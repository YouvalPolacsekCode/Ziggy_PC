"""A wiped automations.yaml must be impossible to miss — without crying wolf.

2026-08-14, Canary. `docker/ha-config/automations.yaml` sat at `[]` for five and
a half hours — all twelve of the home's Home Assistant automations gone. Nothing
reported it. `fleet-health` was green apart from one offline device, and it was
found only because someone happened to `grep` the file. Leave Home, Pre-cool and
every Smart Room rule were dead the whole time.

The mechanism is structural: the customer's live HA config lives inside the
git-tracked tree and the repo ships `automations.yaml` as `[]`, so every release
checkout overwrites it and a backup/restore dance is the only thing putting it
back. That dance has no validation — it restores an empty file as faithfully as
a good one, and once an empty copy is captured it propagates forever.

Ziggy's own store (`user_files/`, untracked) survived the wipe, which is both
what makes it detectable and what made recovery possible.

**The subtlety that broke the first version of this check:** not every Ziggy
automation belongs in HA. A `zone_entered` or `all_persons_left` trigger has no
HA representation, so Pre-cool lives only in Ziggy. Comparing the RAW Ziggy
total against HA reports a permanent phantom gap — the first version flagged a
perfectly healthy Canary (14 in Ziggy, 13 HA-backed, 12 in HA) as wiped. The
comparison must use `ziggy_ha_backed`, computed with the same `needs_ha`
predicate the compiler uses, so both sides agree by construction.

Two severities, deliberately: a total wipe and a one-off bookkeeping drift are
different events. A detector that cries wolf on drift gets ignored before the
real wipe arrives.
"""

import pytest

from relay.app import fleet_health


def _payload(*, backed, ha, raw=None):
    return {"health": {"automations": {
        "ziggy_total":     raw if raw is not None else backed,
        "ziggy_ha_backed": backed,
        "ha_total":        ha,
    }}}


class TestVitalsCarryTheCounts:

    def test_all_three_numbers_are_reported(self):
        v = fleet_health.vitals(_payload(backed=13, ha=12, raw=14))
        assert v["automations_ziggy"] == 14
        assert v["automations_ha_backed"] == 13
        assert v["automations_ha"] == 12

    def test_a_hub_too_old_to_report_stays_none(self):
        v = fleet_health.vitals({"health": {"devices": {"total": 20}}})
        assert v["automations_ziggy"] is None
        assert v["automations_ha_backed"] is None
        assert v["automations_ha"] is None


class TestTotalWipe:

    def _issues(self, payload):
        return {i["code"] for i in fleet_health._evaluate_payload(payload)}

    def _issue(self, payload, code):
        return next(i for i in fleet_health._evaluate_payload(payload) if i["code"] == code)

    def test_HA_at_zero_while_ziggy_has_some_is_a_wipe(self):
        """The exact 2026-08-14 signature."""
        assert "automations_wiped" in self._issues(_payload(backed=12, ha=0))

    def test_a_wipe_is_down_not_degraded(self):
        issue = self._issue(_payload(backed=12, ha=0), "automations_wiped")
        assert issue["level"] == "down", \
            "every automation in the home is dead — that is not 'degraded'"

    def test_the_message_names_the_count_and_where_the_copy_lives(self):
        issue = self._issue(_payload(backed=12, ha=0), "automations_wiped")
        assert "12" in issue["message"]
        assert "user_files" in issue["message"]

    def test_it_is_NOT_wired_to_the_unattended_repair_path(self):
        """Auto-writing automations into a customer's HA off a count mismatch
        is not safe unattended — a false positive would overwrite a real
        config. Human-actioned on purpose; the guardrail test enforces it."""
        assert fleet_health._REMEDY.get("automations_wiped") is None
        issue = self._issue(_payload(backed=12, ha=0), "automations_wiped")
        assert issue.get("remedy") is None
        assert issue.get("kind") == "human"


class TestPartialDriftIsSeparate:

    def _issues(self, payload):
        return {i["code"] for i in fleet_health._evaluate_payload(payload)}

    def test_some_missing_is_degraded_not_a_wipe(self):
        codes = self._issues(_payload(backed=13, ha=12))
        assert "automations_missing" in codes
        assert "automations_wiped" not in codes

    def test_it_says_how_many_are_missing(self):
        issue = next(i for i in fleet_health._evaluate_payload(_payload(backed=13, ha=12))
                     if i["code"] == "automations_missing")
        assert issue["level"] == "degraded"
        assert "1" in issue["message"]


class TestNoFalsePositives:

    def _issues(self, payload):
        return {i["code"] for i in fleet_health._evaluate_payload(payload)}

    def test_ziggy_only_automations_do_NOT_read_as_missing(self):
        """The real Canary shape that broke the first version of this check.

        14 in the store, 13 HA-backed, 12 in HA. Pre-cool's `zone_entered`
        trigger has no HA counterpart BY DESIGN — comparing the raw 14 would
        report a permanent phantom gap on a healthy home.
        """
        codes = self._issues(_payload(backed=12, ha=12, raw=14))
        assert "automations_wiped" not in codes
        assert "automations_missing" not in codes

    def test_a_matched_home_is_quiet(self):
        assert self._issues(_payload(backed=6, ha=6)) == set()

    def test_a_fresh_home_with_none_anywhere_is_quiet(self):
        assert self._issues(_payload(backed=0, ha=0)) == set()

    def test_a_home_with_only_ziggy_native_automations_is_quiet(self):
        """Nothing belongs in HA, so HA having nothing is correct."""
        assert self._issues(_payload(backed=0, ha=0, raw=3)) == set()

    def test_a_hub_too_old_to_report_is_quiet(self):
        # An empty health block raises its own `no_health_telemetry` issue,
        # which is not ours — assert only that WE stay silent.
        codes = self._issues({"health": {}})
        assert "automations_wiped" not in codes
        assert "automations_missing" not in codes

    def test_more_in_HA_than_ziggy_is_fine(self):
        """Hand-written HA automations are legitimate and common."""
        assert self._issues(_payload(backed=2, ha=9)) == set()
