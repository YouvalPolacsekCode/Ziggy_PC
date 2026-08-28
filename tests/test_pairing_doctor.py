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


# ── which discoveries are worth telling a user about ────────────────────────
#
# Live on the Canary (2026-08-29) the raw pending list was:
#   ["SMLIGHT SLZB-07", "SMLIGHT SLZB-07", "智能遥控", "cast"]
# — the home's own Zigbee adapter (twice), and a flow with no name but its
# handler slug. Reporting those tells the user to go "finish adding" their own
# hub hardware, and leaks a model number and an engine slug into a user string.


def test_the_homes_own_radio_hardware_is_not_a_device_to_add():
    flows = [{"handler": "smlight", "title": "SMLIGHT SLZB-07"}]
    assert P.addable_discoveries(flows) == []


def test_the_same_discovery_is_only_mentioned_once():
    flows = [{"handler": "shelly", "title": "Hall Plug"},
             {"handler": "shelly", "title": "Hall Plug"}]
    assert [f["title"] for f in P.addable_discoveries(flows)] == ["Hall Plug"]


def test_a_discovery_with_no_human_name_is_dropped():
    # ha_pairing falls back to the handler slug as the title; "cast" is an
    # engine word, not a device the user can recognise.
    flows = [{"handler": "cast", "title": "cast"}]
    assert P.addable_discoveries(flows) == []


def test_a_genuinely_new_device_survives():
    flows = [{"handler": "shelly", "title": "Living Room TV"}]
    assert [f["title"] for f in P.addable_discoveries(flows)] == ["Living Room TV"]


@pytest.mark.asyncio
async def test_the_canary_noise_does_not_become_a_to_do_for_the_user(monkeypatch):
    """The real payload above, on a healthy home with the window shut, should
    answer 'open Add device' — not 'go finish adding your Zigbee adapter'."""
    from services import ha_health, home_automation, mqtt_client, ha_pairing

    class _Coord:
        state = "loaded"

    async def fake_coord(force=False):
        return _Coord()

    async def fake_retained(topic, timeout=3.0):
        return []

    async def fake_flows(integrations=None, exclude=None):
        return {"ok": True, "flows": [
            {"handler": "smlight", "title": "SMLIGHT SLZB-07"},
            {"handler": "smlight", "title": "SMLIGHT SLZB-07"},
            {"handler": "cast", "title": "cast"},
        ]}

    monkeypatch.setattr(ha_health, "fetch_coordinator_state", fake_coord)
    monkeypatch.setattr(home_automation, "get_all_states", lambda: [
        {"entity_id": "switch.zigbee2mqtt_bridge_permit_join", "state": "off"}])
    monkeypatch.setattr(mqtt_client, "read_retained", fake_retained)
    monkeypatch.setattr(ha_pairing, "get_pending_config_flows", fake_flows)

    a = await P.diagnose_pairing()

    assert a["verdict"] == "pairing_closed"
    assert a["pending_names"] == []


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
    a = P.assess_pairing(coordinator_state="loaded", pairing_open=True,
                         stalled=[], pending=[{"title": "Living Room TV"}])
    assert a["verdict"] == "awaiting_setup"
    assert a["pending_names"] == ["Living Room TV"]


def test_a_closed_window_is_the_answer_when_nothing_else_is_wrong():
    a = P.assess_pairing(coordinator_state="loaded", pairing_open=False,
                         stalled=[], pending=[])
    assert a["verdict"] == "pairing_closed"


def test_the_shut_window_outranks_an_idle_discovery():
    """Live on the Canary a months-old discovery ("智能遥控") was answering the
    question, while the one actionable fact — the home is shut to new devices —
    went unsaid. The step the user can take wins; the discovery rides along."""
    a = P.assess_pairing(coordinator_state="loaded", pairing_open=False,
                         stalled=[], pending=[{"title": "智能遥控"}])
    assert a["verdict"] == "pairing_closed"
    assert a["pending_names"] == ["智能遥控"], "still worth mentioning, just not first"


def test_a_discovery_leads_when_the_home_is_open_or_cannot_say():
    for window in (True, None):
        a = P.assess_pairing(coordinator_state="loaded", pairing_open=window,
                             stalled=[], pending=[{"title": "Living Room TV"}])
        assert a["verdict"] == "awaiting_setup"


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
