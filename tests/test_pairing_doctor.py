"""North-star #2 — "why won't my new device connect?"

The pairing doctor fuses three independent facts the user can't see:
  · is the home's radio healthy, or wedged?
  · is the pairing window actually open?
  · did a device show up and then stall halfway through introducing itself?
    (the SNZB-04PR2 interview-stall pattern — present, never finished)

All pure functions here: the live fetch is a thin wrapper, so the judgement
itself is testable without a home.
"""
import datetime

import pytest

from services import pairing_doctor as P


NOW = datetime.datetime(2026, 8, 29, 12, 0, tzinfo=datetime.timezone.utc)


# ── the pairing window ───────────────────────────────────────────────────────
def test_pairing_window_reads_as_open():
    states = [{"entity_id": "switch.zigbee2mqtt_bridge_permit_join", "state": "on"}]
    assert P.pairing_window_open(states) is True


def test_pairing_window_reads_as_closed():
    states = [{"entity_id": "switch.zigbee2mqtt_bridge_permit_join", "state": "off"}]
    assert P.pairing_window_open(states) is False


def test_pairing_window_is_unknown_without_a_permit_switch():
    # A ZHA home has no such entity — "unknown" must not be read as "closed".
    assert P.pairing_window_open([{"entity_id": "light.kitchen", "state": "on"}]) is None


# ── stalled introductions (the real Z2M signal) ──────────────────────────────
def test_device_that_never_finished_its_interview_is_stalled():
    devices = [
        {"friendly_name": "Coordinator", "type": "Coordinator", "interview_completed": True},
        {"friendly_name": "Kitchen Light", "type": "Router", "interview_completed": True},
        {"friendly_name": "0x00124b0029", "type": "EndDevice",
         "interview_completed": False, "interviewing": False},
    ]
    stalled = P.stalled_introductions(devices)
    assert [s["name"] for s in stalled] == ["0x00124b0029"]


def test_a_device_still_interviewing_is_reported_as_in_progress_not_stalled():
    devices = [{"friendly_name": "New Sensor", "type": "EndDevice",
                "interview_completed": False, "interviewing": True}]
    stalled = P.stalled_introductions(devices)
    assert stalled == [], "still introducing itself — give it a moment, don't alarm"


def test_the_coordinator_itself_is_never_a_stalled_device():
    devices = [{"friendly_name": "Coordinator", "type": "Coordinator",
                "interview_completed": False}]
    assert P.stalled_introductions(devices) == []


# ── the verdict ──────────────────────────────────────────────────────────────
def test_a_wedged_radio_outranks_everything_else():
    a = P.assess_pairing(coordinator_state="setup_retry", pairing_open=True,
                         stalled=[{"name": "New Sensor"}], pending=[])
    assert a["verdict"] == "radio_down"
    assert a["radio_ok"] is False


def test_a_starting_radio_says_wait_rather_than_broken():
    a = P.assess_pairing(coordinator_state="setup_in_progress", pairing_open=None,
                         stalled=[], pending=[])
    assert a["verdict"] == "radio_starting"


def test_a_stalled_device_is_named():
    a = P.assess_pairing(coordinator_state="loaded", pairing_open=True,
                         stalled=[{"name": "0x00124b0029"}], pending=[])
    assert a["verdict"] == "stalled"
    assert a["stalled_names"] == ["0x00124b0029"]


def test_a_device_waiting_to_be_added_is_surfaced():
    a = P.assess_pairing(coordinator_state="loaded", pairing_open=False,
                         stalled=[], pending=[{"title": "Living Room TV"}])
    assert a["verdict"] == "awaiting_setup"
    assert a["pending_names"] == ["Living Room TV"]


def test_a_closed_window_is_the_answer_when_nothing_else_is_wrong():
    a = P.assess_pairing(coordinator_state="loaded", pairing_open=False,
                         stalled=[], pending=[])
    assert a["verdict"] == "pairing_closed"


def test_everything_ready_means_the_device_itself_is_the_problem():
    a = P.assess_pairing(coordinator_state="loaded", pairing_open=True,
                         stalled=[], pending=[])
    assert a["verdict"] == "ready"
    assert a["radio_ok"] is True


# ── the live wrapper ─────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_the_live_read_fuses_all_four_signals(monkeypatch):
    from services import ha_health, home_automation, mqtt_client, ha_pairing

    class _Coord:
        state = "loaded"

    async def fake_coord(force=False):
        return _Coord()

    async def fake_retained(topic, timeout=3.0):
        assert topic.endswith("bridge/devices")
        return [{"friendly_name": "New Sensor", "type": "EndDevice",
                 "interview_completed": False, "interviewing": False}]

    async def fake_flows(integrations=None, exclude=None):
        return {"ok": True, "flows": []}

    monkeypatch.setattr(ha_health, "fetch_coordinator_state", fake_coord)
    monkeypatch.setattr(home_automation, "get_all_states", lambda: [
        {"entity_id": "switch.zigbee2mqtt_bridge_permit_join", "state": "on"}])
    monkeypatch.setattr(mqtt_client, "read_retained", fake_retained)
    monkeypatch.setattr(ha_pairing, "get_pending_config_flows", fake_flows)

    a = await P.diagnose_pairing()

    assert a["verdict"] == "stalled"
    assert a["stalled_names"] == ["New Sensor"]
    assert a["pairing_open"] is True


@pytest.mark.asyncio
async def test_a_home_with_no_radio_and_no_broker_still_gets_an_answer(monkeypatch):
    from services import ha_health, home_automation, mqtt_client, ha_pairing

    async def blow_up(*a, **k):
        raise RuntimeError("nothing here")

    def blow_up_sync(*a, **k):
        raise RuntimeError("nothing here")

    monkeypatch.setattr(ha_health, "fetch_coordinator_state", blow_up)
    monkeypatch.setattr(home_automation, "get_all_states", blow_up_sync)
    monkeypatch.setattr(mqtt_client, "read_retained", blow_up)
    monkeypatch.setattr(ha_pairing, "get_pending_config_flows", blow_up)

    a = await P.diagnose_pairing()

    assert a["verdict"] == "ready"
    assert a["radio_ok"] is None, "no radio info is not a radio fault"


def test_an_unknown_radio_state_does_not_claim_a_fault():
    # No coordinator info at all (e.g. Wi-Fi-only home) — don't invent a radio problem.
    a = P.assess_pairing(coordinator_state=None, pairing_open=None,
                         stalled=[], pending=[])
    assert a["verdict"] == "ready"
    assert a["radio_ok"] is None
