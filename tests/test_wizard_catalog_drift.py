"""The wizard must not drift from the engine.

`test_automation_catalog_drift.py` guards the CATALOG against the converters.
Nothing guarded the WIZARD against the catalog — and that is exactly how a
dead trigger survived for years: every layer was internally consistent, and
no test compared the top one to the rest.

The HA `zone` trigger needed `person.*` entities. Ziggy never creates those
(presence publishes one household roll-up — services/presence_mqtt.py), so on
a live home the picker listed zero people and the trigger could not be built.
The catalog even said "PREFER the Ziggy-native arrival/departure recipes".
The wizard offered it anyway, to every customer, until 2026-09-22.

These tests read the real frontend source. They are deliberately literal: if
someone adds a trigger to the wizard that the engine can't run, or an action
the executor doesn't know, this fails with the offending name.
"""

import json
import re
from pathlib import Path

import pytest

import services.automation_catalog as C
from services.local_automation_actions import _LOCAL_TYPES

_FRONTEND = Path(__file__).resolve().parents[1] / "frontend" / "src"
_TYPES_JS = _FRONTEND / "lib" / "automations" / "types.js"


def _values_of(fn_name: str) -> set[str]:
    """The `value:` strings from one exported getter in types.js."""
    src = _TYPES_JS.read_text(encoding="utf-8")
    m = re.search(rf"export function {fn_name}\b.*?\[(.*?)\n\s*\]", src, re.S)
    assert m, f"{fn_name} not found in {_TYPES_JS.name}"
    # Skip commented-out lines so a deliberately-withdrawn option (webhook)
    # doesn't read as still offered.
    body = "\n".join(l for l in m.group(1).split("\n") if not l.strip().startswith("//"))
    return set(re.findall(r"value:\s*'([^']+)'", body))


def _catalog_ids(kind: str) -> dict:
    return {row["id"]: row for row in C.get_catalog()["ha_capabilities"][kind]}


def _native_ids() -> set[str]:
    return {n["id"] for n in C.get_catalog()["ziggy_native"]}


# ── Triggers ────────────────────────────────────────────────────────────────

# UI-only wrappers: resolved to a real engine shape on save.
#   occupancy → a `state` trigger on a room's presence sensor
#   presence  → person_arrives / person_leaves / all_persons_left / zone_*
_WIZARD_ONLY_TRIGGERS = {"occupancy", "presence"}


def test_every_wizard_trigger_is_something_the_engine_can_run():
    wizard = _values_of("getTriggerTypes") - _WIZARD_ONLY_TRIGGERS
    ha = _catalog_ids("triggers")
    native = _native_ids()
    for tid in sorted(wizard):
        assert tid in ha or tid in native, (
            f"The wizard offers trigger '{tid}', which is in neither the HA "
            f"capability catalog nor the Ziggy-native list. It cannot run."
        )
        if tid in ha:
            assert ha[tid]["ziggy_supported"] is not False, (
                f"The wizard offers trigger '{tid}' but the catalog reports it "
                f"unsupported: {ha[tid].get('ziggy_note') or ha[tid]['description'][:90]}"
            )


def test_wizard_offers_no_policy_declined_trigger():
    """A trigger the agent refuses on policy must not ship in the wizard.

    `webhook` was declined "pending a security review of inbound webhooks"
    while this list handed one to every customer — the agent and the wizard
    disagreeing about what the product does.
    """
    wizard = _values_of("getTriggerTypes")
    for tid, row in _catalog_ids("triggers").items():
        if row.get("policy_declined"):
            assert tid not in wizard, (
                f"Trigger '{tid}' is policy_declined ({row.get('ziggy_note')}) "
                f"but the wizard still offers it."
            )


def test_zone_trigger_stays_out_of_the_wizard():
    """The specific regression. It can never bind to anything in a Ziggy home."""
    assert "zone" not in _values_of("getTriggerTypes")


# ── Actions ─────────────────────────────────────────────────────────────────

# `device_command` is routed through services/command_router rather than being
# a bare executor step; `media_play` is feature-flagged but executable.
def test_every_wizard_action_is_executable():
    for aid in sorted(_values_of("getActionTypes")):
        assert aid in _LOCAL_TYPES, (
            f"The wizard offers action '{aid}', which "
            f"services.local_automation_actions._LOCAL_TYPES cannot execute. "
            f"It would save and then do nothing."
        )


# ── Conditions ──────────────────────────────────────────────────────────────

# The wizard's own names for engine shapes:
#   entity → the generic state/numeric_state condition
#   time   → time_window
_WIZARD_CONDITION_ALIASES = {"entity": "state", "time": "time_window"}


def test_every_wizard_condition_is_evaluable():
    ha = _catalog_ids("conditions")
    for cid in sorted(_values_of("getConditionTypes")):
        real = _WIZARD_CONDITION_ALIASES.get(cid, cid)
        assert real in ha, f"The wizard offers condition '{cid}' ({real}), not in the catalog."
        assert ha[real]["ziggy_supported"] is not False, (
            f"The wizard offers condition '{cid}' but the catalog reports it unsupported."
        )


def test_sun_and_presence_conditions_are_reachable_in_the_wizard():
    """Both were supported by both evaluators, and unbuildable in the UI.

    "Porch light at sunset, but only if nobody's home" was a sentence Ziggy
    would build from chat and the wizard could not express.
    """
    offered = _values_of("getConditionTypes")
    assert "sun" in offered
    assert "presence" in offered
