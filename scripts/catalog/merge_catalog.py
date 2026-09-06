"""Phase E support: validate, dedupe, apply the stopping rule, derive edges."""

import re

from scripts.catalog import schema

LIST_FIELDS = ("uses", "surfaces", "entry_points", "tests", "known_gaps")
ANGLE_RANK = {"code": 0, "history": 0, "reconciled": 1}


def validate_record(rec, sch):
    errors = []
    for field in sch["required"]:
        if field not in rec or rec[field] in (None, ""):
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
