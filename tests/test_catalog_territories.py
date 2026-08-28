import json
import os

import pytest

from scripts.catalog import build_territories as bt
from scripts.catalog import schema

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG_PATH = os.path.join(REPO, "catalog.config.json")


@pytest.fixture(scope="module")
def cfg():
    return bt.load_config(CFG_PATH)


def test_worktrees_are_excluded(cfg):
    assert bt.is_excluded(".claude/worktrees/home-fixer/services/presence_engine.py", cfg)
    assert bt.is_excluded(".claude/worktrees/agent-a71c43cb4253805ae/frontend/src/App.jsx", cfg)
    assert not bt.is_excluded("services/presence_engine.py", cfg)


def test_node_modules_and_build_output_excluded(cfg):
    assert bt.is_excluded("frontend/node_modules/react/index.js", cfg)
    assert bt.is_excluded("frontend/dist/assets/index.js", cfg)
    assert bt.is_excluded("graphify-out/graph.json", cfg)


def test_all_territories_declared(cfg):
    assert len(cfg["territories"]) == 18


def test_every_territory_has_required_fields(cfg):
    for name, t in cfg["territories"].items():
        assert t["include"], f"{name} has no include globs"
        assert t["description"], f"{name} has no description"


def test_known_files_land_in_expected_territory(cfg):
    assert bt.assign_territory("services/presence_engine.py", cfg) == "presence"
    assert bt.assign_territory(
        "frontend/src/components/automations/bundles/recipes/precool.jsx", cfg
    ) == "automations-and-bundles"
    assert bt.assign_territory("services/mobile_push.py", cfg) == "mobile-and-push"
    assert bt.assign_territory("relay/app/fleet_health.py", cfg) == "cloud-and-billing"
    assert bt.assign_territory("scripts/fleet-health.py", cfg) == "fleet-and-release"
    assert bt.assign_territory("backend/routers/media_router.py", cfg) == "media-and-entertainment"
    assert bt.assign_territory("backend/routers/task_router.py", cfg) == "tasks-events-weather"


def test_excluded_files_have_no_territory(cfg):
    assert bt.assign_territory(".claude/worktrees/home-fixer/services/presence_engine.py", cfg) is None


def test_file_communities_maps_source_files_to_community_names():
    graph = os.path.join(REPO, "graphify-out", "graph.json")
    mapping = bt.file_communities(graph)
    assert mapping["services/presence_engine.py"]
    assert isinstance(mapping["services/presence_engine.py"], str)


def test_build_assigns_files_and_reports_unassigned(cfg):
    graph = os.path.join(REPO, "graphify-out", "graph.json")
    roots = {"ziggy_pc": REPO}
    result = bt.build(cfg, graph, roots)
    assert set(result["territories"]) == set(cfg["territories"])
    presence = result["territories"]["presence"]
    assert "services/presence_engine.py" in presence["files"]
    assert presence["communities"], "presence territory should map to graphify communities"
    # Nothing excluded may leak into a territory.
    for t in result["territories"].values():
        for f in t["files"]:
            assert ".claude/worktrees/" not in f


def test_status_and_kind_vocabularies_are_closed():
    assert schema.STATUSES == ("live-prod", "canary-only", "flagged", "orphaned", "abandoned")
    assert schema.MECHANISM_KINDS == (
        "trigger", "condition", "action", "alert-channel", "engine", "store", "bridge",
    )


def test_capability_schema_requires_status_evidence():
    required = schema.CAPABILITY_SCHEMA["required"]
    for field in ("id", "name", "pitch", "what_it_does", "layer", "audience",
                  "status", "status_evidence", "uses", "surfaces"):
        assert field in required


def test_mechanism_schema_requires_kind_and_domain_concept_flag():
    required = schema.MECHANISM_SCHEMA["required"]
    for field in ("id", "name", "kind", "what_it_is", "surfaces", "domain_concept"):
        assert field in required


def test_single_star_does_not_cross_path_separators(cfg):
    # The landmine: a nested file must NOT be claimed by a single-segment glob.
    assert not bt._matches_any("services/bundled_blueprints/light_scene.py", ["services/*light*.py"])
    assert not bt._matches_any("services/permissions/climate_x.py", ["services/*climate*.py"])
    assert bt._matches_any("services/smart_light_schedule.py", ["services/*light*.py"])


def test_double_star_still_spans_path_separators(cfg):
    assert bt._matches_any(".claude/worktrees/home-fixer/services/presence_engine.py", [".claude/worktrees/**"])
    assert bt._matches_any("frontend/node_modules/react/index.js", ["**/node_modules/**"])
    assert bt._matches_any("graphify-out/wiki/Presence_Engine.md", ["graphify-out/**"])


def test_leading_double_star_matches_at_any_depth_including_root(cfg):
    assert bt._matches_any("a.png", ["**/*.png"])
    assert bt._matches_any("frontend/src/assets/device-icons/lamp.png", ["**/*.png"])


def test_bare_double_star_slash_star_matches_everything(cfg):
    # mobile-native declares exactly ["**/*"] and must keep claiming its whole repo.
    assert bt._matches_any("package.json", ["**/*"])
    assert bt._matches_any("android/app/src/main/AndroidManifest.xml", ["**/*"])


def test_dot_is_escaped_not_a_wildcard(cfg):
    assert not bt._matches_any("frontend/src/mainXjsx", ["frontend/src/main.jsx"])
