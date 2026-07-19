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
import time

from core.logger_module import log_info, log_error
from services.ha_automations import save_automation
from services.template_sensors import create_occupancy_sensor
from services.local_automation_actions import set_local_state
from services.blueprint_importer import instantiate_blueprint


# KV namespace holding one manifest per applied bundle, keyed by bundle_id.
# The manifest records exactly which artifacts a bundle created so a later
# "delete bundle" / "undo accept" can sweep them all — without this we'd have
# no reliable way to find KV flags / occupancy sensors after the fact (only
# automations carry the bundle_id into their own metadata).
_BUNDLE_NAMESPACE = "pro_bundles"


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
            # delay_off_seconds is optional on the artifact (the per-artifact
            # edit UI can set it); fall back to create_occupancy_sensor's own
            # default when absent.
            create_kwargs = {
                "room": room,
                "sensor_entities": sensor.get("sensors", []),
                "friendly_name": sensor.get("friendly_name"),
            }
            if isinstance(sensor.get("delay_off_seconds"), int):
                create_kwargs["delay_off_seconds"] = sensor["delay_off_seconds"]
            result = create_occupancy_sensor(**create_kwargs)
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
                    # An `alias` (English, stable) is used as the HA name so the
                    # entity object-id is predictable + groupable and re-apply
                    # overwrites in place. `name` (may be Hebrew) is kept for
                    # reporting only. Recipes set alias; LLM bundles don't → name.
                    "name":        auto.get("alias") or name,
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

    # ── Phase 4: Voice intents ──────────────────────────────────────────────
    # Register each phrase against a concrete action resolved deterministically
    # from what THIS bundle created (see voice_intents.resolve_action_description).
    # Runs last so `created` already holds the automations / KV modes a phrase
    # can bind to. Phrases we can't resolve without an LLM keep the honest
    # "manual setup" note rather than registering something wrong.
    for vi in artifacts.get("voice_intents") or []:
        phrase = vi.get("phrase")
        if not phrase:
            errors.append({"kind": "voice_intent", "error": "missing phrase"})
            continue
        try:
            from services.voice_intents import register_voice_intent, resolve_action_description
            action = resolve_action_description(vi.get("action_description", ""), created)
            if not action:
                errors.append({
                    "kind":   "voice_intent",
                    "phrase": phrase,
                    "error":  "I couldn't map this phrase to an action automatically — set it up manually for now.",
                })
                continue
            reg = register_voice_intent(phrase, action, bundle_id=bundle_id,
                                        description=vi.get("action_description", ""))
            if reg.get("ok"):
                created.append({
                    "kind":       "voice_intent",
                    "phrase":     phrase,
                    "normalized": reg.get("normalized"),
                    "bundle_id":  bundle_id,
                })
            else:
                errors.append({"kind": "voice_intent", "phrase": phrase, "error": reg.get("error", "unknown")})
        except Exception as e:
            errors.append({"kind": "voice_intent", "phrase": phrase, "error": str(e)})

    ok = len(errors) == 0

    # Persist a manifest of what we actually created so the bundle can be
    # swept later (delete-bundle / undo-accept). Only record artifacts that
    # were created — errors left nothing to clean up. Best-effort: a manifest
    # write failure must not fail the apply (the artifacts already exist).
    if created:
        try:
            _persist_manifest(bundle_id, bundle.get("name", ""), created)
        except Exception as e:
            log_error(f"[executor] manifest persist failed bundle={bundle_id}: {e}")

    log_info(f"[executor] bundle={bundle_id} created={len(created)} errors={len(errors)}")
    return {
        "ok":        ok,
        "bundle_id": bundle_id,
        "created":   created,
        "errors":    errors,
    }


def _persist_manifest(bundle_id: str, name: str, created: list[dict]) -> None:
    """Record (or merge into) a bundle's manifest of created artifacts.

    Re-applying the same bundle_id (e.g. the user tweaks and re-accepts) merges
    the new artifacts in rather than clobbering — so an undo still sweeps
    everything the bundle ever produced. Dedupe is by a stable per-kind key.
    """
    from services.local_automation_actions import get_local_state
    existing = get_local_state(_BUNDLE_NAMESPACE, bundle_id) or {}
    prior = existing.get("created") if isinstance(existing, dict) else None
    merged = list(prior) if isinstance(prior, list) else []

    def _key(a: dict) -> tuple:
        kind = a.get("kind")
        if kind == "automation":
            return (kind, a.get("id"))
        if kind == "occupancy_sensor":
            return (kind, a.get("entry_id") or a.get("room"))
        if kind == "kv_state":
            return (kind, a.get("namespace"), a.get("key"))
        if kind == "voice_intent":
            return (kind, a.get("normalized") or a.get("phrase"))
        return (kind, str(a))

    seen = {_key(a) for a in merged}
    for a in created:
        k = _key(a)
        if k not in seen:
            merged.append(a)
            seen.add(k)

    set_local_state(_BUNDLE_NAMESPACE, bundle_id, {
        "bundle_id":  bundle_id,
        "name":       name or existing.get("name", "") if isinstance(existing, dict) else name,
        "created_at": existing.get("created_at") if isinstance(existing, dict) and existing.get("created_at") else time.time(),
        "updated_at": time.time(),
        "created":    merged,
    })


def list_bundles() -> list[dict]:
    """List applied Pro-Mode bundles (most-recently-applied first).

    Reads the manifest KV namespace. Each entry summarizes what the bundle
    created so a management view / undo affordance can show counts without
    re-deriving them from HA.
    """
    from services.local_automation_actions import _load_state
    state = _load_state()
    bundles = (state.get(_BUNDLE_NAMESPACE) or {}) if isinstance(state, dict) else {}
    out: list[dict] = []
    for bundle_id, meta in bundles.items():
        if not isinstance(meta, dict) or not meta.get("created"):
            continue
        created = meta.get("created") or []
        counts: dict[str, int] = {}
        for a in created:
            k = a.get("kind", "unknown")
            counts[k] = counts.get(k, 0) + 1
        out.append({
            "bundle_id":  bundle_id,
            "name":       meta.get("name", ""),
            "created_at": meta.get("created_at"),
            "updated_at": meta.get("updated_at"),
            "counts":     counts,
            "total":      len(created),
        })
    out.sort(key=lambda b: (b.get("updated_at") or b.get("created_at") or 0), reverse=True)
    return out


def delete_bundle(bundle_id: str) -> dict:
    """Sweep every artifact a bundle created — automations, occupancy sensors,
    and KV flags — then drop the manifest.

    This is the "undo accept" / "delete bundle" teardown. Best-effort per
    artifact: a failure on one doesn't abort the rest; failures are collected
    and returned so the caller can report partial cleanup. Idempotent — a
    missing manifest or already-deleted artifact is not an error.

    Returns {"ok": bool, "bundle_id", "removed": [...], "errors": [...]}.
    """
    from services.local_automation_actions import get_local_state
    bundle_id = (bundle_id or "").strip()
    if not bundle_id:
        return {"ok": False, "bundle_id": bundle_id, "removed": [], "errors": [{"error": "bundle_id required"}]}

    manifest = get_local_state(_BUNDLE_NAMESPACE, bundle_id) or {}
    created = manifest.get("created") if isinstance(manifest, dict) else None
    if not created:
        return {"ok": False, "bundle_id": bundle_id, "removed": [],
                "errors": [{"error": "no such bundle (nothing to undo)"}]}

    removed: list[dict] = []
    errors:  list[dict] = []

    for a in created:
        kind = a.get("kind")
        try:
            if kind == "automation":
                _teardown_automation(a.get("id"))
                removed.append({"kind": kind, "id": a.get("id"), "name": a.get("name")})
            elif kind == "occupancy_sensor":
                from services.template_sensors import delete_occupancy_sensor_by_entry_id
                entry_id = a.get("entry_id")
                if entry_id:
                    res = delete_occupancy_sensor_by_entry_id(entry_id)
                    if not res.get("ok"):
                        raise RuntimeError(res.get("error", "delete failed"))
                removed.append({"kind": kind, "room": a.get("room"), "entry_id": entry_id})
            elif kind == "kv_state":
                set_local_state(a.get("namespace") or "modes", a.get("key"), None)
                removed.append({"kind": kind, "namespace": a.get("namespace"), "key": a.get("key")})
            elif kind == "voice_intent":
                from services.voice_intents import unregister_voice_intent
                unregister_voice_intent(a.get("normalized") or a.get("phrase") or "")
                removed.append({"kind": kind, "phrase": a.get("phrase")})
            else:
                # Unknown artifact kind — nothing actionable, but record it so
                # the manifest can still be cleared.
                removed.append({"kind": kind or "unknown"})
        except Exception as e:
            errors.append({"kind": kind, "ref": a.get("id") or a.get("entry_id") or a.get("key"), "error": str(e)})

    # Drop the manifest only if we cleared everything; otherwise keep it so a
    # retry can finish the sweep.
    if not errors:
        set_local_state(_BUNDLE_NAMESPACE, bundle_id, None)

    ok = len(errors) == 0
    log_info(f"[executor] delete bundle={bundle_id} removed={len(removed)} errors={len(errors)}")
    return {"ok": ok, "bundle_id": bundle_id, "removed": removed, "errors": errors}


def _teardown_automation(auto_id: str | None) -> None:
    """Delete an automation and all of Ziggy's side records for it — mirrors
    the DELETE /api/automations/{id} route so bundle-delete and single-delete
    tear down identically."""
    if not auto_id:
        return
    from services.ha_automations import delete_automation as ha_delete_automation
    from core.automation_file import delete_automation as delete_ziggy_automation
    from services.local_automation_actions import delete_ziggy_actions, delete_automation_meta
    from services.automation_history import delete_history

    ha_delete_automation(auto_id)          # best-effort HA-side removal
    delete_ziggy_automation(auto_id)       # Ziggy's own automation file
    delete_ziggy_actions(auto_id)
    delete_automation_meta(auto_id)
    delete_history(auto_id)
    try:
        from services import fake_occupancy_scheduler
        fake_occupancy_scheduler.stop(auto_id)
    except Exception:
        pass
