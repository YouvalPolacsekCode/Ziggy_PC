"""An HA-fired automation must still push to the phone.

2026-08-14, Canary. Leave Home fired four times and turned off the lights and
the AC. The user got no notification at all — the first he knew of it was a
cold room.

Its stored Ziggy actions were:

    turn_off_all_lights
    ir_command   power_off
    notify       "Everyone left — turned things off at home."

but the executor logged only two steps:

    [Executor] ziggy_leave_home step 1/2: turn_off_all_lights
    [Executor] ziggy_leave_home step 2/2: ir_command
    [Executor] ziggy_leave_home complete — 2 steps

The notify was filtered out by `ha_defers_action`, whose rule was "call_service
/ delay / notify run natively in HA, so don't re-run them". That is true for
call_service and delay. It is NOT true for notify: `_action_to_ha` compiles a
Ziggy notify to `notify.persistent_notification`, which only drops a row in
Home Assistant's own notification panel — a surface the user never opens (Ziggy
is the only product surface). The push that actually reaches the phone is sent
by Ziggy's own notify step.

So a notify on an HA-backed automation went to a panel nobody reads, and the
real push was suppressed as a duplicate of it. Compare Pre-cool on Arrival,
which is fired by Ziggy's presence engine rather than HA and therefore runs all
of its steps:

    [Executor] ziggy_precool_arrival step 2/2: notify
    [Push] Sent 'Pre-cool on Arrival' (automation) to 1 subscription(s)

`notify` belongs with ir_command and ziggy_intent: HA's compiled form is a
placeholder, not the real effect.
"""

from services.ha_automations import (
    _HA_PLACEHOLDER_TYPES,
    _action_to_ha,
    ha_defers_action,
)


LEAVE_HOME_STEPS = [
    {"type": "turn_off_all_lights"},
    {"type": "ir_command", "ir_device_id": "ir_ba8b01d69c", "ir_command": "power_off"},
    {"type": "notify", "title": "Leave Home",
     "message": "Everyone left — turned things off at home."},
]


class TestNotifyIsDeferredToZiggy:

    def test_notify_is_deferred(self):
        assert ha_defers_action(LEAVE_HOME_STEPS[2]) is True, (
            "HA's notify.persistent_notification never reaches the phone — "
            "Ziggy has to send the push itself"
        )

    def test_notify_is_declared_a_placeholder(self):
        assert "notify" in _HA_PLACEHOLDER_TYPES

    def test_leave_home_runs_all_three_steps_not_two(self):
        """The exact regression: the executor saw 2 of 3 steps."""
        deferred = [s for s in LEAVE_HOME_STEPS if ha_defers_action(s)]
        assert [s["type"] for s in deferred] == [
            "turn_off_all_lights", "ir_command", "notify",
        ]

    def test_ha_still_gets_a_notify_row_for_its_own_trace(self):
        """Kept deliberately: HA's panel entry is harmless and useful in traces.

        The user never sees it, so a duplicate costs nothing; losing the real
        push cost a silent AC shutdown.
        """
        compiled = _action_to_ha(LEAVE_HOME_STEPS[2])
        assert compiled is not None
        assert compiled["service"] == "notify.persistent_notification"


class TestGenuinelyNativeActionsStayNative:
    """Re-running these WOULD double-fire — e.g. Pre-cool's climate call."""

    def test_call_service_is_not_deferred(self):
        assert ha_defers_action({
            "type": "call_service", "entity_id": "climate.ac_living",
            "service": "climate.turn_off",
        }) is False

    def test_delay_is_not_deferred(self):
        assert ha_defers_action({"type": "delay", "seconds": 30}) is False

    def test_an_all_native_automation_defers_nothing(self):
        """`_run_deferred_automation_actions` must still early-out for these,
        or Ziggy would re-run a climate call HA already made."""
        native = [
            {"type": "call_service", "entity_id": "light.office", "service": "light.turn_off"},
            {"type": "delay", "seconds": 5},
        ]
        assert [s for s in native if ha_defers_action(s)] == []

    def test_ir_and_intent_are_still_deferred(self):
        assert ha_defers_action({"type": "ir_command", "ir_device_id": "x"}) is True
        assert ha_defers_action({"type": "ziggy_intent", "capability": "x"}) is True
        assert ha_defers_action({"type": "turn_off_all_lights"}) is True
