"""
Blaster abstraction — vendor-agnostic IR send/receive/learn.

Ziggy started Broadlink-only. The launch fleet adds Avatto, and beyond that we
expect a long tail of IR blasters (Tuya/ESPHome/Zigbee variants). This module
is the seam that keeps the listener, manager, and decoders vendor-free.

Canonical internal format is the microsecond pulse array (alternating
mark/space). Each adapter is responsible for converting to/from its vendor's
wire format at the boundary.

Adapters supported now:
  - BroadlinkBlaster: full RX + TX + learn via python-broadlink local LAN.
  - AvattoHABlaster:  TX + learn via HA's remote.* services. No continuous RX
                      (Tuya stock firmware doesn't expose received pulses).

Adapters planned:
  - AvattoESPHomeBlaster: full RX + TX + learn via local ESPHome API for
                          users who flash their Avatto S06/S06Pro.

Design notes:
  - Each adapter declares its capabilities. Callers check `capabilities.can_listen`
    before subscribing — the listener loop skips RX-incapable blasters cleanly.
  - All I/O is async at this layer. Adapters wrap sync vendor SDKs in
    asyncio.to_thread when needed.
  - No state lives here — adapters are stateless wrappers over the device.
"""
from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass, field
from typing import AsyncIterator, Optional, Protocol, runtime_checkable

from core.logger_module import log_info, log_error


# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------

@dataclass
class BlasterCapabilities:
    """What an adapter can do. Used by the listener to skip unsupported ops."""
    can_send: bool = True
    can_learn: bool = True
    can_listen: bool = False         # continuous RX (the demo-moment capability)
    supports_native_pulses: bool = True

    @property
    def supports_feedback(self) -> bool:
        """Convenience: can this blaster surface physical-remote presses?"""
        return self.can_listen


@dataclass
class BlasterInfo:
    """Identity + capability snapshot. Returned by discover() and listed in UI."""
    id: str                          # stable id, usually MAC; falls back to host
    vendor: str                      # "broadlink" | "avatto" | "esphome" | ...
    model: str = ""                  # human-readable hardware label
    host: Optional[str] = None       # LAN IP for local adapters; HA entity for routed
    mac: Optional[str] = None        # canonical lowercase hex, no separators
    capabilities: BlasterCapabilities = field(default_factory=BlasterCapabilities)
    extras: dict = field(default_factory=dict)  # vendor-specific config (e.g. HA blaster_entity)


@runtime_checkable
class Blaster(Protocol):
    """Vendor-agnostic IR blaster interface.

    Implementations live alongside this file (BroadlinkBlaster, AvattoHABlaster).
    Callers never import the implementations directly — they go through
    `get_blaster(device)` which picks the right adapter from the device record.
    """
    info: BlasterInfo

    @property
    def capabilities(self) -> BlasterCapabilities: ...

    async def send_pulses(self, pulses_us: list[int], repeat: int = 0) -> None:
        """Transmit a microsecond pulse array. `repeat` = extra repetitions."""
        ...

    async def send_raw(self, code_b64: str, repeat: int = 0) -> None:
        """Transmit a stored raw IR code (Ziggy's canonical base64 form).

        Adapters that natively understand Broadlink wire format pass-through.
        Others decode → pulses → re-encode in their own format.
        """
        ...

    async def learn_once(self, timeout_s: float = 28.0) -> Optional[list[int]]:
        """Enter learn mode, wait for a single capture, return its pulses.

        Returns None on timeout. Raises on hardware error.
        """
        ...

    async def listen(self, on_capture) -> None:
        """Continuous RX loop. Calls `on_capture(pulses_us)` per received signal.

        Adapters without RX should raise NotImplementedError. The listener
        framework checks capabilities first to avoid that path.
        """
        ...


# ---------------------------------------------------------------------------
# Broadlink adapter (the default — covers everything the project shipped with)
# ---------------------------------------------------------------------------

class BroadlinkBlaster:
    """RM4 Mini / RM4 Pro / RM3 variants. Local LAN, python-broadlink."""

    def __init__(self, info: BlasterInfo):
        self.info = info
        self._caps = BlasterCapabilities(
            can_send=True,
            can_learn=True,
            can_listen=True,
            supports_native_pulses=True,
        )

    @property
    def capabilities(self) -> BlasterCapabilities:
        return self._caps

    # -- internals ----------------------------------------------------------

    def _connect_sync(self):
        """Open + auth a python-broadlink device. Sync; call via to_thread."""
        import broadlink as _bl
        dev = _bl.hello(self.info.host)
        dev.auth()
        return dev

    @staticmethod
    def _pulses_to_broadlink_bytes(pulses_us: list[int], *, repeat: int = 0) -> bytes:
        from services.ir_protocol import encode_broadlink_raw
        return encode_broadlink_raw(pulses_us, repeat=repeat)

    @staticmethod
    def _bytes_to_pulses(raw: bytes) -> list[int]:
        from services.ir_protocol import parse_broadlink_raw
        return parse_broadlink_raw(raw)

    # -- public surface -----------------------------------------------------

    async def send_pulses(self, pulses_us: list[int], repeat: int = 0) -> None:
        payload = self._pulses_to_broadlink_bytes(pulses_us, repeat=repeat)
        await asyncio.to_thread(self._send_sync, payload)

    async def send_raw(self, code_b64: str, repeat: int = 0) -> None:
        raw = base64.b64decode(code_b64)
        # Re-pack with repeat if caller wants > 0; Broadlink's wire format
        # already includes a repeat byte at offset 1 of the wrapper.
        if repeat > 0:
            pulses = self._bytes_to_pulses(raw)
            raw = self._pulses_to_broadlink_bytes(pulses, repeat=repeat)
        await asyncio.to_thread(self._send_sync, raw)

    def _send_sync(self, raw: bytes) -> None:
        dev = self._connect_sync()
        dev.send_data(raw)

    async def learn_once(self, timeout_s: float = 28.0) -> Optional[list[int]]:
        return await asyncio.to_thread(self._learn_sync, timeout_s)

    def _learn_sync(self, timeout_s: float) -> Optional[list[int]]:
        import time
        dev = self._connect_sync()
        dev.enter_learning()
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            try:
                raw = dev.check_data()
            except Exception:
                raw = None
            if raw:
                return self._bytes_to_pulses(raw)
            time.sleep(0.35)
        return None

    async def listen(self, on_capture) -> None:
        """Async loop — drives the existing listener flow.

        Each capture is delivered as a pulse array (canonical internal form).
        The caller is responsible for matching, mutating state, broadcasting.
        Failures back off and retry; cancellation closes the loop cleanly.
        """
        from services.ir_listener import _hello_with_rediscovery  # reuse existing rediscovery
        host = self.info.host or ""
        backoff = 1.0
        while True:
            try:
                dev = await asyncio.to_thread(_hello_with_rediscovery, host)
                if dev is None:
                    await asyncio.sleep(min(60.0, backoff))
                    backoff = min(60.0, backoff * 2)
                    continue
                backoff = 1.0
                await asyncio.to_thread(dev.enter_learning)
                deadline = asyncio.get_event_loop().time() + 28.0
                while asyncio.get_event_loop().time() < deadline:
                    raw = await asyncio.to_thread(self._try_check, dev)
                    if raw:
                        pulses = self._bytes_to_pulses(raw)
                        if pulses:
                            try:
                                await on_capture(pulses, raw)
                            except Exception as e:
                                log_error(f"[Blaster:{host}] on_capture failed: {e}")
                    await asyncio.sleep(0.35)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log_error(f"[Blaster:{host}] listen loop error: {e}")
                await asyncio.sleep(min(30.0, backoff))
                backoff = min(60.0, backoff * 2)

    @staticmethod
    def _try_check(dev) -> Optional[bytes]:
        try:
            return dev.check_data()
        except Exception:
            return None


# ---------------------------------------------------------------------------
# Avatto adapter — HA-routed (stock Tuya firmware)
# ---------------------------------------------------------------------------

class AvattoHABlaster:
    """Avatto S06/S06Pro stock firmware via HA's Tuya integration.

    HA owns the Tuya cloud auth and the remote.* services. Ziggy sends through
    HA. No continuous RX — Tuya stock doesn't expose received pulses.

    Capability profile:
      can_send=True, can_learn=True (via remote.learn_command), can_listen=False.

    When users flash ESPHome on these units, switch to AvattoESPHomeBlaster
    (not yet implemented) which gets full RX.
    """

    def __init__(self, info: BlasterInfo):
        self.info = info
        self._caps = BlasterCapabilities(
            can_send=True,
            can_learn=True,
            can_listen=False,
            supports_native_pulses=False,
        )

    @property
    def capabilities(self) -> BlasterCapabilities:
        return self._caps

    @property
    def _ha_entity(self) -> str:
        ent = self.info.extras.get("blaster_entity_id") or ""
        if not ent:
            raise RuntimeError(
                f"AvattoHABlaster {self.info.id} missing blaster_entity_id in extras"
            )
        return ent

    async def send_pulses(self, pulses_us: list[int], repeat: int = 0) -> None:
        # HA Tuya remote doesn't accept raw pulses — Avatto has to learn the
        # command first, then we send by name. Caller should use send_raw if a
        # b64 code is stored; pure-pulse send isn't supported here.
        raise NotImplementedError(
            "AvattoHABlaster does not support raw pulse send. "
            "Use HA remote.send_command with a learned command name."
        )

    async def send_raw(self, code_b64: str, repeat: int = 0) -> None:
        # Same constraint as send_pulses — HA Tuya routes by command name.
        raise NotImplementedError(
            "AvattoHABlaster does not support raw send. "
            "Use ir_manager.send_ir_command which falls back to HA service call."
        )

    async def learn_once(self, timeout_s: float = 28.0) -> Optional[list[int]]:
        # The HA remote.learn_command flow returns nothing programmatically —
        # it stores the code under the (device, command) namespace. Ziggy's
        # legacy learning flow already covers this via start_learning in
        # ir_manager. This adapter is intentionally a no-op for learn_once
        # to keep callers from accidentally racing HA's learn UI.
        raise NotImplementedError(
            "Avatto learn is driven by HA's remote.learn_command, not Blaster.learn_once. "
            "Use start_learning() in ir_manager."
        )

    async def listen(self, on_capture) -> None:
        raise NotImplementedError(
            "AvattoHABlaster has no continuous RX. Flash ESPHome firmware for RX support."
        )


# ---------------------------------------------------------------------------
# Registry — picks the right adapter for a device record
# ---------------------------------------------------------------------------

def _vendor_from_device(device: dict) -> str:
    """Decide which adapter to use for an IR device record.

    Rules (priority order):
      1. Explicit `blaster_vendor` field on the device record.
      2. Explicit on the linked blaster row in ir_blasters.json.
      3. Default to "broadlink" — matches every existing installation.
    """
    vendor = (device.get("blaster_vendor") or "").strip().lower()
    if vendor:
        return vendor
    try:
        from services import ir_blasters as bl
        blaster_id = device.get("blaster_id")
        if blaster_id:
            row = bl.get_blaster(blaster_id)
            if row:
                v = (row.get("vendor") or "").strip().lower()
                if v:
                    return v
    except Exception:
        pass
    return "broadlink"


def get_blaster(device: dict) -> Optional[Blaster]:
    """Build the right Blaster adapter for a device record.

    Returns None if the device record lacks the info the adapter needs (host
    for Broadlink, blaster_entity_id for Avatto-via-HA). Callers fall back to
    legacy paths in that case.
    """
    vendor = _vendor_from_device(device)
    host = (device.get("blaster_host") or "").strip()
    mac = (device.get("blaster_mac") or "").strip().lower()
    blaster_entity = (device.get("blaster_entity_id") or "").strip()

    info = BlasterInfo(
        id=mac or host or blaster_entity or device.get("id", ""),
        vendor=vendor,
        model=device.get("blaster_model", ""),
        host=host or None,
        mac=mac or None,
        extras={"blaster_entity_id": blaster_entity} if blaster_entity else {},
    )

    if vendor == "broadlink":
        if not host:
            return None
        info.capabilities = BlasterCapabilities(
            can_send=True, can_learn=True, can_listen=True,
            supports_native_pulses=True,
        )
        return BroadlinkBlaster(info)

    if vendor in ("avatto", "tuya_ir", "tuya"):
        if not blaster_entity:
            return None
        info.capabilities = BlasterCapabilities(
            can_send=True, can_learn=True, can_listen=False,
            supports_native_pulses=False,
        )
        return AvattoHABlaster(info)

    # Unknown vendor — try Broadlink as a permissive default if the device has
    # a host. This matches pre-abstraction behavior so we never regress an
    # install that hasn't been migrated.
    if host:
        log_info(f"[Blaster] Unknown vendor '{vendor}' for {info.id}; falling back to Broadlink")
        return BroadlinkBlaster(info)
    return None


def describe_capabilities(device: dict) -> dict:
    """UI-friendly capability snapshot for a device record.

    Used by the device card to decide whether to show the 'live state' badge
    or the 'estimated only' badge. Cheap — no I/O.
    """
    blaster = get_blaster(device)
    if blaster is None:
        return {
            "vendor": _vendor_from_device(device),
            "can_send": False,
            "can_learn": False,
            "can_listen": False,
            "supports_feedback": False,
        }
    caps = blaster.capabilities
    return {
        "vendor": blaster.info.vendor,
        "model": blaster.info.model,
        "can_send": caps.can_send,
        "can_learn": caps.can_learn,
        "can_listen": caps.can_listen,
        "supports_feedback": caps.supports_feedback,
    }
