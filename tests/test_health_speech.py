"""Layer-A fixer: the health→speech translation must NEVER leak engine jargon.

health_speech maps the raw ha_health snapshot / self-heal outcomes / manual-action
codes into warm, dugri, gender-free Hebrew+English the agent can say to a user.
The product rule (feedback_ziggy_product_surface): the user must never see
"Home Assistant", entity_ids, "Zigbee", "coordinator", "integration", "MQTT".
"""
import pytest

from core.agent import health_speech as hs
from services import ha_health as H

# Words/prefixes that must never reach a user-facing string.
_BANNED_WORDS = [
    "home assistant", "zigbee", "coordinator", "integration", "mqtt", "entity",
]
_BANNED_DOMAIN_PREFIXES = [
    "light.", "climate.", "switch.", "sensor.", "binary_sensor.",
    "fan.", "cover.", "lock.", "media_player.",
]


def _assert_jargon_free(text: str) -> None:
    low = text.lower()
    for w in _BANNED_WORDS:
        assert w not in low, f"jargon word leaked: {w!r} in {text!r}"
    for d in _BANNED_DOMAIN_PREFIXES:
        assert d not in low, f"entity_id leaked: {d!r} in {text!r}"


def test_summarize_coordinator_failed_hebrew_is_jargon_free():
    snap = {"level": H.LEVEL_DOWN, "primary": H.ISSUE_COORDINATOR_FAILED,
            "devices": {"total": 10, "offline": 8}}
    out = hs.summarize_health(snap, lang="he")
    assert out.strip(), "expected a non-empty Hebrew summary"
    _assert_jargon_free(out)


def test_summarize_ok_english_is_reassuring_and_clean():
    snap = {"level": H.LEVEL_OK, "primary": H.ISSUE_OK,
            "devices": {"total": 10, "offline": 0}}
    out = hs.summarize_health(snap, lang="en")
    assert out.strip(), "expected a non-empty English summary"
    _assert_jargon_free(out)


_ALL_ISSUES = [
    H.ISSUE_OK, H.ISSUE_HA_UNREACHABLE, H.ISSUE_COORDINATOR_LOADING,
    H.ISSUE_COORDINATOR_FAILED, H.ISSUE_COORDINATOR_DEVS_GONE,
    H.ISSUE_DEVICES_OFFLINE_MANY, H.ISSUE_DEVICES_OFFLINE,
]


@pytest.mark.parametrize("primary", _ALL_ISSUES)
@pytest.mark.parametrize("lang", ["he", "en"])
def test_every_issue_code_is_nonempty_and_jargon_free(primary, lang):
    snap = {"primary": primary, "devices": {"total": 10, "offline": 4}}
    out = hs.summarize_health(snap, lang=lang)
    assert out.strip(), f"empty summary for {primary}/{lang}"
    _assert_jargon_free(out)


@pytest.mark.parametrize("outcome", ["synced", "recovered", "failed", "healing"])
@pytest.mark.parametrize("lang", ["he", "en"])
def test_self_heal_outcome_names_device_and_stays_clean(outcome, lang):
    # device_label is already jargon-free (he_noun + room), never an entity_id.
    label = "המנורה בסלון" if lang == "he" else "living room lamp"
    out = hs.describe_self_heal_outcome(outcome, label, lang=lang)
    assert out.strip(), f"empty self-heal line for {outcome}/{lang}"
    assert label in out, "the user-facing line should name the device"
    _assert_jargon_free(out)


@pytest.mark.parametrize("lang", ["he", "en"])
def test_replug_manual_action_is_jargon_free(lang):
    out = hs.describe_manual_action(H.MANUAL_REPLUG_DONGLE, lang=lang)
    assert out.strip(), "expected replug guidance"
    _assert_jargon_free(out)


@pytest.mark.parametrize("lang", ["he", "en"])
def test_down_devices_empty_is_reassuring(lang):
    out = hs.describe_down_devices([], lang=lang)
    assert out.strip()
    _assert_jargon_free(out)


@pytest.mark.parametrize("lang", ["he", "en"])
def test_down_devices_names_them_and_stays_clean(lang):
    items = [{"name": "Entry Light", "silent_hours": 336.0},
             {"name": "Outdoor Watering", "silent_hours": 340.0}]
    out = hs.describe_down_devices(items, lang=lang)
    assert "Entry Light" in out and "Outdoor Watering" in out
    _assert_jargon_free(out)


def test_describe_cause_none_is_graceful():
    out = hs.describe_cause(None, "המנורה בסלון", lang="he")
    assert out.strip()
    _assert_jargon_free(out)


@pytest.mark.parametrize("lang", ["he", "en"])
def test_describe_cause_automation_names_the_routine(lang):
    r = {"cause_kind": "automation", "cause_name": "Good Night",
         "state": "off", "when": "2026-08-28T23:00:00+00:00"}
    label = "המנורה בסלון" if lang == "he" else "living room lamp"
    out = hs.describe_cause(r, label, lang=lang)
    assert "Good Night" in out and label in out
    _assert_jargon_free(out)


@pytest.mark.parametrize("kind", ["person", "device", "unknown"])
@pytest.mark.parametrize("lang", ["he", "en"])
def test_describe_cause_other_kinds_stay_clean(kind, lang):
    r = {"cause_kind": kind, "cause_name": "Hall Motion" if kind == "device" else None,
         "state": "on", "when": None}
    label = "המנורה בסלון" if lang == "he" else "living room lamp"
    out = hs.describe_cause(r, label, lang=lang)
    assert out.strip() and label in out
    _assert_jargon_free(out)


# ── describe_pairing: "why won't my new device connect?" ────────────────────
@pytest.mark.parametrize("verdict", ["radio_down", "radio_starting", "stalled",
                                     "awaiting_setup", "pairing_closed", "ready"])
@pytest.mark.parametrize("lang", ["he", "en"])
def test_every_pairing_verdict_says_something_useful_and_clean(verdict, lang):
    a = {"verdict": verdict, "radio_ok": True, "pairing_open": True,
         "stalled_names": ["Front Door Sensor"], "pending_names": ["Living Room TV"]}
    out = hs.describe_pairing(a, lang=lang)
    assert out.strip(), f"no line for {verdict}"
    _assert_jargon_free(out)


@pytest.mark.parametrize("lang", ["he", "en"])
def test_a_stalled_device_is_named_to_the_user(lang):
    a = {"verdict": "stalled", "radio_ok": True, "pairing_open": True,
         "stalled_names": ["Front Door Sensor"], "pending_names": []}
    assert "Front Door Sensor" in hs.describe_pairing(a, lang=lang)


@pytest.mark.parametrize("lang", ["he", "en"])
def test_a_discovered_device_is_named_to_the_user(lang):
    a = {"verdict": "awaiting_setup", "radio_ok": True, "pairing_open": False,
         "stalled_names": [], "pending_names": ["Living Room TV"]}
    assert "Living Room TV" in hs.describe_pairing(a, lang=lang)


def test_a_wedged_radio_gets_the_physical_step_not_a_shrug():
    a = {"verdict": "radio_down", "radio_ok": False, "pairing_open": None,
         "stalled_names": [], "pending_names": []}
    out = hs.describe_pairing(a, lang="en")
    assert "plug" in out.lower(), "a wedged radio needs the replug step"
    _assert_jargon_free(out)
