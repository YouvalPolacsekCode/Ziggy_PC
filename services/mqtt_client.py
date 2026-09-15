"""
Minimal MQTT publish helper for Ziggy.

Used by services/ha_zigbee.py to drive Zigbee2MQTT's bridge topics
(permit-join, restart, rename-device, etc.). Connection-per-publish:
Z2M control messages are rare enough that a persistent client would
just be a moving part to monitor — connect, publish, disconnect.

Broker URL precedence:
  1. ZIGGY_MQTT_URL env var ('mqtt://host:port' or 'mqtts://...')
  2. settings.yaml -> mqtt.url
  3. Default 'mqtt://mosquitto:1883' (the in-compose broker name)
"""
from __future__ import annotations

import asyncio
import json
import os
import threading
import time
from typing import Any
from urllib.parse import urlparse

from paho.mqtt import client as mqtt_client

from core.logger_module import log_error


_DEFAULT_BROKER = "mqtt://mosquitto:1883"
_CONNECT_TIMEOUT_S = 5.0
_PUBLISH_TIMEOUT_S = 5.0
# Wildcard retained-backlog drain (see `collect_retained`): stop after this
# long with no new message, and never hold the connection open past the cap.
_COLLECT_SETTLE_S = 0.6
_COLLECT_MAX_S = 10.0


def _broker_url() -> str:
    env = os.environ.get("ZIGGY_MQTT_URL")
    if env:
        return env
    try:
        from core.settings_loader import load_settings
        url = (load_settings().get("mqtt") or {}).get("url")
        if url:
            return url
    except Exception:
        pass
    return _DEFAULT_BROKER


def _settings_credentials() -> tuple[str | None, str | None]:
    """Discrete mqtt.username / mqtt.password from settings, or (None, None).

    Prod mosquitto runs with auth enabled but the broker URL is often just
    `mqtt://host:1883` (no embedded creds); the credentials live in the discrete
    settings fields instead. Empty strings are treated as "unset".
    """
    try:
        from core.settings_loader import load_settings
        m = load_settings().get("mqtt") or {}
        user = m.get("username") or None
        pw = m.get("password")
        pw = pw if pw not in ("", None) else None
        return user, pw
    except Exception:
        return None, None


def _parse_broker(url: str) -> tuple[str, int, bool, str | None, str | None]:
    """Return (host, port, tls, username, password). Defaults: 1883 plaintext."""
    p = urlparse(url)
    if p.scheme not in ("mqtt", "mqtts"):
        raise ValueError(f"unsupported MQTT scheme: {p.scheme!r}")
    return (
        p.hostname or "mosquitto",
        p.port or (8883 if p.scheme == "mqtts" else 1883),
        p.scheme == "mqtts",
        p.username,
        p.password,
    )


def _publish_sync(topic: str, payload: bytes, qos: int) -> None:
    """Connect, wait for CONNACK, publish, disconnect.

    Why we wait for CONNACK instead of just calling client.connect():
    paho's `connect()` only performs the TCP handshake — it does NOT
    block until the broker accepts the CONNECT packet. So if the
    broker rejects credentials (rc=5 "Not authorised"), the publish
    call further down silently no-ops (the message gets queued on a
    disconnected client). The caller sees no error.

    This bit Ziggy on the ZHA→Z2M cut-over: settings.yaml had
    `mqtt://host:1883` with no credentials after a fresh Mosquitto
    user was created; every Ziggy-side permit-join publish vanished
    into the void while `_publish_sync` returned cleanly. Switching
    to loop_start + on_connect wait makes auth failures raise loudly.
    """
    host, port, tls, user, pw = _parse_broker(_broker_url())
    # Fallback: if the URL carried no credentials, use the discrete
    # mqtt.username / mqtt.password settings fields (the prod auth home).
    if user is None:
        fb_user, fb_pw = _settings_credentials()
        if fb_user is not None:
            user = fb_user
            pw = pw if pw is not None else fb_pw
    client = mqtt_client.Client(callback_api_version=mqtt_client.CallbackAPIVersion.VERSION2)
    if user is not None:
        client.username_pw_set(user, pw or "")
    if tls:
        client.tls_set()

    connack: dict = {"rc": None}
    ready = threading.Event()

    def _on_connect(_c, _u, _flags, reason_code, _props):
        connack["rc"] = reason_code
        ready.set()

    client.on_connect = _on_connect

    client.connect(host, port, keepalive=int(_CONNECT_TIMEOUT_S * 2))
    client.loop_start()
    try:
        if not ready.wait(timeout=_CONNECT_TIMEOUT_S):
            raise RuntimeError("MQTT connect timeout (no CONNACK)")
        rc = connack["rc"]
        # In paho v2 CallbackAPIVersion.VERSION2 the reason_code is a
        # ReasonCode object — check is_failure (True for any non-Success
        # CONNACK including auth rejection). Fall back to int compare
        # for older paho behavior.
        is_fail = getattr(rc, "is_failure", None)
        if is_fail is True or (is_fail is None and int(rc) != 0):
            raise RuntimeError(f"MQTT connect failed: {rc}")
        info = client.publish(topic, payload, qos=qos)
        info.wait_for_publish(timeout=_PUBLISH_TIMEOUT_S)
        if info.rc != mqtt_client.MQTT_ERR_SUCCESS:
            raise RuntimeError(f"publish rc={info.rc}")
    finally:
        client.loop_stop()
        client.disconnect()


def _decode_retained(payload: bytes) -> Any:
    """Retained payloads are JSON on Z2M's bridge topics, plain text elsewhere."""
    text = payload.decode("utf-8", "replace") if isinstance(payload, (bytes, bytearray)) else str(payload)
    try:
        return json.loads(text)
    except Exception:
        return text


def _read_retained_sync(topic: str, timeout: float) -> bytes | None:
    """Connect, subscribe, wait for the retained message, disconnect.

    Retained messages arrive immediately on subscribe, so this is a short
    round-trip — but if the topic has no retained value nothing ever arrives,
    hence the timeout. Same CONNACK discipline as :func:`_publish_sync`: paho's
    connect() only does the TCP handshake, so an auth rejection would otherwise
    look like an empty topic.
    """
    host, port, tls, user, pw = _parse_broker(_broker_url())
    if user is None:
        fb_user, fb_pw = _settings_credentials()
        if fb_user is not None:
            user = fb_user
            pw = pw if pw is not None else fb_pw
    client = mqtt_client.Client(callback_api_version=mqtt_client.CallbackAPIVersion.VERSION2)
    if user is not None:
        client.username_pw_set(user, pw or "")
    if tls:
        client.tls_set()

    got: dict = {"payload": None}
    arrived = threading.Event()
    connack: dict = {"rc": None}
    ready = threading.Event()

    def _on_connect(_c, _u, _flags, reason_code, _props):
        connack["rc"] = reason_code
        ready.set()

    def _on_message(_c, _u, msg):
        got["payload"] = msg.payload
        arrived.set()

    client.on_connect = _on_connect
    client.on_message = _on_message

    client.connect(host, port, keepalive=int(_CONNECT_TIMEOUT_S * 2))
    client.loop_start()
    try:
        if not ready.wait(timeout=_CONNECT_TIMEOUT_S):
            raise RuntimeError("MQTT connect timeout (no CONNACK)")
        rc = connack["rc"]
        is_fail = getattr(rc, "is_failure", None)
        if is_fail is True or (is_fail is None and int(rc) != 0):
            raise RuntimeError(f"MQTT connect failed: {rc}")
        client.subscribe(topic, qos=0)
        arrived.wait(timeout=timeout)
        return got["payload"]
    finally:
        client.loop_stop()
        client.disconnect()


async def read_retained(topic: str, timeout: float = 3.0) -> Any:
    """Read one retained message, decoded. Returns None if there isn't one.

    Best-effort by contract — a home with no broker, a broker that's down, or a
    topic nobody retained all yield None rather than an error, so a diagnostic
    that consults MQTT still works on homes that have none.
    """
    try:
        raw = await asyncio.to_thread(_read_retained_sync, topic, timeout)
    except Exception as e:
        log_error(f"[mqtt] read {topic} failed: {e}")
        return None
    if raw is None:
        return None
    return _decode_retained(raw)


def _collect_retained_sync(topic_filters: list[str], settle_s: float) -> list[tuple[str, bytes]]:
    """Subscribe to one or more filters, drain the retained backlog, disconnect.

    Distinct from `_read_retained_sync`, which fetches ONE known topic. Here the
    topics are not known ahead of time (`homeassistant/device_automation/#`), so
    there is nothing to wait *for*: retained messages arrive in a burst after
    SUBACK and the broker never says "that's all of them". We therefore wait
    `settle_s` after the *last* message rather than a fixed total — a hub with
    200 retained discovery topics needs longer than one with 5, and a fixed
    multi-second poll on every device-list fetch would be its own problem.
    """
    host, port, tls, user, pw = _parse_broker(_broker_url())
    if user is None:
        fb_user, fb_pw = _settings_credentials()
        if fb_user is not None:
            user = fb_user
            pw = pw if pw is not None else fb_pw

    client = mqtt_client.Client(callback_api_version=mqtt_client.CallbackAPIVersion.VERSION2)
    if user is not None:
        client.username_pw_set(user, pw or "")
    if tls:
        client.tls_set()

    out: list[tuple[str, bytes]] = []
    lock = threading.Lock()
    last = threading.Event()
    connack: dict = {"rc": None}
    ready = threading.Event()

    def _on_connect(c, _u, _flags, reason_code, _props):
        connack["rc"] = reason_code
        ready.set()
        if not getattr(reason_code, "is_failure", False):
            c.subscribe([(f, 0) for f in topic_filters])

    def _on_message(_c, _u, msg):
        with lock:
            out.append((msg.topic, bytes(msg.payload)))
        last.set()

    client.on_connect = _on_connect
    client.on_message = _on_message

    client.connect(host, port, keepalive=int(_CONNECT_TIMEOUT_S * 2))
    client.loop_start()
    try:
        if not ready.wait(timeout=_CONNECT_TIMEOUT_S):
            raise RuntimeError("MQTT connect timeout (no CONNACK)")
        rc = connack["rc"]
        is_fail = getattr(rc, "is_failure", None)
        if is_fail is True or (is_fail is None and int(rc) != 0):
            raise RuntimeError(f"MQTT connect failed: {rc}")
        deadline = time.monotonic() + _COLLECT_MAX_S
        while time.monotonic() < deadline:
            last.clear()
            if not last.wait(timeout=settle_s):
                break  # nothing new for settle_s -> backlog drained
    finally:
        client.loop_stop()
        client.disconnect()
    with lock:
        return list(out)


async def collect_retained(topic_filters: str | list[str],
                           settle_s: float = _COLLECT_SETTLE_S) -> list[tuple[str, Any]]:
    """Read every retained message under one or more topic filters.

    Payloads are decoded with `_decode_retained`, EXCEPT an empty payload, which
    yields None. That distinction matters: publishing an empty retained payload
    is how MQTT retracts a topic, and a caller must be able to tell "this was
    withdrawn" from "this is an empty object".
    """
    filters = [topic_filters] if isinstance(topic_filters, str) else list(topic_filters)
    raw = await asyncio.to_thread(_collect_retained_sync, filters, settle_s)
    decoded: list[tuple[str, Any]] = []
    for topic, body in raw:
        decoded.append((topic, _decode_retained(body) if body else None))
    return decoded


async def publish(topic: str, payload: Any, qos: int = 0) -> None:
    """Connect, publish one message, disconnect. Raises on failure.

    `payload` may be bytes/str (passed through), or any JSON-serialisable
    value (encoded as UTF-8 JSON, the canonical format for Z2M control
    topics).
    """
    if isinstance(payload, (bytes, bytearray)):
        body = bytes(payload)
    elif isinstance(payload, str):
        body = payload.encode("utf-8")
    else:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    try:
        await asyncio.to_thread(_publish_sync, topic, body, qos)
    except Exception as e:
        log_error(f"[mqtt] publish {topic} failed: {e}")
        raise
