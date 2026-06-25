"""
Ziggy Pro Mode designer (Session D3).

Takes a natural-language outcome ("set up smart bedroom lights") and produces
a structured bundle of automations + sensors + state flags + voice intents
that achieves it, using the user's actual home (D2) and Ziggy's actual
capabilities (D1).

The LLM is constrained to a JSON bundle schema — see _SYSTEM_PROMPT_TMPL.
Prefers pre-validated blueprints when one matches the outcome cleanly,
falls back to dynamic composition otherwise.

User-facing rule: NEVER mentions "Home Assistant" / "HA" / integration names.
Gaps surface as Ziggy-native "I can't currently do that" wording sourced from
automation_catalog.get_gaps().
"""
from __future__ import annotations
import json
import re
import uuid
from typing import Optional

from integrations.llm_gateway import chat_completion
from services.automation_catalog import get_supported_only, get_gaps
from services.home_context import load_home_context
from core.logger_module import log_info, log_error


# Detect Hebrew text by Unicode block range (U+05D0 – U+05EA covers the alphabet).
_HEBREW_RANGE_LO = "א"
_HEBREW_RANGE_HI = "ת"


def _is_hebrew(text: str) -> bool:
    return any(_HEBREW_RANGE_LO <= c <= _HEBREW_RANGE_HI for c in (text or ""))


_SYSTEM_PROMPT_TMPL = """You are Ziggy's Pro Mode designer. The user has described an outcome they want for their smart home. Your job: design a complete bundle of automations, sensors, state flags, and voice intents that achieves that outcome.

# RULES (non-negotiable)
1. Use ONLY capabilities marked ziggy_supported=true or "partial" in the catalog below. Never invent shapes outside the catalog.
2. PREFER pre-validated blueprints from the "blueprints" list when one matches the outcome cleanly. They include Hebrew translations, Israeli defaults, and constructs (wait_for_trigger, choose) that direct create_automation can't currently emit.
3. Compose multi-artifact bundles when the outcome calls for it: occupancy_sensor + 2-4 automations + KV state flag + voice intent. Don't return a single automation when the user asked for "smart bedroom" — they want the whole orchestra.
4. NEVER mention "Home Assistant", "HA", integration brand names, or technical entity_ids in user-facing fields (name, rationale, friendly_name, voice phrases). Use Ziggy-native voice throughout.
5. If the user's outcome needs something Ziggy can't currently do, return an empty artifacts object and set decline to a Ziggy-native explanation. Use the catalog.gaps decline_message_he when the user typed Hebrew, decline_message_en otherwise.
6. Default to Israeli home patterns: 24°C AC, 5-min motion timeouts, RTL Hebrew when the user typed Hebrew.
7. Every entity_id you reference (in triggers, conditions, actions, occupancy_sensor sources, blueprint inputs) MUST appear verbatim in the home_context.rooms[].entities lists. Do NOT invent entity_ids by guessing room slug + entity type (e.g. NEVER write "binary_sensor.bedroom_motion" unless that exact string appears in the home context). If a room is missing the entity type you'd need, OMIT that artifact and explain the limitation in the rationale.
8. If a room lacks suitable source sensors for an occupancy_sensor (no motion / presence / door entity), OMIT the occupancy_sensors entry entirely — don't add one with empty sensors[]. Note the limitation in the rationale instead.
9. INTERPRETING "ENTER" / "LEAVE": when the user says "I enter the bedroom", "someone walks in", "כשאני נכנס לחדר", they almost always mean MOTION-SENSOR activation in that room — NOT a person-arriving-home zone trigger. Use a state trigger on the room's motion/presence/door entity. Only treat as a zone trigger when the user explicitly mentions "home", "the house", "arrive home", "leave home", "מגיע הביתה", "יוצא מהבית".
10. DECLINE vs DEGRADE: set "decline" ONLY when you cannot produce ANY useful artifacts (the entire outcome is blocked). If you can fulfil PART of the outcome but some piece is impossible, leave decline=null, build what you can, and explain the limitation in the rationale ("Lights and presence work; sleep mode toggle requires manual setup for now").
11. Output STRICT JSON matching the schema below. No prose, no markdown fences, no commentary outside the JSON object.

# BUNDLE SCHEMA
{{
  "name": "<short display name in the user's language>",
  "rationale": "<1-2 sentence why-this-makes-sense, for the review card>",
  "language": "en" or "he",
  "decline": null or "<Ziggy-native explanation if blocked>",
  "artifacts": {{
    "occupancy_sensors": [
      {{"room": "<room slug from home context>", "sensors": ["<entity_id>", ...], "friendly_name": "<display name>"}}
    ],
    "kv_state": [
      {{"namespace": "modes", "key": "<flag>", "default": false}}
    ],
    "automations": [
      {{
        "name": "<short name in user's language>",
        "source": "blueprint" or "custom",
        "blueprint": {{"id": "<bp_id>", "inputs": {{"<key>": "<value>", ...}}}},
        "trigger": {{"type": "<from catalog>", ...}},
        "conditions": [{{"entity_id": "...", "operator": "is|is_not|above|below", "value": "..."}}],
        "actions": [{{"type": "call_service", "entity_id": "...", "service": "turn_on|turn_off|..."}}],
        "mode": "single|restart|queued|parallel"
      }}
    ],
    "voice_intents": [
      {{"phrase": "<short voice command>", "action_description": "<what should happen>"}}
    ]
  }}
}}

When source=blueprint, include "blueprint" but OMIT trigger/conditions/actions/mode (the blueprint defines them).
When source=custom, include trigger/conditions/actions/mode but OMIT "blueprint".

# CAPABILITY CATALOG (what you can build — only use these)
{capability_catalog_json}

# THE USER'S HOME (use these real entities, rooms, blueprints)
{home_context_json}

The user's outcome request follows in the user message. Return the bundle JSON now.
"""


def design_bundle(outcome: str, language: Optional[str] = None) -> dict:
    """Design an automation bundle for the user's outcome.

    Returns:
      {"ok": True, "bundle": {...}}                 — success
      {"ok": False, "error": "...", "bundle"?: {}}  — failure (LLM error / schema / etc.)

    The bundle's `bundle_id` is stamped here and re-used at apply time so the
    frontend can correlate preview → accept.
    """
    if not outcome or not outcome.strip():
        return {"ok": False, "error": "No outcome provided."}

    lang = language or ("he" if _is_hebrew(outcome) else "en")

    try:
        catalog = get_supported_only()
        # Gaps surface separately so the LLM can craft a Ziggy-native decline if blocked
        catalog["gaps"] = get_gaps()
        home = load_home_context(lang)
    except Exception as e:
        log_error(f"[designer] context build failed: {e}")
        return {"ok": False, "error": "Could not load home context."}

    system_prompt = _SYSTEM_PROMPT_TMPL.format(
        capability_catalog_json=json.dumps(catalog, ensure_ascii=False),
        home_context_json=json.dumps(home, ensure_ascii=False),
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": outcome.strip()},
    ]

    try:
        resp = chat_completion(
            "automation_design",
            messages,
            temperature=0.2,   # low creativity → schema consistency
            max_tokens=3000,
            timeout=45,
        )
    except Exception as e:
        log_error(f"[designer] LLM call failed: {e}")
        return {"ok": False, "error": "The designer is temporarily unavailable."}

    raw = ""
    try:
        raw = resp.choices[0].message.content or ""
    except Exception as e:
        log_error(f"[designer] unexpected response shape: {e}")
        return {"ok": False, "error": "Designer returned an unexpected response."}

    if not raw:
        return {"ok": False, "error": "Designer returned empty response."}

    # Strip ```json``` fences if the model added them despite instructions
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw).strip()

    try:
        bundle = json.loads(raw)
    except json.JSONDecodeError as e:
        log_error(f"[designer] non-JSON response: {raw[:300]}")
        return {"ok": False, "error": "Designer returned invalid JSON.", "raw_preview": raw[:300]}

    validation_err = _validate_bundle(bundle)
    if validation_err:
        log_error(f"[designer] validation failed: {validation_err}")
        return {"ok": False, "error": validation_err, "bundle": bundle}

    # Belt-and-suspenders: even with the "never invent entity IDs" prompt
    # rule, gpt-4o occasionally hallucinates plausible-sounding entities
    # (e.g. binary_sensor.bedroom_motion when bedroom has no motion sensor).
    # Walk the bundle and drop any artifact referencing entities that don't
    # exist in the home context. A bundle reduced to nothing becomes a
    # decline so the user sees an honest "I can't fully do that" message.
    hallucinated = _strip_hallucinated_entities(bundle, home)
    if hallucinated:
        log_error(f"[designer] dropped {len(hallucinated)} hallucinated entity refs: {hallucinated[:5]}")
        # If everything was hallucinated, convert to a soft decline
        artifacts = bundle.get("artifacts") or {}
        if not any(artifacts.get(k) for k in ("automations", "occupancy_sensors", "kv_state", "voice_intents")):
            decline_msg = (
                "אני עדיין לא יכול להגדיר אוטומציה כזו — לא מצאתי חיישנים מתאימים בחדר."
                if lang == "he"
                else "I can't currently set up this automation — the room doesn't have the sensors I need."
            )
            bundle["decline"] = decline_msg

    # Stamp a bundle_id (frontend uses it as the preview→accept handle)
    bundle["bundle_id"] = bundle.get("bundle_id") or f"bundle_{uuid.uuid4().hex[:12]}"
    bundle["language"] = bundle.get("language") or lang

    artifacts = bundle.get("artifacts") or {}
    counts = {k: len(v) for k, v in artifacts.items() if isinstance(v, list)}
    log_info(f"[designer] bundle={bundle['bundle_id']} lang={lang} counts={counts}")
    return {"ok": True, "bundle": bundle}


def _collect_real_entity_ids(home: dict) -> set[str]:
    """Walk home_context and return every entity_id the LLM is allowed to reference."""
    ids: set[str] = set()
    for room in (home.get("rooms") or []):
        ents = room.get("entities") or {}
        for bucket, items in ents.items():
            if not isinstance(items, list):
                continue
            for e in items:
                if isinstance(e, dict) and e.get("entity_id"):
                    ids.add(e["entity_id"])
        occ = room.get("occupancy_sensor")
        if isinstance(occ, dict) and occ.get("entity_id"):
            ids.add(occ["entity_id"])
    return ids


def _strip_hallucinated_entities(bundle: dict, home: dict) -> list[str]:
    """Mutate bundle in place: drop artifacts that reference entity_ids the
    home doesn't have. Returns the list of dropped entity_ids for logging.

    Conservative: a single bad reference inside an artifact drops the whole
    artifact (we can't safely "fix" a broken trigger or action).
    """
    real = _collect_real_entity_ids(home)
    if not real:
        return []   # empty home — nothing to validate against

    artifacts = bundle.get("artifacts") or {}
    dropped: list[str] = []

    # Occupancy sensors: every source sensor must be real
    kept_occ = []
    for s in (artifacts.get("occupancy_sensors") or []):
        bad = [eid for eid in (s.get("sensors") or []) if eid not in real]
        if bad:
            dropped.extend(bad)
        else:
            kept_occ.append(s)
    artifacts["occupancy_sensors"] = kept_occ

    # Automations: walk trigger.entity_id, conditions[].entity_id, actions[].entity_id
    kept_autos = []
    for a in (artifacts.get("automations") or []):
        bad: list[str] = []
        trig = a.get("trigger") or {}
        tid = trig.get("entity_id")
        if tid and tid not in real:
            bad.append(tid)
        for c in (a.get("conditions") or []):
            cid = (c or {}).get("entity_id")
            if cid and cid not in real:
                bad.append(cid)
        for ac in (a.get("actions") or []):
            aid = (ac or {}).get("entity_id")
            if aid and aid not in real:
                bad.append(aid)
        # Also check blueprint inputs that look like entity references
        bp = a.get("blueprint") or {}
        for k, v in (bp.get("inputs") or {}).items():
            if isinstance(v, str) and "." in v and v.count(".") == 1:
                if v not in real:
                    bad.append(v)
        if bad:
            dropped.extend(bad)
        else:
            kept_autos.append(a)
    artifacts["automations"] = kept_autos

    return dropped


def _validate_bundle(bundle: dict) -> Optional[str]:
    """Return None if the bundle structurally passes, error string otherwise.

    Validation is intentionally lightweight — the executor will surface
    per-artifact failures with full context. We just catch obvious shape
    problems early so we don't try to execute garbage.
    """
    if not isinstance(bundle, dict):
        return "Bundle is not a JSON object."

    # A declined bundle (Ziggy chose not to design — e.g. unsupported capability) is valid.
    if bundle.get("decline"):
        return None

    artifacts = bundle.get("artifacts")
    if not isinstance(artifacts, dict):
        return "Bundle missing 'artifacts' object."

    for key in ("occupancy_sensors", "kv_state", "automations", "voice_intents"):
        if key in artifacts and not isinstance(artifacts[key], list):
            return f"artifacts.{key} must be a list."

    for i, a in enumerate(artifacts.get("automations") or []):
        if not isinstance(a, dict):
            return f"automations[{i}] is not an object."
        if not a.get("name"):
            return f"automations[{i}] missing name."
        src = a.get("source")
        if src not in ("blueprint", "custom"):
            return f"automations[{i}].source must be 'blueprint' or 'custom'."
        if src == "blueprint":
            bp = a.get("blueprint") or {}
            if not bp.get("id"):
                return f"automations[{i}].blueprint.id is required."
        else:
            trig = a.get("trigger") or {}
            if not trig.get("type"):
                return f"automations[{i}].trigger.type is required for source=custom."

    # occupancy_sensors with missing/empty data are silently dropped here —
    # the LLM sometimes proposes them for rooms that lack source sensors.
    # We don't fail the whole bundle; we just filter the bad entries.
    valid_sensors = [
        s for s in (artifacts.get("occupancy_sensors") or [])
        if isinstance(s, dict) and s.get("room") and s.get("sensors")
    ]
    artifacts["occupancy_sensors"] = valid_sensors

    return None
