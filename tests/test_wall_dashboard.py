"""Wall dashboard backend — layouts, lists, agenda, capability policy.

Every test redirects the module's storage path at a tmp_path, so nothing here
touches the real user_files/. That matters: these run on a developer's machine
against a live hub checkout.
"""
from __future__ import annotations

import asyncio
import json

import pytest

from services import wall_layouts as layouts
from services import wall_lists as lists
from services import wall_policy as policy


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def tmp_lists(tmp_path, monkeypatch):
    monkeypatch.setattr(lists, "_FILE", tmp_path / "wall_lists.json")
    return tmp_path


@pytest.fixture
def tmp_layouts(tmp_path, monkeypatch):
    monkeypatch.setattr(layouts, "_FILE", tmp_path / "wall_layouts.json")
    return tmp_path


@pytest.fixture
def tmp_policy(tmp_path, monkeypatch):
    monkeypatch.setattr(policy, "_FILE", tmp_path / "wall_tablet_policy.json")
    policy._elevations.clear()
    policy._pin_attempts.clear()
    yield tmp_path
    policy._elevations.clear()
    policy._pin_attempts.clear()


# ---------------------------------------------------------------------------
# Layouts
# ---------------------------------------------------------------------------

class TestWallLayouts:
    def test_default_is_valid_and_fills_the_grid(self):
        doc = layouts.default_layout()
        assert doc["version"] == 2
        assert doc["cols"] == 12
        # Every column of the first content row is used — a fresh tablet should
        # not show a blank third.
        widest = max(m["x"] + m["w"] for m in doc["modules"])
        assert widest == 12

    def test_default_modules_do_not_overlap(self):
        mods = layouts.default_layout()["modules"]
        for i, a in enumerate(mods):
            for b in mods[i + 1:]:
                overlap = (a["x"] < b["x"] + b["w"] and a["x"] + a["w"] > b["x"]
                           and a["y"] < b["y"] + b["h"] and a["y"] + a["h"] > b["y"])
                assert not overlap, f"{a['id']} overlaps {b['id']}"

    def test_sanitize_drops_unknown_module_types(self):
        out = layouts.sanitize({"modules": [
            {"type": "clock", "x": 0, "y": 0, "w": 3, "h": 2},
            {"type": "definitely_not_a_module"},
        ]})
        assert [m["type"] for m in out["modules"]] == ["clock"]

    def test_sanitize_repairs_nonsense_geometry(self):
        out = layouts.sanitize({"modules": [
            {"type": "clock", "x": -9, "y": "banana", "w": 9999, "h": 0},
        ]})
        m = out["modules"][0]
        assert m["x"] == 0 and m["y"] == 0
        assert 1 <= m["w"] <= 24 and m["h"] >= 1

    @pytest.mark.parametrize("junk", [None, "string", 42, [], {"modules": "nope"}])
    def test_sanitize_never_raises(self, junk):
        out = layouts.sanitize(junk)
        assert out["version"] == 2 and out["modules"]

    def test_sanitize_dedupes_ids(self):
        out = layouts.sanitize({"modules": [
            {"id": "dup", "type": "clock", "x": 0, "y": 0, "w": 2, "h": 2},
            {"id": "dup", "type": "clock", "x": 2, "y": 0, "w": 2, "h": 2},
        ]})
        ids = [m["id"] for m in out["modules"]]
        assert len(set(ids)) == len(ids)

    def test_empty_module_list_falls_back_to_default(self):
        assert layouts.sanitize({"modules": []})["modules"] == layouts.default_layout()["modules"]

    def test_save_and_get_round_trip(self, tmp_layouts):
        doc = layouts.default_layout()
        doc["modules"] = [{"id": "c", "type": "clock", "x": 1, "y": 1, "w": 3, "h": 2, "config": {}}]
        asyncio.run(layouts.save_layout("tab_1", doc))
        got = asyncio.run(layouts.get_layout("tab_1"))
        assert got["modules"][0]["id"] == "c"

    def test_layouts_are_per_tablet(self, tmp_layouts):
        a = layouts.default_layout()
        a["modules"] = [{"id": "a", "type": "clock", "x": 0, "y": 0, "w": 2, "h": 2, "config": {}}]
        asyncio.run(layouts.save_layout("tab_a", a))
        # A tablet with no saved layout gets the default, not tab_a's.
        assert asyncio.run(layouts.get_layout("tab_b")) == layouts.default_layout()

    def test_authored_cols_are_preserved(self, tmp_layouts):
        """The stored layout keeps the width it was arranged at. Fitting to a
        different board happens on the client at render time; if the server
        rewrote cols here, a phone opening /wall once would reshape the wall
        tablet's arrangement permanently."""
        doc = layouts.default_layout()
        doc["cols"] = 6
        asyncio.run(layouts.save_layout("tab_1", doc))
        assert asyncio.run(layouts.get_layout("tab_1"))["cols"] == 6

    def test_unpaired_tablet_cannot_save(self, tmp_layouts):
        with pytest.raises(ValueError):
            asyncio.run(layouts.save_layout("", layouts.default_layout()))

    def test_oversized_layout_is_rejected(self, tmp_layouts):
        doc = layouts.default_layout()
        doc["modules"] = [
            {"id": f"m{i}", "type": "clock", "x": 0, "y": i, "w": 2, "h": 1,
             "config": {"junk": "x" * 5000}}
            for i in range(40)
        ]
        with pytest.raises(ValueError):
            asyncio.run(layouts.save_layout("tab_1", doc))

    def test_delete_layout(self, tmp_layouts):
        asyncio.run(layouts.save_layout("tab_1", layouts.default_layout()))
        assert asyncio.run(layouts.delete_layout("tab_1")) is True
        assert asyncio.run(layouts.delete_layout("tab_1")) is False

    def test_corrupt_file_does_not_take_the_wall_down(self, tmp_layouts):
        (tmp_layouts / "wall_layouts.json").write_text("{ not json at all")
        assert asyncio.run(layouts.get_layout("tab_1")) == layouts.default_layout()


# ---------------------------------------------------------------------------
# Lists
# ---------------------------------------------------------------------------

class TestLists:
    def test_default_list_exists_on_first_read(self, tmp_lists):
        got = asyncio.run(lists.get_lists())
        assert [l["id"] for l in got] == ["default"]

    def test_add_toggle_and_clear(self, tmp_lists):
        item = asyncio.run(lists.add_item("default", "Milk", "yuval"))
        assert item["done"] is False and item["added_by"] == "yuval"

        asyncio.run(lists.update_item("default", item["id"], {"done": True}))
        assert asyncio.run(lists.get_list("default"))["items"][0]["done"] is True

        assert asyncio.run(lists.clear_done("default")) == 1
        assert asyncio.run(lists.get_list("default"))["items"] == []

    def test_rename_an_item(self, tmp_lists):
        item = asyncio.run(lists.add_item("default", "Milk"))
        out = asyncio.run(lists.update_item("default", item["id"], {"text": "Oat milk"}))
        assert out["text"] == "Oat milk"

    def test_blank_text_is_rejected(self, tmp_lists):
        with pytest.raises(ValueError):
            asyncio.run(lists.add_item("default", "   "))

    def test_text_is_length_capped(self, tmp_lists):
        item = asyncio.run(lists.add_item("default", "x" * 5000))
        assert len(item["text"]) <= lists._MAX_TEXT

    def test_unknown_list_returns_none(self, tmp_lists):
        assert asyncio.run(lists.add_item("nope", "Milk")) is None

    def test_delete_item(self, tmp_lists):
        item = asyncio.run(lists.add_item("default", "Milk"))
        assert asyncio.run(lists.delete_item("default", item["id"])) is True
        assert asyncio.run(lists.delete_item("default", item["id"])) is False

    def test_default_list_cannot_be_deleted(self, tmp_lists):
        asyncio.run(lists.get_lists())
        with pytest.raises(ValueError):
            asyncio.run(lists.delete_list("default"))

    def test_create_and_delete_a_second_list(self, tmp_lists):
        rec = asyncio.run(lists.create_list("Hardware store"))
        assert rec["name"] == "Hardware store"
        assert asyncio.run(lists.delete_list(rec["id"])) is True

    def test_items_survive_a_restart(self, tmp_lists):
        asyncio.run(lists.add_item("default", "Milk"))
        # Simulate a process restart: nothing cached, read straight off disk.
        assert asyncio.run(lists.get_list("default"))["items"][0]["text"] == "Milk"
        raw = json.loads((tmp_lists / "wall_lists.json").read_text())
        assert raw["lists"]["default"]["items"][0]["text"] == "Milk"

    def test_concurrent_adds_do_not_lose_writes(self, tmp_lists):
        """Two phones ticking the list at the same moment must not clobber one
        another — the whole file is rewritten on every mutation, so the lock is
        the only thing preventing a lost update."""
        async def main():
            await asyncio.gather(*[lists.add_item("default", f"item {i}") for i in range(12)])
            return await lists.get_list("default")
        got = asyncio.run(main())
        assert len(got["items"]) == 12


# ---------------------------------------------------------------------------
# Agenda
# ---------------------------------------------------------------------------

class TestAgenda:
    def test_create_and_read_today(self, tmp_lists):
        ev = asyncio.run(lists.create_event("Dinner", time_str="19:30", note="everyone home"))
        assert ev["title"] == "Dinner"
        events = asyncio.run(lists.get_agenda(1))
        assert len(events) == 1 and events[0]["day_offset"] == 0

    def test_events_sort_by_time(self, tmp_lists):
        asyncio.run(lists.create_event("Late", time_str="21:00"))
        asyncio.run(lists.create_event("Early", time_str="07:30"))
        titles = [e["title"] for e in asyncio.run(lists.get_agenda(1))]
        assert titles == ["Early", "Late"]

    def test_tomorrow_is_excluded_from_a_one_day_window(self, tmp_lists):
        from datetime import date, timedelta
        asyncio.run(lists.create_event("Tomorrow", when=(date.today() + timedelta(days=1)).isoformat()))
        assert asyncio.run(lists.get_agenda(1)) == []
        assert len(asyncio.run(lists.get_agenda(2))) == 1

    def test_blank_title_rejected(self, tmp_lists):
        with pytest.raises(ValueError):
            asyncio.run(lists.create_event("  "))

    def test_update_and_delete(self, tmp_lists):
        ev = asyncio.run(lists.create_event("Dinner"))
        assert asyncio.run(lists.update_event(ev["id"], {"done": True}))["done"] is True
        assert asyncio.run(lists.delete_event(ev["id"])) is True
        assert asyncio.run(lists.delete_event(ev["id"])) is False

    def test_malformed_when_falls_back_to_today(self, tmp_lists):
        asyncio.run(lists.create_event("Whenever", when="not-a-date"))
        assert len(asyncio.run(lists.get_agenda(1))) == 1


# ---------------------------------------------------------------------------
# Capability policy
# ---------------------------------------------------------------------------

class TestWallPolicy:
    def test_unpaired_session_is_unrestricted(self, tmp_policy):
        """An unpaired visitor to /wall is a signed-in person in a browser,
        not a wall panel. They already carry their own permissions, and they
        send no tablet header — so restricting the UI would be theatre that
        only confuses (a Devices button vanishing with no explanation)."""
        pol = asyncio.run(policy.get_policy(None))
        assert all(pol["capabilities"].values())
        assert pol["pin_required"] == []
        assert asyncio.run(policy.check(None, "locks")) == (True, "ok")

    def test_defaults_are_safe(self, tmp_policy):
        pol = asyncio.run(policy.get_policy("tab_1"))
        # Immediately useful...
        assert pol["capabilities"]["lights"] is True
        assert pol["capabilities"]["lists"] is True
        # ...but a shared wall screen cannot open the door or watch a camera
        # until an admin says so.
        assert pol["capabilities"]["locks"] is False
        assert pol["capabilities"]["cameras"] is False
        assert pol["capabilities"]["settings"] is False

    def test_policy_never_leaks_the_pin_hash(self, tmp_policy):
        asyncio.run(policy.set_pin("tab_1", "4321"))
        pol = asyncio.run(policy.get_policy("tab_1"))
        assert pol["has_pin"] is True
        assert "pin_hash" not in json.dumps(pol)

    def test_denial_beats_pin_requirement(self, tmp_policy):
        # locks is False by default, so it is refused outright rather than
        # prompting for a PIN that would not help.
        assert asyncio.run(policy.check("tab_1", "locks")) == (False, "denied")

    def test_enabled_but_pin_required(self, tmp_policy):
        asyncio.run(policy.set_policy("tab_1", {
            "capabilities": {**policy.DEFAULT_CAPABILITIES, "locks": True},
            "pin_required": ["locks"],
        }))
        assert asyncio.run(policy.check("tab_1", "locks")) == (False, "pin_required")

    def test_no_capability_is_always_allowed(self, tmp_policy):
        assert asyncio.run(policy.check("tab_1", None)) == (True, "ok")

    def test_correct_pin_elevates_only_that_capability(self, tmp_policy):
        asyncio.run(policy.set_policy("tab_1", {
            "capabilities": {**policy.DEFAULT_CAPABILITIES, "locks": True, "cameras": True},
            "pin_required": ["locks", "cameras"],
        }))
        asyncio.run(policy.set_pin("tab_1", "1234"))

        res = asyncio.run(policy.verify_pin("tab_1", "locks", "1234"))
        assert res["ok"] is True
        assert asyncio.run(policy.check("tab_1", "locks")) == (True, "ok")
        # Unlocking the door must not also unlock the cameras.
        assert asyncio.run(policy.check("tab_1", "cameras")) == (False, "pin_required")

    def test_wrong_pin_does_not_elevate(self, tmp_policy):
        asyncio.run(policy.set_pin("tab_1", "1234"))
        assert asyncio.run(policy.verify_pin("tab_1", "locks", "9999"))["ok"] is False
        assert policy.is_elevated("tab_1", "locks") is False

    def test_verify_without_a_pin_set(self, tmp_policy):
        assert asyncio.run(policy.verify_pin("tab_1", "locks", "1234")) == {"ok": False, "reason": "no_pin"}

    def test_brute_force_is_rate_limited(self, tmp_policy):
        asyncio.run(policy.set_pin("tab_1", "1234"))
        for _ in range(policy._PIN_ATTEMPT_MAX):
            asyncio.run(policy.verify_pin("tab_1", "locks", "0000"))
        with pytest.raises(PermissionError):
            asyncio.run(policy.verify_pin("tab_1", "locks", "0000"))

    def test_a_correct_pin_clears_the_attempt_counter(self, tmp_policy):
        asyncio.run(policy.set_pin("tab_1", "1234"))
        for _ in range(policy._PIN_ATTEMPT_MAX - 1):
            asyncio.run(policy.verify_pin("tab_1", "locks", "0000"))
        assert asyncio.run(policy.verify_pin("tab_1", "locks", "1234"))["ok"] is True
        # Not locked out immediately after succeeding.
        assert asyncio.run(policy.verify_pin("tab_1", "locks", "1234"))["ok"] is True

    def test_going_idle_drops_elevation(self, tmp_policy):
        asyncio.run(policy.set_policy("tab_1", {
            "capabilities": {**policy.DEFAULT_CAPABILITIES, "locks": True},
            "pin_required": ["locks"],
        }))
        asyncio.run(policy.set_pin("tab_1", "1234"))
        asyncio.run(policy.verify_pin("tab_1", "locks", "1234"))
        assert policy.is_elevated("tab_1", "locks") is True

        policy.drop_elevation("tab_1")
        assert policy.is_elevated("tab_1", "locks") is False

    def test_elevation_expires(self, tmp_policy, monkeypatch):
        asyncio.run(policy.set_pin("tab_1", "1234"))
        asyncio.run(policy.verify_pin("tab_1", "locks", "1234"))
        assert policy.is_elevated("tab_1", "locks") is True
        # Jump past the TTL rather than sleeping through it.
        monkeypatch.setattr(policy, "_now", lambda: __import__("time").time() + policy.ELEVATION_TTL_S + 1)
        assert policy.is_elevated("tab_1", "locks") is False

    def test_clearing_the_pin_clears_pin_requirements(self, tmp_policy):
        """Otherwise clearing the PIN would leave capabilities gated behind a
        PIN that no longer exists — locking the tablet out with no way back."""
        asyncio.run(policy.set_policy("tab_1", {
            "capabilities": {**policy.DEFAULT_CAPABILITIES, "locks": True},
            "pin_required": ["locks"],
        }))
        asyncio.run(policy.set_pin("tab_1", "1234"))
        asyncio.run(policy.set_pin("tab_1", None))
        pol = asyncio.run(policy.get_policy("tab_1"))
        assert pol["has_pin"] is False and pol["pin_required"] == []
        assert asyncio.run(policy.check("tab_1", "locks")) == (True, "ok")

    @pytest.mark.parametrize("bad", ["123", "123456789", "abcd", "12a4"])
    def test_pin_format_is_validated(self, tmp_policy, bad):
        with pytest.raises(ValueError):
            asyncio.run(policy.set_pin("tab_1", bad))

    def test_setting_policy_preserves_an_existing_pin(self, tmp_policy):
        asyncio.run(policy.set_pin("tab_1", "1234"))
        asyncio.run(policy.set_policy("tab_1", {"capabilities": policy.DEFAULT_CAPABILITIES}))
        assert asyncio.run(policy.get_policy("tab_1"))["has_pin"] is True

    def test_hash_is_salted_so_two_tablets_differ(self, tmp_policy):
        a = policy._hash_pin("1234")
        b = policy._hash_pin("1234")
        assert a != b
        assert policy._verify_pin("1234", a) and policy._verify_pin("1234", b)

    def test_verify_survives_a_garbage_hash(self, tmp_policy):
        assert policy._verify_pin("1234", "not-a-real-hash") is False

    def test_unpairing_forgets_the_policy_and_the_pin(self, tmp_policy):
        """Found while cleaning up after a manual test: un-pair deleted the
        layout but left the capability set and PIN hash on disk. A reissued
        tablet id would have inherited a stranger's permissions and PIN."""
        asyncio.run(policy.set_policy("tab_1", {
            "capabilities": {**policy.DEFAULT_CAPABILITIES, "locks": True},
            "pin_required": ["locks"],
        }))
        asyncio.run(policy.set_pin("tab_1", "1234"))
        asyncio.run(policy.verify_pin("tab_1", "locks", "1234"))
        assert policy.is_elevated("tab_1", "locks") is True

        assert asyncio.run(policy.delete_policy("tab_1")) is True

        # Nothing of the old tablet survives: not the PIN, not the widened
        # capabilities, not the live elevation.
        fresh = asyncio.run(policy.get_policy("tab_1"))
        assert fresh["has_pin"] is False
        assert fresh["capabilities"]["locks"] is False
        assert policy.is_elevated("tab_1", "locks") is False
        assert asyncio.run(policy.delete_policy("tab_1")) is False


# ---------------------------------------------------------------------------
# Realtime contract
# ---------------------------------------------------------------------------

def test_list_and_agenda_events_reach_phones():
    """The wall owns the UI today, but the events must already be forwarded to
    the native app — otherwise adding a phone screen later needs a hub release
    rather than just a client one."""
    from services.mobile_ws_bridge import _MOBILE_RELEVANT_TYPES
    assert "list_changed" in _MOBILE_RELEVANT_TYPES
    assert "agenda_changed" in _MOBILE_RELEVANT_TYPES


# ---------------------------------------------------------------------------
# Capability middleware — the piece that makes the policy real
# ---------------------------------------------------------------------------

class TestCapabilityMiddleware:
    """Hiding a door-unlock button in the UI is not security: a wall tablet can
    be pointed at the API directly. These cover the enforcement that actually
    matters, plus the guarantee that no OTHER client is affected."""

    def _mw(self):
        from backend.middleware.wall_capability import (
            _capability_for, _capability_for_control, HEADER,
        )
        return _capability_for, _capability_for_control, HEADER

    def test_unrelated_paths_are_unrestricted(self):
        cap_for, _, _ = self._mw()
        assert cap_for("/api/status", "GET") is None
        assert cap_for("/api/rooms", "GET") is None
        # Reading automations is fine; only changing them is gated.
        assert cap_for("/api/automations", "GET") is None

    def test_sensitive_paths_map_to_capabilities(self):
        cap_for, _, _ = self._mw()
        assert cap_for("/api/cameras/camera.front/snapshot", "GET") == "cameras"
        assert cap_for("/api/pairing/switcher/start", "POST") == "devices"
        assert cap_for("/api/automations/5", "DELETE") == "automations"
        assert cap_for("/api/routines/7/run", "POST") == "scenes"
        assert cap_for("/api/lists/default/items", "POST") == "lists"
        assert cap_for("/api/settings/voice", "PATCH") == "settings"

    def test_a_device_command_is_classified_by_its_entity(self):
        """Turning on a lamp and unlocking the front door hit the same
        endpoint. They must not carry the same power."""
        _, cap_for_control, _ = self._mw()
        assert cap_for_control({"entity_id": "light.kitchen"}) == "lights"
        assert cap_for_control({"entity_id": "lock.front_door"}) == "locks"
        assert cap_for_control({"entity_id": "climate.living"}) == "climate"
        assert cap_for_control({"entity_id": "media_player.tv"}) == "media"
        # Every signal can only RAISE the requirement, never lower it — so an
        # unrecognised entity beside a declared lock domain still reads as a
        # lock, and a declared light domain beside a lock entity still reads as
        # a lock (see test_a_declared_domain_cannot_downgrade_the_check).
        assert cap_for_control({"domain": "lock", "entity_id": "x.y"}) == "locks"
        # Unknown / malformed falls back to the least powerful bucket.
        assert cap_for_control({}) == "lights"
        assert cap_for_control({"entity_id": ["light.a", "light.b"]}) == "lights"

    def test_header_name_is_wall_specific(self):
        _, _, header = self._mw()
        assert header == "X-Ziggy-Wall-Tablet"

    def test_middleware_is_registered(self):
        import backend.server as server
        from backend.middleware.wall_capability import WallCapabilityMiddleware
        assert any(m.cls is WallCapabilityMiddleware for m in server.app.user_middleware)

    def test_a_locked_down_tablet_is_refused_a_door(self, tmp_policy):
        # locks denied by default
        assert asyncio.run(policy.check("tab_wall", "locks")) == (False, "denied")
        # ...and enabling it still demands the PIN
        asyncio.run(policy.set_policy("tab_wall", {
            "capabilities": {**policy.DEFAULT_CAPABILITIES, "locks": True},
            "pin_required": ["locks"],
        }))
        assert asyncio.run(policy.check("tab_wall", "locks")) == (False, "pin_required")
        # ...while the lamp next to it still works.
        assert asyncio.run(policy.check("tab_wall", "lights")) == (True, "ok")


# ---------------------------------------------------------------------------
# Attack regressions
# ---------------------------------------------------------------------------

class TestConfirmedBypassesStayClosed:
    """Each of these reproduces a hole that was real in the first cut of this
    feature and confirmed against a running hub. They exist so the holes cannot
    quietly reopen."""

    def test_identity_comes_from_the_credential_not_a_header(self, tmp_policy):
        """THE original flaw. Enforcement keyed on an `X-Ziggy-Wall-Tablet`
        header, so a tablet escaped every restriction by omitting one line:
        unlock-the-door went 403 -> 200. Identity must come from how you
        authenticated, so dropping it leaves you unauthenticated, not free."""
        from backend.middleware import wall_capability as mw
        import inspect
        src = inspect.getsource(mw.WallCapabilityMiddleware)
        assert "resolve_token" in src, "identity must be resolved from the credential"
        assert "headers.get(HEADER)" not in src, "identity must not come from a header"

    def test_a_tablet_token_resolves_and_a_random_one_does_not(self, tmp_policy):
        token = policy.issue_token("tab_1")
        assert token.startswith("zwt_")
        assert policy.resolve_token(token) == "tab_1"
        assert policy.resolve_token("zwt_not_a_real_token") is None
        assert policy.resolve_token(None) is None
        assert policy.resolve_token("some-users-session-token") is None

    def test_the_token_is_stored_hashed(self, tmp_policy):
        token = policy.issue_token("tab_1")
        on_disk = (tmp_policy / "wall_tablet_policy.json").read_text()
        assert token not in on_disk

    def test_a_tablet_principal_is_never_admin(self, tmp_policy):
        """Defence in depth: even before any capability is consulted, a wall
        panel must not satisfy require_role('admin')."""
        from backend.routers.auth_deps import find_user_by_token, ROLE_ORDER
        token = policy.issue_token("tab_1")
        principal = find_user_by_token(token)
        assert principal["is_wall_tablet"] is True
        assert ROLE_ORDER[principal["role"]] < ROLE_ORDER["admin"]

    def test_existing_sessions_are_unaffected_by_the_new_lookup(self, tmp_policy):
        """The tablet lookup is appended last, so a token that is not a tablet
        credential resolves exactly as it did before."""
        from backend.routers.auth_deps import find_user_by_token
        assert find_user_by_token("") is None
        assert find_user_by_token("definitely-not-a-session") is None

    def test_natural_language_cannot_bypass_the_policy(self, tmp_policy):
        """The second confirmed hole, and the worse one in practice: Ziggy is a
        natural-language product, and POST /api/intent "unlock the front door"
        returned 200 on a tablet whose locks were denied — straight through the
        assistant card sitting on the wall."""
        async def main():
            tok = policy.current_tablet.set("tab_wall")
            try:
                # THE exact payload Ziggy's parser produces for "unlock the
                # front door". Verified against the live parser: the intent is
                # the generic `control_device` and the lock is identified ONLY
                # by params.domain. An earlier mapping guessed from the intent
                # NAME and so let this straight through.
                assert await policy.check_intent(
                    "control_device",
                    {"domain": "lock", "action": "unlock", "room": "front door"},
                ) == (False, "denied")

                # Also refused when the lock is named as an entity instead.
                assert await policy.check_intent(
                    "control_device", {"entity_id": "lock.front_door"}) == (False, "denied")
                assert await policy.check_intent("unlock_door", {}) == (False, "denied")

                # ...while the lamp beside it still works, by either shape.
                assert await policy.check_intent(
                    "toggle_light", {"room": "kitchen", "turn_on": True}) == (True, "ok")
                assert await policy.check_intent(
                    "control_device", {"domain": "light", "room": "kitchen"}) == (True, "ok")
            finally:
                policy.current_tablet.reset(tok)
        asyncio.run(main())

    def test_every_real_intent_that_can_reach_a_lock_is_gated(self, tmp_policy):
        """Guards against the mapping drifting away from the real vocabulary:
        walk the actual handler registry and assert nothing lock- or
        camera-shaped is left unclassified."""
        from core.action_parser import _ALL_HANDLERS
        for name in _ALL_HANDLERS:
            low = name.lower()
            if "lock" in low and "block" not in low:
                assert policy.capability_for_intent(name, {}) == "locks", name
            if "camera" in low:
                assert policy.capability_for_intent(name, {}) == "cameras", name

    def test_domain_alone_is_enough_to_classify(self, tmp_policy):
        for domain, cap in [("lock", "locks"), ("camera", "cameras"),
                            ("climate", "climate"), ("media_player", "media"),
                            ("light", "lights")]:
            assert policy.capability_for_intent("control_device", {"domain": domain}) == cap

    def test_a_lock_cannot_hide_behind_a_lamp_in_a_multi_entity_command(self, tmp_policy):
        """Reading only the first entity let `["light.a", "lock.front_door"]`
        be classified as a light."""
        async def main():
            tok = policy.current_tablet.set("tab_wall")
            try:
                assert await policy.check_intent(
                    "turn_off", {"entity_id": ["light.a", "lock.front_door"]}
                ) == (False, "denied")
            finally:
                policy.current_tablet.reset(tok)
        asyncio.run(main())

    def test_a_declared_domain_cannot_downgrade_the_check(self):
        """`domain` is attacker-controlled. Claiming "light" while targeting a
        lock must not weaken the classification."""
        from backend.middleware.wall_capability import _capability_for_control
        assert _capability_for_control(
            {"domain": "light", "service": "turn_off",
             "data": {"entity_id": "lock.front_door"}}) == "locks"
        assert _capability_for_control(
            {"domain": "homeassistant", "service": "turn_off",
             "data": {"entity_id": "lock.front_door"}}) == "locks"
        # Nested and list forms are both found.
        assert _capability_for_control(
            {"data": {"entity_id": ["light.a", "camera.hall"]}}) == "cameras"

    def test_the_intent_gate_is_inert_without_a_tablet_in_context(self, tmp_policy):
        """Phones, browsers, background threads and hub-local voice must be
        entirely unaffected."""
        async def main():
            assert policy.current_tablet.get() is None
            assert await policy.check_intent("unlock_door", {"entity_id": "lock.x"}) == (True, "ok")
        asyncio.run(main())

    def test_the_dispatcher_gate_is_wired_in(self):
        """The check has to sit in handle_intent itself — that is the one point
        every path (chat, voice, /api/intent, /api/intent/direct) converges on."""
        import inspect
        from core import action_parser
        src = inspect.getsource(action_parser.handle_intent)
        assert "_wall_tablet_may" in src
        # ...and before the multi-intent fan-out, so a bundle cannot smuggle a
        # locked action through beside a permitted one.
        assert src.index("_wall_tablet_may") < src.index("__multi__")


def test_wall_routes_are_registered():
    """dashboard_router.py exists in the tree but was never registered in
    server.py, which is why /api/dashboard/* 404s. Guard against the wall
    router silently suffering the same fate."""
    import backend.server as server
    paths = {r.path for r in server.app.routes if hasattr(r, "path")}
    for expected in ("/api/wall/layout", "/api/wall/policy", "/api/wall/pin/verify",
                     "/api/lists", "/api/agenda", "/api/wall/tablets/claim"):
        assert expected in paths, f"{expected} is not registered"
