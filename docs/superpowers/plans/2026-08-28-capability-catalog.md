# Ziggy Capability Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a two-tier, evidence-backed catalog of everything Ziggy can do — capabilities and the reusable mechanisms they share — as a git-tracked JSON file, a readable Markdown file, and a browsable three-lens web viewer.

**Architecture:** A deterministic Python pipeline brackets a two-stage agent swarm. Python computes territories from `graphify-out/graph.json` (Phase A), 72 workflow subagents extract and verify capability records into per-territory JSON files (Phases B–G), then Python merges, validates, derives composition edges, and renders both the Markdown and the self-contained viewer. Everything Ziggy-specific lives in one `catalog.config.json` so the pipeline can later be extracted as a general plugin.

**Tech Stack:** Python 3.11 + pytest (deterministic pipeline), Workflow tool with plain-JS scripts (swarm), vanilla self-contained HTML/CSS/JS (viewer), Artifact tool (publishing).

**Spec:** `docs/superpowers/specs/2026-08-28-capability-catalog-design.md`

## Global Constraints

- **Never modify Ziggy runtime code.** This plan creates only `catalog.config.json`, files under `scripts/catalog/`, files under `docs/`, and tests under `tests/`. No file in `backend/`, `core/`, `services/`, `frontend/src/`, `relay/`, or `integrations/` is edited.
- **`.claude/worktrees/**` is excluded from every glob, every agent prompt, and every traversal.** These are stale duplicate trees; including them double-counts capabilities and reports abandoned code as shipped.
- **No live fleet probe.** No SSH, no relay calls, no `scripts/fleet-health.py`. Liveness is proven statically only.
- **Repo scope is exactly two roots:** `/Users/YouvalPolacsek/ziggy_pc` and `/Users/YouvalPolacsek/ziggy_mobile`.
- **Workflow scripts are plain JavaScript, not TypeScript.** No type annotations, no interfaces. `Date.now()`, `Math.random()`, and argless `new Date()` throw inside workflow scripts.
- **Workflow subagents write their own output files** and return only a small summary object. Never return bulk catalog data through the workflow return value.
- **Scratchpad for all intermediates:** `/private/tmp/claude-501/-Users-YouvalPolacsek-ziggy-pc/d1721fa0-00ed-4847-90a8-dd1e491b20cc/scratchpad`. Referred to below as `$SCRATCH`.
- **The viewer must be self-contained.** A strict CSP blocks every external host — no CDN scripts, no external stylesheets, no remote fonts or images.
- **Status vocabulary is exactly:** `live-prod`, `canary-only`, `flagged`, `orphaned`, `abandoned`. No other value is valid.
- **Mechanism kinds are exactly:** `trigger`, `condition`, `action`, `alert-channel`, `engine`, `store`, `bridge`.
- **Mechanism stopping rule:** a mechanism is kept only if it has 2+ consuming capabilities, OR `domain_concept` is `true`.
- **Run tests with:** `python3 -m pytest tests/test_catalog_*.py -v` from the repo root.

---

### Task 1: Config, schema, and territory builder

Establishes the extraction seam and the deterministic Phase A partition. Everything downstream reads these.

**Files:**
- Create: `catalog.config.json`
- Create: `scripts/catalog/__init__.py`
- Create: `scripts/catalog/schema.py`
- Create: `scripts/catalog/build_territories.py`
- Test: `tests/test_catalog_territories.py`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `scripts.catalog.schema.CAPABILITY_SCHEMA: dict` — JSON Schema for one capability record
  - `scripts.catalog.schema.MECHANISM_SCHEMA: dict` — JSON Schema for one mechanism record
  - `scripts.catalog.schema.STATUSES: tuple[str, ...]`
  - `scripts.catalog.schema.MECHANISM_KINDS: tuple[str, ...]`
  - `scripts.catalog.build_territories.load_config(path: str) -> dict`
  - `scripts.catalog.build_territories.is_excluded(rel_path: str, cfg: dict) -> bool`
  - `scripts.catalog.build_territories.assign_territory(rel_path: str, cfg: dict) -> str | None`
  - `scripts.catalog.build_territories.file_communities(graph_path: str) -> dict[str, str]` — maps `source_file` → `community_name`
  - `scripts.catalog.build_territories.build(cfg: dict, graph_path: str, roots: dict[str, str]) -> dict` — returns `{"territories": {name: {"files": [...], "communities": [...], "roots": [...]}}, "unassigned": [...]}`

- [ ] **Step 1: Write the failing test**

Create `tests/test_catalog_territories.py`:

```python
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


def test_sixteen_territories_declared(cfg):
    assert len(cfg["territories"]) == 16


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
    assert bt.assign_territory("relay/app/fleet_health.py", cfg) == "fleet-and-release"


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_catalog_territories.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.catalog'`

- [ ] **Step 3: Create the config**

Create `catalog.config.json`. This is the extraction seam — the only file carrying Ziggy-specific knowledge.

```json
{
  "project": "Ziggy",
  "roots": {
    "ziggy_pc": "/Users/YouvalPolacsek/ziggy_pc",
    "ziggy_mobile": "/Users/YouvalPolacsek/ziggy_mobile"
  },
  "graph": "graphify-out/graph.json",
  "exclude": [
    ".claude/worktrees/**",
    "**/node_modules/**",
    "**/__pycache__/**",
    "frontend/dist/**",
    "graphify-out/**",
    "logs/**",
    "cache/**",
    "piper_voices/**",
    "oww_data/**",
    "**/*.png",
    "**/*.mp3",
    "**/*.lock",
    "**/package-lock.json"
  ],
  "prod_entrypoints": [
    "backend/server.py",
    "services/ziggy_scheduler.py"
  ],
  "dead_entrypoints": [
    "core/ziggy_main.py"
  ],
  "status_rules": {
    "live-prod": "Reachable from a prod entrypoint (backend/server.py or a ziggy_scheduler tick) and present in the newest release-* tag.",
    "canary-only": "On main and running on the canary cohort, but not yet in a release-* tag.",
    "flagged": "Present and wired, but gated behind a settings.yaml feature flag that is off by default.",
    "orphaned": "Code exists with no caller reachable from any prod entrypoint.",
    "abandoned": "Removed from the tree, or superseded, but present in git history."
  },
  "lenses": ["pitch", "capability", "engineering"],
  "territories": {
    "chat-and-assistant": {
      "description": "Chat, voice, intent parsing, the v2 tool-calling agent, wake word, STT/TTS.",
      "include": ["core/agent/**", "core/intent_parser.py", "core/action_parser.py", "core/handlers/**", "interfaces/**", "backend/routers/intent_router.py", "services/command_router.py", "frontend/src/pages/Chat*.jsx"],
      "root": "ziggy_pc"
    },
    "automations-and-bundles": {
      "description": "Automations, routines, bundle wizards and recipes, the Library, Pro designer, HA automation sync.",
      "include": ["services/automation_*.py", "services/bundle*.py", "services/local_automation_actions.py", "services/routine*.py", "frontend/src/components/automations/**", "frontend/src/lib/automations/**", "frontend/src/pages/Actions.jsx", "backend/routers/automation_router.py", "backend/routers/routine_router.py"],
      "root": "ziggy_pc"
    },
    "presence": {
      "description": "Presence engine, persons, zones and geofences, LAN probing, door-aware presence, room presence.",
      "include": ["services/presence_*.py", "services/lan_presence.py", "services/room_presence_engine.py", "backend/routers/presence_router.py", "frontend/src/lib/mobilePresenceBridge.jsx"],
      "root": "ziggy_pc"
    },
    "devices-and-pairing": {
      "description": "Device registry, classification, capability catalog, Zigbee/Matter/WiFi pairing, config flows, delete semantics.",
      "include": ["services/device_*.py", "services/capability_catalog.py", "services/entity_filter.py", "services/target_resolver.py", "services/display_registry.py", "backend/routers/device_router.py", "frontend/src/components/devices/**", "frontend/src/pages/Devices.jsx"],
      "root": "ziggy_pc"
    },
    "ir-and-ac": {
      "description": "IR blasters, protocol decoding, fingerprint matching, IR device registry, IR/WiFi merge.",
      "include": ["services/ir_*.py", "backend/routers/ir_router.py", "frontend/src/components/ir/**"],
      "root": "ziggy_pc"
    },
    "climate-and-lighting": {
      "description": "Smart climate control, circadian light schedule, presets, power-on behaviour.",
      "include": ["services/*climate*.py", "services/*light*.py", "services/*circadian*.py", "services/*preset*.py"],
      "root": "ziggy_pc"
    },
    "rooms-and-dashboard": {
      "description": "Rooms, room ownership, dashboard layouts, the wall display, device groups, quick controls.",
      "include": ["services/dashboard_layouts.py", "services/device_groups.py", "services/room*.py", "backend/routers/room_router.py", "backend/routers/map_router.py", "frontend/src/pages/Dashboard.jsx", "frontend/src/pages/Rooms.jsx", "frontend/src/components/wall/**"],
      "root": "ziggy_pc"
    },
    "mobile-and-push": {
      "description": "Mobile router, push notification substrate, FCM, push actions and preferences, geofencing bridge.",
      "include": ["services/mobile_*.py", "services/push_*.py", "backend/routers/mobile_router.py", "frontend/src/pages/Mobile*.jsx"],
      "root": "ziggy_pc"
    },
    "mobile-native": {
      "description": "The Capacitor app shell, native ziggy-presence plugin, OTA updater, native permissions.",
      "include": ["**/*"],
      "root": "ziggy_mobile"
    },
    "cloud-and-billing": {
      "description": "Fly relay, LLM proxy, per-home HMAC, provisioning, tunnels, billing.",
      "include": ["relay/**", "integrations/llm_gateway.py", "services/telemetry_client.py"],
      "root": "ziggy_pc"
    },
    "fleet-and-release": {
      "description": "Release channel, ship.sh, updater, cohorts, fleet health, drift detection, imaging.",
      "include": ["scripts/**", "services/deploy_state.py", "services/ha_health.py", "services/ha_outage_alert.py", "backend/routers/admin_router.py"],
      "root": "ziggy_pc"
    },
    "auth-and-onboarding": {
      "description": "Auth, permissions platform, onboarding wizards, phone pairing, web onboarding.",
      "include": ["services/permissions/**", "backend/routers/auth*.py", "backend/middleware/**", "frontend/src/pages/*Onboarding*.jsx", "frontend/src/stores/authStore.js"],
      "root": "ziggy_pc"
    },
    "alerts-and-vision": {
      "description": "Anomaly engine, sensor alerts, vision and camera alerts, suggestions, pattern learning.",
      "include": ["services/anomaly_*.py", "services/sensor_alerts.py", "services/vision*.py", "services/suggestion_engine.py", "services/pattern_detector.py", "backend/routers/camera_router.py", "frontend/src/pages/Cameras.jsx"],
      "root": "ziggy_pc"
    },
    "backup-and-dr": {
      "description": "Backup engine, restore, disaster recovery, customer state protection.",
      "include": ["services/backup_*.py", "backend/routers/backup_router.py"],
      "root": "ziggy_pc"
    },
    "i18n-and-hebrew": {
      "description": "Hebrew nativization, RTL, i18n vocabulary, voice style, brand language.",
      "include": ["frontend/src/lib/i18n/**", "**/*hebrew*", "validate_hebrew_intent.py"],
      "root": "ziggy_pc"
    },
    "platform": {
      "description": "HA bridge and WebSocket sync, MQTT, WS broadcast hub, settings loader, server bootstrap, scheduler.",
      "include": ["services/home_automation.py", "services/ha_*.py", "services/ziggy_scheduler.py", "core/settings_loader.py", "core/debug_bus.py", "core/shared_flags.py", "backend/server.py", "backend/ws_manager.py"],
      "root": "ziggy_pc"
    }
  }
}
```

- [ ] **Step 4: Write the schema module**

Create `scripts/catalog/__init__.py` (empty file), then `scripts/catalog/schema.py`:

```python
"""JSON Schemas for capability and mechanism records.

Every swarm agent is handed these verbatim so all 72 emit the same shape.
"""

STATUSES = ("live-prod", "canary-only", "flagged", "orphaned", "abandoned")

MECHANISM_KINDS = (
    "trigger", "condition", "action", "alert-channel", "engine", "store", "bridge",
)

AUDIENCES = ("user-facing", "operator", "internal")

CAPABILITY_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "id", "name", "pitch", "what_it_does", "layer", "audience",
        "status", "status_evidence", "uses", "surfaces",
    ],
    "properties": {
        "id": {"type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$"},
        "name": {"type": "string", "minLength": 2},
        "pitch": {"type": "string", "minLength": 8,
                  "description": "One benefit line in the user's language. No jargon, no entity ids."},
        "what_it_does": {"type": "string", "minLength": 30,
                         "description": "2-4 plain sentences."},
        "layer": {"type": "string"},
        "audience": {"type": "string", "enum": list(AUDIENCES)},
        "status": {"type": "string", "enum": list(STATUSES)},
        "status_evidence": {
            "type": "string", "minLength": 20,
            "description": "Must cite a concrete file path, flag name, or commit. Not a claim.",
        },
        "uses": {"type": "array", "items": {"type": "string"}},
        "surfaces": {"type": "array", "items": {"type": "string"}, "minItems": 1},
        "entry_points": {"type": "array", "items": {"type": "string"}},
        "tests": {"type": "array", "items": {"type": "string"}},
        "first_shipped": {"type": "string"},
        "commit": {"type": "string"},
        "known_gaps": {"type": "array", "items": {"type": "string"}},
        "territory": {"type": "string"},
        "angle": {"type": "string", "enum": ["code", "history", "reconciled"]},
        "disagreement": {"type": "string"},
    },
}

MECHANISM_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["id", "name", "kind", "what_it_is", "surfaces", "domain_concept"],
    "properties": {
        "id": {"type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$"},
        "name": {"type": "string", "minLength": 2},
        "kind": {"type": "string", "enum": list(MECHANISM_KINDS)},
        "what_it_is": {"type": "string", "minLength": 20},
        "surfaces": {"type": "array", "items": {"type": "string"}, "minItems": 1},
        "domain_concept": {
            "type": "boolean",
            "description": "True if this owns its own store/engine and survives the 2+ consumer rule alone.",
        },
        "health": {"type": "string",
                   "description": "Known fragility, e.g. 'lan_host is IP-pinned and drifts with DHCP'."},
        "territory": {"type": "string"},
    },
}
```

- [ ] **Step 5: Write the territory builder**

Create `scripts/catalog/build_territories.py`:

```python
"""Phase A: deterministic partition of the corpus into product territories."""

import fnmatch
import json
import os


def load_config(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _matches_any(rel_path, patterns):
    for pat in patterns:
        if fnmatch.fnmatch(rel_path, pat):
            return True
        # fnmatch does not treat "**" as spanning separators; emulate it.
        if "**/" in pat and fnmatch.fnmatch(rel_path, pat.replace("**/", "")):
            return True
        if pat.endswith("/**") and rel_path.startswith(pat[:-3] + "/"):
            return True
        if "/**/" in pat:
            head, tail = pat.split("/**/", 1)
            if rel_path.startswith(head + "/") and fnmatch.fnmatch(rel_path, "*" + tail):
                return True
    return False


def is_excluded(rel_path, cfg):
    return _matches_any(rel_path, cfg["exclude"])


def assign_territory(rel_path, cfg, root="ziggy_pc"):
    """First matching territory wins. Order in the config is significant."""
    if is_excluded(rel_path, cfg):
        return None
    for name, t in cfg["territories"].items():
        if t.get("root", "ziggy_pc") != root:
            continue
        if _matches_any(rel_path, t["include"]):
            return name
    return None


def file_communities(graph_path):
    """Map source_file -> community_name using graphify's node list."""
    with open(graph_path, "r", encoding="utf-8") as fh:
        graph = json.load(fh)
    mapping = {}
    for node in graph.get("nodes", []):
        src = node.get("source_file")
        cname = node.get("community_name")
        if src and cname and src not in mapping:
            mapping[src] = cname
    return mapping


def _iter_tracked(root):
    import subprocess
    out = subprocess.run(
        ["git", "ls-files"], cwd=root, capture_output=True, text=True, check=True
    )
    return [line for line in out.stdout.splitlines() if line]


def build(cfg, graph_path, roots):
    communities = file_communities(graph_path)
    territories = {
        name: {"files": [], "communities": [], "roots": [], "description": t["description"]}
        for name, t in cfg["territories"].items()
    }
    unassigned = []

    for root_key, root_path in roots.items():
        if not os.path.isdir(root_path):
            continue
        for rel in _iter_tracked(root_path):
            if is_excluded(rel, cfg):
                continue
            name = assign_territory(rel, cfg, root=root_key)
            if name is None:
                unassigned.append({"root": root_key, "path": rel})
                continue
            entry = territories[name]
            entry["files"].append(rel)
            if root_key not in entry["roots"]:
                entry["roots"].append(root_key)
            cname = communities.get(rel)
            if cname and cname not in entry["communities"]:
                entry["communities"].append(cname)

    return {"territories": territories, "unassigned": unassigned}


if __name__ == "__main__":
    import sys

    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    cfg = load_config(os.path.join(repo, "catalog.config.json"))
    result = build(cfg, os.path.join(repo, cfg["graph"]), cfg["roots"])
    out = sys.argv[1] if len(sys.argv) > 1 else "territories.json"
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2)
    total = sum(len(t["files"]) for t in result["territories"].values())
    print(f"assigned {total} files across {len(result['territories'])} territories")
    print(f"unassigned: {len(result['unassigned'])}")
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_catalog_territories.py -v`
Expected: PASS, 11 tests.

If `test_known_files_land_in_expected_territory` fails, the territory `include` globs need adjusting in `catalog.config.json` — fix the config, not the test.

- [ ] **Step 7: Generate the territory map and eyeball coverage**

Run:
```bash
python3 scripts/catalog/build_territories.py "$SCRATCH/territories.json"
python3 -c "
import json,collections
d=json.load(open('$SCRATCH/territories.json'))
for n,t in sorted(d['territories'].items(), key=lambda kv: -len(kv[1]['files'])):
    print(f\"{len(t['files']):5d}  {n}  ({len(t['communities'])} communities)\")
print('UNASSIGNED', len(d['unassigned']))
print(collections.Counter(u['path'].split('/')[0] for u in d['unassigned']).most_common(15))
"
```

Expected: every territory has a non-zero file count; unassigned is dominated by root-level scratch files, docs, and test fixtures. If a whole subsystem is unassigned, add it to a territory's `include` before proceeding.

- [ ] **Step 8: Commit**

```bash
git add catalog.config.json scripts/catalog/__init__.py scripts/catalog/schema.py scripts/catalog/build_territories.py tests/test_catalog_territories.py
git commit -m "feat(catalog): territory partition, record schemas, and extraction seam"
```

---

### Task 2: Merge, validation, and derivation engine

Turns 64 raw per-territory agent outputs into one validated catalog with derived composition edges. This is where the mechanism stopping rule and the `used_by` index are enforced.

**Files:**
- Create: `scripts/catalog/merge_catalog.py`
- Test: `tests/test_catalog_merge.py`

**Interfaces:**
- Consumes: `scripts.catalog.schema.CAPABILITY_SCHEMA`, `MECHANISM_SCHEMA`, `STATUSES`, `MECHANISM_KINDS` from Task 1.
- Produces:
  - `scripts.catalog.merge_catalog.validate_record(rec: dict, schema: dict) -> list[str]` — returns error strings, empty if valid
  - `scripts.catalog.merge_catalog.dedupe(records: list[dict]) -> list[dict]` — merges by `id`, unioning list fields
  - `scripts.catalog.merge_catalog.apply_stopping_rule(mechs: list[dict], caps: list[dict]) -> tuple[list[dict], list[dict]]` — returns `(kept, dropped)`
  - `scripts.catalog.merge_catalog.build_used_by(mechs: list[dict], caps: list[dict]) -> list[dict]`
  - `scripts.catalog.merge_catalog.derive_composition(caps: list[dict]) -> list[dict]`
  - `scripts.catalog.merge_catalog.merge(cap_records, mech_records) -> dict` — full catalog dict

- [ ] **Step 1: Write the failing test**

Create `tests/test_catalog_merge.py`:

```python
import pytest

from scripts.catalog import merge_catalog as mc
from scripts.catalog import schema


def cap(cid, uses=(), **kw):
    base = {
        "id": cid,
        "name": cid.replace("-", " ").title(),
        "pitch": "Does a useful thing for you.",
        "what_it_does": "It does a useful thing. It does it reliably. You do not configure it.",
        "layer": "presence",
        "audience": "user-facing",
        "status": "live-prod",
        "status_evidence": "wired at backend/server.py:_startup line 210",
        "uses": list(uses),
        "surfaces": [f"services/{cid}.py"],
    }
    base.update(kw)
    return base


def mech(mid, kind="engine", domain_concept=False, **kw):
    base = {
        "id": mid,
        "name": mid.replace("-", " ").title(),
        "kind": kind,
        "what_it_is": "A reusable building block used by capabilities.",
        "surfaces": [f"services/{mid}.py"],
        "domain_concept": domain_concept,
    }
    base.update(kw)
    return base


def test_validate_accepts_a_good_capability():
    assert mc.validate_record(cap("precool"), schema.CAPABILITY_SCHEMA) == []


def test_validate_rejects_missing_status_evidence():
    bad = cap("precool")
    del bad["status_evidence"]
    errors = mc.validate_record(bad, schema.CAPABILITY_SCHEMA)
    assert any("status_evidence" in e for e in errors)


def test_validate_rejects_unknown_status():
    bad = cap("precool", status="shipped")
    errors = mc.validate_record(bad, schema.CAPABILITY_SCHEMA)
    assert any("status" in e for e in errors)


def test_validate_rejects_unknown_mechanism_kind():
    bad = mech("zones", kind="widget")
    errors = mc.validate_record(bad, schema.MECHANISM_SCHEMA)
    assert any("kind" in e for e in errors)


def test_dedupe_merges_same_id_and_unions_lists():
    a = cap("precool", uses=["zones"], surfaces=["a.py"])
    b = cap("precool", uses=["all-away"], surfaces=["b.py"], tests=["tests/t.py"])
    out = mc.dedupe([a, b])
    assert len(out) == 1
    assert sorted(out[0]["uses"]) == ["all-away", "zones"]
    assert sorted(out[0]["surfaces"]) == ["a.py", "b.py"]
    assert out[0]["tests"] == ["tests/t.py"]


def test_dedupe_prefers_reconciled_angle_for_scalar_fields():
    a = cap("precool", angle="code", pitch="Code angle pitch line.")
    b = cap("precool", angle="reconciled", pitch="Reconciled pitch line.")
    out = mc.dedupe([a, b])
    assert out[0]["pitch"] == "Reconciled pitch line."


def test_stopping_rule_drops_single_consumer_mechanism():
    caps = [cap("precool", uses=["zones", "lonely"])]
    mechs = [mech("zones"), mech("lonely")]
    kept, dropped = mc.apply_stopping_rule(mechs, caps)
    assert {m["id"] for m in dropped} == {"zones", "lonely"}
    assert kept == []


def test_stopping_rule_keeps_two_consumer_mechanism():
    caps = [cap("precool", uses=["zones"]), cap("leave-home", uses=["zones"])]
    kept, dropped = mc.apply_stopping_rule([mech("zones")], caps)
    assert [m["id"] for m in kept] == ["zones"]
    assert dropped == []


def test_stopping_rule_keeps_single_consumer_domain_concept():
    caps = [cap("precool", uses=["presence-engine"])]
    kept, _ = mc.apply_stopping_rule([mech("presence-engine", domain_concept=True)], caps)
    assert [m["id"] for m in kept] == ["presence-engine"]


def test_build_used_by_is_the_reverse_index():
    caps = [cap("precool", uses=["zones"]), cap("leave-home", uses=["zones"])]
    mechs = mc.build_used_by([mech("zones")], caps)
    assert sorted(mechs[0]["used_by"]) == ["leave-home", "precool"]


def test_derive_composition_links_capabilities_sharing_a_mechanism():
    caps = [
        cap("precool", uses=["zones", "bundle-engine"]),
        cap("leave-home", uses=["zones"]),
        cap("backup", uses=["storage"]),
    ]
    out = {c["id"]: c for c in mc.derive_composition(caps)}
    assert out["precool"]["composes_with"] == [{"id": "leave-home", "via": ["zones"]}]
    assert out["leave-home"]["composes_with"] == [{"id": "precool", "via": ["zones"]}]
    assert out["backup"]["composes_with"] == []


def test_derive_composition_has_no_self_edges():
    caps = [cap("precool", uses=["zones"]), cap("leave-home", uses=["zones"])]
    for c in mc.derive_composition(caps):
        assert all(link["id"] != c["id"] for link in c["composes_with"])


def test_merge_produces_catalog_with_both_tiers_and_counts():
    caps = [cap("precool", uses=["zones"]), cap("leave-home", uses=["zones"])]
    mechs = [mech("zones", kind="store")]
    catalog = mc.merge(caps, mechs)
    assert catalog["counts"]["capabilities"] == 2
    assert catalog["counts"]["mechanisms"] == 1
    assert catalog["mechanisms"][0]["used_by"]
    assert catalog["capabilities"][0]["composes_with"]


def test_merge_records_dangling_uses_references():
    caps = [cap("precool", uses=["ghost"])]
    catalog = mc.merge(caps, [])
    assert "ghost" in catalog["warnings"]["dangling_mechanism_refs"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_catalog_merge.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.catalog.merge_catalog'`

- [ ] **Step 3: Write the merge engine**

Create `scripts/catalog/merge_catalog.py`:

```python
"""Phase E support: validate, dedupe, apply the stopping rule, derive edges."""

import re

from scripts.catalog import schema

LIST_FIELDS = ("uses", "surfaces", "entry_points", "tests", "known_gaps")
ANGLE_RANK = {"code": 0, "history": 0, "reconciled": 1}


def validate_record(rec, sch):
    errors = []
    for field in sch["required"]:
        if field not in rec or rec[field] in (None, "", []):
            errors.append(f"missing required field: {field}")
    for key, value in rec.items():
        prop = sch["properties"].get(key)
        if prop is None:
            errors.append(f"unknown field: {key}")
            continue
        if "enum" in prop and value not in prop["enum"]:
            errors.append(f"{key}: {value!r} not one of {prop['enum']}")
        if prop.get("type") == "string" and isinstance(value, str):
            if len(value) < prop.get("minLength", 0):
                errors.append(f"{key}: too short (min {prop['minLength']})")
            pattern = prop.get("pattern")
            if pattern and not re.match(pattern, value):
                errors.append(f"{key}: {value!r} does not match {pattern}")
        if prop.get("type") == "array" and isinstance(value, list):
            if len(value) < prop.get("minItems", 0):
                errors.append(f"{key}: needs at least {prop['minItems']} item(s)")
        if prop.get("type") == "boolean" and not isinstance(value, bool):
            errors.append(f"{key}: must be a boolean")
    return errors


def dedupe(records):
    by_id = {}
    for rec in records:
        rid = rec["id"]
        if rid not in by_id:
            by_id[rid] = dict(rec)
            continue
        merged = by_id[rid]
        incoming_rank = ANGLE_RANK.get(rec.get("angle", "code"), 0)
        current_rank = ANGLE_RANK.get(merged.get("angle", "code"), 0)
        for key, value in rec.items():
            if key in LIST_FIELDS:
                merged[key] = sorted(set(merged.get(key, [])) | set(value or []))
            elif key not in merged or incoming_rank > current_rank:
                merged[key] = value
        if incoming_rank > current_rank:
            merged["angle"] = rec["angle"]
    return list(by_id.values())


def _consumer_counts(caps):
    counts = {}
    for c in caps:
        for mid in set(c.get("uses", [])):
            counts[mid] = counts.get(mid, 0) + 1
    return counts


def apply_stopping_rule(mechs, caps):
    counts = _consumer_counts(caps)
    kept, dropped = [], []
    for m in mechs:
        if counts.get(m["id"], 0) >= 2 or m.get("domain_concept"):
            kept.append(m)
        else:
            dropped.append(m)
    return kept, dropped


def build_used_by(mechs, caps):
    out = []
    for m in mechs:
        users = sorted(c["id"] for c in caps if m["id"] in c.get("uses", []))
        enriched = dict(m)
        enriched["used_by"] = users
        out.append(enriched)
    return out


def derive_composition(caps):
    out = []
    for c in caps:
        mine = set(c.get("uses", []))
        links = []
        for other in caps:
            if other["id"] == c["id"]:
                continue
            shared = sorted(mine & set(other.get("uses", [])))
            if shared:
                links.append({"id": other["id"], "via": shared})
        links.sort(key=lambda link: (-len(link["via"]), link["id"]))
        enriched = dict(c)
        enriched["composes_with"] = links
        out.append(enriched)
    return out


def merge(cap_records, mech_records):
    errors = []
    for rec in cap_records:
        for err in validate_record(rec, schema.CAPABILITY_SCHEMA):
            errors.append(f"capability {rec.get('id', '?')}: {err}")
    for rec in mech_records:
        for err in validate_record(rec, schema.MECHANISM_SCHEMA):
            errors.append(f"mechanism {rec.get('id', '?')}: {err}")

    caps = dedupe(cap_records)
    mechs = dedupe(mech_records)
    kept, dropped = apply_stopping_rule(mechs, caps)

    known = {m["id"] for m in kept}
    dangling = sorted(
        {mid for c in caps for mid in c.get("uses", []) if mid not in known}
    )
    for c in caps:
        c["uses"] = [m for m in c.get("uses", []) if m in known]

    caps = derive_composition(caps)
    kept = build_used_by(kept, caps)

    caps.sort(key=lambda c: c["id"])
    kept.sort(key=lambda m: m["id"])

    status_counts = {}
    for c in caps:
        status_counts[c["status"]] = status_counts.get(c["status"], 0) + 1

    return {
        "capabilities": caps,
        "mechanisms": kept,
        "counts": {
            "capabilities": len(caps),
            "mechanisms": len(kept),
            "by_status": status_counts,
        },
        "warnings": {
            "validation_errors": errors,
            "dropped_mechanisms": [m["id"] for m in dropped],
            "dangling_mechanism_refs": dangling,
        },
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_catalog_merge.py -v`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/catalog/merge_catalog.py tests/test_catalog_merge.py
git commit -m "feat(catalog): merge engine with stopping rule and derived composition"
```

---

### Task 3: Markdown renderer

The human-readable, diffable companion to the JSON.

**Files:**
- Create: `scripts/catalog/render_markdown.py`
- Test: `tests/test_catalog_render.py`

**Interfaces:**
- Consumes: catalog dict from `merge_catalog.merge`.
- Produces: `scripts.catalog.render_markdown.render(catalog: dict) -> str`

- [ ] **Step 1: Write the failing test**

Create `tests/test_catalog_render.py`:

```python
from scripts.catalog import merge_catalog as mc
from scripts.catalog import render_markdown as rm


def build_catalog():
    caps = [
        {
            "id": "precool-on-arrival", "name": "Pre-cool on Arrival",
            "pitch": "Your home is already cool when you walk in.",
            "what_it_does": "Watches for you crossing a wide ring around home and starts the AC early.",
            "layer": "presence", "audience": "user-facing",
            "status": "live-prod",
            "status_evidence": "bundle recipe at frontend/.../precool.jsx, shipped 286341c",
            "uses": ["presence-zones"],
            "surfaces": ["frontend/src/components/automations/bundles/recipes/precool.jsx"],
        },
        {
            "id": "leave-home", "name": "Leave Home",
            "pitch": "Everything shuts down when the last person leaves.",
            "what_it_does": "Triggers on any-presence going away and runs a shutdown bundle.",
            "layer": "presence", "audience": "user-facing",
            "status": "live-prod",
            "status_evidence": "shipped 153cc56, wired via bundle engine",
            "uses": ["presence-zones"],
            "surfaces": ["services/presence_side_effects.py"],
        },
        {
            "id": "dead-thing", "name": "Dead Thing",
            "pitch": "Something that no longer runs.",
            "what_it_does": "Was started only in core/ziggy_main.py, which never runs under uvicorn.",
            "layer": "platform", "audience": "internal",
            "status": "orphaned",
            "status_evidence": "no caller from backend/server.py; only core/ziggy_main.py:88",
            "uses": [], "surfaces": ["services/dead_thing.py"],
        },
    ]
    mechs = [{
        "id": "presence-zones", "name": "Presence Zones",
        "kind": "store", "what_it_is": "Geofence rings with lat/lon/radius, created and resized by wizards.",
        "surfaces": ["services/presence_engine.py"], "domain_concept": True,
        "health": "lan_host is IP-pinned and drifts with DHCP",
    }]
    return mc.merge(caps, mechs)


def test_render_includes_every_capability_name():
    md = rm.render(build_catalog())
    assert "Pre-cool on Arrival" in md
    assert "Leave Home" in md
    assert "Dead Thing" in md


def test_render_shows_status_and_evidence():
    md = rm.render(build_catalog())
    assert "live-prod" in md
    assert "orphaned" in md
    assert "286341c" in md


def test_render_has_a_mechanism_section_with_used_by():
    md = rm.render(build_catalog())
    assert "## Mechanisms" in md
    assert "Presence Zones" in md
    assert "leave-home" in md and "precool-on-arrival" in md


def test_render_surfaces_composition():
    md = rm.render(build_catalog())
    assert "presence-zones" in md


def test_render_includes_health_note():
    md = rm.render(build_catalog())
    assert "IP-pinned" in md


def test_render_starts_with_a_summary_table():
    md = rm.render(build_catalog())
    head = md.split("## ")[0]
    assert "3" in head  # capability count
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_catalog_render.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.catalog.render_markdown'`

- [ ] **Step 3: Write the renderer**

Create `scripts/catalog/render_markdown.py`:

```python
"""Render the catalog JSON as readable, diffable Markdown."""

STATUS_ICON = {
    "live-prod": "🟢",
    "canary-only": "🟡",
    "flagged": "🔵",
    "orphaned": "🟠",
    "abandoned": "⚫",
}


def _capability_block(cap, lines):
    icon = STATUS_ICON.get(cap["status"], "")
    lines.append(f"### {icon} {cap['name']}  `{cap['id']}`")
    lines.append("")
    lines.append(f"> {cap['pitch']}")
    lines.append("")
    lines.append(cap["what_it_does"])
    lines.append("")
    lines.append(f"- **Status:** `{cap['status']}` — {cap['status_evidence']}")
    lines.append(f"- **Layer:** {cap['layer']} · **Audience:** {cap['audience']}")
    if cap.get("uses"):
        lines.append("- **Built from:** " + ", ".join(f"`{m}`" for m in cap["uses"]))
    if cap.get("composes_with"):
        parts = [
            f"`{link['id']}` (via {', '.join(link['via'])})"
            for link in cap["composes_with"][:6]
        ]
        lines.append("- **Composes with:** " + ", ".join(parts))
    if cap.get("entry_points"):
        lines.append("- **Entry points:** " + ", ".join(f"`{e}`" for e in cap["entry_points"]))
    lines.append("- **Surfaces:** " + ", ".join(f"`{s}`" for s in cap["surfaces"][:8]))
    if cap.get("tests"):
        lines.append("- **Tests:** " + ", ".join(f"`{t}`" for t in cap["tests"][:5]))
    if cap.get("known_gaps"):
        lines.append("- **Known gaps:** " + "; ".join(cap["known_gaps"]))
    lines.append("")


def render(catalog):
    counts = catalog["counts"]
    lines = ["# Ziggy Capability Catalog", ""]
    lines.append(
        f"**{counts['capabilities']} capabilities** built from "
        f"**{counts['mechanisms']} shared mechanisms**."
    )
    lines.append("")
    lines.append("| Status | Count |")
    lines.append("|---|---|")
    for status, n in sorted(counts["by_status"].items(), key=lambda kv: -kv[1]):
        lines.append(f"| {STATUS_ICON.get(status, '')} `{status}` | {n} |")
    lines.append("")
    lines.append("*Generated from `docs/capability-catalog.json`. Do not edit by hand.*")
    lines.append("")

    by_layer = {}
    for cap in catalog["capabilities"]:
        by_layer.setdefault(cap["layer"], []).append(cap)

    lines.append("## Capabilities")
    lines.append("")
    for layer in sorted(by_layer):
        lines.append(f"## {layer}")
        lines.append("")
        for cap in sorted(by_layer[layer], key=lambda c: c["name"]):
            _capability_block(cap, lines)

    lines.append("## Mechanisms")
    lines.append("")
    lines.append("Reusable building blocks. `used_by` answers *where else is this used?*")
    lines.append("")
    by_kind = {}
    for m in catalog["mechanisms"]:
        by_kind.setdefault(m["kind"], []).append(m)
    for kind in sorted(by_kind):
        lines.append(f"### {kind}")
        lines.append("")
        for m in sorted(by_kind[kind], key=lambda x: x["name"]):
            lines.append(f"#### {m['name']}  `{m['id']}`")
            lines.append("")
            lines.append(m["what_it_is"])
            lines.append("")
            lines.append("- **Used by:** " + (", ".join(f"`{c}`" for c in m["used_by"]) or "_nothing_"))
            if m.get("health"):
                lines.append(f"- **Health:** ⚠️ {m['health']}")
            lines.append("- **Surfaces:** " + ", ".join(f"`{s}`" for s in m["surfaces"][:6]))
            lines.append("")

    warnings = catalog.get("warnings", {})
    if any(warnings.values()):
        lines.append("## Warnings")
        lines.append("")
        for key, values in warnings.items():
            if values:
                lines.append(f"- **{key}:** {len(values)}")
        lines.append("")

    return "\n".join(lines)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_catalog_render.py -v`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/catalog/render_markdown.py tests/test_catalog_render.py
git commit -m "feat(catalog): markdown renderer"
```

---

### Task 4: Extraction workflow (Workflow 1 — 64 agents)

Runs Phases B, C and D. Agents write their own files; the workflow returns only counts.

**Files:**
- Create: `scripts/catalog/workflow-extract.js`
- Output: `$SCRATCH/catalog-raw/<territory>.<angle>.json`

**Interfaces:**
- Consumes: `$SCRATCH/territories.json` from Task 1 Step 7, passed in via `args`.
- Produces: one file per territory at `$SCRATCH/catalog-raw/<territory>.verified.json`, each `{"capabilities": [...], "mechanisms": [...]}` matching the Task 1 schemas.

- [ ] **Step 1: Write the workflow script**

Create `scripts/catalog/workflow-extract.js`:

```javascript
export const meta = {
  name: 'ziggy-catalog-extract',
  description: 'Dual-angle extraction, reconciliation and static liveness verification per territory',
  phases: [
    { title: 'Extract' },
    { title: 'Reconcile' },
    { title: 'Verify' },
  ],
}

const SUMMARY = {
  type: 'object',
  additionalProperties: false,
  required: ['territory', 'path', 'capability_count', 'mechanism_count', 'notes'],
  properties: {
    territory: { type: 'string' },
    path: { type: 'string' },
    capability_count: { type: 'integer' },
    mechanism_count: { type: 'integer' },
    notes: { type: 'string' },
  },
}

const { territories, scratch, schemaText, rules } = args

const RULES = `
HARD RULES — violating any of these invalidates your output:
- NEVER read or reference anything under .claude/worktrees/ — those are stale duplicate trees.
- Do NOT modify any file outside your assigned output path.
- Do NOT SSH anywhere, call the relay, or run scripts/fleet-health.py. Static reading only.
- status_evidence MUST cite a concrete file path, flag name, or commit SHA. A claim with no
  citation is a failure. If you cannot prove it, use status "orphaned" and say why.
- ${rules}

RECORD SCHEMAS (emit exactly these shapes):
${schemaText}
`

const names = Object.keys(territories)

const results = await pipeline(
  names,

  // Stage 1: both angles, blind to each other.
  (name) => {
    const t = territories[name]
    const files = t.files.slice(0, 400).join('\n')
    const communities = t.communities.slice(0, 40).join(', ')
    return parallel([
      () => agent(
        `You are mapping the "${name}" territory of the Ziggy smart-home codebase, CODE-FIRST.
Territory: ${t.description}

Read the code. Your job is to name every CAPABILITY (something a person gets) and every
MECHANISM (a reusable building block) visible in these files.

Files in your territory:
${files}

Matching graphify community wiki pages live in graphify-out/wiki/ — these are named:
${communities}
They are symbol-level, so use them for orientation and for their "Relationships" sections,
not for product meaning. You may also run: graphify explain "<node>" and graphify path "<a>" "<b>".

A capability is what a user or operator GETS. A mechanism is what capabilities are BUILT FROM.
Apply the stopping rule: only record a mechanism if you believe 2+ capabilities use it, or it
owns its own store/engine (set domain_concept true in that case).

Set "angle" to "code" on every record. Set "territory" to "${name}".

Write your output as JSON to ${scratch}/catalog-raw/${name}.code.json with shape
{"capabilities": [...], "mechanisms": [...]}. Create the directory if needed.
Then return the summary object.
${RULES}`,
        { label: `code:${name}`, phase: 'Extract', schema: SUMMARY }
      ),
      () => agent(
        `You are mapping the "${name}" territory of the Ziggy smart-home codebase, HISTORY-FIRST.
Territory: ${t.description}

Do NOT start from the code. Start from the record of what was built:
- git log for these paths. Useful: git log --oneline --no-merges -- <path> ...
  Ziggy's commit messages are unusually narrative and often name the feature and the bug.
- docs/ — runbooks, audits, handoffs, design specs relevant to this territory.
- /Users/YouvalPolacsek/.claude/projects/-Users-YouvalPolacsek-ziggy-pc/memory/*.md —
  92 memory files, many of which are feature journals with status notes.
- frontend/src/lib/i18n/en.js — the user-facing vocabulary; strings name features
  that the code does not.

Your unique value is finding capabilities that the code alone will NOT show: things built
then unwired, things shipped then superseded, things whose only trace is a commit and a
memory note. Record those with status "abandoned" or "orphaned" and say what happened.

Paths in scope:
${files}

Set "angle" to "history" on every record. Set "territory" to "${name}".

Write JSON to ${scratch}/catalog-raw/${name}.history.json with shape
{"capabilities": [...], "mechanisms": [...]}. Then return the summary object.
${RULES}`,
        { label: `history:${name}`, phase: 'Extract', schema: SUMMARY }
      ),
    ])
  },

  // Stage 2: reconcile the two angles.
  (pair, name) => agent(
    `Reconcile the two independent extractions of the "${name}" territory of Ziggy.

Read both:
- ${scratch}/catalog-raw/${name}.code.json    (what the code shows)
- ${scratch}/catalog-raw/${name}.history.json (what the record shows)

Produce ONE merged set. Rules:
- Same capability found by both angles: merge into one record, union the lists, keep the
  better pitch and what_it_does.
- In code but NOT in history: keep it, and set "disagreement" to "undocumented — no commit
  or doc names this".
- In history but NOT in code: keep it, set status to "abandoned" or "orphaned" as the
  evidence supports, and set "disagreement" to "in history only — <what happened>".
- Deduplicate mechanisms by meaning, not just by id. Two names for one thing become one.
- Re-apply the stopping rule after merging.

Set "angle" to "reconciled" on every record. Set "territory" to "${name}".

Write JSON to ${scratch}/catalog-raw/${name}.reconciled.json and return the summary.
${RULES}`,
    { label: `reconcile:${name}`, phase: 'Reconcile', schema: SUMMARY }
  ),

  // Stage 3: prove every status claim. Independent of the reconciler.
  (rec, name) => agent(
    `You are an independent verifier for the "${name}" territory of Ziggy. You did not write
these records and you should not trust them.

Read ${scratch}/catalog-raw/${name}.reconciled.json.

For EVERY capability, prove or correct its "status" by reading the actual wiring:
- "live-prod" requires a call path reachable from backend/server.py (its startup hook) or
  from a services/ziggy_scheduler.py tick, AND presence in the newest release-* tag.
  Check with: git tag --list 'release-*' --sort=-creatordate | head -1
- CRITICAL: core/ziggy_main.py is NOT the production entrypoint. The container runs
  uvicorn backend.server:app. Anything started ONLY in ziggy_main.py is "orphaned",
  no matter how complete it looks. Four features were already found dead this exact way.
  tests/test_prod_entrypoint_starts_services.py encodes this rule.
- "flagged" means wired but gated behind a config/settings.yaml feature flag that is off
  by default. Name the flag in status_evidence.
- "canary-only" means on main but not in the newest release-* tag.
- "orphaned" means no caller reachable from a prod entrypoint.
- "abandoned" means gone from the tree.

Rewrite status and status_evidence wherever the claim does not hold. Every status_evidence
MUST cite a file path, a flag name, or a commit SHA. Do not soften a demotion — a feature
wrongly listed as live is the single worst failure this catalog can have.

Leave capabilities and mechanisms otherwise unchanged.

Write the corrected JSON to ${scratch}/catalog-raw/${name}.verified.json and return the
summary, using "notes" to say how many statuses you changed and which.
${RULES}`,
    { label: `verify:${name}`, phase: 'Verify', schema: SUMMARY }
  )
)

const ok = results.filter(Boolean)
log(`verified ${ok.length}/${names.length} territories`)

return {
  territories: ok,
  total_capabilities: ok.reduce((n, r) => n + r.capability_count, 0),
  total_mechanisms: ok.reduce((n, r) => n + r.mechanism_count, 0),
  failed: names.filter((n) => !ok.some((r) => r.territory === n)),
}
```

- [ ] **Step 2: Launch Workflow 1**

Call the Workflow tool with `scriptPath: "scripts/catalog/workflow-extract.js"` and `args` set to an object containing:
- `territories`: the `territories` object read from `$SCRATCH/territories.json`
- `scratch`: the `$SCRATCH` absolute path
- `schemaText`: `json.dumps` of `CAPABILITY_SCHEMA` and `MECHANISM_SCHEMA`
- `rules`: `"Scope is /Users/YouvalPolacsek/ziggy_pc and /Users/YouvalPolacsek/ziggy_mobile only."`

Pass `args` as real JSON values, never as a JSON-encoded string.

Expect 64 agents, ~8 concurrent, 20–35 minutes.

- [ ] **Step 3: Check the output landed**

Run:
```bash
ls "$SCRATCH/catalog-raw/"*.verified.json | wc -l
python3 -c "
import glob,json,collections
c=collections.Counter(); caps=0; mechs=0
for f in glob.glob('$SCRATCH/catalog-raw/*.verified.json'):
    d=json.load(open(f))
    caps+=len(d['capabilities']); mechs+=len(d['mechanisms'])
    for x in d['capabilities']: c[x['status']]+=1
print('capabilities',caps,'mechanisms',mechs)
print(dict(c))
"
```

Expected: 16 files, a non-trivial capability count, and a status spread that includes some non-`live-prod` values. If every capability came back `live-prod`, Phase D did not do its job — re-run the verify stage before continuing.

- [ ] **Step 4: CHECKPOINT — report to the user**

Present: total capabilities, total mechanisms, the status breakdown, per-territory counts, and any territory in `failed`. Get a go-ahead before Task 5. Do not proceed automatically.

- [ ] **Step 5: Commit the workflow script**

```bash
git add scripts/catalog/workflow-extract.js
git commit -m "feat(catalog): dual-angle extraction and verification workflow"
```

---

### Task 5: Synthesis workflow (Workflow 2 — 8 agents)

Runs Phases E, F and G against the full verified set.

**Files:**
- Create: `scripts/catalog/workflow-synthesize.js`
- Output: `$SCRATCH/catalog-synth/{normalized,narrative,gaps}.json`

**Interfaces:**
- Consumes: `$SCRATCH/catalog-raw/*.verified.json` from Task 4.
- Produces: `$SCRATCH/catalog-synth/normalized.json` (`{"capabilities": [...], "mechanisms": [...]}`), `narrative.json` (`{"stories": [{"title", "blurb", "capability_ids"}]}`), `gaps.json` (`{"unclaimed": [...], "notes": "..."}`).

- [ ] **Step 1: Write the workflow script**

Create `scripts/catalog/workflow-synthesize.js`:

```javascript
export const meta = {
  name: 'ziggy-catalog-synthesize',
  description: 'Global dedup and normalization, value-story narrative, and completeness critique',
  phases: [
    { title: 'Cross-link' },
    { title: 'Narrative' },
    { title: 'Critique' },
  ],
}

const DONE = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'summary'],
  properties: { path: { type: 'string' }, summary: { type: 'string' } },
}

const { scratch, schemaText } = args
const RAW = `${scratch}/catalog-raw`
const OUT = `${scratch}/catalog-synth`

const SLICES = [
  { key: 'capability-ids', what: 'capability id and name normalization: find capabilities recorded under different ids or names across territories and map them to ONE canonical id+name. Emit a mapping file.' },
  { key: 'mechanism-ids', what: 'mechanism identity: two territories will have named the same building block differently (e.g. "geofence-zones" vs "presence-zones"). Collapse them to one canonical id, unioning surfaces and used_by. Emit a mapping file.' },
  { key: 'layers', what: 'layer and audience normalization: the 16 territories invented their own layer strings. Collapse them into one coherent set of 8-12 layers that a product owner would recognise, and assign every capability to one.' },
  { key: 'uses-edges', what: 'uses-edge repair: capabilities reference mechanism ids that other territories defined. Using the whole set, fix every "uses" list so it points at ids that actually exist, and add obviously-missing edges you can prove from the surfaces.' },
]

phase('Cross-link')
const maps = await parallel(SLICES.map((s) => () => agent(
  `You have the complete verified Ziggy capability extraction, 16 territory files at ${RAW}/*.verified.json.
Read ALL of them first — your job needs the global picture.

Your specific job: ${s.what}

Write your result as JSON to ${OUT}/map.${s.key}.json. Return {path, summary}.

RULES: never read .claude/worktrees/. Do not invent capabilities that no territory reported.
Do not change any "status" or "status_evidence" value — those were independently verified
and are not yours to touch.
SCHEMAS:
${schemaText}`,
  { label: `crosslink:${s.key}`, phase: 'Cross-link', schema: DONE }
)))

const applied = await agent(
  `Apply the four normalization maps to produce the single global record set.

Read all of ${RAW}/*.verified.json and all of ${OUT}/map.*.json.

Produce ONE file ${OUT}/normalized.json with {"capabilities": [...], "mechanisms": [...]} where:
- every capability appears exactly once under its canonical id
- every mechanism appears exactly once under its canonical id
- layers are the normalized set
- every "uses" entry points at a mechanism id that exists in this file
- "status" and "status_evidence" are copied through UNCHANGED from the verified files

Do NOT compute composes_with or used_by — a deterministic script does that afterwards.
Return {path, summary} where summary gives final counts.
SCHEMAS:
${schemaText}`,
  { label: 'apply-maps', phase: 'Cross-link', schema: DONE }
)

phase('Narrative')
const narrative = await agent(
  `Read ${OUT}/normalized.json.

Group the USER-FACING capabilities into 5-8 value stories — the way a person would describe
what Ziggy does for them, not the way an engineer would. Think in terms of what changes in
someone's life: comfort, safety, effort saved, control, peace of mind.

For each story give: title (3-5 words), blurb (2 sentences, no jargon, no entity ids, no
Home Assistant terminology — the user never sees HA), and capability_ids.

Every user-facing capability with status live-prod or canary-only must appear in exactly one
story. Operator/internal capabilities and orphaned/abandoned ones are excluded.

Write to ${OUT}/narrative.json as {"stories": [{"title","blurb","capability_ids"}]}.
Return {path, summary}.`,
  { label: 'narrative', phase: 'Narrative', schema: DONE }
)

phase('Critique')
const critics = await parallel([
  () => agent(
    `You are the completeness critic for the Ziggy backend and services.

Read ${OUT}/normalized.json. Then enumerate the real surface area:
- every file in backend/routers/ (49 of them)
- every file in services/ (134 of them)
- every route registered in backend/server.py

For each, decide: is it claimed by at least one capability or mechanism in the catalog, or is
it genuinely just plumbing? Anything neither claimed nor plumbing is a GAP — the swarm missed
a capability there.

Do not be generous. A capability that "sort of covers" a router does not claim it.

Write ${OUT}/gaps.backend.json as {"unclaimed": [{"path","why_it_matters"}], "notes": "..."}.
Return {path, summary} with the gap count.
Never read .claude/worktrees/.`,
    { label: 'critic:backend', phase: 'Critique', schema: DONE }
  ),
  () => agent(
    `You are the completeness critic for the Ziggy frontend, mobile, relay and ops surface.

Read ${OUT}/normalized.json. Then enumerate:
- every file in frontend/src/pages/ (41) and the routes in frontend/src/App.jsx
- every file in relay/ (46)
- every script in scripts/ (33)
- the ziggy_mobile repo at /Users/YouvalPolacsek/ziggy_mobile

For each, decide: claimed by a capability, genuine plumbing, or a GAP. Pay special attention
to whether the mobile-native territory was actually covered — the native ziggy-presence
plugin, FCM registration, geofencing and the OTA updater must each be represented.

Write ${OUT}/gaps.frontend.json as {"unclaimed": [{"path","why_it_matters"}], "notes": "..."}.
Return {path, summary} with the gap count.
Never read .claude/worktrees/.`,
    { label: 'critic:frontend', phase: 'Critique', schema: DONE }
  ),
])

return {
  maps: maps.filter(Boolean).map((m) => m.path),
  normalized: applied ? applied.path : null,
  narrative: narrative ? narrative.path : null,
  gaps: critics.filter(Boolean).map((c) => ({ path: c.path, summary: c.summary })),
}
```

- [ ] **Step 2: Launch Workflow 2**

Call Workflow with `scriptPath: "scripts/catalog/workflow-synthesize.js"` and `args` `{scratch, schemaText}` as real JSON values.

Expect 8 agents, ~10 minutes.

- [ ] **Step 3: Verify the outputs exist**

Run:
```bash
ls "$SCRATCH/catalog-synth/"
python3 -c "
import json
d=json.load(open('$SCRATCH/catalog-synth/normalized.json'))
print('capabilities',len(d['capabilities']),'mechanisms',len(d['mechanisms']))
n=json.load(open('$SCRATCH/catalog-synth/narrative.json'))
print('stories',[s['title'] for s in n['stories']])
"
```

Expected: `normalized.json`, `narrative.json`, two `gaps.*.json`, four `map.*.json`.

- [ ] **Step 4: Commit**

```bash
git add scripts/catalog/workflow-synthesize.js
git commit -m "feat(catalog): synthesis workflow — cross-link, narrative, completeness critique"
```

---

### Task 6: Assemble the final catalog

Runs the deterministic pipeline over the swarm output and writes the two durable artifacts.

**Files:**
- Create: `scripts/catalog/assemble.py`
- Create: `docs/capability-catalog.json` (generated)
- Create: `docs/CAPABILITY_CATALOG.md` (generated)
- Test: `tests/test_catalog_assemble.py`

**Interfaces:**
- Consumes: `merge_catalog.merge`, `render_markdown.render`.
- Produces: `scripts.catalog.assemble.assemble(normalized_path, narrative_path, gap_paths, out_json, out_md) -> dict`

- [ ] **Step 1: Write the failing test**

Create `tests/test_catalog_assemble.py`:

```python
import json
import os

from scripts.catalog import assemble


def _write(tmp_path, name, payload):
    p = tmp_path / name
    p.write_text(json.dumps(payload), encoding="utf-8")
    return str(p)


def test_assemble_writes_json_and_markdown(tmp_path):
    normalized = _write(tmp_path, "normalized.json", {
        "capabilities": [{
            "id": "precool", "name": "Pre-cool", "pitch": "Cool before you arrive.",
            "what_it_does": "Starts the AC when you cross a ring around home, so it is cool on arrival.",
            "layer": "presence", "audience": "user-facing", "status": "live-prod",
            "status_evidence": "recipe at frontend/.../precool.jsx shipped in 286341c",
            "uses": ["zones"], "surfaces": ["frontend/x.jsx"],
        }, {
            "id": "leave-home", "name": "Leave Home", "pitch": "Shuts down when you go.",
            "what_it_does": "Runs a shutdown bundle when the last tracked person leaves home.",
            "layer": "presence", "audience": "user-facing", "status": "live-prod",
            "status_evidence": "shipped in 153cc56 via the bundle engine",
            "uses": ["zones"], "surfaces": ["services/y.py"],
        }],
        "mechanisms": [{
            "id": "zones", "name": "Zones", "kind": "store",
            "what_it_is": "Geofence rings with a centre and radius, owned by the presence engine.",
            "surfaces": ["services/presence_engine.py"], "domain_concept": True,
        }],
    })
    narrative = _write(tmp_path, "narrative.json", {
        "stories": [{"title": "Comfort on arrival", "blurb": "Ziggy gets there first.",
                     "capability_ids": ["precool", "leave-home"]}]
    })
    gaps = _write(tmp_path, "gaps.json", {"unclaimed": [{"path": "services/z.py", "why_it_matters": "unmapped"}],
                                          "notes": "one gap"})

    out_json = str(tmp_path / "catalog.json")
    out_md = str(tmp_path / "catalog.md")
    result = assemble.assemble(normalized, narrative, [gaps], out_json, out_md)

    assert os.path.exists(out_json) and os.path.exists(out_md)
    written = json.loads(open(out_json, encoding="utf-8").read())
    assert written["counts"]["capabilities"] == 2
    assert written["stories"][0]["title"] == "Comfort on arrival"
    assert written["gaps"][0]["path"] == "services/z.py"
    assert result["counts"]["capabilities"] == 2


def test_assemble_derives_composition_and_used_by(tmp_path):
    normalized = _write(tmp_path, "n.json", {
        "capabilities": [{
            "id": "a", "name": "A", "pitch": "Does a thing.",
            "what_it_does": "It does a thing that a person would notice happening.",
            "layer": "l", "audience": "user-facing", "status": "live-prod",
            "status_evidence": "wired at backend/server.py:_startup",
            "uses": ["m"], "surfaces": ["a.py"],
        }, {
            "id": "b", "name": "B", "pitch": "Does another thing.",
            "what_it_does": "It does another thing that a person would notice happening.",
            "layer": "l", "audience": "user-facing", "status": "live-prod",
            "status_evidence": "wired at backend/server.py:_startup",
            "uses": ["m"], "surfaces": ["b.py"],
        }],
        "mechanisms": [{"id": "m", "name": "M", "kind": "engine",
                        "what_it_is": "A shared engine both capabilities depend on.",
                        "surfaces": ["m.py"], "domain_concept": False}],
    })
    out_json, out_md = str(tmp_path / "c.json"), str(tmp_path / "c.md")
    cat = assemble.assemble(normalized, None, [], out_json, out_md)
    a = next(c for c in cat["capabilities"] if c["id"] == "a")
    assert a["composes_with"] == [{"id": "b", "via": ["m"]}]
    assert cat["mechanisms"][0]["used_by"] == ["a", "b"]


def test_assemble_tolerates_missing_narrative_and_gaps(tmp_path):
    normalized = _write(tmp_path, "n.json", {"capabilities": [], "mechanisms": []})
    out_json, out_md = str(tmp_path / "c.json"), str(tmp_path / "c.md")
    cat = assemble.assemble(normalized, None, [], out_json, out_md)
    assert cat["stories"] == []
    assert cat["gaps"] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_catalog_assemble.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.catalog.assemble'`

- [ ] **Step 3: Write the assembler**

Create `scripts/catalog/assemble.py`:

```python
"""Final assembly: swarm output -> docs/capability-catalog.json + CAPABILITY_CATALOG.md"""

import json
import os

from scripts.catalog import merge_catalog as mc
from scripts.catalog import render_markdown as rm


def _read(path):
    if not path or not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def assemble(normalized_path, narrative_path, gap_paths, out_json, out_md, built_from=None):
    normalized = _read(normalized_path) or {"capabilities": [], "mechanisms": []}
    catalog = mc.merge(normalized["capabilities"], normalized["mechanisms"])

    narrative = _read(narrative_path) or {}
    catalog["stories"] = narrative.get("stories", [])

    gaps = []
    for path in gap_paths or []:
        data = _read(path) or {}
        gaps.extend(data.get("unclaimed", []))
    catalog["gaps"] = gaps

    if built_from:
        catalog["built_from_commit"] = built_from

    with open(out_json, "w", encoding="utf-8") as fh:
        json.dump(catalog, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    with open(out_md, "w", encoding="utf-8") as fh:
        fh.write(rm.render(catalog))
        fh.write("\n")

    return catalog


if __name__ == "__main__":
    import subprocess
    import sys

    scratch = sys.argv[1]
    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    synth = os.path.join(scratch, "catalog-synth")
    sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo,
                         capture_output=True, text=True).stdout.strip()
    cat = assemble(
        os.path.join(synth, "normalized.json"),
        os.path.join(synth, "narrative.json"),
        [os.path.join(synth, "gaps.backend.json"),
         os.path.join(synth, "gaps.frontend.json")],
        os.path.join(repo, "docs", "capability-catalog.json"),
        os.path.join(repo, "docs", "CAPABILITY_CATALOG.md"),
        built_from=sha,
    )
    print(json.dumps(cat["counts"], indent=2))
    for key, values in cat["warnings"].items():
        print(f"{key}: {len(values)}")
    print(f"gaps: {len(cat['gaps'])}")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_catalog_assemble.py -v`
Expected: PASS, 3 tests.

- [ ] **Step 5: Generate the real artifacts**

Run: `python3 scripts/catalog/assemble.py "$SCRATCH"`

Expected: counts printed, and `docs/capability-catalog.json` + `docs/CAPABILITY_CATALOG.md` written. Read the first 100 lines of the Markdown and sanity-check that the pitches read like product language, not code language. If `validation_errors` is non-empty, fix the offending records in `normalized.json` and re-run.

- [ ] **Step 6: Run the whole catalog test suite**

Run: `python3 -m pytest tests/test_catalog_*.py -v`
Expected: PASS, 34 tests.

- [ ] **Step 7: Commit**

```bash
git add scripts/catalog/assemble.py tests/test_catalog_assemble.py docs/capability-catalog.json docs/CAPABILITY_CATALOG.md
git commit -m "feat(catalog): assemble pipeline and first generated catalog"
```

---

### Task 7: The viewer

Self-contained three-lens HTML with Compose mode.

**Files:**
- Create: `scripts/catalog/build_viewer.py`
- Create: `scripts/catalog/viewer_template.html`
- Test: `tests/test_catalog_viewer.py`
- Output: `$SCRATCH/ziggy-capability-catalog.html`

**Interfaces:**
- Consumes: `docs/capability-catalog.json`.
- Produces: `scripts.catalog.build_viewer.build(catalog_path: str, template_path: str, out_path: str) -> str`

- [ ] **Step 1: Write the failing test**

Create `tests/test_catalog_viewer.py`:

```python
import json
import os
import re

from scripts.catalog import build_viewer

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEMPLATE = os.path.join(REPO, "scripts", "catalog", "viewer_template.html")


def _catalog(tmp_path):
    payload = {
        "capabilities": [{
            "id": "precool", "name": "Pre-cool", "pitch": "Cool before you arrive.",
            "what_it_does": "Starts the AC early.", "layer": "presence",
            "audience": "user-facing", "status": "live-prod",
            "status_evidence": "shipped 286341c", "uses": ["zones"],
            "surfaces": ["a.jsx"], "composes_with": [{"id": "leave-home", "via": ["zones"]}],
        }],
        "mechanisms": [{"id": "zones", "name": "Zones", "kind": "store",
                        "what_it_is": "Geofence rings.", "surfaces": ["p.py"],
                        "domain_concept": True, "used_by": ["precool"]}],
        "counts": {"capabilities": 1, "mechanisms": 1, "by_status": {"live-prod": 1}},
        "stories": [{"title": "Comfort", "blurb": "It is ready.", "capability_ids": ["precool"]}],
        "gaps": [], "warnings": {},
    }
    p = tmp_path / "catalog.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    return str(p)


def test_build_inlines_the_catalog(tmp_path):
    out = str(tmp_path / "viewer.html")
    html = build_viewer.build(_catalog(tmp_path), TEMPLATE, out)
    assert "Pre-cool" in html
    assert "precool" in html
    assert os.path.exists(out)


def test_viewer_is_self_contained(tmp_path):
    out = str(tmp_path / "viewer.html")
    html = build_viewer.build(_catalog(tmp_path), TEMPLATE, out)
    assert not re.search(r'(src|href)\s*=\s*["\']https?://', html)
    assert "cdn." not in html
    assert "@import url(" not in html


def test_viewer_has_no_document_skeleton_tags(tmp_path):
    out = str(tmp_path / "viewer.html")
    html = build_viewer.build(_catalog(tmp_path), TEMPLATE, out)
    lowered = html.lower()
    for tag in ("<!doctype", "<html", "<body", "</html>", "</body>"):
        assert tag not in lowered, f"artifact wrapper supplies {tag}"


def test_viewer_declares_all_three_lenses(tmp_path):
    out = str(tmp_path / "viewer.html")
    html = build_viewer.build(_catalog(tmp_path), TEMPLATE, out)
    for lens in ("Pitch", "Capability", "Engineering"):
        assert lens in html


def test_viewer_supports_dark_and_light(tmp_path):
    out = str(tmp_path / "viewer.html")
    html = build_viewer.build(_catalog(tmp_path), TEMPLATE, out)
    assert "prefers-color-scheme: dark" in html
    assert 'data-theme="dark"' in html
    assert 'data-theme="light"' in html


def test_build_escapes_script_terminator(tmp_path):
    payload = json.loads(open(_catalog(tmp_path), encoding="utf-8").read())
    payload["capabilities"][0]["pitch"] = "danger </script> here"
    p = tmp_path / "evil.json"
    p.write_text(json.dumps(payload), encoding="utf-8")
    out = str(tmp_path / "viewer.html")
    html = build_viewer.build(str(p), TEMPLATE, out)
    assert "</script> here" not in html
    assert "<\\/script>" in html
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_catalog_viewer.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'scripts.catalog.build_viewer'`

- [ ] **Step 3: Write the template**

Create `scripts/catalog/viewer_template.html`. It must contain the literal token `/*__CATALOG__*/` where the data is injected, and must NOT contain `<!doctype>`, `<html>`, `<head>` or `<body>` — the Artifact wrapper supplies those.

Requirements the implementer must satisfy (the design brief, not boilerplate to copy blindly):
- `<title>Ziggy Capability Catalog</title>` at the top.
- A `<style>` block using CSS custom properties for colour, with a light default, a `@media (prefers-color-scheme: dark)` block, AND `:root[data-theme="dark"]` / `:root[data-theme="light"]` overrides that win in both directions.
- A header showing total capabilities, total mechanisms, and the status chips.
- Three lens tabs labelled **Pitch**, **Capability**, **Engineering**, switching by toggling a class — no page reload.
- *Pitch lens*: renders `catalog.stories`, each with title, blurb, and its capabilities as chips. Excludes `orphaned` and `abandoned`.
- *Capability lens*: a search input filtering on name/pitch/what_it_does, filter chips for layer and status, and a card grid. Clicking a card opens a detail panel showing `what_it_does`, `status` + `status_evidence`, `uses` (clickable → mechanism), `composes_with` (clickable → capability), surfaces, tests, and `known_gaps`.
- *Engineering lens*: mechanisms grouped by `kind`, each showing `what_it_is`, `used_by` as clickable chips, `health` (with a warning marker), and surfaces. Plus a Gaps section listing `catalog.gaps`.
- **Compose mode**: two `<select>` elements listing every capability. On selection, show the intersection of their `uses` — the shared mechanisms — and state plainly whether they already compose and through what. If the intersection is empty, say they share no foundations today and list what each stands on.
- Status colour coding, with `orphaned` and `abandoned` visually distinct and impossible to mistake for shipped.
- All content in one `overflow-x: auto` container where wide; the page body must never scroll horizontally.
- Keyboard: `/` focuses search, `Escape` closes the detail panel.

- [ ] **Step 4: Write the builder**

Create `scripts/catalog/build_viewer.py`:

```python
"""Inline the catalog JSON into the viewer template."""

import json
import os

TOKEN = "/*__CATALOG__*/"


def build(catalog_path, template_path, out_path):
    with open(catalog_path, "r", encoding="utf-8") as fh:
        catalog = json.load(fh)
    with open(template_path, "r", encoding="utf-8") as fh:
        template = fh.read()

    if TOKEN not in template:
        raise ValueError(f"template is missing the {TOKEN} injection point")

    payload = json.dumps(catalog, ensure_ascii=False)
    # A literal </script> inside the JSON would close the tag early.
    payload = payload.replace("</", "<\\/")

    html = template.replace(TOKEN, payload)

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(html)
    return html


if __name__ == "__main__":
    import sys

    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    out = sys.argv[1]
    build(
        os.path.join(repo, "docs", "capability-catalog.json"),
        os.path.join(repo, "scripts", "catalog", "viewer_template.html"),
        out,
    )
    print(f"wrote {out}")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m pytest tests/test_catalog_viewer.py -v`
Expected: PASS, 6 tests.

- [ ] **Step 6: Build the real viewer**

Run: `python3 scripts/catalog/build_viewer.py "$SCRATCH/ziggy-capability-catalog.html"`

- [ ] **Step 7: Commit**

```bash
git add scripts/catalog/build_viewer.py scripts/catalog/viewer_template.html tests/test_catalog_viewer.py
git commit -m "feat(catalog): three-lens viewer with compose mode"
```

---

### Task 8: Publish and report

**Files:**
- Modify: `docs/CAPABILITY_CATALOG.md` (add the published URL at the top)

- [ ] **Step 1: Load the artifact design skill**

Invoke the `artifact-design` skill before publishing, as its tool contract requires.

- [ ] **Step 2: Publish**

Call the Artifact tool with:
- `file_path`: `$SCRATCH/ziggy-capability-catalog.html`
- `favicon`: `🏠`
- `description`: `Every capability Ziggy has, the mechanisms they share, and what actually runs in production.`

Record the returned URL.

- [ ] **Step 3: Add the URL to the Markdown and commit**

Insert a line under the title of `docs/CAPABILITY_CATALOG.md`:

```markdown
**Browse it:** <URL>
```

```bash
git add docs/CAPABILITY_CATALOG.md
git commit -m "docs(catalog): link the published viewer"
```

- [ ] **Step 4: Report to the user**

Report, honestly and specifically:
- capability and mechanism counts, and the status breakdown
- the most-reused mechanisms (top of `used_by` length) — the real foundations
- every capability with status `orphaned` or `abandoned` — things built that do not run
- the gap list from the critics — what the swarm could not account for
- any `validation_errors` or `dangling_mechanism_refs` still in `warnings`
- the published URL

Do not present the catalog as complete if the critics found gaps. Say what is missing.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `docs/capability-catalog.json` as system of record | 6 |
| `docs/CAPABILITY_CATALOG.md` generated | 3, 6 |
| Two tiers with the field sets given | 1 (schema), 2 (merge) |
| Mechanism stopping rule (2+ consumers or domain concept) | 2 |
| `used_by` reverse index | 2 |
| Composition derived from shared mechanisms | 2 |
| Mechanism kinds → cross-cutting inventories | 1 (vocabulary), 7 (Engineering lens grouping) |
| Phase A deterministic partition | 1 |
| Phase B dual-angle extraction | 4 |
| Phase C reconcile with disagreement flags | 4 |
| Phase D independent static verification | 4 |
| Phase E cross-link behind a barrier | 5 |
| Phase F narrative / value stories | 5 |
| Phase G completeness critics | 5 |
| Three lenses + Compose mode | 7 |
| Self-contained viewer, theme-aware | 7 |
| `catalog.config.json` extraction seam | 1 |
| `.claude/worktrees/**` excluded everywhere | 1 (config + test), 4 and 5 (agent rules) |
| No live fleet probe | Global Constraints, agent rules in 4 |
| `ziggy_pc` + `ziggy_mobile` scope | 1 (roots), 5 (mobile critic) |
| Human checkpoint between workflows | 4 Step 4 |
| Drift report deliverable | 8 Step 4 |

No gaps.

**Placeholder scan:** No TBD/TODO. Every code step carries real code. Task 7 Step 3 gives a design brief rather than a full HTML dump — deliberate, because the template is a large presentational file and the brief pins every behaviour the tests assert.

**Type consistency:** `validate_record`, `dedupe`, `apply_stopping_rule`, `build_used_by`, `derive_composition`, `merge` are named identically in Task 2's interfaces, its implementation, and Tasks 3/6 usage. `build(catalog_path, template_path, out_path)` matches between Task 7's interface block, its tests, and its implementation. `STATUSES` and `MECHANISM_KINDS` are defined once in Task 1 and asserted in Task 1's tests. Agent output filenames (`<territory>.code.json`, `.history.json`, `.reconciled.json`, `.verified.json`) are consistent between Task 4's stages and Task 5's reads.
