"""Phase A: deterministic partition of the corpus into product territories."""

import json
import os
import re


def load_config(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


# Glob -> compiled regex, keyed by pattern string. Patterns repeat across
# ~1,100 files x ~18 territories, so compiling once per unique pattern (not
# once per call) matters.
_PATTERN_CACHE = {}


def _compile_glob(pat):
    """Translate a glob into an anchored regex with path-segment-aware semantics.

    Unlike Python's stdlib `fnmatch` (whose `*` becomes regex `.*` and freely
    crosses "/"), these globs are path-aware:
      - "**/"            -> zero or more complete path segments
      - "**" (elsewhere)  -> anything, including "/"
      - "*"               -> anything within a single path segment (no "/")
      - "?"               -> one non-separator character
      - anything else     -> escaped literally
    """
    i, n = 0, len(pat)
    out = ["^"]
    while i < n:
        if pat.startswith("**/", i):
            out.append("(?:[^/]*/)*")
            i += 3
        elif pat.startswith("**", i):
            out.append(".*")
            i += 2
        elif pat[i] == "*":
            out.append("[^/]*")
            i += 1
        elif pat[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(pat[i]))
            i += 1
    out.append("$")
    return re.compile("".join(out))


def _pattern(pat):
    rx = _PATTERN_CACHE.get(pat)
    if rx is None:
        rx = _compile_glob(pat)
        _PATTERN_CACHE[pat] = rx
    return rx


def _matches_any(rel_path, patterns):
    return any(_pattern(pat).match(rel_path) for pat in patterns)


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
            name = assign_territory(rel, cfg, root=root_key)
            if name is None:
                # assign_territory() returns None for both excluded paths and
                # genuinely-uncovered ones; only the latter belong in the
                # unassigned report, so disambiguate here instead of guarding
                # every iteration up front (that guard duplicated the exclude
                # check assign_territory already does internally).
                if not is_excluded(rel, cfg):
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
