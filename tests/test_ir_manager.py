"""
Unit tests for IR manager channel dispatch and command routing.

All tests mock file I/O and HA service calls — no live Broadlink required.
"""
from __future__ import annotations

import json
import os
import pytest
import pytest_asyncio
from unittest.mock import patch, MagicMock, AsyncMock


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_device(
    *,
    device_id: str = "ir_test01",
    device_type: str = "tv",
    all_digits_learned: bool = True,
    extra_commands: dict | None = None,
    extra_learned: list | None = None,
) -> dict:
    """Minimal IR device with digit keys."""
    commands = {
        "power": "power",
        "volume_up": "vol_up",
        "volume_down": "vol_down",
        **{f"digit_{i}": f"digit_{i}" for i in range(10)},
        "digit_ok": "digit_ok",
        **(extra_commands or {}),
    }
    learned = (
        ["power", "volume_up", "volume_down"]
        + ([f"digit_{i}" for i in range(10)] + ["digit_ok"] if all_digits_learned else [])
        + (extra_learned or [])
    )
    return {
        "id": device_id,
        "name": "Test TV",
        "type": device_type,
        "blaster_entity_id": "remote.broadlink",
        "ha_device_namespace": "living_room_tv",
        "ha_entity_id": None,
        "room": "living_room",
        "commands": commands,
        "learned_commands": learned,
        "sequences": {},
        "assumed_state": "unknown",
        "ac_config": None,
        "ac_memory": None,
    }


@pytest.fixture(autouse=True)
def _isolate_ir_devices_file(tmp_path, monkeypatch):
    """Redirect IR_DEVICES_FILE to a per-test tmp path.

    Previously this test file only patched `_load` (not `_save`). Any test
    that called send_ir_command / send_channel etc. triggered `_after_command`
    → `_record_last_command` → `update_ir_device` → `_save`, which wrote the
    in-memory fixture device ("Test TV") to the real user_files/ir_devices.json,
    overwriting the user's actual saved IR devices on every pytest run.

    Pointing IR_DEVICES_FILE at a tmp path makes any accidental _save during
    a test land in a throwaway file, so production data can never be touched.
    """
    from services import ir_manager
    monkeypatch.setattr(ir_manager, "IR_DEVICES_FILE", str(tmp_path / "ir_devices.json"))


def _patch_load(device: dict):
    """Patch _load to return [device] and isolate _save so it can't touch the
    real file (the autouse fixture above redirects IR_DEVICES_FILE to tmp)."""
    return patch("services.ir_manager._load", return_value=[device])


def _patch_ha_send(ok: bool = True):
    return patch(
        "services.ir_manager._ha_send",
        return_value={"ok": ok, "message": "" if ok else "HA send failed"},
    )


# ---------------------------------------------------------------------------
# send_channel — digit decomposition
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_send_channel_single_digit():
    device = _make_device()
    sent = []

    def fake_send(did, cmd, repeats=1):
        sent.append(cmd)
        return {"ok": True}

    with _patch_load(device), \
         patch("services.ir_manager.send_ir_command", side_effect=fake_send), \
         patch("asyncio.sleep", new_callable=AsyncMock):
        from services.ir_manager import send_channel
        result = await send_channel("ir_test01", 5)

    assert result["ok"] is True
    assert sent == ["digit_5", "digit_ok"]


@pytest.mark.asyncio
async def test_send_channel_two_digits():
    device = _make_device()
    sent = []

    def fake_send(did, cmd, repeats=1):
        sent.append(cmd)
        return {"ok": True}

    with _patch_load(device), \
         patch("services.ir_manager.send_ir_command", side_effect=fake_send), \
         patch("asyncio.sleep", new_callable=AsyncMock):
        from services.ir_manager import send_channel
        result = await send_channel("ir_test01", 12)

    assert result["ok"] is True
    assert sent == ["digit_1", "digit_2", "digit_ok"]


@pytest.mark.asyncio
async def test_send_channel_three_digits():
    device = _make_device()
    sent = []

    def fake_send(did, cmd, repeats=1):
        sent.append(cmd)
        return {"ok": True}

    with _patch_load(device), \
         patch("services.ir_manager.send_ir_command", side_effect=fake_send), \
         patch("asyncio.sleep", new_callable=AsyncMock):
        from services.ir_manager import send_channel
        result = await send_channel("ir_test01", 100)

    assert result["ok"] is True
    assert sent == ["digit_1", "digit_0", "digit_0", "digit_ok"]


@pytest.mark.asyncio
async def test_send_channel_missing_digit_command():
    """Device has digit commands missing from command map."""
    device = _make_device()
    # Remove digit_5 from command map
    del device["commands"]["digit_5"]

    with _patch_load(device):
        from services.ir_manager import send_channel
        result = await send_channel("ir_test01", 5)

    assert result["ok"] is False
    assert "digit_5" in result["message"]


@pytest.mark.asyncio
async def test_send_channel_digit_not_learned():
    """Digit in command map but not in learned_commands."""
    device = _make_device(all_digits_learned=False)

    with _patch_load(device):
        from services.ir_manager import send_channel
        result = await send_channel("ir_test01", 3)

    assert result["ok"] is False
    assert "digit_3" in result["message"] or "not learned" in result["message"].lower()


@pytest.mark.asyncio
async def test_send_channel_device_not_found():
    with _patch_load(_make_device(device_id="ir_other")):
        from services.ir_manager import send_channel
        result = await send_channel("ir_test01", 5)

    assert result["ok"] is False
    assert "not found" in result["message"].lower()


@pytest.mark.asyncio
async def test_send_channel_stops_on_mid_sequence_failure():
    """If a digit send fails mid-sequence, dispatch stops immediately."""
    device = _make_device()
    sent = []
    call_count = 0

    def fake_send(did, cmd, repeats=1):
        nonlocal call_count
        call_count += 1
        sent.append(cmd)
        # Fail on the second digit
        return {"ok": call_count != 2}

    with _patch_load(device), \
         patch("services.ir_manager.send_ir_command", side_effect=fake_send), \
         patch("asyncio.sleep", new_callable=AsyncMock):
        from services.ir_manager import send_channel
        result = await send_channel("ir_test01", 12)

    assert result["ok"] is False
    # Should have stopped after the failing digit (digit_2), not sent digit_ok
    assert "digit_ok" not in sent


# ---------------------------------------------------------------------------
# send_ir_command — command not in map / not learned
# ---------------------------------------------------------------------------

def test_send_ir_command_not_in_map():
    device = _make_device()

    with _patch_load(device):
        from services.ir_manager import send_ir_command
        result = send_ir_command("ir_test01", "nonexistent_cmd")

    assert result["ok"] is False
    assert "nonexistent_cmd" in result["message"]


def test_send_ir_command_not_learned():
    device = _make_device(all_digits_learned=False)

    with _patch_load(device):
        from services.ir_manager import send_ir_command
        result = send_ir_command("ir_test01", "digit_7")

    assert result["ok"] is False
    assert "not been learned" in result["message"].lower() or "hasn't been learned" in result["message"].lower()


def test_send_ir_command_success():
    device = _make_device()

    with _patch_load(device), _patch_ha_send(ok=True):
        from services.ir_manager import send_ir_command
        result = send_ir_command("ir_test01", "power")

    assert result["ok"] is True


# ---------------------------------------------------------------------------
# apply_decoded_ac_state — physical AC remote → device state (Phase 2)
# ---------------------------------------------------------------------------

def test_apply_decoded_ac_state_updates_power_mode_temp():
    """Decoded AC state from a physical remote should update assumed_state +
    ac_memory so Ziggy's next command sees the real configuration."""
    device = _make_device(device_id="ir_ac01", device_type="ac")
    device["ac_memory"] = {"mode": None, "temp": None, "fan": None}

    saved = []

    class FakeAcState:
        power = "off"
        mode = "cool"
        temp = 23
        fan = "auto"
        brand = "gree"

    with patch("services.ir_manager._load", return_value=[device]), \
         patch("services.ir_manager._save", side_effect=lambda d: saved.append([dict(x) for x in d])):
        from services.ir_manager import apply_decoded_ac_state
        result = apply_decoded_ac_state("ir_ac01", FakeAcState())

    assert result is True
    assert saved, "_save was never called"
    final = saved[-1][0]
    assert final["assumed_state"] == "off"
    assert final["ac_memory"]["mode"] == "cool"
    assert final["ac_memory"]["temp"] == 23
    assert final["ac_memory"]["fan"] == "auto"
    assert "physical_remote_gree" in final["last_command_sent"]


def test_apply_decoded_ac_state_partial_fields_preserve_memory():
    """If the protocol decoder only extracted some fields (Gree single-half
    decode has no fan), existing ac_memory fields must not be wiped."""
    device = _make_device(device_id="ir_ac02", device_type="ac")
    device["ac_memory"] = {"mode": "heat", "temp": 24, "fan": "high"}

    saved = []

    class PartialAcState:
        power = "on"
        mode = "cool"
        temp = 22
        fan = None
        brand = "gree"

    with patch("services.ir_manager._load", return_value=[device]), \
         patch("services.ir_manager._save", side_effect=lambda d: saved.append([dict(x) for x in d])):
        from services.ir_manager import apply_decoded_ac_state
        apply_decoded_ac_state("ir_ac02", PartialAcState())

    final = saved[-1][0]
    assert final["ac_memory"]["mode"] == "cool"   # updated
    assert final["ac_memory"]["temp"] == 22        # updated
    assert final["ac_memory"]["fan"] == "high"     # preserved


def test_apply_decoded_ac_state_unknown_device_returns_false():
    with patch("services.ir_manager._load", return_value=[]):
        from services.ir_manager import apply_decoded_ac_state

        class FakeState:
            power = "on"; mode = "cool"; temp = 24; fan = "low"; brand = "gree"

        assert apply_decoded_ac_state("ir_missing", FakeState()) is False


# ---------------------------------------------------------------------------
# apply_decoded_ac_command — short-packet command increments
# ---------------------------------------------------------------------------

def _ac_device_with_memory(mem):
    d = _make_device(device_id="ir_ac01", device_type="ac")
    d["ac_memory"] = mem
    return d


def test_apply_command_temp_up_increments_and_caps_at_30():
    saved = []
    device = _ac_device_with_memory({"mode": "cool", "temp": 29, "fan": "auto"})

    class C:
        action = "temp_up"
        brand = "tadiran"

    with patch("services.ir_manager._load", return_value=[device]), \
         patch("services.ir_manager._save", side_effect=lambda d: saved.append([dict(x) for x in d])):
        from services.ir_manager import apply_decoded_ac_command
        apply_decoded_ac_command("ir_ac01", C())
        # Bump again — should cap at 30
        apply_decoded_ac_command("ir_ac01", C())

    assert saved[0][0]["ac_memory"]["temp"] == 30
    assert saved[1][0]["ac_memory"]["temp"] == 30


def test_apply_command_temp_down_decrements_and_floors_at_16():
    saved = []
    device = _ac_device_with_memory({"mode": "cool", "temp": 17, "fan": "auto"})

    class C:
        action = "temp_down"
        brand = "tadiran"

    with patch("services.ir_manager._load", return_value=[device]), \
         patch("services.ir_manager._save", side_effect=lambda d: saved.append([dict(x) for x in d])):
        from services.ir_manager import apply_decoded_ac_command
        apply_decoded_ac_command("ir_ac01", C())
        apply_decoded_ac_command("ir_ac01", C())

    assert saved[0][0]["ac_memory"]["temp"] == 16
    assert saved[1][0]["ac_memory"]["temp"] == 16


def test_apply_command_temp_up_with_no_prior_temp_uses_default():
    """If we've never seen a full-state packet, ac_memory.temp is None.
    Temp+ from None should default to 24°C (the Israeli AC standard)
    and increment to 25."""
    saved = []
    device = _ac_device_with_memory({"mode": None, "temp": None, "fan": None})

    class C:
        action = "temp_up"
        brand = "tadiran"

    with patch("services.ir_manager._load", return_value=[device]), \
         patch("services.ir_manager._save", side_effect=lambda d: saved.append([dict(x) for x in d])):
        from services.ir_manager import apply_decoded_ac_command
        apply_decoded_ac_command("ir_ac01", C())

    assert saved[0][0]["ac_memory"]["temp"] == 25


def test_apply_command_fan_cycle_advances_in_order():
    saved = []
    device = _ac_device_with_memory({"mode": "cool", "temp": 24, "fan": "auto"})

    class C:
        action = "fan_cycle"
        brand = "tadiran"

    with patch("services.ir_manager._load", return_value=[device]), \
         patch("services.ir_manager._save", side_effect=lambda d: saved.append([dict(x) for x in d])):
        from services.ir_manager import apply_decoded_ac_command
        apply_decoded_ac_command("ir_ac01", C())

    # auto → low (next in cycle)
    assert saved[0][0]["ac_memory"]["fan"] == "low"


def test_apply_command_unknown_action_returns_false():
    """The decoder identifies a short Tadiran packet but doesn't yet know
    which button it was (command-bit mapping pending). apply must no-op
    rather than corrupting ac_memory."""
    saved = []
    device = _ac_device_with_memory({"mode": "cool", "temp": 24, "fan": "auto"})

    class C:
        action = "unknown"
        brand = "tadiran"

    with patch("services.ir_manager._load", return_value=[device]), \
         patch("services.ir_manager._save", side_effect=lambda d: saved.append([dict(x) for x in d])):
        from services.ir_manager import apply_decoded_ac_command
        result = apply_decoded_ac_command("ir_ac01", C())

    assert result is False
    assert saved == []  # no save = no mutation
