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
