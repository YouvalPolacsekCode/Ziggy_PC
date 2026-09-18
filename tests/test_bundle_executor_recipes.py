"""bundle_executor: recipes phase + the preview handler counting only what is buildable."""
import asyncio

import pytest

from services import bundle_executor as BE
from services import local_automation_actions as laa


def _registry():
    from services import recipes
    return recipes.REGISTRY


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    monkeypatch.setattr(laa, "STATE_FILE", str(tmp_path / "s.json"))
    monkeypatch.setattr("services.home_context.load_home_context", lambda lang="en": {"rooms": []})


def test_recipe_artifacts_are_built_and_saved(monkeypatch):
    saved = []

    def fake_save(data, auto_id=None):
        saved.append((auto_id, data["name"], data.get("recipe")))
        return {"ok": True, "id": auto_id or "x"}

    monkeypatch.setattr(BE, "save_automation", fake_save)
    monkeypatch.setitem(_registry(), "motion_light", lambda params, *, home, language: {"ok": True, "automations": [
        {"name": "Kitchen motion light", "alias": "Ziggy Motion Light Kitchen",
         "trigger": {"type": "state"}, "actions": [{"type": "notify", "message": "m"}],
         "conditions": [], "mode": "restart"}]})
    res = BE.execute_bundle({"bundle_id": "b1", "language": "en",
                             "artifacts": {"recipes": [{"recipe": "motion_light", "room": "kitchen"}]}})
    assert res["ok"], res
    assert saved == [("ziggy_motion_light_kitchen", "Ziggy Motion Light Kitchen", "motion_light")]
    assert res["created"][0]["from"] == "recipe:motion_light"
    assert res["created"][0]["id"] == "ziggy_motion_light_kitchen"


def test_recipe_fixed_auto_id_wins(monkeypatch):
    saved = []
    monkeypatch.setattr(BE, "save_automation", lambda data, auto_id=None: saved.append(auto_id) or {"ok": True, "id": auto_id})
    monkeypatch.setitem(_registry(), "leave_home", lambda params, *, home, language: {"ok": True, "automations": [
        {"name": "Leave Home", "alias": "Leave Home", "auto_id": "ziggy_leave_home",
         "trigger": {"type": "all_persons_left"}, "actions": [{"type": "turn_off_all_lights"}]}]})
    BE.execute_bundle({"bundle_id": "b", "artifacts": {"recipes": [{"recipe": "leave_home"}]}})
    assert saved == ["ziggy_leave_home"]


def test_recipe_error_is_one_row_and_others_apply(monkeypatch):
    monkeypatch.setattr(BE, "save_automation", lambda data, auto_id=None: {"ok": True, "id": "c"})
    monkeypatch.setitem(_registry(), "welcome_home", lambda params, *, home, language: {"ok": False, "error": "no_lights"})
    res = BE.execute_bundle({"bundle_id": "b2", "artifacts": {
        "recipes": [{"recipe": "welcome_home"}, {"recipe": "nope"}],
        "automations": [{"name": "c", "source": "custom", "trigger": {"type": "time", "time": "07:00"},
                         "actions": [{"type": "notify", "message": "x"}]}]}})
    assert not res["ok"]
    assert [e["kind"] for e in res["errors"]] == ["recipe", "recipe"]
    assert len(res["created"]) == 1 and res["created"][0]["from"] == "custom"


def test_manifest_records_recipe_automations(monkeypatch):
    monkeypatch.setattr(BE, "save_automation", lambda data, auto_id=None: {"ok": True, "id": auto_id})
    monkeypatch.setitem(_registry(), "motion_light", lambda params, *, home, language: {"ok": True, "automations": [
        {"name": "n", "alias": "Ziggy Motion Light Kitchen", "trigger": {"type": "state"}, "actions": [{"type": "delay", "seconds": 1}]}]})
    BE.execute_bundle({"bundle_id": "b3", "artifacts": {"recipes": [{"recipe": "motion_light", "room": "kitchen"}]}})
    b = [x for x in BE.list_bundles() if x["bundle_id"] == "b3"][0]
    assert b["counts"] == {"automation": 1}


def test_preview_summary_counts_only_buildable(monkeypatch):
    from core.handlers import automation_handler as AH
    monkeypatch.setattr("services.orchestra_designer.design_bundle", lambda outcome, language=None: {"ok": True, "bundle": {
        "bundle_id": "b", "name": "N", "rationale": "R", "language": "en", "decline": None,
        "artifacts": {"recipes": [{"recipe": "smart_room", "room": "kitchen"}], "automations": []},
        "left_out": [{"what": "the button", "why": "no wireless switch is paired"}]}})
    res = asyncio.run(AH.handle_design_automation_set({"outcome": "make the kitchen smart"}))
    assert "1 recipe" in res["message"] and "voice" not in res["message"]
    assert "Left out: the button — no wireless switch is paired." in res["message"]
    assert res["data"]["kind"] == "automation_bundle_preview"


def test_preview_with_nothing_buildable_is_text_with_reasons(monkeypatch):
    from core.handlers import automation_handler as AH
    monkeypatch.setattr("services.orchestra_designer.design_bundle", lambda outcome, language=None: {"ok": True, "bundle": {
        "bundle_id": "b", "name": "N", "rationale": "R", "language": "en",
        "decline": "I can't set this up yet.",
        "artifacts": {"recipes": [], "automations": []},
        "left_out": [{"what": "arrival", "why": "no phone is tracked"}]}})
    res = asyncio.run(AH.handle_design_automation_set({"outcome": "x"}))
    assert res["ok"] and "data" not in res or not (res.get("data") or {}).get("bundle")
    assert "I can't set this up yet." in res["message"] and "no phone is tracked" in res["message"]
