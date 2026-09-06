"""Incremental refresh of the capability catalog.

The catalog stores `built_from_commit`. This script:

  1. Reads current HEAD and diffs against `built_from_commit`.
  2. Groups changed files by territory (via the same partition the swarm used).
  3. For each affected territory, writes a self-contained brief that hands an
     agent: the curation guide, the current entries for that territory (as
     raw records), the commits since last build, and a strict delta contract.
  4. Merges the agents' delta responses back into the catalog, re-derives
     composition, regenerates the Markdown and viewer HTML, and — optionally
     — deploys to Jeff.

Human review is always required between --prep and --merge. This script does
not silently mutate the catalog.

Usage:
    python3 scripts/catalog/refresh.py                 # scan only, print summary
    python3 scripts/catalog/refresh.py --prep          # write briefs to $BRIEF_DIR
    python3 scripts/catalog/refresh.py --merge         # dry-run merge, print diff
    python3 scripts/catalog/refresh.py --merge --apply # actually write files
    python3 scripts/catalog/refresh.py --deploy        # apply + copy to jeff + fly deploy

Brief and proposal files live under:
    /tmp/catalog-refresh-<HEAD>/
        <territory>.brief.md       (from --prep)
        <territory>.proposed.json  (agent writes these)
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
from collections import defaultdict
from typing import Any

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, REPO)

JEFF_LIVE_URL = "https://youval-jeff.fly.dev/ziggy-catalog.json"

from scripts.catalog import build_territories as bt  # noqa: E402
from scripts.catalog import merge_catalog as mc      # noqa: E402
from scripts.catalog import render_markdown as rm    # noqa: E402
from scripts.catalog import build_viewer             # noqa: E402

CATALOG_PATH = os.path.join(REPO, "docs/capability-catalog.json")
MARKDOWN_PATH = os.path.join(REPO, "docs/CAPABILITY_CATALOG.md")
CURATION_PATH = os.path.join(REPO, "docs/CATALOG_CURATION.md")
CONFIG_PATH = os.path.join(REPO, "catalog.config.json")
TEMPLATE_PATH = os.path.join(REPO, "scripts/catalog/viewer_template.html")
JEFF_STATIC = os.path.expanduser("~/Code/jeff/jeff/static/ziggy-capability-catalog.html")
JEFF_DIR = os.path.expanduser("~/Code/jeff")


# ---------------------------------------------------------------------------
# git helpers
# ---------------------------------------------------------------------------

def git(*args: str, cwd: str = REPO) -> str:
    out = subprocess.run(
        ["git", *args], cwd=cwd, capture_output=True, text=True, check=True
    )
    return out.stdout


def head_sha() -> str:
    return git("rev-parse", "HEAD").strip()


def commits_since(base: str) -> list[dict]:
    """Return commits from `base` (exclusive) to HEAD, oldest first."""
    log = git(
        "log",
        "--reverse",
        "--format=%H%x00%ci%x00%an%x00%s",
        f"{base}..HEAD",
    )
    out = []
    for line in log.splitlines():
        if not line:
            continue
        sha, date, author, subject = line.split("\x00", 3)
        # Also grab files touched by this commit.
        files = git("show", "--name-only", "--format=", sha).splitlines()
        files = [f for f in files if f]
        out.append({"sha": sha, "short": sha[:8], "date": date, "author": author,
                    "subject": subject, "files": files})
    return out


def changed_files(base: str) -> dict[str, str]:
    """Return {path: status} between base and HEAD.

    status is one of A/M/D/R (added/modified/deleted/renamed).
    """
    raw = git("diff", "--name-status", f"{base}..HEAD")
    changed: dict[str, str] = {}
    for line in raw.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        status = parts[0][0]
        # R100 old new  →  keep new path
        path = parts[-1]
        changed[path] = status
    return changed


# ---------------------------------------------------------------------------
# territory scan
# ---------------------------------------------------------------------------

def group_changes_by_territory(cfg: dict, changed: dict[str, str],
                                repo_root: str = "ziggy_pc") -> dict[str, dict]:
    """Return {territory: {added, modified, deleted, renamed, all}}.

    Paths are matched only against territories whose `root` equals `repo_root`.
    A ziggy_pc path must not be assigned to a ziggy_mobile territory (whose
    include glob may otherwise match trivially).
    """
    by_terr: dict[str, dict] = defaultdict(lambda: {
        "added": [], "modified": [], "deleted": [], "renamed": [], "all": [],
    })
    for path, status in changed.items():
        if bt.is_excluded(path, cfg):
            continue
        terr = bt.assign_territory(path, cfg, root=repo_root)
        if not terr:
            continue
        bucket = {"A": "added", "M": "modified", "D": "deleted", "R": "renamed"}.get(status, "modified")
        by_terr[terr][bucket].append(path)
        by_terr[terr]["all"].append(path)
    return dict(by_terr)


def group_commits_by_territory(cfg: dict, commits: list[dict],
                               changed_by_terr: dict[str, dict]) -> dict[str, list[dict]]:
    """A commit belongs to a territory if any of its touched files land there.

    A commit that touches presence AND automations shows up under both.
    """
    terr_files = {t: set(v["all"]) for t, v in changed_by_terr.items()}
    out: dict[str, list[dict]] = defaultdict(list)
    for c in commits:
        for terr, files in terr_files.items():
            if any(f in files for f in c["files"]):
                out[terr].append(c)
    return dict(out)


# ---------------------------------------------------------------------------
# raw records (catalog minus derived fields)
# ---------------------------------------------------------------------------

_DERIVED_CAP = ("composes_with",)
_DERIVED_MECH = ("used_by",)
_DERIVED_TOP = ("counts", "warnings", "stories", "gaps", "built_from_commit", "built_at")


def raw_records(catalog: dict) -> tuple[list[dict], list[dict]]:
    """Strip derived fields so records can be re-fed to merge_catalog.merge()."""
    caps = []
    for c in catalog.get("capabilities", []):
        c2 = {k: v for k, v in c.items() if k not in _DERIVED_CAP}
        caps.append(c2)
    mechs = []
    for m in catalog.get("mechanisms", []):
        m2 = {k: v for k, v in m.items() if k not in _DERIVED_MECH}
        mechs.append(m2)
    return caps, mechs


def caps_for_territory(caps: list[dict], territory: str) -> list[dict]:
    return [c for c in caps if c.get("territory") == territory]


def mechs_for_territory(mechs: list[dict], territory: str) -> list[dict]:
    return [m for m in mechs if m.get("territory") == territory]


# ---------------------------------------------------------------------------
# brief writing
# ---------------------------------------------------------------------------

DELTA_CONTRACT = """
## Response contract

Write your response as JSON to `PROPOSED_PATH` with this exact shape:

```json
{
  "territory": "<territory>",
  "notes": "one-line summary of what changed and why",
  "add": [
    { "id": "...", "name": "...", "pitch": "...", "what_it_does": "...",
      "layer": "...", "audience": "...", "status": "...",
      "status_evidence": "...", "uses": [], "surfaces": ["..."],
      "territory": "<territory>" }
  ],
  "update": [
    { "id": "existing-id",
      "reason": "why the update",
      "changes": { "what_it_does": "new text", "known_gaps": ["..."], "status_evidence": "..." } }
  ],
  "mark_abandoned": [
    { "id": "existing-id",
      "reason": "cite evidence — file that no longer exists, commit that removed it, etc." }
  ]
}
```

All three arrays may be empty. If **nothing catalog-worthy** changed
(refactor, dependency bumps, test-only work, purely internal plumbing),
return all three empty and say so in `notes`.

**Absolute rules:**
- Do NOT write `composes_with` or `used_by` — they are derived downstream.
- Every capability's `status_evidence` MUST cite a real file path, flag name,
  or commit SHA. A claim without a citation is a failure.
- Default choice for new work is `update`, not `add`. Only `add` when the
  new work is a genuinely new capability by the Section 1 test in the guide.
- If evidence disagrees on status, take the pessimistic reading.
- Do not soften a demotion.
"""


def gold_examples_for_layer(caps: list[dict], layer: str, limit: int = 2) -> list[dict]:
    """Pick a couple of well-formed entries from the same or nearby layer as
    voice calibration."""
    same = [c for c in caps if c.get("layer") == layer and c["status"] == "live-prod"]
    same.sort(key=lambda c: -len(c.get("what_it_does", "")))
    picks = same[:limit]
    if len(picks) < limit:
        rest = [c for c in caps if c not in picks and c["status"] == "live-prod"]
        rest.sort(key=lambda c: -len(c.get("what_it_does", "")))
        picks += rest[: limit - len(picks)]
    # Strip derived fields for cleanliness
    return [{k: v for k, v in c.items() if k not in _DERIVED_CAP} for c in picks]


def write_brief(brief_dir: str, territory: str, curation: str,
                terr_caps: list[dict], terr_mechs: list[dict],
                commits: list[dict], changes: dict,
                gold: list[dict], built_from: str, head: str) -> str:
    proposed_path = os.path.join(brief_dir, f"{territory}.proposed.json")
    brief_path = os.path.join(brief_dir, f"{territory}.brief.md")

    def _fmt_files(paths: list[str]) -> str:
        if not paths:
            return "  (none)"
        return "\n".join(f"  - `{p}`" for p in paths)

    parts = [
        f"# Catalog refresh brief — territory: `{territory}`",
        "",
        f"Range: `{built_from[:8]}` → `{head[:8]}` "
        f"({len(commits)} commit(s), {len(changes['all'])} file change(s))",
        "",
        "You are updating the Ziggy capability catalog for ONE territory.",
        "Read the curation guide below carefully — it defines what counts as",
        "a capability, how entries are written, and what the catalog's voice",
        "sounds like. Then look at what changed in this territory since the",
        "last build and propose a minimal delta.",
        "",
        "---",
        "",
        "## Curation guide (source of truth for judgment)",
        "",
        curation,
        "",
        "---",
        "",
        f"## Current entries in `{territory}` ({len(terr_caps)} capabilities, {len(terr_mechs)} mechanisms)",
        "",
        "These are the entries currently in the catalog for your territory.",
        "Default choice: fold new work into one of these. Only propose an",
        "`add` if the new work is a genuinely new capability by the Section 1",
        "test.",
        "",
        "```json",
        json.dumps({"capabilities": terr_caps, "mechanisms": terr_mechs}, indent=2, ensure_ascii=False),
        "```",
        "",
        "---",
        "",
        "## Gold-standard examples (voice calibration)",
        "",
        "Match this voice. Read them for tone, not content.",
        "",
        "```json",
        json.dumps(gold, indent=2, ensure_ascii=False),
        "```",
        "",
        "---",
        "",
        f"## Commits since `{built_from[:8]}` ({len(commits)})",
        "",
    ]

    for c in commits:
        parts.append(f"### `{c['short']}`  {c['date'][:10]}  — {c['subject']}")
        parts.append("")
        parts.append("Files touched:")
        parts.append(_fmt_files(c["files"]))
        parts.append("")

    parts += [
        "---",
        "",
        "## File changes in this territory (summary)",
        "",
        f"**Added** ({len(changes['added'])}):",
        _fmt_files(changes["added"]),
        "",
        f"**Modified** ({len(changes['modified'])}):",
        _fmt_files(changes["modified"]),
        "",
        f"**Deleted** ({len(changes['deleted'])}):",
        _fmt_files(changes["deleted"]),
        "",
        f"**Renamed** ({len(changes['renamed'])}):",
        _fmt_files(changes["renamed"]),
        "",
        "---",
        "",
        DELTA_CONTRACT.replace("PROPOSED_PATH", f"`{proposed_path}`"),
        "",
        "---",
        "",
        "## Deletions to consider marking abandoned",
        "",
        "For each deleted file, check if it appears in any current entry's",
        "`surfaces`. If ALL of an entry's surfaces have been deleted, mark it",
        "`abandoned` with evidence citing the deletion commit(s).",
    ]

    os.makedirs(brief_dir, exist_ok=True)
    with open(brief_path, "w", encoding="utf-8") as f:
        f.write("\n".join(parts))
    return brief_path


# ---------------------------------------------------------------------------
# delta application
# ---------------------------------------------------------------------------

def apply_deltas(caps: list[dict], deltas: list[dict]) -> tuple[list[dict], list[str], list[str]]:
    """Apply the collected deltas to the raw capabilities.

    Returns (new_caps, warnings, changelog).
    """
    by_id = {c["id"]: dict(c) for c in caps}
    warnings: list[str] = []
    changelog: list[str] = []

    for d in deltas:
        terr = d.get("territory", "?")

        for entry in d.get("mark_abandoned", []):
            cid = entry["id"]
            reason = entry.get("reason", "no reason given")
            if cid not in by_id:
                warnings.append(f"[{terr}] mark_abandoned: id {cid!r} not found")
                continue
            by_id[cid]["status"] = "abandoned"
            by_id[cid]["status_evidence"] = f"{by_id[cid].get('status_evidence','')} | Marked abandoned in refresh: {reason}"
            changelog.append(f"[{terr}] abandoned  {cid}  — {reason}")

        for entry in d.get("update", []):
            cid = entry["id"]
            reason = entry.get("reason", "")
            if cid not in by_id:
                warnings.append(f"[{terr}] update: id {cid!r} not found")
                continue
            for field, value in entry.get("changes", {}).items():
                by_id[cid][field] = value
            changelog.append(f"[{terr}] updated    {cid}  — {reason}")

        for entry in d.get("add", []):
            cid = entry.get("id")
            if not cid:
                warnings.append(f"[{terr}] add: entry missing id")
                continue
            if cid in by_id:
                warnings.append(f"[{terr}] add: id {cid!r} already exists (merged as update)")
                by_id[cid].update({k: v for k, v in entry.items() if k not in _DERIVED_CAP})
            else:
                by_id[cid] = {k: v for k, v in entry.items() if k not in _DERIVED_CAP}
                by_id[cid].setdefault("territory", terr)
                changelog.append(f"[{terr}] added      {cid}  — {entry.get('name', '?')}")

    return list(by_id.values()), warnings, changelog


# ---------------------------------------------------------------------------
# top-level modes
# ---------------------------------------------------------------------------

def cmd_scan(cfg: dict, catalog: dict) -> dict:
    """Compute what's changed since built_from. Print summary."""
    built_from = catalog.get("built_from_commit")
    if not built_from:
        raise SystemExit("catalog has no built_from_commit — cannot compute delta")
    head = head_sha()
    if built_from == head:
        return {"built_from": built_from, "head": head, "no_op": True,
                "commits": [], "by_territory": {}}

    commits = commits_since(built_from)
    changes = changed_files(built_from)
    by_terr_files = group_changes_by_territory(cfg, changes)
    by_terr_commits = group_commits_by_territory(cfg, commits, by_terr_files)

    # Union of territories touched by either files or commits
    territories = sorted(set(by_terr_files) | set(by_terr_commits))

    summary = {
        "built_from": built_from,
        "head": head,
        "no_op": False,
        "commits": commits,
        "by_territory": {
            t: {
                "files": by_terr_files.get(t, {"added": [], "modified": [], "deleted": [], "renamed": [], "all": []}),
                "commits": by_terr_commits.get(t, []),
            } for t in territories
        },
    }
    return summary


def _print_scan(summary: dict) -> None:
    if summary["no_op"]:
        print(f"✅  Catalog is at HEAD ({summary['head'][:8]}). Nothing to refresh.")
        return
    print(f"Range: {summary['built_from'][:8]} → {summary['head'][:8]}")
    print(f"Commits: {len(summary['commits'])}")
    print(f"Territories touched: {len(summary['by_territory'])}")
    print()
    for terr, info in sorted(summary["by_territory"].items(),
                              key=lambda kv: -len(kv[1]["commits"])):
        n_c = len(info["commits"])
        f = info["files"]
        print(f"  {terr:32s}  {n_c:3d} commits, "
              f"+{len(f['added'])} ~{len(f['modified'])} -{len(f['deleted'])} R{len(f['renamed'])}")


def cmd_prep(cfg: dict, catalog: dict, brief_dir: str) -> list[str]:
    """Write briefs for each affected territory."""
    summary = cmd_scan(cfg, catalog)
    if summary["no_op"]:
        print("No-op: catalog is at HEAD.")
        return []

    with open(CURATION_PATH, "r", encoding="utf-8") as f:
        curation = f.read()

    raw_caps, raw_mechs = raw_records(catalog)

    os.makedirs(brief_dir, exist_ok=True)
    written: list[str] = []

    for territory, info in summary["by_territory"].items():
        terr_caps = caps_for_territory(raw_caps, territory)
        terr_mechs = mechs_for_territory(raw_mechs, territory)
        # Gold examples from same layer as the most common layer in the territory
        if terr_caps:
            layers = [c.get("layer") for c in terr_caps]
            top_layer = max(set(layers), key=layers.count)
        else:
            top_layer = None
        gold = gold_examples_for_layer(raw_caps, top_layer or "", limit=2) if top_layer else []

        brief_path = write_brief(
            brief_dir=brief_dir,
            territory=territory,
            curation=curation,
            terr_caps=terr_caps,
            terr_mechs=terr_mechs,
            commits=info["commits"],
            changes=info["files"],
            gold=gold,
            built_from=summary["built_from"],
            head=summary["head"],
        )
        written.append(brief_path)

    return written


def _load_proposals(brief_dir: str) -> list[dict]:
    proposals = []
    if not os.path.isdir(brief_dir):
        return proposals
    for name in sorted(os.listdir(brief_dir)):
        if not name.endswith(".proposed.json"):
            continue
        path = os.path.join(brief_dir, name)
        try:
            with open(path, "r", encoding="utf-8") as f:
                proposals.append(json.load(f))
        except Exception as e:
            print(f"WARN: could not parse {path}: {e}", file=sys.stderr)
    return proposals


def cmd_merge(cfg: dict, catalog: dict, brief_dir: str, apply: bool = False) -> dict:
    proposals = _load_proposals(brief_dir)
    if not proposals:
        raise SystemExit(f"No .proposed.json files found in {brief_dir}. "
                         f"Run --prep first, then dispatch an agent per brief.")

    raw_caps, raw_mechs = raw_records(catalog)
    new_caps, warnings, changelog = apply_deltas(raw_caps, proposals)

    new_catalog = mc.merge(new_caps, raw_mechs)
    new_catalog["stories"] = catalog.get("stories", [])
    new_catalog["gaps"] = catalog.get("gaps", [])
    new_catalog["built_from_commit"] = head_sha()
    new_catalog["built_at"] = dt.datetime.now(dt.timezone.utc).isoformat()

    result = {
        "old_counts": catalog["counts"],
        "new_counts": new_catalog["counts"],
        "changelog": changelog,
        "delta_warnings": warnings,
        "merge_warnings": new_catalog["warnings"],
        "applied": False,
    }

    if apply:
        with open(CATALOG_PATH, "w", encoding="utf-8") as f:
            json.dump(new_catalog, f, indent=2, ensure_ascii=False)
            f.write("\n")
        with open(MARKDOWN_PATH, "w", encoding="utf-8") as f:
            f.write(rm.render(new_catalog))
            f.write("\n")
        # Regenerate the viewer HTML into a scratch path for later --deploy.
        viewer_path = os.path.join(brief_dir, "ziggy-capability-catalog.html")
        build_viewer.build(CATALOG_PATH, TEMPLATE_PATH, viewer_path)
        result["applied"] = True
        result["viewer_path"] = viewer_path

    return result


def cmd_deploy(brief_dir: str) -> None:
    viewer_path = os.path.join(brief_dir, "ziggy-capability-catalog.html")
    if not os.path.exists(viewer_path):
        raise SystemExit(f"viewer not built yet — run --merge --apply first "
                         f"(expected: {viewer_path})")

    if not os.path.isdir(JEFF_DIR):
        raise SystemExit(f"jeff repo not found at {JEFF_DIR}")

    shutil.copyfile(viewer_path, JEFF_STATIC)
    print(f"copied viewer → {JEFF_STATIC}")

    # Commit in Jeff.
    subprocess.run(["git", "add", "jeff/static/ziggy-capability-catalog.html"],
                   cwd=JEFF_DIR, check=True)
    diff = subprocess.run(["git", "diff", "--cached", "--quiet"],
                          cwd=JEFF_DIR).returncode
    if diff == 0:
        print("no changes to commit in jeff (viewer bytes identical)")
    else:
        subprocess.run(["git", "commit", "-q", "-m",
                        "chore(catalog): refresh Ziggy capability viewer"],
                       cwd=JEFF_DIR, check=True)
        print("committed refresh in jeff")

    print("deploying to fly...")
    subprocess.run(["fly", "deploy"], cwd=JEFF_DIR, check=True)
    print("✅  deployed")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _brief_dir_for(head: str) -> str:
    return f"/tmp/catalog-refresh-{head[:12]}"


def cmd_status(catalog: dict) -> None:
    """Compare what's on disk vs. what Jeff is actually serving.

    Useful sanity check after a refresh: if the local catalog moved forward
    but nobody redeployed Jeff, this surfaces the drift in one line.
    """
    local_built = (catalog.get("built_from_commit") or "")[:12]
    local_caps = catalog["counts"]["capabilities"]
    head = head_sha()[:12]

    print(f"local catalog:  built@{local_built}  "
          f"({local_caps} capabilities)")
    print(f"repo HEAD:      {head}")
    if local_built == head:
        print("                ✅  catalog is at HEAD")
    else:
        # Count commits between
        try:
            behind = git("rev-list", "--count", f"{local_built}..HEAD").strip()
            print(f"                ⚠   catalog is {behind} commit(s) behind HEAD "
                  "— run --prep")
        except subprocess.CalledProcessError:
            print("                ⚠   cannot compute delta (unknown built_from)")

    # Now what's live on Jeff?
    try:
        import urllib.request
        with urllib.request.urlopen(JEFF_LIVE_URL, timeout=10) as r:
            live = json.loads(r.read().decode("utf-8"))
        live_built = (live.get("built_from_commit") or "")[:12]
        live_caps = live.get("counts", {}).get("capabilities", len(live.get("capabilities", [])))
        print(f"live on Jeff:   built@{live_built}  "
              f"({live_caps} capabilities)")
        if live_built == local_built:
            print("                ✅  Jeff matches local")
        else:
            print(f"                ⚠   Jeff is showing an older build — "
                  f"run --deploy to publish local")
    except Exception as e:  # noqa: BLE001
        print(f"live on Jeff:   ❌  could not fetch ({e})")


def main() -> int:
    p = argparse.ArgumentParser(description="Incremental catalog refresh.")
    p.add_argument("--prep", action="store_true", help="Write per-territory briefs.")
    p.add_argument("--merge", action="store_true", help="Merge agent proposals (dry-run without --apply).")
    p.add_argument("--apply", action="store_true", help="With --merge: actually write the new catalog + MD + HTML.")
    p.add_argument("--deploy", action="store_true", help="Copy HTML to Jeff and `fly deploy`.")
    p.add_argument("--status", action="store_true", help="Compare local catalog against what Jeff is serving.")
    p.add_argument("--brief-dir", default=None,
                   help="Override the brief directory (default: /tmp/catalog-refresh-<HEAD>).")
    args = p.parse_args()

    with open(CATALOG_PATH, "r", encoding="utf-8") as f:
        catalog = json.load(f)
    cfg = bt.load_config(CONFIG_PATH)

    head = head_sha()
    brief_dir = args.brief_dir or _brief_dir_for(head)

    if args.status:
        cmd_status(catalog)
        return 0

    if args.deploy and not (args.merge or args.apply):
        # Sugar: --deploy alone means "the working viewer at brief_dir is what to ship".
        cmd_deploy(brief_dir)
        return 0

    if args.prep:
        written = cmd_prep(cfg, catalog, brief_dir)
        if not written:
            return 0
        print(f"\n📄  {len(written)} brief(s) written to {brief_dir}/")
        for w in written:
            print(f"    {w}")
        print()
        print("Next: for each brief, dispatch an agent (Claude Code or subagent tool)")
        print("with the brief as its prompt. Each agent writes back to:")
        print(f"    {brief_dir}/<territory>.proposed.json")
        print()
        print("Then: python3 scripts/catalog/refresh.py --merge")
        return 0

    if args.merge:
        result = cmd_merge(cfg, catalog, brief_dir, apply=args.apply)
        print("=== changelog ===")
        for line in result["changelog"] or ["(no capability changes)"]:
            print(f"  {line}")
        print()
        print("=== counts ===")
        print(f"  before: {result['old_counts']}")
        print(f"  after:  {result['new_counts']}")
        if result["delta_warnings"]:
            print()
            print("=== delta warnings ===")
            for w in result["delta_warnings"]:
                print(f"  {w}")
        mw = result["merge_warnings"]
        interesting = {k: v for k, v in mw.items() if v}
        if interesting:
            print()
            print("=== merge warnings ===")
            for k, v in interesting.items():
                print(f"  {k}: {len(v) if isinstance(v, list) else v}")
                if isinstance(v, list):
                    for item in v[:5]:
                        print(f"    {item}")
        if result["applied"]:
            print(f"\n✅  wrote {CATALOG_PATH}, {MARKDOWN_PATH}, and {result['viewer_path']}")
            if args.deploy:
                cmd_deploy(brief_dir)
        else:
            print("\n(dry run — pass --apply to write files)")
        return 0

    # No mode: default = scan
    summary = cmd_scan(cfg, catalog)
    _print_scan(summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
