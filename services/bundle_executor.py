"""
Bundle executor for Ziggy Pro Mode (Session D3).

Takes a bundle JSON produced by services.orchestra_designer and instantiates
every artifact (KV flags, occupancy sensors, automations) via the existing
Ziggy primitives. Best-effort — surfaces per-artifact pass/fail rather than
all-or-nothing failure.

Soft rollback (delete-on-partial-failure) is intentionally not implemented
in v1. Rationale: every artifact created carries the `bundle_id` so the user
(or a later "discard bundle" handler) can clean up selectively. Hard
rollback is hostile when half the bundle is already useful on its own.

Voice intents are surfaced as "not supported in v1" errors — see voice
intent design TODO for the missing primitive.
"""
from __future__ import annotations
import uuid

from core.logger_module import log_info
from services.ha_automations import save_automation
from services.template_sensors import create_occupancy_sensor
from services.local_automation_actions import set_local_state
from services.blueprint_importer import instantiate_blueprint


def execute_bundle(bundle: dict) -> dict:
    """Apply every artifact in a designed bundle.

    Returns:
      {
        "ok":        True iff every artifact succeeded,
        "bundle_id": echoed from input or auto-generated,
        "created":   [{kind, ...identifiers...}, ...],
        "errors":    [{kind, ...identifiers..., error}, ...],
      }
    """
    bundle_id = bundle.get("bundle_id") or f"bundle_{uuid.uuid4().hex[:12]}"
    artifacts = bundle.get("artifacts") or {}

    created: list[dict] = []
    errors:  list[dict] = []

    # If the designer declined, there's nothing to execute. The caller
    # (handler) should have routed the decline message back to the user
    # before calling us — but be defensive.
    if bundle.get("decline"):
        return {
            "ok":        True,
            "bundle_id": bundle_id,
            "created":   [],
            "errors":    [],
            "declined":  True,
            "decline":   bundle["decline"],
        }

    # ── Phase 1: KV flags (no dependencies) ─────────────────────────────────
    for kv in artifacts.get("kv_state") or []:
        ns  = kv.get("namespace") or "modes"
        key = kv.get("key")
        if not key:
            errors.append({"kind": "kv_state", "error": "missing key"})
            continue
        try:
            set_local_state(ns, key, kv.get("default", False))
            created.append({"kind": "kv_state", "namespace": ns, "key": key, "bundle_id": bundle_id})
        except Exception as e:
            errors.append({"kind": "kv_state", "namespace": ns, "key": key, "error": str(e)})

    # ── Phase 2: Occupancy sensors (no dependencies on KV) ──────────────────
    for sensor in artifacts.get("occupancy_sensors") or []:
        room = sensor.get("room", "")
        try:
            result = create_occupancy_sensor(
                room=room,
                sensor_entities=sensor.get("sensors", []),
                friendly_name=sensor.get("friendly_name"),
            )
            if result.get("ok"):
                created.append({
                    "kind":      "occupancy_sensor",
                    "room":      room,
                    "entity_id": result.get("entity_id"),
                    "entry_id":  result.get("entry_id"),
                    "bundle_id": bundle_id,
                })
            else:
                errors.append({"kind": "occupancy_sensor", "room": room, "error": result.get("error", "unknown")})
        except Exception as e:
            errors.append({"kind": "occupancy_sensor", "room": room, "error": str(e)})

    # ── Phase 3: Automations (may reference KV / occupancy sensors) ─────────
    for auto in artifacts.get("automations") or []:
        name = auto.get("name", "automation")
        src  = auto.get("source", "custom")
        try:
            if src == "blueprint":
                bp_meta = auto.get("blueprint") or {}
                bp_id   = bp_meta.get("id", "")
                inputs  = bp_meta.get("inputs") or {}
                if not bp_id:
                    errors.append({"kind": "automation", "name": name, "error": "blueprint.id missing"})
                    continue
                # instantiate_blueprint already returns a save_automation-ready dict
                data = instantiate_blueprint(bp_id, inputs, name=name)
                data["bundle_id"] = bundle_id
                save_result = save_automation(data)
            else:
                data = {
                    "name":        name,
                    "description": auto.get("description", f"Created by Ziggy Pro (bundle:{bundle_id})"),
                    "trigger":     auto.get("trigger", {}),
                    "conditions":  auto.get("conditions", []),
                    "actions":     auto.get("actions", []),
                    "mode":        auto.get("mode", "single"),
                    "bundle_id":   bundle_id,
                }
                save_result = save_automation(data)

            if save_result.get("ok"):
                created.append({
                    "kind":      "automation",
                    "name":      name,
                    "id":        save_result.get("id"),
                    "from":      f"blueprint:{bp_meta.get('id')}" if src == "blueprint" else "custom",
                    "bundle_id": bundle_id,
                })
            else:
                errors.append({"kind": "automation", "name": name, "error": save_result.get("error", "unknown save error")})
        except ValueError as e:
            # instantiate_blueprint raises ValueError on input validation issues
            errors.append({"kind": "automation", "name": name, "error": str(e)})
        except Exception as e:
            errors.append({"kind": "automation", "name": name, "error": str(e)})

    # ── Phase 4: Voice intents — NOT YET SUPPORTED ──────────────────────────
    # Voice intent registration needs a Ziggy primitive that doesn't exist
    # yet (where do phrases live? command_phrases.yaml? a new registry?).
    # Surface as a clear "not supported" error so the user knows the rest of
    # the bundle landed but voice triggers need manual setup for now.
    for vi in artifacts.get("voice_intents") or []:
        errors.append({
            "kind":   "voice_intent",
            "phrase": vi.get("phrase"),
            "error":  "Voice intents aren't supported by Ziggy Pro v1 yet — set this phrase up manually for now.",
        })

    ok = len(errors) == 0
    log_info(f"[executor] bundle={bundle_id} created={len(created)} errors={len(errors)}")
    return {
        "ok":        ok,
        "bundle_id": bundle_id,
        "created":   created,
        "errors":    errors,
    }
