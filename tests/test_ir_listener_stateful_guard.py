"""
Stateful-AC guard in the listener's code-match cascade.

Real-hardware finding (2026-07-27, user's Tadiran + Broadlink RM4): full-
state AC frames are settings snapshots — two different buttons pressed at
the same settings emit IDENTICAL frames. During the validation walk, temp
presses passing through the settings a power button was learned at matched
the stored power code (protocol pass) and fired bogus "turned on" toasts.

Therefore: frames that decode with an ac_state must NEVER be attributed to
a learned button. They return no command match and flow to the AC-state
inference path instead. Non-stateful frames (TV remotes etc.) keep the
full match cascade.
"""
import base64

import pytest

from services.ir_protocol import encode_broadlink_raw
from services import ir_listener


def _tadiran_frame_bytes(payload: bytes) -> bytes:
    """Broadlink-wrapped raw for a single-half Tadiran state frame."""
    pulses = [8500, 4630]
    for byte in payload:
        for bit_i in range(8):  # LSB first
            pulses += [1870, 690] if (byte >> bit_i) & 1 else [620, 1938]
    pulses += [620, 13000]
    return encode_broadlink_raw(pulses)


def _nec_frame_bytes() -> bytes:
    pulses = [9000, 4500]
    bits = [1, 0, 1, 1, 0, 0, 1, 0] * 4
    for b in bits:
        pulses += [560, 1690] if b else [560, 560]
    pulses += [560]
    return encode_broadlink_raw(pulses)


def _stub_devices(monkeypatch, stored_b64: str, command: str):
    def fake_list(enabled_only=True):
        return [{
            "id": "dev1", "name": "Test Device", "enabled": True,
            "ir_codes": {command: stored_b64},
        }]
    import services.ir_manager as irm
    monkeypatch.setattr(irm, "list_ir_devices", fake_list)


def test_stateful_ac_frame_never_matches_stored_command(monkeypatch):
    """Byte-identical to the stored 'power_on' code — yet must NOT match:
    on Tadiran, an identical frame can equally be a temp press at the same
    settings. State inference owns these frames."""
    frame = _tadiran_frame_bytes(bytes.fromhex("01153e000030c027"))
    _stub_devices(monkeypatch, base64.b64encode(frame).decode(), "power_on")
    assert ir_listener._find_code_match(frame) is None


def test_non_stateful_frame_still_matches_exact(monkeypatch):
    """TV-style frames (no ac_state) keep the normal cascade."""
    frame = _nec_frame_bytes()
    _stub_devices(monkeypatch, base64.b64encode(frame).decode(), "vol_up")
    result = ir_listener._find_code_match(frame)
    assert result is not None
    assert result[1] == "vol_up"
    assert result[2] == "exact"
