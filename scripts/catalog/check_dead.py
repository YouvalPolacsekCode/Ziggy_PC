"""Dead-code check for the capability catalog.

For each capability, verify that at least one file in `surfaces` still exists
in `git ls-files`. A live capability whose entire surface footprint is gone
is a lie in the catalog — a user asks "does Ziggy do X?" and we say yes even
though the code was deleted three weeks ago.

This check is free and mechanical: no LLM, no fetches. Run it as a pre-commit
hook or in CI. If it exits 1, run `refresh.py` to update the catalog before
committing.

Handles the two repos Ziggy spans (ziggy_pc + ziggy_mobile) via
`catalog.config.json` roots, normalises surface paths, and skips non-file
surfaces (e.g. "Settings → Music") with a warning rather than a fatal.

Usage:
    python3 scripts/catalog/check_dead.py
    python3 scripts/catalog/check_dead.py --json          # machine-readable
    python3 scripts/catalog/check_dead.py --catalog PATH  # non-default catalog

Exit codes:
    0 — every live-status capability has at least one existing surface
    1 — one or more live-status capabilities have ZERO existing surfaces
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LIVE_STATUSES = {"live-prod", "canary-only", "flagged"}

# A surface with none of these hints is non-file (e.g. "Settings → Music",
# "Wall dashboard"). We warn rather than fatal on those — they may still
# describe a real feature location, just not a code path.
FILE_HINTS = (".py", ".js", ".jsx", ".ts", ".tsx", ".html", ".css",
              ".md", ".yaml", ".yml", ".json", ".sh", ".swift", ".kt",
              ".java", ".mjs", ".xml", ".toml")


def load_config() -> dict:
    with open(os.path.join(REPO, "catalog.config.json"), "r", encoding="utf-8") as f:
        return json.load(f)


def tracked_files(root: str) -> set[str]:
    if not os.path.isdir(root):
        return set()
    out = subprocess.run(
        ["git", "ls-files"], cwd=root, capture_output=True, text=True, check=False
    )
    if out.returncode != 0:
        return set()
    return set(out.stdout.splitlines())


def looks_like_file(surface: str) -> bool:
    return any(surface.endswith(h) for h in FILE_HINTS) or "/" in surface


def resolve_surface(surface: str, roots: dict[str, set[str]]) -> tuple[str, bool]:
    """Return (root_key, exists).

    root_key is the repo the surface belongs to ("ziggy_pc", "ziggy_mobile",
    or "unknown"). exists is True iff the surface can be located in that repo.
    """
    # Explicit root prefix wins.
    for key, tracked in roots.items():
        prefix = key + "/"
        if surface.startswith(prefix):
            rel = surface[len(prefix):]
            return key, rel in tracked

    # Otherwise assume the primary repo. Ziggy_pc is the default.
    primary = "ziggy_pc" if "ziggy_pc" in roots else next(iter(roots), "ziggy_pc")
    return primary, surface in roots.get(primary, set())


def check(catalog: dict, roots: dict[str, set[str]]) -> dict:
    dead_but_live: list[dict] = []
    already_dead: list[dict] = []
    partial: list[dict] = []
    non_file_only: list[dict] = []

    for cap in catalog.get("capabilities", []):
        surfaces = [s for s in cap.get("surfaces", []) if s]
        if not surfaces:
            continue

        existing, missing, nonfile = [], [], []
        for s in surfaces:
            if not looks_like_file(s):
                nonfile.append(s)
                continue
            _, ok = resolve_surface(s, roots)
            (existing if ok else missing).append(s)

        entry = {
            "id": cap["id"],
            "name": cap["name"],
            "status": cap["status"],
            "layer": cap.get("layer"),
            "surfaces_total": len(surfaces),
            "surfaces_existing": existing,
            "surfaces_missing": missing,
            "surfaces_non_file": nonfile,
        }

        # If every surface is non-file, this is a catalog-quality issue,
        # not a dead-code one.
        if not existing and not missing and nonfile:
            non_file_only.append(entry)
            continue

        if not existing:
            (dead_but_live if cap["status"] in LIVE_STATUSES else already_dead).append(entry)
        elif missing:
            partial.append(entry)

    return {
        "dead_but_live_status": dead_but_live,
        "already_marked_dead": already_dead,
        "partial": partial,
        "non_file_only": non_file_only,
    }


def _fmt_report(result: dict, total: int, tracked_totals: dict[str, int]) -> str:
    dead = result["dead_but_live_status"]
    lines = [
        f"Checked {total} capabilities against:",
    ]
    for k, n in tracked_totals.items():
        lines.append(f"  {k}: {n} tracked files")

    if dead:
        lines += ["", f"❌  {len(dead)} live-status capability(s) with ZERO existing surfaces:",
                  "    (These claim to ship but their code is gone. Mark `abandoned` on next refresh.)", ""]
        for d in dead:
            lines.append(f"  {d['id']}  [{d['status']}]  {d['name']}")
            for s in d["surfaces_missing"][:5]:
                lines.append(f"     gone: {s}")
            if len(d["surfaces_missing"]) > 5:
                lines.append(f"     … and {len(d['surfaces_missing']) - 5} more")
    else:
        lines += ["", "✅  No live-status capability is missing all its surfaces."]

    if result["already_marked_dead"]:
        lines += ["", f"ℹ  {len(result['already_marked_dead'])} already-dead capability(s) whose surfaces are also gone (informational):"]
        for d in result["already_marked_dead"]:
            lines.append(f"  {d['id']}  [{d['status']}]  {d['name']}")

    if result["partial"]:
        lines += ["", f"⚠  {len(result['partial'])} capability(s) with some (not all) surfaces missing:",
                  "    (Not fatal — but a refresh should decide whether the missing files were replaced or lost.)"]
        for p in result["partial"][:12]:
            n_missing = len(p["surfaces_missing"])
            n_total = p["surfaces_total"]
            lines.append(f"  {p['id']}  [{p['status']}]  {n_missing}/{n_total} missing  — {p['name']}")
        if len(result["partial"]) > 12:
            lines.append(f"  … and {len(result['partial']) - 12} more (use --json for the full list)")

    if result["non_file_only"]:
        lines += ["", f"⚠  {len(result['non_file_only'])} capability(s) whose surfaces are ALL non-file entries:",
                  "    (Catalog-quality issue — surfaces should be file paths. Fix on next refresh.)"]
        for p in result["non_file_only"]:
            lines.append(f"  {p['id']}  [{p['status']}]  surfaces: {p['surfaces_non_file']}")

    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Catalog dead-code check.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    parser.add_argument(
        "--catalog",
        default=os.path.join(REPO, "docs/capability-catalog.json"),
        help="Path to the catalog JSON.",
    )
    args = parser.parse_args()

    if not os.path.exists(args.catalog):
        print(f"catalog not found: {args.catalog}", file=sys.stderr)
        return 2

    with open(args.catalog, "r", encoding="utf-8") as f:
        catalog = json.load(f)

    cfg = load_config()
    roots = {key: tracked_files(path) for key, path in cfg["roots"].items()}
    tracked_totals = {k: len(v) for k, v in roots.items()}

    result = check(catalog, roots)

    if args.json:
        result["checked"] = len(catalog.get("capabilities", []))
        result["tracked_totals"] = tracked_totals
        result["fatal"] = len(result["dead_but_live_status"])
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(_fmt_report(
            result,
            total=len(catalog.get("capabilities", [])),
            tracked_totals=tracked_totals,
        ))

    return 1 if result["dead_but_live_status"] else 0


if __name__ == "__main__":
    sys.exit(main())
