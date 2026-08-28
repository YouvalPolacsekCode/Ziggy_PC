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
