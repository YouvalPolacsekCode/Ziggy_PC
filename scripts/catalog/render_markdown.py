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


def _value_stories_section(stories, lines):
    lines.append("## Value Stories")
    lines.append("")
    for story in stories:
        lines.append(f"### {story['title']}")
        lines.append("")
        lines.append(story["blurb"])
        lines.append("")
        for cap_id in story.get("capability_ids", []):
            lines.append(f"- `{cap_id}`")
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

    stories = catalog.get("stories")
    if stories:
        _value_stories_section(stories, lines)

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
