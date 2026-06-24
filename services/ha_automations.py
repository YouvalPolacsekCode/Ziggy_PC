"""
HA Automations — CRUD via HA REST config API + states.
Translates between Ziggy's simplified UI schema and HA's native format.

Routing rule:
  - Automations that involve a state trigger or call_service action → stored in HA.
  - Automations that only use IR commands / Ziggy capabilities → stored in Ziggy
    (automations.json) so HA is not required for purely local automations.
  - Regardless of storage, all automations are merged in list_automations().
"""
from __future__ import annotations
import re
import uuid
from typing import Optional
import requests

from core.settings_loader import settings
from core.logger_module import log_error
from services import ha_client

# Local aliases so the call sites below stay readable. Each call resolves
# the current URL/headers — no import-time credential snapshot.
def HA_URL() -> str:  # noqa: N802 — preserved as a callable shim for now
    return ha_client.url()


def HEADERS() -> dict:  # noqa: N802
    return ha_client.headers()


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")
    return s or uuid.uuid4().hex


def needs_ha(data: dict) -> bool:
    """Return True when the automation requires Home Assistant to store or trigger.

    Rules:
    - state / numeric_state → HA must watch for the state-change event
    - sunrise / sunset      → HA must compute the astronomical time
    - webhook               → HA must receive the HTTP call
    - time trigger          → Ziggy's own scheduler handles it; no HA required
      (call_service steps are now executed natively by execute_ziggy_actions)
    - ha_native_body present → HA must run it (blueprint-sourced bodies can
      use HA-only constructs like `choose:`, `wait_for_trigger:`, `repeat:`
      that Ziggy's executor can't interpret)
    """
    if isinstance(data.get("ha_native_body"), dict) and data["ha_native_body"]:
        return True
    trigger_type = data.get("trigger", {}).get("type", "")
    return trigger_type in ("state", "numeric_state", "sunrise", "sunset", "webhook", "zone")


# ── Ziggy → HA ────────────────────────────────────────────────────────────────

def _condition_to_ha(c: dict) -> Optional[dict]:
    # ── Time-window condition ──────────────────────────────────────────────
    if c.get("type") == "time":
        result: dict = {"condition": "time"}
        after  = (c.get("after")  or "").strip()
        before = (c.get("before") or "").strip()
        if after:
            result["after"]  = after  + ":00" if len(after)  == 5 else after
        if before:
            result["before"] = before + ":00" if len(before) == 5 else before
        return result if (after or before) else None

    # ── Entity-state / numeric-state condition ─────────────────────────────
    entity_id = c.get("entity_id", "")
    if not entity_id:
        return None
    operator = c.get("operator", "is")
    value    = c.get("value", "on")
    if operator in ("is", "is_not"):
        state_val = ("off" if value == "on" else "on") if operator == "is_not" else str(value)
        return {"condition": "state", "entity_id": entity_id, "state": state_val}
    if operator == "above":
        try:
            return {"condition": "numeric_state", "entity_id": entity_id, "above": float(value)}
        except (ValueError, TypeError):
            return None
    if operator == "below":
        try:
            return {"condition": "numeric_state", "entity_id": entity_id, "below": float(value)}
        except (ValueError, TypeError):
            return None
    return None


def _trigger_to_ha(t: dict) -> list:
    kind = t.get("type", "time")
    if kind == "time":
        return [{"platform": "time", "at": f"{t.get('time', '08:00')}:00"}]
    if kind == "state":
        cfg: dict = {"platform": "state", "entity_id": t.get("entity_id", ""), "to": t.get("state", "on")}
        for_mins = t.get("for_minutes")
        if for_mins:
            mins = int(for_mins)
            h, m = divmod(mins, 60)
            cfg["for"] = f"{h:02d}:{m:02d}:00"
        return [cfg]
    if kind == "numeric_state":
        cfg: dict = {"platform": "numeric_state", "entity_id": t.get("entity_id", "")}
        if t.get("above") is not None:
            cfg["above"] = t["above"]
        if t.get("below") is not None:
            cfg["below"] = t["below"]
        return [cfg]
    if kind in ("sunrise", "sunset"):
        cfg = {"platform": "sun", "event": kind}
        if t.get("offset"):
            cfg["offset"] = t["offset"]
        return [cfg]
    if kind == "webhook":
        return [{"platform": "webhook", "webhook_id": t.get("webhook_id", "ziggy_webhook"), "allowed_methods": ["POST"]}]
    if kind == "zone":
        return [{
            "platform": "zone",
            "entity_id": t.get("entity_id", ""),
            "zone":      t.get("zone", "zone.home"),
            "event":     t.get("event", "enter"),
        }]
    if kind == "time_pattern":
        # Fires periodically. Any of seconds/minutes/hours may be a number ("15")
        # or a cron-style "/N" string ("/15" → every 15 units). At least one is required.
        cfg = {"platform": "time_pattern"}
        for field in ("seconds", "minutes", "hours"):
            v = t.get(field)
            if v is not None and v != "":
                cfg[field] = v
        return [cfg] if len(cfg) > 1 else []
    return []


def _action_to_ha(a: dict) -> Optional[dict]:
    kind = a.get("type", "call_service")
    if kind == "call_service":
        entity_id = a.get("entity_id", "")
        svc = a.get("service", "homeassistant.turn_on")
        domain = entity_id.split(".")[0] if "." in entity_id else "homeassistant"
        action_name = svc.split(".")[-1]
        ha_action: dict = {"service": f"{domain}.{action_name}", "target": {"entity_id": entity_id}}
        service_data = a.get("service_data") or {}
        if service_data:
            ha_action["data"] = service_data
        return ha_action
    if kind == "delay":
        secs = int(a.get("seconds", 0))
        m, s = divmod(secs, 60)
        h, m = divmod(m, 60)
        return {"delay": f"{h:02d}:{m:02d}:{s:02d}"}
    if kind == "notify":
        return {"service": "notify.persistent_notification",
                "data": {"message": a.get("message", ""), "title": "Ziggy"}}
    if kind == "ziggy_intent":
        label = a.get("virtual_device_name") or a.get("capability", "ziggy_action")
        return {"service": "notify.persistent_notification",
                "data": {"message": f"[Ziggy] Run: {label}", "title": "Ziggy Capability"}}
    if kind == "ir_command":
        label = f"{a.get('ir_device_name', 'IR device')} → {a.get('ir_sequence') or a.get('ir_command', '')}"
        return {"service": "notify.persistent_notification",
                "data": {"message": f"[Ziggy IR] {label}", "title": "Ziggy IR"}}
    return None  # send_intent not translatable to HA


# ── HA → Ziggy ────────────────────────────────────────────────────────────────

def _ha_trigger_to_ziggy(ha_triggers: list) -> dict:
    if not ha_triggers:
        return {}
    t = ha_triggers[0] if isinstance(ha_triggers, list) else ha_triggers
    platform = t.get("platform", "time")
    if platform == "time":
        return {"type": "time", "time": str(t.get("at", "00:00:00"))[:5]}
    if platform == "state":
        return {"type": "state", "entity_id": t.get("entity_id", ""), "state": t.get("to", "on")}
    if platform == "numeric_state":
        result: dict = {"type": "numeric_state", "entity_id": t.get("entity_id", "")}
        if t.get("above") is not None:
            result["above"] = t["above"]
        if t.get("below") is not None:
            result["below"] = t["below"]
        return result
    if platform == "sun":
        return {"type": t.get("event", "sunrise"), "offset": t.get("offset", "")}
    if platform == "webhook":
        return {"type": "webhook", "webhook_id": t.get("webhook_id", "")}
    if platform == "zone":
        return {"type": "zone", "entity_id": t.get("entity_id", ""), "zone": t.get("zone", "zone.home"), "event": t.get("event", "enter")}
    if platform == "time_pattern":
        result: dict = {"type": "time_pattern"}
        for field in ("seconds", "minutes", "hours"):
            if t.get(field) is not None:
                result[field] = t[field]
        return result
    return {}


def _ha_action_to_ziggy(a: dict) -> dict:
    if "service" in a:
        svc = a["service"]
        target = a.get("target") or a.get("data") or {}
        entity_id = target.get("entity_id", "")
        if isinstance(entity_id, list):
            entity_id = entity_id[0] if entity_id else ""
        return {"type": "call_service", "entity_id": entity_id,
                "service": f"homeassistant.{svc.split('.')[-1]}"}
    if "delay" in a:
        d = a["delay"]
        if isinstance(d, str):
            parts = d.split(":")
            secs = int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2]) if len(parts) == 3 else 0
        elif isinstance(d, dict):
            secs = d.get("seconds", 0) + d.get("minutes", 0) * 60 + d.get("hours", 0) * 3600
        else:
            secs = 0
        return {"type": "delay", "seconds": secs}
    return {"type": "notify", "message": str(a)}


# ── API calls ─────────────────────────────────────────────────────────────────

def list_automations() -> list:
    """Return all automations: HA-backed (with locally-cached trigger) + Ziggy-only."""
    from services.local_automation_actions import get_automation_meta, get_all_saved_actions
    from core.automation_file import list_automations as list_ziggy_automations

    ha_result: list = []
    ha_ids: set = set()

    # Prefer the WS-fed state cache. ha_subscriber keeps it continuously
    # current via state_changed events, so it's at least as fresh as a REST
    # snapshot — and skips a 100-300 ms HA round-trip that used to fire on
    # every Dashboard mount + Automations page mount. Fall back to REST only
    # when the cache is empty (early boot, before the subscriber's first
    # snapshot completes).
    try:
        from services.ha_subscriber import state_cache
        cache_items = list(state_cache.items()) if state_cache else None
    except Exception:
        cache_items = None

    try:
        if cache_items is not None:
            for eid, entry in cache_items:
                if not eid.startswith("automation."):
                    continue
                auto_id = eid[len("automation."):]
                ha_ids.add(auto_id)
                attrs = entry.get("attributes", {}) or {}
                meta = get_automation_meta(auto_id)
                ha_result.append({
                    "id": auto_id,
                    "entity_id": eid,
                    "name": meta.get("name") or attrs.get("friendly_name", auto_id),
                    "description": meta.get("description", ""),
                    "enabled": entry.get("state") != "off",
                    "last_triggered": attrs.get("last_triggered"),
                    "trigger": meta.get("trigger", {}),
                    "actions": get_all_saved_actions(auto_id),
                    "rooms": meta.get("rooms", []),
                    "source": "ha",
                })
        else:
            resp = requests.get(f"{HA_URL()}/api/states", headers=HEADERS(), timeout=10)
            if resp.status_code == 200:
                for s in resp.json():
                    eid = s.get("entity_id", "")
                    if not eid.startswith("automation."):
                        continue
                    auto_id = eid[len("automation."):]
                    ha_ids.add(auto_id)
                    attrs = s.get("attributes", {})
                    meta = get_automation_meta(auto_id)
                    ha_result.append({
                        "id": auto_id,
                        "entity_id": eid,
                        "name": meta.get("name") or attrs.get("friendly_name", auto_id),
                        "description": meta.get("description", ""),
                        "enabled": s.get("state") != "off",
                        "last_triggered": attrs.get("last_triggered"),
                        "trigger": meta.get("trigger", {}),
                        "actions": get_all_saved_actions(auto_id),
                        "rooms": meta.get("rooms", []),
                        "source": "ha",
                    })
    except Exception as e:
        log_error(f"[HA Automations] list: {e}")

    # Merge Ziggy-only automations (those not already in the HA list).
    ziggy_extras: list = []
    try:
        for a in list_ziggy_automations():
            if a.get("id") not in ha_ids:
                ziggy_extras.append({**a, "source": "ziggy"})
    except Exception:
        pass

    all_automations = ha_result + ziggy_extras
    return sorted(all_automations, key=lambda x: (x.get("name") or "").lower())


def get_automation_for_ui(auto_id: str) -> Optional[dict]:
    """Fetch full automation config for editing. Falls back to Ziggy-only store."""
    from services.local_automation_actions import (
        get_all_saved_actions, get_automation_meta, save_automation_meta,
    )

    # Try HA first.
    try:
        resp = requests.get(f"{HA_URL()}/api/config/automation/config/{auto_id}",
                            headers=HEADERS(), timeout=10)
        if resp.status_code == 200:
            cfg = resp.json()
            # HA 2024+ uses plural keys ("triggers", "actions"); older HA uses singular.
            ha_triggers = cfg.get("triggers") or cfg.get("trigger") or []
            if isinstance(ha_triggers, dict):
                ha_triggers = [ha_triggers]
            ha_actions = cfg.get("actions") or cfg.get("action") or []
            if isinstance(ha_actions, dict):
                ha_actions = [ha_actions]

            saved_actions = get_all_saved_actions(auto_id)
            meta = get_automation_meta(auto_id)

            # Prefer locally-stored trigger (written at save time, always accurate).
            # Fall back to parsing HA config only if no local record exists.
            trigger = meta.get("trigger") or _ha_trigger_to_ziggy(ha_triggers)
            name = cfg.get("alias", auto_id)

            # Back-fill metadata cache so the list view shows trigger data
            # without needing another HA config API call.
            if not meta and trigger:
                save_automation_meta(auto_id, {
                    "name": name,
                    "description": cfg.get("description", ""),
                    "trigger": trigger,
                })

            return {
                "id": auto_id,
                "name": name,
                "description": cfg.get("description", ""),
                "enabled": True,
                "trigger": trigger,
                "conditions": meta.get("conditions", []),
                "actions": saved_actions if saved_actions else [_ha_action_to_ziggy(a) for a in ha_actions],
                "rooms": meta.get("rooms", []),
                "source": "ha",
            }
    except Exception as e:
        log_error(f"[HA Automations] get_for_ui {auto_id}: {e}")

    # Fall back to Ziggy-only store.
    try:
        from core.automation_file import get_automation as get_ziggy
        ziggy = get_ziggy(auto_id)
        if ziggy:
            saved_actions = get_all_saved_actions(auto_id)
            ziggy["actions"] = saved_actions if saved_actions else ziggy.get("actions", [])
            ziggy["source"] = "ziggy"
            return ziggy
    except Exception:
        pass

    return None


def save_automation(data: dict, auto_id: Optional[str] = None) -> dict:
    """
    Save an automation.  Routes to HA or Ziggy-only depending on needs_ha().
    auto_id — supply when updating an existing automation so the same slug is used.

    Paired templates (e.g. Night Watch) carry `paired: True` + `stages: [...]`;
    they are fanned out atomically by _save_paired_automation — see that helper
    for the rollback contract.
    """
    if data.get("paired") and data.get("stages"):
        return _save_paired_automation(data, auto_id)

    if not auto_id:
        auto_id = _slug(data.get("name", "ziggy_automation"))

    ziggy_actions = data.get("actions", [])
    trigger = data.get("trigger", {})

    from services.local_automation_actions import save_ziggy_actions, save_automation_meta

    if not needs_ha(data):
        # Ziggy-only: store in automations.json, no HA required.
        from core.automation_file import (
            get_automation as get_ziggy,
            create_automation as create_ziggy,
            update_automation as update_ziggy,
        )
        # Use the slug as stable ID so lookups are consistent.
        if get_ziggy(auto_id):
            update_ziggy(auto_id, {**data, "id": auto_id})
        else:
            create_ziggy({**data, "id": auto_id})
        save_ziggy_actions(auto_id, ziggy_actions)
        save_automation_meta(auto_id, {
            "name": data.get("name", ""),
            "description": data.get("description", ""),
            "trigger": trigger,
            "conditions": data.get("conditions", []),
            "rooms": data.get("rooms", []),
        })
        return {"ok": True, "id": auto_id, "source": "ziggy"}

    # HA-backed automation.
    # `ha_native_body` is the escape hatch used by blueprint-instantiated
    # automations (services.blueprint_importer). Blueprint bodies can use
    # HA-only constructs like `choose:`, `wait_for_trigger:`, and `repeat:`
    # that Ziggy's translator can't round-trip. When the caller supplies a
    # fully-formed HA body we trust it and use it verbatim for the
    # triggers / conditions / actions / mode that it explicitly sets.
    # Anything not in ha_native_body still goes through the normal
    # _trigger_to_ha / _action_to_ha translation, so a mixed payload (e.g.
    # Ziggy trigger + HA actions) is also valid.
    native = data.get("ha_native_body") if isinstance(data.get("ha_native_body"), dict) else None

    if native and native.get("actions"):
        ha_actions = list(native["actions"])
    else:
        ha_actions = [_action_to_ha(a) for a in ziggy_actions]
        ha_actions = [a for a in ha_actions if a is not None]

    if native and native.get("conditions") is not None:
        ha_conditions = list(native["conditions"])
    else:
        ziggy_conditions = data.get("conditions", [])
        ha_conditions = [_condition_to_ha(c) for c in ziggy_conditions]
        ha_conditions = [c for c in ha_conditions if c is not None]

    if native and native.get("triggers"):
        ha_triggers = list(native["triggers"])
    else:
        ha_triggers = _trigger_to_ha(trigger)

    # HA 2024.1+ uses plural keys only. Sending both "trigger"+"triggers" (or
    # "condition"+"conditions", "action"+"actions") causes a 400 "Message malformed"
    # error. Use plural keys exclusively.
    ha_cfg = {
        "id": auto_id,
        "alias": data.get("name", "Ziggy Automation"),
        "description": data.get("description", ""),
        "triggers": ha_triggers,
        "conditions": ha_conditions,
        "actions": ha_actions,
        "mode": (native.get("mode") if native and native.get("mode") else data.get("mode", "single")),
    }
    try:
        resp = requests.post(f"{HA_URL()}/api/config/automation/config/{auto_id}",
                             headers=HEADERS(), json=ha_cfg, timeout=10)
        if resp.status_code in (200, 201):
            save_ziggy_actions(auto_id, ziggy_actions)
            # Cache trigger + name so list_automations() can display them without
            # a per-automation config API call.
            save_automation_meta(auto_id, {
                "name": data.get("name", ""),
                "description": data.get("description", ""),
                "trigger": trigger,
                "conditions": data.get("conditions", []),
                "rooms": data.get("rooms", []),
            })
            return {"ok": True, "id": auto_id, "source": "ha"}
        return {"ok": False, "error": f"HA {resp.status_code}: {resp.text}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _save_paired_automation(data: dict, base_auto_id: Optional[str] = None) -> dict:
    """Atomic fan-out for paired templates (e.g. Night Watch).

    Reads `data["stages"]` (a list of stage dicts, each with its own trigger /
    conditions / actions / name / description and an optional `_initial_enabled`
    hint). Creates each stage as a separate automation via save_automation,
    using `{base_id}_{stage_key}` slugs. If any stage save fails, every stage
    saved earlier in this call is deleted before returning the error — all
    succeed or none do.

    Stage key resolution (in priority order):
      1. stage.get("key")              — explicit key from the template
      2. _slug(stage["name"])          — derived from the stage's name
      3. f"stage_{idx}"                — last-resort positional fallback
    Stage 0 owns the parent ID exactly so the user sees ONE "Night Watch"
    automation in the Active tab; stages 1..N get `{base}_{key}` suffixes.
    """
    base_id = data.get("base_id") or base_auto_id or _slug(data.get("name", "paired_automation"))
    stages = data.get("stages") or []
    if not stages:
        return {"ok": False, "error": "paired automation has empty stages[]"}

    created: list[str] = []   # populated as each stage succeeds; used for rollback

    try:
        for idx, stage in enumerate(stages):
            key = stage.get("key") or _slug(stage.get("name") or f"stage_{idx}")
            stage_id = base_id if idx == 0 else f"{base_id}_{key}"

            # Re-wire any `automation` steps that reference the partner stages
            # by their unsuffixed key (e.g. `"night_watch_alert"`). The template
            # builder uses literal strings; if the user picks a non-default
            # base_id, those references would dangle. We rewrite them here.
            stage_actions = list(stage.get("actions") or [])
            stage_conditions = list(stage.get("conditions") or [])

            stage_payload = {
                "name":         stage.get("name", f"{data.get('name', 'Paired')} — Stage {idx + 1}"),
                "description":  stage.get("description", ""),
                "trigger":      stage.get("trigger", {}),
                "conditions":   stage_conditions,
                "actions":      stage_actions,
                "rooms":        stage.get("rooms", []),
            }

            # Recursive call — but with `paired` stripped so it goes through
            # the normal HA/Ziggy save path, not back into _save_paired_automation.
            result = save_automation(stage_payload, auto_id=stage_id)
            if not result.get("ok"):
                raise RuntimeError(
                    f"stage {idx + 1}/{len(stages)} ({stage_id}) save failed: "
                    f"{result.get('error', 'unknown error')}"
                )

            created.append(stage_id)

            # Honor `_initial_enabled: False` — used by Night Watch's alert
            # stage so the first time it fires is when Stage 1 arms it.
            if stage.get("_initial_enabled") is False:
                try:
                    toggle_automation(stage_id, False)
                except Exception as toggle_err:
                    raise RuntimeError(
                        f"stage {stage_id} created but could not be disabled: {toggle_err}"
                    )

        return {
            "ok":      True,
            "id":      base_id,
            "source":  "paired",
            "stages":  created,
            "paired":  True,
        }

    except Exception as e:
        # Rollback: best-effort delete of every stage created in this call.
        for prev_id in created:
            try:
                delete_automation(prev_id)
            except Exception as del_err:
                log_error(f"[paired] rollback delete {prev_id} failed: {del_err}")
        return {"ok": False, "error": str(e), "rolled_back": created}


def delete_automation(auto_id: str) -> bool:
    try:
        resp = requests.delete(f"{HA_URL()}/api/config/automation/config/{auto_id}",
                               headers=HEADERS(), timeout=10)
        return resp.status_code in (200, 204)
    except Exception as e:
        log_error(f"[HA Automations] delete {auto_id}: {e}")
        return False


def toggle_automation(auto_id: str, enable: bool) -> bool:
    service = "turn_on" if enable else "turn_off"
    try:
        resp = requests.post(f"{HA_URL()}/api/services/automation/{service}",
                             headers=HEADERS(),
                             json={"entity_id": f"automation.{auto_id}"},
                             timeout=10)
        return resp.status_code == 200
    except Exception as e:
        log_error(f"[HA Automations] toggle {auto_id}: {e}")
        return False


def trigger_automation(auto_id: str) -> bool:
    try:
        resp = requests.post(f"{HA_URL()}/api/services/automation/trigger",
                             headers=HEADERS(),
                             json={"entity_id": f"automation.{auto_id}"},
                             timeout=10)
        return resp.status_code == 200
    except Exception as e:
        log_error(f"[HA Automations] trigger {auto_id}: {e}")
        return False


# ── Run history (HA-native traces, surfaced as Ziggy "runs") ────────────────
# HA records every automation execution: trigger, each condition pass/fail,
# each action call. Exposed at /api/config/automation/trace/{id}[/{run_id}].
# We translate the response into Ziggy-native shape so the frontend never
# sees raw HA jargon (trace_id, context_user_id, script_execution, etc.).

def _trace_status(state: str, script_execution: str) -> str:
    """Collapse HA's two status fields into one Ziggy verdict.

    Values:
      success — ran to completion
      stopped — stopped early (failed condition, mode=single skip, etc.)
      failed  — error or aborted
      running — still in progress
    """
    if state == "running":
        return "running"
    if script_execution in ("finished",):
        return "success"
    if script_execution in ("failed", "error"):
        return "failed"
    # stopped, cancelled, aborted, failed_conditions, failed_single, etc.
    return "stopped"


def _trigger_label(trace_obj: dict) -> str:
    """Extract a short, human label for what fired the automation.

    HA's `trigger` field in the trace summary is already a friendly string
    (e.g. "state of binary_sensor.bedroom_motion"). For detail traces we
    fall back to peeking at trace["trace"]["trigger/0"][0]["changed_variables"].
    """
    raw = trace_obj.get("trigger")
    if isinstance(raw, str) and raw:
        return raw
    if isinstance(raw, dict):
        # detail-shape: trigger is a dict with description / platform
        for key in ("description", "platform", "id"):
            v = raw.get(key)
            if isinstance(v, str) and v:
                return v
    return "manual"


def _summarize_run(t: dict) -> dict:
    """Convert one HA trace summary into a Ziggy-native run record.

    HA returns: run_id, timestamp.start, timestamp.finish, trigger, state,
    script_execution. We expose: run_id (opaque pass-through), started_at,
    finished_at, status, trigger_label.
    """
    ts = t.get("timestamp") or {}
    started = ts.get("start") if isinstance(ts, dict) else None
    finished = ts.get("finish") if isinstance(ts, dict) else None
    return {
        "run_id":        t.get("run_id", ""),
        "started_at":    started,
        "finished_at":   finished,
        "status":        _trace_status(t.get("state", ""), t.get("script_execution", "")),
        "trigger_label": _trigger_label(t),
    }


def _step_kind(path: str) -> str:
    """Classify an HA trace step path into trigger / condition / action.

    HA uses paths like "trigger/0", "condition/2", "action/0/choose/1/sequence/0".
    """
    head = (path or "").split("/", 1)[0]
    if head == "trigger":
        return "trigger"
    if head == "condition":
        return "condition"
    if head == "action":
        return "action"
    return "other"


def _step_outcome(entries: list) -> dict:
    """Collapse one step's list of execution entries into a single outcome.

    HA records a list per path (e.g. one condition can re-evaluate); we summarize
    the last meaningful entry. Returns:
      {"passed": True/False/None, "error": str|None, "timestamp": iso|None}
    For non-condition steps, `passed` is True if no error, False if errored,
    None if indeterminate. Condition steps use `result.result` directly.
    """
    if not entries:
        return {"passed": None, "error": None, "timestamp": None}
    last = entries[-1] if isinstance(entries[-1], dict) else {}
    err = last.get("error")
    ts = last.get("timestamp")
    result = last.get("result")
    passed: Optional[bool] = None
    if isinstance(result, dict) and "result" in result:
        passed = bool(result["result"])
    elif err:
        passed = False
    else:
        passed = True
    return {"passed": passed, "error": str(err) if err else None, "timestamp": ts}


def get_automation_traces(auto_id: str, limit: int = 10) -> dict:
    """List the most recent HA execution runs for one automation.

    Returns:
      {"ok": True,  "runs": [<run summary>, ...]}    on success (oldest→newest reversed to newest-first)
      {"ok": False, "error": "<ziggy-native message>", "runs": []}   on failure

    Errors are surfaced in Ziggy-native wording (no "HA"/"trace"/"context_id").
    """
    try:
        resp = requests.get(
            f"{HA_URL()}/api/config/automation/trace/{auto_id}",
            headers=HEADERS(), timeout=10,
        )
        if resp.status_code == 404:
            # HA returns 404 when no runs recorded yet — treat as empty list,
            # not an error, so the frontend can render the empty state.
            return {"ok": True, "runs": []}
        if resp.status_code != 200:
            log_error(f"[HA Automations] traces {auto_id}: {resp.status_code}")
            return {"ok": False, "error": "Run history is temporarily unavailable.", "runs": []}
        payload = resp.json() or []
        if not isinstance(payload, list):
            return {"ok": True, "runs": []}
        runs = [_summarize_run(t) for t in payload if isinstance(t, dict)]
        # HA returns oldest first; show newest first.
        runs.reverse()
        return {"ok": True, "runs": runs[: max(0, int(limit))]}
    except requests.RequestException as e:
        log_error(f"[HA Automations] traces {auto_id} network: {e}")
        return {"ok": False, "error": "Run history is temporarily unavailable.", "runs": []}
    except Exception as e:
        log_error(f"[HA Automations] traces {auto_id}: {e}")
        return {"ok": False, "error": "Run history is temporarily unavailable.", "runs": []}


def get_trace_detail(auto_id: str, run_id: str) -> dict:
    """Fetch the step-by-step timeline of one execution.

    Returns:
      {"ok": True, "run": <summary>, "steps": [{kind, path, label, passed, error, timestamp}, ...]}
      {"ok": False, "error": "..."}

    Steps are ordered as HA recorded them. `path` is kept (opaque pass-through)
    so the frontend can key React lists, but it's never shown to the user.
    The frontend should render `label` + status pill.
    """
    try:
        resp = requests.get(
            f"{HA_URL()}/api/config/automation/trace/{auto_id}/{run_id}",
            headers=HEADERS(), timeout=10,
        )
        if resp.status_code == 404:
            return {"ok": False, "error": "This run is no longer available."}
        if resp.status_code != 200:
            log_error(f"[HA Automations] trace detail {auto_id}/{run_id}: {resp.status_code}")
            return {"ok": False, "error": "Run details are temporarily unavailable."}
        payload = resp.json() or {}

        summary = _summarize_run(payload)

        # Build a flat, ordered step list. HA's `trace` is a dict keyed by
        # path → list of execution entries. We want chronological order.
        steps: list = []
        trace_map = payload.get("trace") or {}
        config = payload.get("config") or {}
        if isinstance(trace_map, dict):
            # Each entry's `timestamp` lets us sort across paths.
            tmp: list = []
            for path, entries in trace_map.items():
                if not isinstance(entries, list):
                    continue
                outcome = _step_outcome(entries)
                tmp.append((
                    outcome.get("timestamp") or "",
                    path,
                    outcome,
                ))
            tmp.sort(key=lambda x: x[0])
            for _ts, path, outcome in tmp:
                kind = _step_kind(path)
                steps.append({
                    "path":      path,             # opaque, for React key only
                    "kind":      kind,
                    "label":     _step_label(path, kind, config),
                    "passed":    outcome["passed"],
                    "error":     outcome["error"],
                    "timestamp": outcome["timestamp"],
                })

        return {"ok": True, "run": summary, "steps": steps}
    except requests.RequestException as e:
        log_error(f"[HA Automations] trace detail {auto_id}/{run_id} network: {e}")
        return {"ok": False, "error": "Run details are temporarily unavailable."}
    except Exception as e:
        log_error(f"[HA Automations] trace detail {auto_id}/{run_id}: {e}")
        return {"ok": False, "error": "Run details are temporarily unavailable."}


def _step_label(path: str, kind: str, config: dict) -> str:
    """Build a short human label for one step, sourced from the automation config.

    Falls back to a positional label ("Condition 2", "Step 3") when the config
    doesn't carry an `alias` for that index. NEVER returns entity_ids or other
    HA identifiers — those are scrubbed for the end user.
    """
    parts = (path or "").split("/")
    idx_str = parts[1] if len(parts) > 1 else ""
    try:
        idx = int(idx_str)
    except ValueError:
        idx = 0

    cfg_key = {"trigger": ("triggers", "trigger"),
               "condition": ("conditions", "condition"),
               "action": ("actions", "action")}.get(kind, ())

    item: dict = {}
    for k in cfg_key:
        seq = config.get(k)
        if isinstance(seq, list) and idx < len(seq) and isinstance(seq[idx], dict):
            item = seq[idx]
            break
        if isinstance(seq, dict) and idx == 0:
            item = seq
            break

    alias = item.get("alias") if isinstance(item, dict) else None
    if isinstance(alias, str) and alias.strip():
        return alias.strip()

    # Positional fallback. Capitalized, 1-indexed for the user.
    label_map = {"trigger": "Trigger", "condition": "Condition", "action": "Step"}
    return f"{label_map.get(kind, 'Step')} {idx + 1}"
