"""Selectors — the "which resources / which capabilities" half of a grant.

A grant targets resources and capabilities by *pattern*, never by hardcoded
enum. A single grant can therefore say "all cameras tagged ``outdoor`` in
building B" or "every ``light.*`` verb in the kids' room". Selectors also return
a **specificity score**, which conflict resolution uses to decide that a
device-level deny beats a room-level allow.

Matcher forms
-------------
Resource matchers::

    "*"                                   # everything
    {"resource": "device:lock_1"}         # exact id (self OR ancestor ⇒ inherit)
    {"node": "space:home_42"}             # alias of resource
    {"descendant_of": "space:building_b"} # anywhere under a subtree
    {"type": "room"}                      # space.type (self or ancestor)
    {"class": "lock"}                     # device.class
    {"tag": "outdoor"}                    # tag on self or an ancestor
    {"attr": {"key": "floor", "value": 2}}

Capability matchers::

    "*"
    {"key": "lock.unlock"}                # exact
    {"key": "light.*"}                    # fnmatch glob
    {"scope_tag": "security"}
    {"risk_tier": "high"}

A selector is a single matcher, or ``{"any_of": [...]}`` (OR, score = max) or
``{"all_of": [...]}`` (AND, score = sum — more constraints ⇒ more specific).
``None`` means "match nothing" for safety (a grant with no target grants
nothing), while ``"*"`` is the explicit "everything".
"""
from __future__ import annotations

import fnmatch
from typing import Any

from .capabilities import CapabilityDef
from .resources import ResolvedResource

NO_MATCH = -1  # specificity sentinel: this selector did not match at all

# Base specificity by matcher kind. Multiplied by 10 and adjusted by ancestor
# distance so a precise self-match always outranks a coarse ancestor-match.
_RES_BASE = {
    "exact": 100,   # resource/node id
    "attr": 80,
    "tag": 70,
    "class": 60,
    "type": 40,
    "descendant_of": 30,
    "wildcard": 0,
}
_CAP_BASE = {
    "exact": 100,
    "glob": 50,
    "scope_tag": 40,
    "risk_tier": 30,
    "wildcard": 0,
}


# ---------------------------------------------------------------------------
# Resource selectors
# ---------------------------------------------------------------------------

def match_resource(selector: Any, res: ResolvedResource) -> int:
    """Return specificity (>= 0) if ``selector`` matches ``res``, else NO_MATCH."""
    if selector is None:
        return NO_MATCH
    if selector == "*":
        return _RES_BASE["wildcard"] * 10
    if isinstance(selector, dict) and "any_of" in selector:
        scores = [match_resource(m, res) for m in selector["any_of"]]
        scores = [s for s in scores if s != NO_MATCH]
        return max(scores) if scores else NO_MATCH
    if isinstance(selector, dict) and "all_of" in selector:
        scores = [match_resource(m, res) for m in selector["all_of"]]
        if any(s == NO_MATCH for s in scores) or not scores:
            return NO_MATCH
        return sum(scores)
    return _match_res_atom(selector, res)


def _match_res_atom(m: Any, res: ResolvedResource) -> int:
    if not isinstance(m, dict):
        return NO_MATCH

    # id match — self or any ancestor (this is what makes inheritance work)
    if "resource" in m or "node" in m:
        target = m.get("resource") or m.get("node")
        for dist, node in res.chain():
            if node.id == target:
                return _RES_BASE["exact"] * 10 - dist
        return NO_MATCH

    if "descendant_of" in m:
        target = m["descendant_of"]
        # self is not its own descendant; check ancestors only
        for anc in res.ancestors:
            if anc.id == target:
                return _RES_BASE["descendant_of"] * 10
        return NO_MATCH

    if "type" in m:
        for dist, node in res.chain():
            if node.type_or_class == m["type"] and node.kind == "space":
                return _RES_BASE["type"] * 10 - dist
        return NO_MATCH

    if "class" in m:
        # device class only lives on the self node (devices are leaves)
        if res.self_node.kind == "device" and res.self_node.type_or_class == m["class"]:
            return _RES_BASE["class"] * 10
        return NO_MATCH

    if "tag" in m:
        for dist, node in res.chain():
            if m["tag"] in node.tags:
                return _RES_BASE["tag"] * 10 - dist
        return NO_MATCH

    if "attr" in m:
        spec = m["attr"]
        key, val = spec.get("key"), spec.get("value")
        for dist, node in res.chain():
            if node.attr_dict.get(key) == val:
                return _RES_BASE["attr"] * 10 - dist
        return NO_MATCH

    return NO_MATCH


# ---------------------------------------------------------------------------
# Capability selectors
# ---------------------------------------------------------------------------

def match_capability(selector: Any, cap: CapabilityDef) -> int:
    if selector is None:
        return NO_MATCH
    if selector == "*":
        return _CAP_BASE["wildcard"] * 10
    if isinstance(selector, dict) and "any_of" in selector:
        scores = [match_capability(m, cap) for m in selector["any_of"]]
        scores = [s for s in scores if s != NO_MATCH]
        return max(scores) if scores else NO_MATCH
    if isinstance(selector, dict) and "all_of" in selector:
        scores = [match_capability(m, cap) for m in selector["all_of"]]
        if any(s == NO_MATCH for s in scores) or not scores:
            return NO_MATCH
        return sum(scores)
    return _match_cap_atom(selector, cap)


def _match_cap_atom(m: Any, cap: CapabilityDef) -> int:
    if not isinstance(m, dict):
        return NO_MATCH
    if "key" in m:
        pat = m["key"]
        if any(ch in pat for ch in "*?["):
            return _CAP_BASE["glob"] * 10 if fnmatch.fnmatchcase(cap.key, pat) else NO_MATCH
        return _CAP_BASE["exact"] * 10 if cap.key == pat else NO_MATCH
    if "scope_tag" in m:
        return _CAP_BASE["scope_tag"] * 10 if m["scope_tag"] in cap.scope_tags else NO_MATCH
    if "risk_tier" in m:
        return _CAP_BASE["risk_tier"] * 10 if cap.risk_tier.value == m["risk_tier"] else NO_MATCH
    return NO_MATCH


# ---------------------------------------------------------------------------
# Validation (write path)
# ---------------------------------------------------------------------------

_RES_KEYS = {"resource", "node", "descendant_of", "type", "class", "tag", "attr"}
_CAP_KEYS = {"key", "scope_tag", "risk_tier"}


def validate_resource_selector(sel: Any) -> None:
    _validate_selector(sel, _RES_KEYS, "resource")


def validate_capability_selector(sel: Any) -> None:
    _validate_selector(sel, _CAP_KEYS, "capability")


def _validate_selector(sel: Any, atom_keys: set[str], label: str) -> None:
    if sel is None or sel == "*":
        return
    if isinstance(sel, dict) and ("any_of" in sel or "all_of" in sel):
        key = "any_of" if "any_of" in sel else "all_of"
        members = sel[key]
        if not isinstance(members, list) or not members:
            raise ValueError(f"{label} selector {key!r} must be a non-empty list")
        for m in members:
            _validate_selector(m, atom_keys, label)
        return
    if not isinstance(sel, dict) or len(sel) != 1:
        raise ValueError(f"{label} matcher must be a single-key object, got {sel!r}")
    (k,) = sel.keys()
    if k not in atom_keys:
        raise ValueError(f"unknown {label} matcher key {k!r}")
