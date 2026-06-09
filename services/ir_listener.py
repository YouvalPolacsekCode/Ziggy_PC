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

# Per-host "last rediscovery attempted at" timestamp — keeps us from triggering
# a LAN broadcast on every single retry inside a tight failure loop. Honoured
# by `_hello_with_rediscovery` below.
_rediscovery_cooldown: dict[str, float] = {}
_REDISCOVERY_COOLDOWN_S = 20.0


# Pretty labels for Broadlink hardware type strings reported by
# python-broadlink. Used by `_humanize_broadlink_name` when the device's
# self-reported `name` looks like a factory default.
_BROADLINK_TYPE_LABELS = {
    "RM4MINI":   "RM4 Mini",
    "RM4PRO":    "RM4 Pro",
    "RM4MINIB":  "RM4 Mini",
    "RM4C":      "RM4C",
    "RM3MINI":   "RM3 Mini",
    "RM3PROPLUS":"RM3 Pro+",
    "RMMINIB":   "RM Mini",
    "RMPRO":     "RM Pro",
    "RMPLUS":    "RM Plus",
    "MP1":       "MP1",
    "SP2":       "SP2",
    "SP3":       "SP3",
}

# Factory-default device names from Broadlink + common IR-blaster brands
# that Ziggy may discover (some flash Broadlink-compatible firmware and
# show up via python-broadlink's discover). All are exact, case-folded
# matches against the device's self-reported name. Anything not in this
# list AND not entirely non-ASCII is treated as user-customized and
# preserved as-typed.
_BROADLINK_FACTORY_NAMES = frozenset({
    # Broadlink cloud defaults (the dominant case worldwide)
    "智能遥控",         # zh: Smart Remote — every unit ships with this
    "万能遥控",         # zh: Universal Remote — older RM3 variants
    "万能遥控器",       # zh: Universal Remote (formal)
    "智能遥控器",       # zh: Smart Remote (formal)
    "远程遥控",         # zh: Remote Control
    "黑豆",             # zh: "Black Bean" — RM3 mini's nickname
    "smart remote",
    "smart ir",
    "universal remote",
    "broadlink",
    "broadlink rm",
    # IHC / OEM clones that flash a Broadlink-compatible firmware
    "ihc",
    "ir hub",
    "ir blaster",
    "blaster",
    # Tuya-rebranded IR hubs that some integrations route through here
    "smart ir remote",
    "智能红外遥控",     # zh: Smart Infrared Remote (Tuya)
    "红外遥控",         # zh: Infrared Remote
    # Xiaomi / Mi (when discoverable on the same protocol)
    "米家万能遥控",     # zh: Mi Home Universal Remote
    "万能遥控器pro",    # zh: Universal Remote Pro
    # Generic placeholders
    "device",
    "new device",
    "untitled",
    "(null)",
    "none",
})


def _humanize_broadlink_name(raw: str, type_str: str, mac: bytes) -> str:
    """Replace factory-default IR-blaster names with something readable.

    Returns the raw name as-is when the user has customized it. Replaces
    when:
      1. Empty / null / whitespace-only.
      2. Exact match (case-folded, whitespace-trimmed) against the known
         factory-default list above.
      3. Entirely non-ASCII (the device has not been renamed in any app —
         user-typed mixed-locale strings like "Living Room 客厅" still
         contain ASCII and are preserved).

    Replacement format: "Broadlink RM4 Mini · FC67" — pretty type label
    plus the MAC's last 4 hex chars. The MAC suffix disambiguates homes
    with multiple identical units, which a commercial-tier installation
    will commonly have.
    """
    name = (raw or "").strip()
    has_ascii = any(c.isascii() and c.isalnum() for c in name)
    looks_factory = (
        not name
        or not has_ascii                            # Chinese / Cyrillic / Arabic / Japanese / etc.
        or name.lower() in _BROADLINK_FACTORY_NAMES
    )
    if not looks_factory:
        return name
    pretty_type = _BROADLINK_TYPE_LABELS.get(
        (type_str or "").upper(),
        (type_str or "Blaster").replace("_", " ").title(),
    )
    short_mac = ""
    try:
        short_mac = mac.hex()[-4:].upper() if mac else ""
    except Exception:
        pass
    return f"Broadlink {pretty_type}" + (f" · {short_mac}" if short_mac else "")


def _norm_mac(mac) -> str:
    """Canonical lowercase-hex MAC, no separators.

    `dev.mac.hex()` gives `ec0bae6afc67`; user-facing UI strings come in as
    `ec:0b:ae:6a:fc:67` or `EC-0B-AE-6A-FC-67`. We strip and lowercase so
    every comparison through the rediscovery path is symmetric regardless
    of which source the MAC originated from.
    """
    if not mac:
        return ""
    if isinstance(mac, (bytes, bytearray)):
        return mac.hex().lower()
    return str(mac).replace(":", "").replace("-", "").replace(" ", "").lower()


def _hello_with_rediscovery(host: str, timeout: int = 3):
    """`broadlink.hello(host)` with automatic LAN-rediscovery on failure.

    Broadlink devices get their IP via DHCP, so the address Ziggy has cached
    in `ir_devices.json` goes stale every time the router reboots or the
    lease rotates. Without recovery, every IR send fails until the user
    manually re-enters the new IP. This wrapper:

      1. Tries the cached host first (fast path, identical to upstream).
         On success, lazy-backfills the device's MAC if it wasn't stored
         (handles records created before MAC capture was added) AND marks
         the matching blaster registry row as last-seen-just-now.
      2. On failure, throttle-checks the rediscovery cooldown — we don't
         want to broadcast-scan the LAN on every retry inside a tight loop.
      3. If allowed, runs `broadlink.discover()`. When the device's MAC is
         known we match by MAC (handles multi-Broadlink homes correctly).
         When MAC isn't known and exactly one Broadlink answers, we accept
         that as the device. Multiple-without-MAC re-raises rather than
         guessing.
      4. Persists the new IP back to `ir_devices.json` + the blaster
         registry (the authoritative source for blaster identity) and
         returns the live device handle so the caller can complete its send.
    """
    import broadlink
    try:
        dev = broadlink.hello(host, timeout=timeout)
        mac_norm = _norm_mac(dev.mac)
        # Lazy MAC backfill — store on first successful contact so future
        # rediscoveries can disambiguate even in multi-Broadlink homes.
        try:
            _persist_blaster_mac(host, mac_norm)
        except Exception:
            pass
        # Registry heartbeat: mark this blaster as freshly contacted, so the
        # UI's status chip reads "online" and last_seen_at is accurate.
        try:
            from services import ir_blasters as _bl
            row = _bl.get_by_mac(mac_norm) if mac_norm else _bl.get_by_host(host)
            if row:
                _bl.mark_seen(row["id"], host)
        except Exception:
            pass
        return dev
    except Exception as e:
        now = time.monotonic()
        last = _rediscovery_cooldown.get(host, 0.0)
        if (now - last) < _REDISCOVERY_COOLDOWN_S:
            raise
        _rediscovery_cooldown[host] = now
        log_info(f"[IR] hello({host}) failed ({type(e).__name__}); attempting LAN rediscovery")
        try:
            found = broadlink.discover(timeout=3)
        except Exception as disc_err:
            log_error(f"[IR] LAN rediscovery failed: {disc_err}")
            raise e
        if not found:
            log_error("[IR] No Broadlink answered LAN broadcast — device powered off or off-network?")
            raise e

        # MAC-anchored disambiguation: prefer the device whose MAC matches
        # this host's known MAC. Falls back to "single device" heuristic
        # only when no MAC is stored (legacy records).
        known_macs = _lookup_blaster_macs_for_host(host)
        new_dev = None
        if known_macs:
            for d in found:
                if _norm_mac(d.mac) in known_macs:
                    new_dev = d
                    break
            if new_dev is None:
                log_error(
                    f"[IR] {len(found)} Broadlinks on LAN but none match known "
                    f"MAC(s) {sorted(known_macs)} for host={host} — leaving config unchanged"
                )
                raise e
        elif len(found) == 1:
            new_dev = found[0]
        else:
            ips = [d.host[0] for d in found]
            log_error(
                f"[IR] {len(found)} Broadlinks on LAN ({ips}); can't auto-pick "
                f"without stored MAC for host={host} — re-pair the device to record its MAC"
            )
            raise e

        new_host = new_dev.host[0]
        if new_host == host:
            # Same IP yet hello() still failed — actually a device problem,
            # not an IP-change problem. Don't rewrite the config.
            raise e
        log_info(f"[IR] Broadlink IP changed: {host} → {new_host}; updating registry + ir_devices.json")
        new_mac = _norm_mac(new_dev.mac)
        try:
            _persist_blaster_host_change(host, new_host)
            _persist_blaster_mac(new_host, new_mac)
        except Exception as save_err:
            log_error(f"[IR] Failed to persist new blaster IP {new_host}: {save_err}")
            # Don't fail the send — we still have a live device handle.
        # Also bump the canonical registry row (matched by MAC, since IP
        # just changed). mark_seen handles the IP update + last_seen
        # atomically. Failure here is non-fatal — the send still works
        # via the live handle and the legacy JSON fields are already
        # patched above.
        try:
            from services import ir_blasters as _bl
            row = _bl.get_by_mac(new_mac) if new_mac else None
            if row:
                _bl.mark_seen(row["id"], new_host)
        except Exception:
            pass
        return new_dev


def _persist_blaster_host_change(old_host: str, new_host: str) -> int:
    """Rewrite every reference to `old_host` in ir_devices.json to `new_host`.

    Touches both `blaster_host` and the synthesized `blaster_entity_id`
    (which embeds the host as `direct_<ip>`). Returns the number of
    device records updated. Best-effort: a failed save logs but doesn't
    raise — the in-memory device handle is still usable.
    """
    from services.ir_manager import _load as _ir_load, _save as _ir_save
    devices = _ir_load()
    changed = 0
    for d in devices:
        if (d.get("blaster_host") or "").strip() == old_host:
            d["blaster_host"] = new_host
            changed += 1
        beid = (d.get("blaster_entity_id") or "")
        if beid == f"direct_{old_host}":
            d["blaster_entity_id"] = f"direct_{new_host}"
    if changed:
        _ir_save(devices)
    return changed


def _persist_blaster_mac(host: str, mac: str) -> int:
    """Record `mac` for every ir_devices.json row pointing at `host`.

    Idempotent: skip rows that already have the same MAC. Returns the
    number of records updated. Lazy backfill path: records created before
    MAC capture was added pick up their MAC on the first successful
    contact, which lets future rediscoveries pick the right device even
    in homes with multiple Broadlinks.
    """
    if not mac or not host:
        return 0
    from services.ir_manager import _load as _ir_load, _save as _ir_save
    devices = _ir_load()
    changed = 0
    for d in devices:
        if (d.get("blaster_host") or "").strip() != host:
            continue
        if _norm_mac(d.get("blaster_mac")) != mac:
            d["blaster_mac"] = mac
            changed += 1
    if changed:
        _ir_save(devices)
    return changed


def _lookup_blaster_macs_for_host(host: str) -> set[str]:
    """Return every distinct MAC stored against `host`. Usually 0 or 1.

    Returns an empty set for hosts that haven't yet been MAC-anchored —
    callers treat that as "fall back to the legacy single-device heuristic."
    """
    from services.ir_manager import _load as _ir_load
    macs: set[str] = set()
    for d in _ir_load():
        if (d.get("blaster_host") or "").strip() != host:
            continue
        m = _norm_mac(d.get("blaster_mac"))
        if m:
            macs.add(m)
    return macs


async def warmup_blaster_connections() -> None:
    """Probe each cached blaster_host once at boot to refresh stale IPs.

    Without this, the *first* IR command of the day after an overnight
    DHCP IP change takes a noticeable 2–3s hit while `_hello_with_rediscovery`
    runs its broadcast scan inline. Running the same probe at startup
    folds that cost into background warmup so the user-perceived send
    latency stays sub-100ms even when the IP has rotated.

    Best-effort: any probe that fails was already logged inside the helper.
    """
    by_host = list(_all_ir_devices_by_host().keys())
    if not by_host:
        return
    loop = asyncio.get_event_loop()

    def _probe(h: str):
        try:
            _hello_with_rediscovery(h, timeout=2)
        except Exception:
            pass   # Already logged inside the helper.

    await asyncio.gather(
        *[loop.run_in_executor(None, _probe, h) for h in by_host],
        return_exceptions=True,
    )
    log_info(f"[IRListener] Warmup probed {len(by_host)} blaster host(s)")


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
                from services.ir_manager import (
                    apply_decoded_ac_state, get_ir_device,
                    get_device_state_snapshot,
                )
                applied = apply_decoded_ac_state(device_id, ac_state)
                updated = get_ir_device(device_id) if applied else None
                new_state = (
                    updated.get("assumed_state", "unknown") if updated else "unknown"
                )
                snapshot = get_device_state_snapshot(updated) if updated else None
                from backend.ws_manager import manager
                await manager.broadcast({
                    "type": "ir_command_detected",
                    "device_id": device_id,
                    "command": f"physical_remote_{ac_state.power or 'state'}",
                    "new_assumed_state": new_state,
                    "source": "physical_remote",
                    "match_method": method,
                    "state": snapshot,
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
                from services.ir_manager import (
                    apply_decoded_ac_command, get_ir_device,
                    get_device_state_snapshot,
                )
                applied = apply_decoded_ac_command(device_id, ac_command)
                updated = get_ir_device(device_id) if applied else None
                snapshot = get_device_state_snapshot(updated) if updated else None
                from backend.ws_manager import manager
                await manager.broadcast({
                    "type": "ir_command_detected",
                    "device_id": device_id,
                    "command": f"physical_remote_{ac_command.action}",
                    "new_assumed_state": (updated or {}).get("assumed_state", "unknown") if updated else "unknown",
                    "source": "physical_remote",
                    "match_method": method,
                    "state": snapshot,
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

    # Re-use the same post-command logic as Ziggy's own sends — but pass
    # source="live" so the state engine sets live_at (RX-confirmed) rather
    # than estimated_at. This is what flips the UI's confidence chip to
    # "live" the moment a physical-remote button is pressed.
    try:
        from services.ir_manager import get_ir_device, get_device_state_snapshot
        from services.ir_manager import _after_command  # type: ignore[attr-defined]
        device = get_ir_device(device_id)
        if device:
            _after_command(device_id, device, logical_cmd, source="live")

        # Reload to get the state _after_command just wrote
        updated = get_ir_device(device_id)
        new_state = updated.get("assumed_state", "unknown") if updated else "unknown"

        # Full state snapshot for the device card — includes confidence band
        # and the per-template values (volume for TV, temp/mode/fan for AC,
        # playing for streamer, etc.). The UI doesn't have to know the
        # device class to render correctly anymore.
        snapshot = get_device_state_snapshot(updated) if updated else None

        # Broadcast so the frontend updates the device card immediately — no refresh needed
        from backend.ws_manager import manager
        await manager.broadcast({
            "type": "ir_command_detected",
            "device_id": device_id,
            "command": logical_cmd,
            "new_assumed_state": new_state,
            "source": "physical_remote",
            "match_method": match_method,
            "state": snapshot,
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
            d = _hello_with_rediscovery(host)
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

    Runs `warmup_blaster_connections` first so any cached IP that's gone
    stale overnight (DHCP rotation, router reboot) is refreshed before
    we kick off listener loops — listeners would otherwise burn their
    first iteration on a 10s timeout against the dead IP.
    """
    by_host = _all_ir_devices_by_host()
    if not by_host:
        log_info("[IRListener] No blaster_host configured — IR receive not active. "
                 "Set blaster_host on an IR device to enable physical remote detection.")
        return

    # Probe + refresh cached IPs in parallel. May rewrite ir_devices.json,
    # so re-read the host list after.
    await warmup_blaster_connections()
    by_host = _all_ir_devices_by_host()

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
            d = _hello_with_rediscovery(host)
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
                "name": _humanize_broadlink_name(
                    getattr(dev, "name", "") or "",
                    dev_type,
                    dev.mac,
                ),
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
            dev = _hello_with_rediscovery(host)
            dev.auth()
            dev.send_data(raw)
            return True
        except Exception as e:
            log_error(f"[IRListener] send_ir_direct to {host} failed: {e}")
            return False

    return await loop.run_in_executor(None, _send)
