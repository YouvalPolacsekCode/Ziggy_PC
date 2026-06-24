"""
Blueprint importer — parse Home Assistant Blueprint YAML files and surface
them as Ziggy automation templates.

Why this exists
---------------
HA Blueprints are the community ecosystem's "outcome → automation template"
mechanism. Thousands of proven patterns live at
https://community.home-assistant.io/c/blueprints-exchange/53. Rather than
re-inventing a Ziggy-specific format, this importer consumes HA's native
blueprint YAML directly, so users can drop in any community blueprint and
have it become a Ziggy template.

Security boundary
-----------------
Blueprints are NEVER fetched from the internet at runtime. Only two sources
are supported:
  1. Pre-bundled blueprints under services/bundled_blueprints/ (shipped
     with Ziggy)
  2. User-pasted YAML strings (already on their machine; the LLM tool layer
     can hand them to load_user_blueprint)

A malicious blueprint at worst creates an automation in HA — same blast
radius as anything the user can already do via the wizard.

Data shape
----------
Each blueprint YAML looks roughly like:
    blueprint:
      name: Motion-activated Light
      description: Turn on a light when motion is detected, off after a delay.
      domain: automation
      input:
        motion_entity:
          name: Motion sensor
          selector:
            entity:
              domain: binary_sensor
        light_target:
          name: Light
          selector:
            entity:
              domain: light
        no_motion_wait:
          name: No-motion wait time
          default: 120
          selector:
            number: { min: 0, max: 3600, unit_of_measurement: seconds }
    trigger:
      platform: state
      entity_id: !input motion_entity
      to: "on"
    action:
      - service: light.turn_on
        target:
          entity_id: !input light_target
      - delay: "00:00:{{ no_motion_wait }}"
      - service: light.turn_off
        target:
          entity_id: !input light_target

The `!input` tag is HA-specific. We parse it with a custom yaml.SafeLoader
constructor so it round-trips through Python as a small marker class
(InputRef), which substitute_inputs() then resolves at instantiation time.

Ziggy-facing contract
---------------------
After parsing, each blueprint exposes:
  - id          stable identifier (file stem for bundled, slug of name for user-pasted)
  - name        translated/clarified Ziggy-native name
  - description plain-language description (HA jargon stripped at the template layer)
  - inputs      list of {key, name, description, selector_kind, default, required}
                — wizard-renderable; uses "options" wording in the UI, never "input"
  - source      "bundled" | "user"
  - he          optional Hebrew override block {name, description, inputs:{key: label_he}}

When the user fills in the inputs, instantiate_blueprint() substitutes them
into the trigger/condition/action blocks and returns an HA-shaped automation
dict that save_automation() can persist directly. We deliberately keep the
HA shape (platform/service/target) because save_automation already knows how
to round-trip HA-native blocks.
"""
from __future__ import annotations

import re
import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import yaml

from core.logger_module import log_info, log_error


# ── Custom YAML loader for HA's !input tag ───────────────────────────────────


class InputRef:
    """Marker for an unresolved `!input <key>` placeholder in a blueprint."""

    __slots__ = ("key",)

    def __init__(self, key: str):
        self.key = key

    def __repr__(self) -> str:
        return f"InputRef({self.key!r})"

    def __eq__(self, other: object) -> bool:
        return isinstance(other, InputRef) and other.key == self.key

    def __hash__(self) -> int:
        return hash(("InputRef", self.key))


class _BlueprintLoader(yaml.SafeLoader):
    """SafeLoader subclass that understands HA's `!input` tag."""


def _input_constructor(loader: yaml.Loader, node: yaml.Node) -> InputRef:
    if not isinstance(node, yaml.ScalarNode):
        # HA only ever emits scalar !input keys; defensively bail out.
        raise yaml.YAMLError(f"!input expects a scalar key, got {type(node).__name__}")
    key = loader.construct_scalar(node)  # type: ignore[arg-type]
    if not isinstance(key, str) or not key.strip():
        raise yaml.YAMLError("!input requires a non-empty string key")
    return InputRef(key.strip())


_BlueprintLoader.add_constructor("!input", _input_constructor)


# ── Parsed blueprint data model ──────────────────────────────────────────────


@dataclass
class BlueprintInput:
    """One declared input variable from a blueprint."""

    key:            str
    name:           str
    description:    str = ""
    default:        Any = None
    required:       bool = True
    selector_kind:  str = "text"       # "entity" | "number" | "time" | "boolean" | "text" | "select"
    selector_meta:  dict = field(default_factory=dict)
    name_he:        str = ""           # Hebrew translation, optional

    def to_dict(self) -> dict:
        return {
            "key":           self.key,
            "name":          self.name,
            "name_he":       self.name_he,
            "description":   self.description,
            "default":       self.default,
            "required":      self.required,
            "selector_kind": self.selector_kind,
            "selector_meta": self.selector_meta,
        }


@dataclass
class Blueprint:
    """A parsed HA blueprint, ready to surface as a Ziggy template."""

    id:                str
    name:              str
    description:       str
    inputs:            list[BlueprintInput]
    raw_body:          dict             # the trigger/condition/action half, with !input refs intact
    source:            str              # "bundled" | "user"
    name_he:           str = ""
    description_he:    str = ""
    category:          str = "blueprint"
    icon:              str = "🧩"
    tags:              list[str] = field(default_factory=list)
    # Israeli/Hebrew first-class — defaults can be tuned per blueprint via the
    # bundled YAML's `ziggy:` block. Read at parse time.
    israel_defaults:   dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "id":              self.id,
            "name":            self.name,
            "name_he":         self.name_he,
            "description":     self.description,
            "description_he":  self.description_he,
            "category":        self.category,
            "icon":            self.icon,
            "tags":            self.tags,
            "source":          self.source,
            "inputs":          [i.to_dict() for i in self.inputs],
            "israel_defaults": self.israel_defaults,
        }


# ── Parse / load ─────────────────────────────────────────────────────────────


def _parse_input_selector(selector: Any) -> tuple[str, dict]:
    """Turn HA's selector dict into a (kind, meta) pair the wizard can render.

    HA's selector format is `{ <kind>: { ...options } }`, e.g.
    `{entity: {domain: light}}` or `{number: {min: 0, max: 100}}`.
    Unknown selectors fall back to the generic "text" input — the wizard
    can still let the user paste a value.
    """
    if not isinstance(selector, dict) or not selector:
        return "text", {}
    # The selector dict carries exactly one key — the selector kind.
    kind, meta = next(iter(selector.items()))
    if not isinstance(meta, dict):
        meta = {}
    return str(kind), meta


def _parse_inputs(input_block: Any, he_block: Optional[dict] = None) -> list[BlueprintInput]:
    """Convert the blueprint's `input:` dict (or HA's newer `input.sections`
    nested form) into a flat list of BlueprintInput.

    The newer "sections" form looks like:
        input:
          group1:
            input:
              key_a: { ... }
              key_b: { ... }
    We flatten it; section grouping is purely UI-level in HA and our wizard
    presents one flat form anyway.
    """
    if not input_block:
        return []
    if not isinstance(input_block, dict):
        return []

    he_block = he_block or {}
    he_inputs = he_block.get("inputs") if isinstance(he_block, dict) else {}
    if not isinstance(he_inputs, dict):
        he_inputs = {}

    out: list[BlueprintInput] = []

    def _consume(key: str, spec: Any) -> None:
        if not isinstance(spec, dict):
            return
        # Recursive section flattening.
        nested = spec.get("input")
        if isinstance(nested, dict) and "selector" not in spec:
            for sub_key, sub_spec in nested.items():
                _consume(sub_key, sub_spec)
            return

        sel_kind, sel_meta = _parse_input_selector(spec.get("selector"))
        default = spec.get("default")
        # HA convention: a key is required when no `default` is supplied.
        required = "default" not in spec
        out.append(BlueprintInput(
            key=key,
            name=str(spec.get("name") or key.replace("_", " ").title()),
            description=str(spec.get("description") or "").strip(),
            default=default,
            required=required,
            selector_kind=sel_kind,
            selector_meta=sel_meta,
            name_he=str(he_inputs.get(key) or "").strip(),
        ))

    for key, spec in input_block.items():
        _consume(str(key), spec)
    return out


def parse_blueprint_yaml(text: str, *, source: str, fallback_id: Optional[str] = None) -> Blueprint:
    """Parse a blueprint YAML string into a Blueprint.

    Raises ValueError on malformed input — callers (the bundled loader, the
    REST endpoint, the LLM tool) wrap this with a friendly Ziggy-native
    error message; the raw HA-jargon errors NEVER leak to end users.
    """
    if not text or not text.strip():
        raise ValueError("Blueprint is empty.")

    try:
        doc = yaml.load(text, Loader=_BlueprintLoader)
    except yaml.YAMLError as e:
        # Pyyaml's message embeds an "<unicode string>" filename which leaks
        # implementation detail. Strip it; the line/column part is still useful.
        msg = str(e).replace('"<unicode string>"', "the template").replace("<unicode string>", "the template")
        raise ValueError(f"Template is malformed: {msg}") from e

    if not isinstance(doc, dict):
        raise ValueError("Blueprint must be a YAML mapping (key: value structure).")

    bp = doc.get("blueprint")
    if not isinstance(bp, dict):
        raise ValueError("Blueprint is missing the top-level 'blueprint:' block.")

    domain = bp.get("domain")
    if domain != "automation":
        # Script blueprints exist in HA but we don't have a target surface for
        # them in Ziggy yet — refuse them politely instead of half-supporting.
        raise ValueError(
            f"Only automation blueprints are supported (got '{domain or 'unknown'}'). "
            "Script blueprints aren't supported yet."
        )

    name = str(bp.get("name") or "").strip()
    if not name:
        raise ValueError("Blueprint is missing a name.")

    description = str(bp.get("description") or "").strip()

    # Optional Ziggy-native enrichment block. Lets bundled blueprints carry
    # Hebrew strings, a curated icon/category, and Israeli defaults without
    # polluting the HA-standard fields.
    ziggy_meta = bp.get("ziggy") if isinstance(bp.get("ziggy"), dict) else {}
    he_block = ziggy_meta.get("he") if isinstance(ziggy_meta.get("he"), dict) else {}

    inputs = _parse_inputs(bp.get("input"), he_block=he_block)

    # The body is everything OUTSIDE the `blueprint:` block — trigger, condition,
    # action, mode, max, variables, etc. We keep it intact (with !input refs)
    # and resolve substitutions at instantiation time.
    raw_body = {k: v for k, v in doc.items() if k != "blueprint"}

    bp_id = str(bp.get("id") or fallback_id or _slug(name))

    # English name stays the primary user-facing string (Ziggy is bilingual;
    # the frontend picks name vs name_he based on locale). Hebrew override
    # is stashed alongside.
    return Blueprint(
        id=bp_id,
        name=name,
        description=description,
        inputs=inputs,
        raw_body=raw_body,
        source=source,
        name_he=str(he_block.get("name") or "").strip(),
        description_he=str(he_block.get("description") or "").strip(),
        category=str(ziggy_meta.get("category") or "blueprint"),
        icon=str(ziggy_meta.get("icon") or "🧩"),
        tags=list(ziggy_meta.get("tags") or []),
        israel_defaults=dict(ziggy_meta.get("israel_defaults") or {}),
    )


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return s or uuid.uuid4().hex[:8]


# ── Bundled blueprint registry ───────────────────────────────────────────────


BUNDLED_DIR = Path(__file__).resolve().parent / "bundled_blueprints"


_BLUEPRINT_CACHE: dict[str, Blueprint] = {}
_CACHE_LOADED = False


def _load_bundled() -> None:
    """Read every *.yaml file under BUNDLED_DIR into _BLUEPRINT_CACHE.

    Idempotent — only re-reads the directory the first time it's called.
    Bundled blueprints ship with the repo; their file mtimes don't matter
    at runtime. To force a reload (e.g. after editing during dev), call
    reload_bundled().
    """
    global _CACHE_LOADED
    if _CACHE_LOADED:
        return
    _CACHE_LOADED = True

    if not BUNDLED_DIR.exists():
        log_info(f"[blueprints] Bundled directory missing: {BUNDLED_DIR}")
        return

    for path in sorted(BUNDLED_DIR.glob("*.yaml")):
        try:
            text = path.read_text(encoding="utf-8")
            bp = parse_blueprint_yaml(text, source="bundled", fallback_id=path.stem)
            _BLUEPRINT_CACHE[bp.id] = bp
        except Exception as e:
            # A single bad bundled blueprint must NOT take down the whole
            # template library. Log and continue.
            log_error(f"[blueprints] Failed to parse bundled {path.name}: {e}")

    log_info(f"[blueprints] Loaded {len(_BLUEPRINT_CACHE)} bundled blueprints")


def reload_bundled() -> None:
    """Force a re-read of the bundled directory. Used by tests and dev."""
    global _CACHE_LOADED
    _CACHE_LOADED = False
    _BLUEPRINT_CACHE.clear()
    _load_bundled()


def list_blueprints() -> list[Blueprint]:
    """Return all known blueprints (bundled + any user-loaded session ones)."""
    _load_bundled()
    return list(_BLUEPRINT_CACHE.values())


def get_blueprint(blueprint_id: str) -> Optional[Blueprint]:
    _load_bundled()
    return _BLUEPRINT_CACHE.get(blueprint_id)


def load_user_blueprint(text: str) -> Blueprint:
    """Parse and register a user-supplied blueprint YAML string.

    Returns the parsed Blueprint. The blueprint is added to the in-process
    registry under source="user" so subsequent list_blueprints / get_blueprint
    calls see it. It is NOT persisted to disk — user blueprints live for the
    process lifetime; if the user wants permanence, the operator can drop
    the file into services/bundled_blueprints/.

    This intentional non-persistence keeps the security surface tiny: we
    never write user-supplied YAML to a path that can later be auto-loaded
    without explicit operator action.
    """
    _load_bundled()
    bp = parse_blueprint_yaml(text, source="user")
    # If a user-supplied blueprint collides with a bundled ID, salt the user
    # one so the bundled version stays the canonical reference.
    if bp.id in _BLUEPRINT_CACHE and _BLUEPRINT_CACHE[bp.id].source == "bundled":
        bp.id = f"{bp.id}_user_{uuid.uuid4().hex[:6]}"
    _BLUEPRINT_CACHE[bp.id] = bp
    log_info(f"[blueprints] Loaded user blueprint '{bp.name}' ({bp.id})")
    return bp


# ── Instantiation: blueprint + inputs → HA automation dict ───────────────────


def _substitute(node: Any, inputs: dict) -> Any:
    """Walk the blueprint body, replacing every InputRef with the matching
    user-supplied value. Unsupplied inputs without defaults are flagged
    upstream by validate_inputs; here we keep their key as a literal so a
    save_automation downstream surfaces a meaningful failure.
    """
    if isinstance(node, InputRef):
        if node.key in inputs:
            return inputs[node.key]
        # Falls through unchanged — caller validated already.
        return f"!input {node.key}"
    if isinstance(node, dict):
        return {k: _substitute(v, inputs) for k, v in node.items()}
    if isinstance(node, list):
        return [_substitute(v, inputs) for v in node]
    if isinstance(node, str):
        # HA also supports `{{ input_key }}` Jinja-style refs inside string
        # values (e.g. `delay: "00:00:{{ no_motion_wait }}"`). Substitute
        # them too — minus a Jinja engine, since blueprints only ever
        # reference input keys here.
        def repl(m: re.Match) -> str:
            key = m.group(1).strip()
            if key in inputs and inputs[key] is not None:
                return str(inputs[key])
            return m.group(0)
        return re.sub(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}", repl, node)
    return node


def validate_inputs(bp: Blueprint, inputs: dict) -> tuple[bool, list[str]]:
    """Return (ok, missing_required_keys).

    Wording note: callers translate missing-key reports into Ziggy-native
    phrasing — never expose raw key names to the end user without the
    blueprint's human `name` field.
    """
    missing = []
    for inp in bp.inputs:
        if inp.required and (inp.key not in inputs or inputs[inp.key] in (None, "")):
            missing.append(inp.key)
    return (len(missing) == 0), missing


def instantiate_blueprint(blueprint_id: str, inputs: dict, *, name: Optional[str] = None) -> dict:
    """Resolve a blueprint + user inputs into an HA-shaped automation dict
    that services.ha_automations.save_automation can persist directly.

    The returned dict carries:
      - name, description    (Ziggy-native, never HA jargon)
      - triggers / actions / conditions / mode (HA-native; save_automation
        will pass them through)
      - blueprint_meta       { id, source } for traceability — surfaces in
                              the Active tab so the user can see "made from
                              the Motion Light template" without leaking the
                              word "blueprint" if we choose.

    Raises ValueError when validation fails. The router/handler layers
    translate this into a Ziggy-native error string.
    """
    bp = get_blueprint(blueprint_id)
    if not bp:
        raise ValueError(f"Template not found: {blueprint_id}")

    ok, missing = validate_inputs(bp, inputs)
    if not ok:
        # Friendly: show the *labels* of the missing inputs, not their raw keys.
        labels = []
        by_key = {i.key: i for i in bp.inputs}
        for k in missing:
            inp = by_key.get(k)
            labels.append(inp.name if inp else k)
        raise ValueError(f"Please fill in: {', '.join(labels)}.")

    # Defaults — fill in any unsupplied optional inputs from the blueprint's
    # `default:` so the substitution pass sees a complete map.
    full_inputs = {}
    for inp in bp.inputs:
        if inp.key in inputs and inputs[inp.key] not in (None, ""):
            full_inputs[inp.key] = inputs[inp.key]
        elif inp.default is not None:
            full_inputs[inp.key] = inp.default
        # Else: leave it out; substitution will leave a literal placeholder
        # that downstream HA will reject — surfaced as a 502 from
        # save_automation.

    resolved = _substitute(bp.raw_body, full_inputs)

    # HA blueprint bodies use either singular ("trigger") or plural
    # ("triggers") keys; both are valid. Normalise to the plural form that
    # save_automation expects after Session A. For now we pass them through
    # under the keys HA uses and let save_automation / HA's REST layer accept
    # either — Ziggy's _trigger_to_ha + _action_to_ha already understand
    # HA-shaped dicts.
    triggers = resolved.get("triggers") or resolved.get("trigger") or []
    if isinstance(triggers, dict):
        triggers = [triggers]
    actions = resolved.get("actions") or resolved.get("action") or []
    if isinstance(actions, dict):
        actions = [actions]
    conditions = resolved.get("conditions") or resolved.get("condition") or []
    if isinstance(conditions, dict):
        conditions = [conditions]

    # save_automation expects Ziggy-shaped trigger/action/condition objects.
    # Blueprint bodies are HA-shaped — we translate the minimum subset we
    # need so the round-trip succeeds. Anything we can't translate goes
    # through as-is; the HA REST API will accept HA-native blocks via the
    # `ziggy_native_ha_body` escape hatch (handled in save_automation by the
    # `ha_native_body` key — see below).
    ziggy_trigger = _ha_trigger_to_ziggy_first(triggers)
    ziggy_actions = _ha_actions_to_ziggy(actions)
    ziggy_conditions = _ha_conditions_to_ziggy(conditions)

    automation_name = name or bp.name
    automation_desc = (
        f"Created from the '{bp.name}' template. "
        f"{bp.description.splitlines()[0] if bp.description else ''}"
    ).strip()

    payload = {
        "name":         automation_name,
        "description":  automation_desc,
        "trigger":      ziggy_trigger,
        "conditions":   ziggy_conditions,
        "actions":      ziggy_actions,
        "rooms":        [],
        # Provenance, not surfaced as "blueprint" in the UI — the frontend
        # renders it as "Made from <bp.name>".
        "blueprint_meta": {
            "id":     bp.id,
            "source": bp.source,
            "name":   bp.name,
        },
        # Escape hatch: full HA-native body, so save_automation can fall
        # back to the raw HA dict for blocks Ziggy doesn't yet model
        # (choose:, repeat:, etc.). Consumers that don't recognise the key
        # ignore it harmlessly.
        "ha_native_body": {
            "triggers":   triggers,
            "conditions": conditions,
            "actions":    actions,
            "mode":       resolved.get("mode", "single"),
        },
    }
    return payload


# ── HA-shaped → Ziggy-shaped translation helpers ─────────────────────────────
#
# These convert the trigger / action / condition blocks parsed out of a
# blueprint into the simplified Ziggy shapes that services.ha_automations
# already understands. We only translate the cases the existing handlers
# cover; anything else is left empty and the ha_native_body fallback above
# carries the original blocks through.


def _ha_trigger_to_ziggy_first(triggers: list) -> dict:
    if not triggers:
        return {}
    t = triggers[0]
    if not isinstance(t, dict):
        return {}
    platform = t.get("platform") or t.get("trigger") or "time"
    if platform == "time":
        at = t.get("at", "08:00")
        if isinstance(at, str) and len(at) >= 5:
            at = at[:5]
        return {"type": "time", "time": str(at)}
    if platform == "state":
        eid = t.get("entity_id", "")
        if isinstance(eid, list):
            eid = eid[0] if eid else ""
        out: dict = {"type": "state", "entity_id": str(eid), "state": str(t.get("to", "on"))}
        # HA's `for:` survives through the Session A `for_minutes` plumbing —
        # if blueprint uses it, hand it across.
        for_block = t.get("for")
        if isinstance(for_block, dict):
            mins = int(for_block.get("minutes", 0)) + int(for_block.get("hours", 0)) * 60
            secs = int(for_block.get("seconds", 0))
            if secs and not mins:
                mins = max(1, secs // 60)
            if mins:
                out["for_minutes"] = mins
        elif isinstance(for_block, str):
            # "HH:MM:SS" format
            parts = for_block.split(":")
            if len(parts) == 3:
                try:
                    out["for_minutes"] = int(parts[0]) * 60 + int(parts[1])
                except ValueError:
                    pass
        return out
    if platform == "numeric_state":
        out = {"type": "numeric_state", "entity_id": str(t.get("entity_id", ""))}
        if t.get("above") is not None:
            out["above"] = t["above"]
        if t.get("below") is not None:
            out["below"] = t["below"]
        return out
    if platform == "sun":
        return {"type": str(t.get("event") or "sunrise"), "offset": str(t.get("offset", ""))}
    if platform == "zone":
        return {
            "type":      "zone",
            "entity_id": str(t.get("entity_id", "")),
            "zone":      str(t.get("zone", "zone.home")),
            "event":     str(t.get("event", "enter")),
        }
    # Unknown platform — leave empty; ha_native_body fallback carries it.
    return {}


def _ha_actions_to_ziggy(actions: list) -> list[dict]:
    out: list[dict] = []
    for a in actions or []:
        if not isinstance(a, dict):
            continue
        # service: domain.service [+ target / data]
        svc = a.get("service") or a.get("action")
        if isinstance(svc, str):
            target = a.get("target") or {}
            eid = target.get("entity_id") or a.get("entity_id") or ""
            if isinstance(eid, list):
                eid = eid[0] if eid else ""
            ziggy_action: dict = {
                "type":      "call_service",
                "entity_id": str(eid),
                "service":   svc,
            }
            data = a.get("data")
            if isinstance(data, dict):
                ziggy_action["service_data"] = data
            out.append(ziggy_action)
            continue
        # delay
        if "delay" in a:
            d = a["delay"]
            secs = 0
            if isinstance(d, str):
                parts = d.split(":")
                if len(parts) == 3:
                    try:
                        secs = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
                    except ValueError:
                        secs = 0
            elif isinstance(d, dict):
                secs = (
                    int(d.get("seconds", 0))
                    + int(d.get("minutes", 0)) * 60
                    + int(d.get("hours", 0)) * 3600
                )
            elif isinstance(d, (int, float)):
                secs = int(d)
            out.append({"type": "delay", "seconds": secs})
            continue
        # Anything else (choose, repeat, scene.turn_on with no service form …)
        # is skipped here; the ha_native_body fallback carries it through to
        # HA verbatim.
    return out


def _ha_conditions_to_ziggy(conditions: list) -> list[dict]:
    out: list[dict] = []
    for c in conditions or []:
        if not isinstance(c, dict):
            continue
        cond_type = c.get("condition")
        if cond_type == "state":
            eid = c.get("entity_id", "")
            if isinstance(eid, list):
                eid = eid[0] if eid else ""
            out.append({
                "entity_id": str(eid),
                "operator":  "is",
                "value":     str(c.get("state", "on")),
            })
        elif cond_type == "numeric_state":
            eid = c.get("entity_id", "")
            if isinstance(eid, list):
                eid = eid[0] if eid else ""
            if c.get("above") is not None:
                out.append({"entity_id": str(eid), "operator": "above", "value": str(c["above"])})
            if c.get("below") is not None:
                out.append({"entity_id": str(eid), "operator": "below", "value": str(c["below"])})
        elif cond_type == "time":
            time_cond: dict = {"type": "time"}
            if c.get("after"):
                time_cond["after"] = str(c["after"])[:5]
            if c.get("before"):
                time_cond["before"] = str(c["before"])[:5]
            if "after" in time_cond or "before" in time_cond:
                out.append(time_cond)
        # Unknown condition types fall through; ha_native_body preserves them.
    return out
