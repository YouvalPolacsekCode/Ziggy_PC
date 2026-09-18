"""
Ziggy's automation designer — an outcome in, a reviewable bundle out.

Takes a natural-language outcome ("make my living area smart", "תכין לי חדר
שינה חכם") and produces a bundle of RECIPES and custom automations that
achieves it, using the user's actual home (services.home_context) and only
the capabilities Ziggy can really build (services.automation_catalog, whose
support flags are computed from the converters).

The contract since 2026-09-18 — the closed loop:
  * Anything the designer says, Ziggy can build. Recipes first (Smart Room,
    Motion Light, Welcome Home, Leave Home); raw rules only for what no
    recipe covers, composed only from catalog primitives.
  * Modes are a FIXED set (sleep, movie, cleaning, guest, vacation). The
    designer conditions on them and flips them; it never invents a flag.
  * Buttons and arrivals/departures are in vocabulary (controller trigger;
    the welcome_home / leave_home recipes on Ziggy's presence engine).
  * Whatever it cannot do goes in `left_out`, in the catalog's own decline
    words, and the preview says so. No voice-intent artifacts, no flags,
    no notify-only rules, no tautologies, no reaching into rooms the user
    didn't name — services.bundle_lint enforces the last four after the model.

User-facing rule: NEVER mentions "Home Assistant" / "HA" / integration names.
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


_HEBREW_RANGE_LO = "א"
_HEBREW_RANGE_HI = "ת"


def _is_hebrew(text: str) -> bool:
    return any(_HEBREW_RANGE_LO <= c <= _HEBREW_RANGE_HI for c in (text or ""))


_SYSTEM_PROMPT_TMPL = """You are Ziggy's automation designer. The user described an outcome they want for their smart home. Design a bundle that achieves it — recipes first, custom rules only where no recipe fits — and say plainly what you left out.

# RULES (non-negotiable)
1. RECIPES FIRST. These are tested, deterministic bundles. Use one whenever it fits:
   - smart_room(room): lights follow who is in the room (bright by day, warm/dim at night, off when empty, never on a sleeping person). Use for "make <room> smart", "automate the <room> lights".
   - motion_light(room, lights?, sensors?, brightness_pct?, linger_minutes?, night_only?): light on when someone walks in, off after the room goes still. Use for a kitchen / hallway / bathroom that just needs motion lighting.
   - welcome_home(lights, only_after_dark?): lights on when a household member ARRIVES home (phone location). Use for "when I get home", "כשאני מגיע הביתה".
   - leave_home(quiet_minutes?, ac?, notify?): everything off once everyone has LEFT and the whole house has been still. Use for "when we leave", "when nobody's home", "כשכולם יוצאים".
   Compose custom automations ONLY for what no recipe covers (a button, a schedule, a threshold, a mode flip).
2. Use ONLY the triggers / conditions / actions in the capability catalog below. Never invent a shape.
3. MODES ARE FIXED: sleep, movie, cleaning, guest, vacation. Condition on them with {{"type": "mode", "mode": "...", "is": true|false}} and flip them with {{"type": "set_mode", "mode": "...", "on": true|false, "hours": <optional>}}. NEVER invent a flag, a variable, a "manual override" store or a "paused" state — those do not exist. Motion lighting already stays off in sleep/movie mode and "off when empty" already pauses in cleaning mode; a manual off is already remembered by Ziggy (a light a person switched off stays off until the room empties). Do NOT build rules for those; they are built in.
4. BUTTONS: a wireless switch / remote is in home_context.controllers with its controller_id and the exact action names it sends. Trigger with {{"type": "controller", "controller_id": "<id>", "action": "<action name>"}}. Bind presses to a light look (call_service turn_on with service_data brightness_pct), a mode (set_mode), or turn_off_all_lights.
5. Every entity_id you reference (triggers, conditions, actions, recipe lights, blueprint inputs) MUST appear verbatim in home_context.rooms[].entities. Never guess an id. If a room lacks what you need, OMIT that piece and put it in left_out.
6. SCOPE: act only on rooms the user named or the room a trigger belongs to. "Everything off" belongs to leave_home, not to a room rule.
7. Never restate a trigger as a condition. Never make a rule whose only action is a notification. Never add a notification that fires repeatedly on a routine event (a room emptying, motion).
8. OCCUPANCY IS PART OF EVERY ROOM. Do not create sensors; leave occupancy_sensors empty. "I enter the bedroom" / "כשאני נכנס" means the room's motion/presence sensor, NOT arriving home. Only "home" / "the house" / "מגיע הביתה" / "יוצא מהבית" mean arrival/departure — use the recipes for those.
9. Light turn_ons carry "respect_hold": true. Motion-driven "on" rules carry the sleep and movie mode conditions; "off when empty" rules carry the cleaning one. (Recipes do this for you.)
10. Israeli home defaults: 24°C, 5-minute motion windows, 24h clock. Hebrew when the user typed Hebrew: warm, short, dugri, gender-free by construction ("אפשר…", "כדאי…"), Ziggy in masculine first person, no technical words (no entity / טריגר / אינטגרציה).
11. If a piece of the outcome is impossible, put it in left_out using the matching decline text from catalog.gaps (Hebrew when the user typed Hebrew). Set "decline" ONLY when you can build nothing at all.
12. Output STRICT JSON matching the schema. No prose, no markdown fences.

# BUNDLE SCHEMA
{{
  "name": "<short display name in the user's language>",
  "rationale": "<1-2 sentences for the review card: what this will do>",
  "language": "en" or "he",
  "decline": null or "<Ziggy-native explanation if NOTHING can be built>",
  "artifacts": {{
    "recipes": [
      {{"recipe": "smart_room",   "room": "<room slug>"}},
      {{"recipe": "motion_light", "room": "<room slug>", "linger_minutes": 5}},
      {{"recipe": "welcome_home", "lights": ["<light entity_id>", ...], "only_after_dark": true}},
      {{"recipe": "leave_home",   "quiet_minutes": 30, "ac": true, "notify": true}}
    ],
    "automations": [
      {{
        "name": "<short name in the user's language>",
        "source": "custom",
        "trigger": {{"type": "<from catalog>", ...}},
        "conditions": [{{"type": "mode", "mode": "sleep", "is": false}}, {{"entity_id": "...", "operator": "is|is_not|above|below", "value": "..."}}, {{"type": "time", "after": "HH:MM", "before": "HH:MM"}}, {{"type": "sun", "after": "sunset"}}],
        "actions": [{{"type": "call_service", "entity_id": "...", "service": "turn_on|turn_off", "service_data": {{"brightness_pct": 40}}, "respect_hold": true}}, {{"type": "set_mode", "mode": "movie", "on": true, "hours": 2}}, {{"type": "turn_off_all_lights"}}],
        "mode": "single|restart|queued|parallel"
      }}
    ],
    "occupancy_sensors": []
  }},
  "left_out": [ {{"what": "<the part of the request>", "why": "<Ziggy-native reason>"}} ]
}}

# CAPABILITY CATALOG (what you can build — only use these)
{capability_catalog_json}

# THE USER'S HOME (real rooms, entities, controllers, people)
{home_context_json}

The user's outcome request follows in the user message. Return the bundle JSON now.
"""

_RECIPES = ("smart_room", "motion_light", "welcome_home", "leave_home")


def _rooms_mentioned(outcome: str, home: dict) -> set[str]:
    """Room slugs named in the outcome, English or Hebrew."""
    text = (outcome or "").lower()
    found: set[str] = set()
    slugs = [str(r.get("id") or "").lower() for r in (home.get("rooms") or []) if r.get("id")]
    try:
        from core.agent.directory import room_he
    except Exception:
        room_he = None  # type: ignore
    for slug in slugs:
        en = slug.replace("_", " ")
        if en and en in text:
            found.add(slug)
            continue
        if room_he:
            he = room_he(slug) or ""
            if he and he in text:
                found.add(slug)
                continue
        # a room's own Hebrew name from home context (user-named rooms)
        for r in home.get("rooms") or []:
            if str(r.get("id") or "").lower() == slug:
                for key in ("name_he", "name"):
                    v = str(r.get(key) or "").lower()
                    if v and v in text:
                        found.add(slug)
    # "living area" / "אזור המגורים" → living room + kitchen + dining
    if "living area" in text or "אזור המגורים" in text:
        for s in ("living_room", "kitchen", "dining_room"):
            if s in slugs:
                found.add(s)
    return found


def design_bundle(outcome: str, language: Optional[str] = None) -> dict:
    """Design an automation bundle for the user's outcome.

    Returns:
      {"ok": True, "bundle": {...}}                 — success (may carry left_out / decline)
      {"ok": False, "error": "...", "bundle"?: {}}  — LLM / schema failure
    """
    if not outcome or not outcome.strip():
        return {"ok": False, "error": "No outcome provided."}

    lang = language or ("he" if _is_hebrew(outcome) else "en")

    try:
        catalog = get_supported_only()
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
            "automation_design", messages,
            temperature=0.1, max_tokens=1800, timeout=45,
            response_format={"type": "json_object"},
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

    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-zA-Z]*\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw).strip()
    try:
        bundle = json.loads(raw)
    except json.JSONDecodeError:
        log_error(f"[designer] non-JSON response: {raw[:300]}")
        return {"ok": False, "error": "Designer returned invalid JSON.", "raw_preview": raw[:300]}

    return finalize_bundle(bundle, outcome=outcome, home=home, lang=lang)


def finalize_bundle(bundle: dict, *, outcome: str, home: dict, lang: str) -> dict:
    """Validate, strip hallucinations, lint, stamp. Pure apart from logging —
    split from design_bundle so tests can drive it without an LLM."""
    validation_err = _validate_bundle(bundle)
    if validation_err:
        log_error(f"[designer] validation failed: {validation_err}")
        return {"ok": False, "error": validation_err, "bundle": bundle}

    hallucinated = _strip_hallucinated_entities(bundle, home)
    if hallucinated:
        log_error(f"[designer] dropped {len(hallucinated)} hallucinated entity refs: {hallucinated[:5]}")

    from services.bundle_lint import lint
    allowed = _rooms_mentioned(outcome, home)
    bundle, notes = lint(bundle, home, allowed_rooms=allowed or None)

    left_out = [x for x in (bundle.get("left_out") or []) if isinstance(x, dict) and x.get("what")]
    for n in notes:
        left_out.append({"what": n["what"], "why": n["why"]})
    bundle["left_out"] = left_out

    artifacts = bundle.get("artifacts") or {}
    if not any(artifacts.get(k) for k in ("recipes", "automations", "occupancy_sensors")):
        if not bundle.get("decline"):
            bundle["decline"] = (
                "אני עדיין לא יכול להגדיר את זה — לא מצאתי בבית את מה שצריך בשביל זה."
                if lang == "he" else
                "I can't set this up yet — the home doesn't have what I'd need for it."
            )

    bundle["bundle_id"] = bundle.get("bundle_id") or f"bundle_{uuid.uuid4().hex[:12]}"
    bundle["language"] = bundle.get("language") or lang
    counts = {k: len(v) for k, v in artifacts.items() if isinstance(v, list)}
    log_info(f"[designer] bundle={bundle['bundle_id']} lang={lang} counts={counts} left_out={len(left_out)}")
    return {"ok": True, "bundle": bundle}


def _collect_real_entity_ids(home: dict) -> set[str]:
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
    """Drop artifacts that reference entity_ids the home doesn't have.
    Conservative: one bad reference drops the whole artifact. Recipe light
    lists are filtered rather than dropped (the recipe declines if empty)."""
    real = _collect_real_entity_ids(home)
    if not real:
        return []
    artifacts = bundle.get("artifacts") or {}
    dropped: list[str] = []

    kept_occ = []
    for s in (artifacts.get("occupancy_sensors") or []):
        bad = [eid for eid in (s.get("sensors") or []) if eid not in real]
        if bad:
            dropped.extend(bad)
        else:
            kept_occ.append(s)
    artifacts["occupancy_sensors"] = kept_occ

    for r in (artifacts.get("recipes") or []):
        if isinstance(r, dict) and isinstance(r.get("lights"), list):
            good = [l for l in r["lights"] if l in real]
            dropped.extend([l for l in r["lights"] if l not in real])
            r["lights"] = good

    kept_autos = []
    for a in (artifacts.get("automations") or []):
        bad: list[str] = []
        trig = a.get("trigger") or {}
        tids = trig.get("entity_id")
        for tid in (tids if isinstance(tids, list) else [tids]):
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
        bp = a.get("blueprint") or {}
        for k, v in (bp.get("inputs") or {}).items():
            if isinstance(v, str) and "." in v and v.count(".") == 1 and v not in real:
                bad.append(v)
        if bad:
            dropped.extend(bad)
        else:
            kept_autos.append(a)
    artifacts["automations"] = kept_autos
    return dropped


def _validate_bundle(bundle: dict) -> Optional[str]:
    """Structural check only; the executor surfaces per-artifact failures."""
    if not isinstance(bundle, dict):
        return "Bundle is not a JSON object."
    if bundle.get("decline"):
        bundle.setdefault("artifacts", {})
        return None
    artifacts = bundle.get("artifacts")
    if not isinstance(artifacts, dict):
        return "Bundle missing 'artifacts' object."
    for key in ("recipes", "occupancy_sensors", "automations", "kv_state", "voice_intents"):
        if key in artifacts and not isinstance(artifacts[key], list):
            return f"artifacts.{key} must be a list."

    good_recipes = []
    for i, r in enumerate(artifacts.get("recipes") or []):
        if not isinstance(r, dict) or r.get("recipe") not in _RECIPES:
            continue  # unknown recipe → silently dropped; the lint notes can't name it usefully
        good_recipes.append(r)
    artifacts["recipes"] = good_recipes

    for i, a in enumerate(artifacts.get("automations") or []):
        if not isinstance(a, dict):
            return f"automations[{i}] is not an object."
        if not a.get("name"):
            return f"automations[{i}] missing name."
        src = a.get("source") or "custom"
        a["source"] = src
        if src not in ("blueprint", "custom"):
            return f"automations[{i}].source must be 'blueprint' or 'custom'."
        if src == "blueprint":
            if not (a.get("blueprint") or {}).get("id"):
                return f"automations[{i}].blueprint.id is required."
        else:
            if not (a.get("trigger") or {}).get("type"):
                return f"automations[{i}].trigger.type is required for source=custom."

    artifacts["occupancy_sensors"] = [
        s for s in (artifacts.get("occupancy_sensors") or [])
        if isinstance(s, dict) and s.get("room") and s.get("sensors")
    ]
    return None
