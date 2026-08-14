"""A wiped automations.yaml must be impossible to miss.

2026-08-14, Canary. `docker/ha-config/automations.yaml` sat at `[]` for five and
a half hours — all twelve of the home's Home Assistant automations gone. Nothing
reported it. `fleet-health` was green apart from one offline device, the app
looked normal, and it was found only because someone happened to `grep` the
file. Leave Home, Pre-cool and every Smart Room rule were dead the whole time.

The mechanism is structural, not a one-off: the customer's live HA config lives
inside the git-tracked tree and the repo ships `automations.yaml` as `[]`, so
every release checkout overwrites it and a backup/restore dance is the only
thing putting it back. That dance has no validation — it will restore an empty
file as faithfully as a good one, and once an empty copy is captured it is
propagated forever.

A wipe has an unmistakable signature that needs no history and no thresholds:

    Ziggy's own store says N automations   (user_files/, durable, untracked)
    Home Assistant says 0                  (the tracked file that just got reset)

Ziggy's store is the second copy that survived the wipe and made recovery
possible, so comparing the two is both the detector and the repair source.

A genuinely fresh home has 0 in BOTH and must stay quiet.
"""

import pytest

from relay.app import fleet_health


def _payload(*, ziggy_n, ha_n, **extra):
    health = {"automations": {"ziggy_total": ziggy_n, "ha_total": ha_n}}
    health.update(extra.pop("health", {}))
    return {"health": health, **extra}


class TestVitalsCarryAutomationCounts:

    def test_both_counts_are_reported(self):
        v = fleet_health.vitals(_payload(ziggy_n=12, ha_n=12))
        assert v["automations_ziggy"] == 12
        assert v["automations_ha"] == 12

    def test_missing_payload_does_not_invent_numbers(self):
        v = fleet_health.vitals({})
        assert v["automations_ziggy"] is None
        assert v["automations_ha"] is None

    def test_an_older_hub_that_does_not_report_them_stays_none(self):
        """Homes on an older release must not read as wiped."""
        v = fleet_health.vitals({"health": {"devices": {"total": 20}}})
        assert v["automations_ziggy"] is None
        assert v["automations_ha"] is None


class TestWipeDetection:

    def _issues(self, payload):
        return {i.get("code") for i in fleet_health._evaluate_payload(payload)}

    def _issue(self, payload, code):
        return next(i for i in fleet_health._evaluate_payload(payload)
                    if i["code"] == code)

    def test_ziggy_has_automations_but_HA_has_none_is_flagged(self):
        """The exact 2026-08-14 signature."""
        assert "automations_wiped" in self._issues(_payload(ziggy_n=12, ha_n=0))

    def test_it_is_not_a_mere_warning(self):
        issue = self._issue(_payload(ziggy_n=12, ha_n=0), "automations_wiped")
        assert issue["level"] == "down", (
            "every automation in the home is dead — that is not 'degraded'"
        )

    def test_the_message_names_the_numbers_and_the_repair(self):
        issue = self._issue(_payload(ziggy_n=12, ha_n=0), "automations_wiped")
        assert "12" in issue["message"]
        assert "user_files" in issue["message"], \
            "the operator must be told where the surviving copy is"

    def test_it_is_NOT_wired_to_the_unattended_repair_path(self):
        """Auto-writing automations into a customer's HA off a count mismatch
        is not a safe unattended action — a false positive would overwrite a
        real config. This stays human-actioned on purpose."""
        assert fleet_health._REMEDY.get("automations_wiped") is None
        issue = self._issue(_payload(ziggy_n=12, ha_n=0), "automations_wiped")
        assert issue.get("remedy") is None
        assert issue.get("kind") == "human"

    def test_a_healthy_home_is_quiet(self):
        assert "automations_wiped" not in self._issues(_payload(ziggy_n=12, ha_n=12))

    def test_a_fresh_home_with_none_anywhere_is_quiet(self):
        """Zero automations is normal on a new home — only a MISMATCH is a wipe."""
        assert "automations_wiped" not in self._issues(_payload(ziggy_n=0, ha_n=0))

    def test_a_hub_too_old_to_report_is_quiet(self):
        assert "automations_wiped" not in self._issues({"health": {}})

    def test_partial_loss_is_flagged_too(self):
        """Not every wipe empties the file completely."""
        assert "automations_wiped" in self._issues(_payload(ziggy_n=12, ha_n=3))

    def test_more_in_HA_than_ziggy_is_NOT_a_wipe(self):
        """Hand-written HA automations are legitimate and common."""
        assert "automations_wiped" not in self._issues(_payload(ziggy_n=2, ha_n=9))
