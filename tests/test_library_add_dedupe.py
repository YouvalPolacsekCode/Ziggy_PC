"""Library "Add is always available" — unique per-instance ids (addendum A3).

Adding the same template twice must create a SECOND automation/routine, not
silently overwrite the first. The guard lives at the two create chokepoints:
ha_automations._dedupe_auto_id and ha_scripts._dedupe_script_id, both keyed
off the live HA state cache (plus the Ziggy-local store for automations).
"""
from unittest.mock import patch


def test_auto_id_free_when_unused():
    from services.ha_automations import _dedupe_auto_id
    with patch("services.ha_subscriber.state_cache", {}), \
         patch("core.automation_file.list_automations", return_value=[]):
        assert _dedupe_auto_id("motion_light") == "motion_light"


def test_auto_id_suffixes_on_collision():
    from services.ha_automations import _dedupe_auto_id
    cache = {"automation.motion_light": {}, "automation.motion_light_2": {}}
    with patch("services.ha_subscriber.state_cache", cache), \
         patch("core.automation_file.list_automations", return_value=[]):
        assert _dedupe_auto_id("motion_light") == "motion_light_3"


def test_auto_id_sees_ziggy_local_store_too():
    # Ziggy-only automations (no HA entity) must also block their slug.
    from services.ha_automations import _dedupe_auto_id
    with patch("services.ha_subscriber.state_cache", {}), \
         patch("core.automation_file.list_automations",
               return_value=[{"id": "leaving"}]):
        assert _dedupe_auto_id("leaving") == "leaving_2"


def test_script_id_suffixes_on_collision():
    from services.ha_scripts import _dedupe_script_id
    cache = {"script.good_night": {}}
    with patch("services.ha_subscriber.state_cache", cache):
        assert _dedupe_script_id("good_night") == "good_night_2"
        assert _dedupe_script_id("movie_night") == "movie_night"
