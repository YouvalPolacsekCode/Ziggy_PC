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
from typing import Any
from urllib.parse import urlparse

from paho.mqtt import client as mqtt_client

from core.logger_module import log_error


_DEFAULT_BROKER = "mqtt://mosquitto:1883"
_CONNECT_TIMEOUT_S = 5.0
_PUBLISH_TIMEOUT_S = 5.0


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
    host, port, tls, user, pw = _parse_broker(_broker_url())
    client = mqtt_client.Client(callback_api_version=mqtt_client.CallbackAPIVersion.VERSION2)
    if user is not None:
        client.username_pw_set(user, pw or "")
    if tls:
        client.tls_set()
    client.connect(host, port, keepalive=int(_CONNECT_TIMEOUT_S * 2))
    try:
        info = client.publish(topic, payload, qos=qos)
        info.wait_for_publish(timeout=_PUBLISH_TIMEOUT_S)
        if info.rc != mqtt_client.MQTT_ERR_SUCCESS:
            raise RuntimeError(f"publish rc={info.rc}")
    finally:
        client.disconnect()


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
