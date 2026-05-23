"""
Continuous IR receive service — no new hardware required.

Uses the python-broadlink library to access the IR receiver that is already
built into the Broadlink RM4/RM3/RM Pro hardware. Home Assistant uses this
same hardware for sending but never activates its receiver after the learn
wizard. This service keeps the receiver listening permanently.

How it works:
  - One asyncio task per unique blaster_host in ir_devices.json
  - Each task loops: enter_learning → poll check_data → on receipt → match
  - On match: updates device assumed_state + broadcasts to frontend
  - TX and RX are independent circuits on the RM4, so HA can still send
    commands via remote.send_command while the receiver is active
  - Pauses during wizard learn sessions so there's no race for the receiver

Coordination with HA:
  - Sending: HA calls remote.send_command (unchanged). The RM4 executes the
    send from its TX LED; this does not interrupt the RX learning mode.
  - Learning in wizard: caller must call pause_for_learn() / resume_after_learn()
    to temporarily yield the receiver to HA's remote.learn_command flow,
    OR use learn_command_direct() which bypasses HA entirely.
"""
from __future__ import annotations

import asyncio
import base64
import time
from typing import Callable, Optional

from core.logger_module import log_info, log_error

# Per-host pause events — set = paused (wizard is using the receiver)
_pause_events: dict[str, asyncio.Event] = {}
# Per-host task handles (for cancellation)
_tasks: dict[str, asyncio.Task] = {}

# Discovery lock — prevents concurrent subnet scans (each spawns 32 threads)
_discovery_lock: Optional[asyncio.Lock] = None
_discovery_cache: Optional[tuple[list, float]] = None
_DISCOVERY_CACHE_TTL = 60  # seconds — reuse results within 1 minute

# How long the RM4 stays in learn mode before timing out (seconds).
# We re-enter before this so the window is always open.
_LEARN_WINDOW = 28
_POLL_INTERVAL = 0.35  # seconds between check_data() polls


def _all_ir_devices_by_host() -> dict[str, list[dict]]:
    """Group enabled IR devices by their blaster_host (direct IP)."""
    try:
        from services.ir_manager import list_ir_devices
        result: dict[str, list[dict]] = {}
        for d in list_ir_devices(enabled_only=True):
            host = (d.get("blaster_host") or "").strip()
            if host:
                result.setdefault(host, []).append(d)
        return result
    except Exception as e:
        log_error(f"[IRListener] Failed to load IR devices: {e}")
        return {}


# Frames longer than this are treated as "stateful protocol" (AC class) and
# must NOT be matched by the fuzzy pulse comparator — its first-40-pulses
# window covers only the protocol header on long frames, which is identical
# across every press of that remote and causes false-positive matches
# (e.g. pressing power/off on a Tadiran remote matching a previously-learned
# mode_cool button because both share the same Gree leader + first 19 header
# bits). Long frames must go through protocol decode + AC state inference.
_FUZZY_MAX_FRAME_PULSES = 100


def _find_code_match(received_bytes: bytes) -> Optional[tuple[str, str, str]]:
    """
    Scan all ir_devices.json entries for a code matching received_bytes.

    Match strategy, in order:
      1. Exact base64 match — fastest path, hits if Broadlink captures are
         byte-identical (rare in practice; pulse jitter usually breaks this).
      2. Fingerprint match — robust to typical capture jitter via magnitude-
         class leader + median-split body classification.
      3. Protocol-decode payload equivalence — for NEC/Sony/Samsung/LG/AC
         packets, decoded payload hex is the canonical "what was pressed";
         this beats fuzzy because it's semantically exact, not "looks similar".
      4. Fuzzy pulse-array match — per-pulse tolerance fallback for SHORT
         frames only (TV buttons etc.). Long frames go to AC state inference.

    Returns (device_id, logical_command, match_method) on hit, None otherwise.
    `match_method` is one of "exact" | "fingerprint" | "protocol" | "fuzzy".
    """
    try:
        from services.ir_manager import list_ir_devices
        from services.ir_protocol import (
            fingerprint_bytes, fingerprint_b64,
            parse_broadlink_raw, fuzzy_match_pulses,
            decode_protocol_bytes, decode_protocol_b64,
        )

        received_b64 = base64.b64encode(received_bytes).decode()
        devices = list_ir_devices(enabled_only=True)
        total_codes = sum(len(d.get("ir_codes") or {}) for d in devices)

        # Pass 1: exact bytes
        for device in devices:
            ir_codes: dict = device.get("ir_codes") or {}
            for logical_cmd, stored_b64 in ir_codes.items():
                if stored_b64 == received_b64:
                    return device["id"], logical_cmd, "exact"

        # Pass 2: fingerprint
        recv_fp = fingerprint_bytes(received_bytes)
        if recv_fp:
            for device in devices:
                ir_codes = device.get("ir_codes") or {}
                for logical_cmd, stored_b64 in ir_codes.items():
                    if fingerprint_b64(stored_b64) == recv_fp:
                        return device["id"], logical_cmd, "fingerprint"

        # Pass 3: protocol-decode payload equivalence — canonical "what was
        # pressed". Runs BEFORE fuzzy because protocol equality is exact at
        # the semantic layer; fuzzy can false-positive across different
        # buttons of the same stateful remote.
        recv_decode = decode_protocol_bytes(received_bytes)
        if recv_decode:
            for device in devices:
                ir_codes = device.get("ir_codes") or {}
                for logical_cmd, stored_b64 in ir_codes.items():
                    stored_decode = decode_protocol_b64(stored_b64)
                    if (stored_decode is not None
                            and stored_decode.family == recv_decode.family
                            and stored_decode.payload_hex == recv_decode.payload_hex):
                        return device["id"], logical_cmd, "protocol"

        # Pass 4: fuzzy pulse comparison — SHORT frames only.
        recv_pulses = parse_broadlink_raw(received_bytes)
        if recv_pulses and len(recv_pulses) <= _FUZZY_MAX_FRAME_PULSES:
            for device in devices:
                ir_codes = device.get("ir_codes") or {}
                for logical_cmd, stored_b64 in ir_codes.items():
                    try:
                        stored_pulses = parse_broadlink_raw(
                            base64.b64decode(stored_b64)
                        )
                    except Exception:
                        continue
                    # Both sides must be short for fuzzy to apply.
                    if len(stored_pulses) > _FUZZY_MAX_FRAME_PULSES:
                        continue
                    if fuzzy_match_pulses(recv_pulses, stored_pulses):
                        return device["id"], logical_cmd, "fuzzy"

        # No match — diagnostics for the user. Includes the leader pulse
        # timings + magnitude class so the protocol family can be identified
        # from the log even when no decoder catches it (e.g. unknown AC).
        device_summary = ", ".join(
            f"{d.get('name','?')}({len(d.get('ir_codes') or {})} codes)"
            for d in devices
        ) or "none"
        proto_info = (
            f"{recv_decode.family}/{recv_decode.payload_bits}b"
            if recv_decode else "no_protocol"
        )
        leader_info = ""
        if recv_pulses and len(recv_pulses) >= 2:
            try:
                from services.ir_protocol import _magnitude_class
                lm, ls = recv_pulses[0], recv_pulses[1]
                lead_cls = _magnitude_class(lm) + _magnitude_class(ls)
                body_preview = "/".join(str(p) for p in recv_pulses[2:10])
                leader_info = f" leader={lm}µs/{ls}µs({lead_cls}) body={body_preview}"
            except Exception:
                pass
        log_info(
            f"[IRListener] No match (fp={recv_fp} proto={proto_info} "
            f"pulses={len(recv_pulses) if recv_pulses else 0}){leader_info}: "
            f"{total_codes} stored codes across {len(devices)} device(s): "
            f"{device_summary}"
        )
        return None
    except Exception as e:
        log_error(f"[IRListener] Code match scan failed: {e}")
        return None


def _find_ac_state_match(received_bytes: bytes, host: str) -> Optional[tuple[str, "object", str]]:
    """
    Pass 5: when no learned code matches but the packet decodes to a known
    AC protocol, apply the decoded state directly to the (unique) AC device
    on this blaster_host. Returns (device_id, AcState, match_method) or None.

    This is what catches the stateful-AC-remote case: any press from the
    physical AC remote updates state without us having to learn every
    combination of mode/temp/fan/power.
    """
    try:
        from services.ir_manager import list_ir_devices
        from services.ir_protocol import decode_protocol_bytes

        decoded = decode_protocol_bytes(received_bytes)
        if decoded is None or decoded.ac_state is None:
            return None

        # Find AC device(s) on this blaster_host
        ac_devices = [
            d for d in list_ir_devices(enabled_only=True)
            if d.get("type") == "ac"
            and (d.get("blaster_host") or "") == host
        ]
        if not ac_devices:
            log_info(
                f"[IRListener] Decoded {decoded.family} AC state but no AC "
                f"device configured on host={host}"
            )
            return None
        if len(ac_devices) > 1:
            log_info(
                f"[IRListener] Decoded {decoded.family} AC state but multiple "
                f"AC devices on host={host} — ambiguous, skipping state apply"
            )
            return None

        return ac_devices[0]["id"], decoded.ac_state, f"ac_state_decoded:{decoded.family}"
    except Exception as e:
        log_error(f"[IRListener] AC state match failed: {e}")
        return None


def _find_ac_command_match(received_bytes: bytes, host: str) -> Optional[tuple[str, "object", str, str]]:
    """
    Pass 5.5: when the packet decodes to a known *command* protocol (e.g.
    Tadiran short-form temp+/-/fan/swing), apply that command as an
    increment against the AC device's tracked ac_memory. Distinct from
    Pass 5 because the short packet doesn't carry full state — only the
    button that was pressed.

    Returns (device_id, AcCommand, match_method, payload_hex) or None.
    Includes payload_hex so the listener can log the raw bytes — needed
    for reverse-engineering command-bit positions when action is "unknown".
    """
    try:
        from services.ir_manager import list_ir_devices
        from services.ir_protocol import decode_protocol_bytes

        decoded = decode_protocol_bytes(received_bytes)
        if decoded is None or decoded.ac_command is None:
            return None

        ac_devices = [
            d for d in list_ir_devices(enabled_only=True)
            if d.get("type") == "ac"
            and (d.get("blaster_host") or "") == host
        ]
        if not ac_devices:
            return None
        if len(ac_devices) > 1:
            log_info(
                f"[IRListener] Decoded {decoded.family} AC command but multiple "
                f"AC devices on host={host} — ambiguous, skipping"
            )
            return None

        return (
            ac_devices[0]["id"],
            decoded.ac_command,
            f"ac_command_decoded:{decoded.family}",
            decoded.payload_hex,
        )
    except Exception as e:
        log_error(f"[IRListener] AC command match failed: {e}")
        return None


async def _on_code_received(received_bytes: bytes, host: str = "") -> None:
    """Called when the listener captures a code. Matches and updates state."""
    match = _find_code_match(received_bytes)

    # Pass 5: if no learned code matches but the packet decodes to a known AC
    # protocol, apply the decoded HVAC state to the AC device on this blaster.
    # This is what makes stateful AC remotes work — every press updates state,
    # without needing to learn every combination of mode/temp/fan/power.
    if not match:
        ac_match = _find_ac_state_match(received_bytes, host)
        if ac_match:
            device_id, ac_state, method = ac_match
            # Also log the raw payload so the user can paste it back when
            # the decoded state looks wrong — needed to reverse-engineer
            # remaining bit positions (mode, fan, checksum) and verify
            # the temp encoding for ranges we haven't yet observed.
            try:
                from services.ir_protocol import decode_protocol_bytes
                _decode = decode_protocol_bytes(received_bytes)
                payload_hex = _decode.payload_hex if _decode else "?"
            except Exception:
                payload_hex = "?"
            log_info(
                f"[IRListener] AC state inferred: device={device_id} "
                f"power={ac_state.power} mode={ac_state.mode} "
                f"temp={ac_state.temp} fan={ac_state.fan} ({method}) "
                f"payload={payload_hex}"
            )
            try:
                from services.ir_manager import apply_decoded_ac_state, get_ir_device
                applied = apply_decoded_ac_state(device_id, ac_state)
                updated = get_ir_device(device_id) if applied else None
                new_state = (
                    updated.get("assumed_state", "unknown") if updated else "unknown"
                )
                from backend.ws_manager import manager
                await manager.broadcast({
                    "type": "ir_command_detected",
                    "device_id": device_id,
                    "command": f"physical_remote_{ac_state.power or 'state'}",
                    "new_assumed_state": new_state,
                    "source": "physical_remote",
                    "match_method": method,
                    "ac_state": {
                        "power": ac_state.power,
                        "mode": ac_state.mode,
                        "temp": ac_state.temp,
                        "fan": ac_state.fan,
                        "brand": ac_state.brand,
                    },
                })
            except Exception as e:
                log_error(f"[IRListener] AC state apply failed: {e}")
            return

    # Pass 5.5: AC command packets (Tadiran short-form, temp+/-/fan/swing).
    # These don't carry state — they encode the BUTTON that was pressed.
    # Apply as an increment against the AC device's ac_memory.
    if not match:
        cmd_match = _find_ac_command_match(received_bytes, host)
        if cmd_match:
            device_id, ac_command, method, payload_hex = cmd_match
            log_info(
                f"[IRListener] AC command inferred: device={device_id} "
                f"action={ac_command.action} brand={ac_command.brand} "
                f"({method}) payload={payload_hex}"
            )
            try:
                from services.ir_manager import apply_decoded_ac_command, get_ir_device
                applied = apply_decoded_ac_command(device_id, ac_command)
                updated = get_ir_device(device_id) if applied else None
                from backend.ws_manager import manager
                await manager.broadcast({
                    "type": "ir_command_detected",
                    "device_id": device_id,
                    "command": f"physical_remote_{ac_command.action}",
                    "new_assumed_state": (updated or {}).get("assumed_state", "unknown") if updated else "unknown",
                    "source": "physical_remote",
                    "match_method": method,
                    # Send the full ac_memory snapshot so the frontend chip
                    # reflects the incremented value immediately. The
                    # decoder only knows "+1 temp" — the manager applied
                    # it to whatever ac_memory was, and that result is
                    # what the UI needs.
                    "ac_state": {
                        "power": (updated or {}).get("assumed_state"),
                        "mode":  ((updated or {}).get("ac_memory") or {}).get("mode"),
                        "temp":  ((updated or {}).get("ac_memory") or {}).get("temp"),
                        "fan":   ((updated or {}).get("ac_memory") or {}).get("fan"),
                        "brand": ac_command.brand,
                    },
                })
            except Exception as e:
                log_error(f"[IRListener] AC command apply failed: {e}")
            return

    if not match:
        # Unknown code — persist to the unassigned queue and broadcast so the
        # UI's "Unassigned signals" panel can offer to bind it to a device.
        code_b64 = base64.b64encode(received_bytes).decode()
        try:
            from services.ir_protocol import fingerprint_bytes, parse_broadlink_raw
            from services.ir_unassigned import record_signal

            pulses = parse_broadlink_raw(received_bytes)
            fp = fingerprint_bytes(received_bytes)
            entry = record_signal(
                code_b64,
                blaster_host=host,
                fingerprint=fp,
                pulse_count=len(pulses),
            )
            log_info(
                f"[IRListener] Unassigned signal queued id={entry.get('id')} "
                f"fp={fp} pulses={len(pulses)} count={entry.get('count')}"
            )
        except Exception as e:
            log_error(f"[IRListener] Failed to queue unassigned signal: {e}")
            entry = None

        try:
            from backend.ws_manager import manager
            await manager.broadcast({
                "type": "ir_unknown_signal",
                "signal_id": (entry or {}).get("id"),
                "fingerprint": (entry or {}).get("fingerprint"),
                "code_b64": code_b64,
                "blaster_host": host,
            })
        except Exception:
            pass
        return

    device_id, logical_cmd, match_method = match
    log_info(
        f"[IRListener] Physical remote: device={device_id} command={logical_cmd} "
        f"match={match_method}"
    )

    # Re-use the same post-command logic as Ziggy's own sends
    try:
        from services.ir_manager import get_ir_device
        from services.ir_manager import _after_command  # type: ignore[attr-defined]
        device = get_ir_device(device_id)
        if device:
            _after_command(device_id, device, logical_cmd)

        # Reload to get the state _after_command just wrote
        updated = get_ir_device(device_id)
        new_state = updated.get("assumed_state", "unknown") if updated else "unknown"

        # Broadcast so the frontend updates the device card immediately — no refresh needed
        from backend.ws_manager import manager
        await manager.broadcast({
            "type": "ir_command_detected",
            "device_id": device_id,
            "command": logical_cmd,
            "new_assumed_state": new_state,
            "source": "physical_remote",
            "match_method": match_method,
        })
    except Exception as e:
        log_error(f"[IRListener] State update after detection failed: {e}")


async def _listen_loop(host: str) -> None:
    """
    Continuous learn-receive loop for one Broadlink device host.
    Runs until task is cancelled.
    """
    import broadlink
    loop = asyncio.get_event_loop()

    pause_event = _pause_events.setdefault(host, asyncio.Event())
    dev: Optional[object] = None

    def _connect() -> Optional[object]:
        try:
            d = broadlink.hello(host)
            d.auth()
            return d
        except Exception as e:
            log_error(f"[IRListener] Cannot connect to Broadlink at {host}: {e}")
            return None

    def _enter_learning(d) -> bool:
        try:
            d.enter_learning()
            return True
        except Exception as e:
            log_error(f"[IRListener] enter_learning failed on {host}: {e}")
            return False

    def _check_data(d) -> Optional[bytes]:
        try:
            return d.check_data()
        except Exception:
            return None

    log_info(f"[IRListener] Starting listener for {host}")

    _fail_count = 0          # consecutive connection failures
    _retry_delay = 10        # starts at 10s, caps at 300s
    _MAX_RETRY = 300
    _SUPPRESS_AFTER = 3      # stop logging errors after this many consecutive failures

    while True:
        # Reconnect if needed
        if dev is None:
            dev = await loop.run_in_executor(None, _connect)
            if dev is None:
                _fail_count += 1
                # Only log the first N failures; after that, stay silent until recovered.
                if _fail_count == _SUPPRESS_AFTER:
                    log_error(f"[IRListener] {host} unreachable after {_fail_count} attempts — suppressing further errors until reconnected.")
                elif _fail_count > _SUPPRESS_AFTER:
                    pass  # silent
                # Exponential backoff: 10 → 20 → 40 → … → 300s
                _retry_delay = min(_retry_delay * 2, _MAX_RETRY)
                await asyncio.sleep(_retry_delay)
                continue
            # Reconnected — reset backoff and log recovery if we were suppressed
            if _fail_count >= _SUPPRESS_AFTER:
                log_info(f"[IRListener] {host} reconnected after {_fail_count} failed attempts.")
            _fail_count = 0
            _retry_delay = 10

        # Respect pause (wizard is using the receiver)
        if pause_event.is_set():
            await asyncio.sleep(0.5)
            continue

        # Enter learning mode
        ok = await loop.run_in_executor(None, _enter_learning, dev)
        if not ok:
            dev = None  # force reconnect
            await asyncio.sleep(5)
            continue

        window_start = time.monotonic()

        while True:
            # Paused mid-window? Yield immediately; wizard will re-enter its own learn.
            if pause_event.is_set():
                break

            elapsed = time.monotonic() - window_start
            if elapsed >= _LEARN_WINDOW:
                break  # timeout — outer loop re-enters learning immediately

            data = await loop.run_in_executor(None, _check_data, dev)
            if data:
                await _on_code_received(bytes(data), host=host)
                break  # break inner loop to re-enter learning for the next signal

            await asyncio.sleep(_POLL_INTERVAL)


async def start_listener() -> None:
    """
    Discover all configured blaster_hosts and launch a listen loop for each.
    Called once at server startup. Safe to call if no hosts configured (no-op).
    """
    by_host = _all_ir_devices_by_host()
    if not by_host:
        log_info("[IRListener] No blaster_host configured — IR receive not active. "
                 "Set blaster_host on an IR device to enable physical remote detection.")
        return

    for host in by_host:
        if host not in _tasks or _tasks[host].done():
            task = asyncio.create_task(_listen_loop(host), name=f"ir_listener_{host}")
            _tasks[host] = task
            log_info(f"[IRListener] Listener task started for host={host}")


def restart_listener_for_host(host: str) -> None:
    """
    Cancel and restart the listener for a specific host.
    Call when a device's blaster_host is added or changed.
    """
    if host in _tasks and not _tasks[host].done():
        _tasks[host].cancel()

    async def _restart():
        await asyncio.sleep(0.5)
        if host:
            task = asyncio.create_task(_listen_loop(host), name=f"ir_listener_{host}")
            _tasks[host] = task
            log_info(f"[IRListener] Listener restarted for host={host}")

    try:
        loop = asyncio.get_event_loop()
        loop.create_task(_restart())
    except RuntimeError:
        pass


def pause_for_learn(host: str) -> None:
    """Pause the listener on host so the wizard can use the receiver."""
    ev = _pause_events.setdefault(host, asyncio.Event())
    ev.set()
    log_info(f"[IRListener] Paused for learn on {host}")


def resume_after_learn(host: str) -> None:
    """Resume the listener on host after the wizard is done."""
    ev = _pause_events.get(host)
    if ev:
        ev.clear()
    log_info(f"[IRListener] Resumed after learn on {host}")


async def learn_command_direct(host: str, timeout: int = 20) -> Optional[bytes]:
    """
    Put the Broadlink at `host` in learning mode and wait for a code.
    Pauses the background listener for the duration.
    Returns raw bytes of the captured code, or None on timeout.

    This replaces HA's remote.learn_command for devices with blaster_host set.
    The raw bytes are stored in ir_devices.json under ir_codes, enabling
    both direct sending and receive matching.
    """
    import broadlink
    loop = asyncio.get_event_loop()

    pause_for_learn(host)
    try:
        def _connect_and_learn():
            d = broadlink.hello(host)
            d.auth()
            d.enter_learning()
            return d

        dev = await loop.run_in_executor(None, _connect_and_learn)

        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            def _check(d):
                try:
                    return d.check_data()
                except Exception:
                    return None

            data = await loop.run_in_executor(None, _check, dev)
            if data:
                return bytes(data)
            await asyncio.sleep(0.35)

        return None
    except Exception as e:
        log_error(f"[IRListener] learn_command_direct failed on {host}: {e}")
        return None
    finally:
        resume_after_learn(host)


async def discover_broadlink_devices(timeout: int = 8) -> list[dict]:
    """
    Find Broadlink devices on the local network.

    Phase 1 — UDP broadcast (~3s, works on most networks)
    Phase 2 — Subnet scan (targets each /24 IP directly, for when broadcast
               is blocked by Windows Firewall or router)

    Results are cached for 60 seconds. Concurrent calls wait for the
    first call's result rather than launching duplicate scans.
    """
    global _discovery_lock, _discovery_cache

    # Lazy-init the lock (must be created inside an event loop)
    if _discovery_lock is None:
        _discovery_lock = asyncio.Lock()

    # Return cached result if fresh
    if _discovery_cache is not None:
        cached_result, cached_at = _discovery_cache
        if time.monotonic() - cached_at < _DISCOVERY_CACHE_TTL:
            return cached_result

    # If a scan is already running, wait for it to finish then return its cache
    if _discovery_lock.locked():
        async with _discovery_lock:
            if _discovery_cache is not None:
                return _discovery_cache[0]
            return []

    async with _discovery_lock:
        # Re-check cache after acquiring lock (another coroutine may have filled it)
        if _discovery_cache is not None:
            cached_result, cached_at = _discovery_cache
            if time.monotonic() - cached_at < _DISCOVERY_CACHE_TTL:
                return cached_result

        import broadlink
        import socket
        import ipaddress
        import concurrent.futures
        loop = asyncio.get_event_loop()

        def _device_info(dev) -> dict:
            dev_type = getattr(dev, "TYPE", None) or str(getattr(dev, "devtype", ""))
            host = dev.host[0] if isinstance(dev.host, tuple) else dev.host
            return {
                "host": host,
                "mac": ":".join(f"{b:02x}" for b in dev.mac),
                "type": dev_type,
                "name": getattr(dev, "name", "").strip() or f"Broadlink {dev_type}",
            }

        def _try_hello(ip: str) -> dict | None:
            try:
                dev = broadlink.hello(ip, timeout=1)
                dev.auth()
                return _device_info(dev)
            except Exception:
                return None

        def _scan() -> list[dict]:
            found: list[dict] = []
            seen: set[str] = set()

            # Phase 1: UDP broadcast
            try:
                for dev in broadlink.discover(timeout=3):
                    try:
                        dev.auth()
                        info = _device_info(dev)
                        if info["host"] not in seen:
                            found.append(info)
                            seen.add(info["host"])
                    except Exception:
                        pass
            except Exception:
                pass

            if found:
                return found

            # Phase 2: Subnet scan
            log_info("[IRListener] Broadcast found nothing — scanning subnet directly")
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                    s.connect(("8.8.8.8", 80))
                    local_ip = s.getsockname()[0]
                network = ipaddress.IPv4Network(f"{local_ip}/24", strict=False)
                candidates = [str(h) for h in network.hosts() if str(h) != local_ip]
            except Exception as e:
                log_error(f"[IRListener] Subnet detection failed: {e}")
                return found

            # 32 workers: ~4s for 254 IPs at 1s timeout, manageable thread count
            with concurrent.futures.ThreadPoolExecutor(max_workers=32) as pool:
                for result in pool.map(_try_hello, candidates):
                    if result and result["host"] not in seen:
                        found.append(result)
                        seen.add(result["host"])

            return found

        result = await loop.run_in_executor(None, _scan)
        _discovery_cache = (result, time.monotonic())
        return result


async def send_ir_direct(host: str, code_b64: str) -> bool:
    """
    Send a raw IR code directly via python-broadlink (no HA intermediation).
    Returns True on success.
    """
    import broadlink
    loop = asyncio.get_event_loop()

    def _send():
        try:
            raw = base64.b64decode(code_b64)
            dev = broadlink.hello(host)
            dev.auth()
            dev.send_data(raw)
            return True
        except Exception as e:
            log_error(f"[IRListener] send_ir_direct to {host} failed: {e}")
            return False

    return await loop.run_in_executor(None, _send)
