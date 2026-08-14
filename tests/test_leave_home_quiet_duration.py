"""Leave Home must require a SUSTAINED quiet house, not an instantaneous one.

2026-08-14, Canary. The AC switched itself off twice in half an hour while
Youval was sitting in the living room, then came back on minutes later (Pre-cool
on Arrival re-firing). Nobody touched a remote.

`Leave Home` was compiled from 15 indoor motion/occupancy sensors:

    triggers:  <any of the 15> to 'off' for 00:15:00
    conditions: <each of the 15> state 'off'      # <-- instantaneous

The trigger is an OR across sensors, so any ONE room going idle for 15 minutes
starts the check — a guest bathroom does that constantly while you are home.
The conditions were meant to be the guard ("whole house quiet"), but they
compile to a snapshot: `state: 'off'` with no `for:`. A PIR in an OCCUPIED room
is 'off' for most of the minute — it reports motion, then drops back after its
~60-90s cooldown. So the guard passes during a routine blink-gap.

Both misfires were exactly that race:

  13:17:03  guest bathroom hit 15:00 idle (off since 13:02:03)
            living-room PIR had been off 93s (13:15:30), back ON at 13:18:17
  13:49:27  kitchen hit 15:00 idle (off since 13:34:27)
            living-room PIR had been off 70s (13:48:17), back ON at 13:49:33
            -> six seconds after the AC was killed.

The fix is that "quiet" is a duration, not an instant: every sensor must have
been off for the SAME window the trigger waited on. The living-room PIR, which
saw motion every 1-2 minutes throughout, then fails the condition and the
automation correctly does nothing.

Layer 1 (this file): `_condition_to_ha` can express a duration at all — it
could not, so the recipe had no way to say "off for 15 minutes" even if it
wanted to.
"""

from unittest.mock import patch

from services.ha_automations import _condition_to_ha, _trigger_to_ha
from services.local_automation_actions import _eval_single_condition


class TestConditionDuration:
    """A state condition must be able to carry `for_minutes`, like a trigger."""

    def test_state_condition_compiles_for_minutes_to_ha_for(self):
        out = _condition_to_ha({
            "entity_id": "binary_sensor.motion_living",
            "operator": "is",
            "value": "off",
            "for_minutes": 15,
        })
        assert out == {
            "condition": "state",
            "entity_id": "binary_sensor.motion_living",
            "state": "off",
            "for": "00:15:00",
        }

    def test_duration_over_an_hour_uses_hh_mm_ss(self):
        out = _condition_to_ha({
            "entity_id": "binary_sensor.motion_living",
            "operator": "is", "value": "off", "for_minutes": 90,
        })
        assert out["for"] == "01:30:00"

    def test_condition_duration_matches_trigger_duration_format(self):
        """Same minutes in/out on both sides, so a recipe can mirror them."""
        trig = _trigger_to_ha({
            "type": "state", "entity_id": ["binary_sensor.motion_living"],
            "state": "off", "for_minutes": 15,
        })[0]
        cond = _condition_to_ha({
            "entity_id": "binary_sensor.motion_living",
            "operator": "is", "value": "off", "for_minutes": 15,
        })
        assert cond["for"] == trig["for"] == "00:15:00"

    def test_is_not_operator_also_carries_the_duration(self):
        out = _condition_to_ha({
            "entity_id": "binary_sensor.motion_living",
            "operator": "is_not", "value": "on", "for_minutes": 15,
        })
        assert out["state"] == "off"
        assert out["for"] == "00:15:00"

    # ── Guards: a duration is opt-in and never invented ──────────────────────

    def test_condition_without_for_minutes_is_unchanged(self):
        """Every other bundle relies on instantaneous conditions — don't move them."""
        out = _condition_to_ha({
            "entity_id": "binary_sensor.door_front", "operator": "is", "value": "off",
        })
        assert out == {
            "condition": "state",
            "entity_id": "binary_sensor.door_front",
            "state": "off",
        }
        assert "for" not in out

    def test_zero_and_none_do_not_emit_a_for_key(self):
        for value in (0, None, "", "0"):
            out = _condition_to_ha({
                "entity_id": "binary_sensor.door_front",
                "operator": "is", "value": "off", "for_minutes": value,
            })
            assert "for" not in out, f"for_minutes={value!r} should not emit `for`"

    def test_garbage_for_minutes_is_ignored_not_fatal(self):
        out = _condition_to_ha({
            "entity_id": "binary_sensor.door_front",
            "operator": "is", "value": "off", "for_minutes": "soon",
        })
        assert out is not None and "for" not in out

    def test_numeric_conditions_are_untouched(self):
        out = _condition_to_ha({
            "entity_id": "sensor.temp_living", "operator": "above",
            "value": 27, "for_minutes": 15,
        })
        assert out == {
            "condition": "numeric_state",
            "entity_id": "sensor.temp_living",
            "above": 27.0,
        }


class TestLeaveHomeRegression:
    """The exact Canary shape: the compiled guard must be sustained-quiet."""

    # The living-room PIR as it actually behaved at 13:49:27 — occupied room,
    # motion 70s ago, i.e. 'off' right now but nowhere near 15 minutes idle.
    def test_whole_house_quiet_guard_is_a_duration_not_a_snapshot(self):
        sensors = [
            "binary_sensor.motion_living",     # occupied — blinking off/on
            "binary_sensor.motion_kitchen",     # the one that hit 15:00 idle
            "binary_sensor.motion_guest_bath",
        ]
        conditions = [
            {"entity_id": s, "operator": "is", "value": "off", "for_minutes": 15}
            for s in sensors
        ]
        compiled = [_condition_to_ha(c) for c in conditions]

        assert all(c["for"] == "00:15:00" for c in compiled), (
            "every sensor must be quiet for the full window — an instantaneous "
            "check passes during a PIR cooldown gap and kills the AC while "
            "someone is sitting in the room"
        )


class TestZiggyExecutorAgrees:
    """The SECOND evaluator must reach the same verdict as the compiled YAML.

    Leave Home's real actions (turn_off_all_lights, IR power_off) can't be
    expressed in HA, so HA fires the trigger and Ziggy re-runs them itself —
    re-checking the conditions on the way in ("all 16 condition(s) passed" in
    the logs). Ziggy's evaluator already understood `for_minutes`; it simply
    never received one, because nothing upstream could produce it. These pin
    both halves together so a future edit can't silently drop the window on one
    side and leave the other guarding alone.
    """

    LIVING = "binary_sensor.motion_living"

    def _eval(self, cond, state, last_changed_iso):
        state_res = {"ok": True, "data": {"state": state}}
        cache = {self.LIVING: {"last_changed": last_changed_iso}}
        with patch("services.home_automation.get_state", return_value=state_res), \
             patch("services.ha_subscriber.state_cache", cache):
            return _eval_single_condition(cond)

    def test_blinking_pir_in_an_occupied_room_fails_the_guard(self):
        """13:49:27 exactly: 'off', but only for 70s. Someone is right there."""
        from datetime import datetime, timedelta, timezone
        seventy_s_ago = (datetime.now(timezone.utc) - timedelta(seconds=70)).isoformat()
        passed, reason = self._eval(
            {"entity_id": self.LIVING, "operator": "is", "value": "off", "for_minutes": 15},
            "off", seventy_s_ago,
        )
        assert passed is False, f"expected the guard to reject a 70s-idle PIR, got: {reason}"

    def test_genuinely_quiet_room_still_passes(self):
        """07:30:44: really gone, really quiet. Leave Home must still work."""
        from datetime import datetime, timedelta, timezone
        long_ago = (datetime.now(timezone.utc) - timedelta(minutes=40)).isoformat()
        passed, _ = self._eval(
            {"entity_id": self.LIVING, "operator": "is", "value": "off", "for_minutes": 15},
            "off", long_ago,
        )
        assert passed is True

    def test_a_sensor_reporting_motion_fails_regardless_of_window(self):
        from datetime import datetime, timedelta, timezone
        long_ago = (datetime.now(timezone.utc) - timedelta(minutes=40)).isoformat()
        passed, _ = self._eval(
            {"entity_id": self.LIVING, "operator": "is", "value": "off", "for_minutes": 15},
            "on", long_ago,
        )
        assert passed is False
