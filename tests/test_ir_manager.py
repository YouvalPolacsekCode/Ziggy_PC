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


def _patch_load(device: dict):
    """Patch _load to return [device] and _save to be a no-op."""
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
