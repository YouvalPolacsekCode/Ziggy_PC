# Ziggy Permission Platform

A general **Policy Decision Point (PDP)**. Every access question in the product
— a tap, a voice command, an AI action, a property-manager API call — funnels
through one function:

```
decide(Principal, Action, Resource, Context) -> Allow | Deny + Obligations
```

Roles, groups, kids, buildings, cars, kiosks, voice and AI are all **data** fed
to that function. The consumer UI exposes ~5% of the grammar (preset roles + one
kid screen); the same engine scales to apartment buildings, rentals and
enterprise installs with no redesign.

This package is **additive**. The legacy linear-role path
(`services.auth_db` + `backend.routers.auth_deps.require_role`) is untouched;
`compat.py` bridges the two.

## Module map

| Module | Responsibility |
|---|---|
| `types.py` | Value types: `Principal`, `Effect`, `RiskTier`, `Channel`, `Obligation`, `Decision`. No logic. |
| `context.py` | `Context` (dotted-path facts) + `ContextBuilder`. |
| `conditions.py` | Safe, serializable boolean expression language (no `eval`). Time-window/quiet-hours aware. |
| `capabilities.py` + `seeds.py` | Open capability registry + device-class manifests (incl. future EV/mower) + preset roles. |
| `resources.py` | Typed containment **DAG** of spaces + devices; ancestor resolution. |
| `selectors.py` | Resource + capability pattern matching **with specificity scoring**. |
| `grants.py` | The one policy primitive. |
| `engine.py` | The PDP: gather → filter → combine (deny-overrides, specificity) → obligations → explain. |
| `roles.py` | Roles-as-data → compile to grants at bind time. |
| `groups.py` | Static/dynamic groups + typed relationship graph + principal expansion. |
| `delegation.py` | Object-capability re-granting with enforced attenuation. |
| `store.py` | **Event-sourced** SQLite log; read-model rebuilt by replay (point-in-time for free). |
| `audit.py` | Append-only decision/action ledger (attribution). |
| `service.py` | `PermissionService` façade: mutators + `authorize` (the PEP entry) + query API. |
| `ai.py` | AI agent authz: envelope ∩ delegator, gated by the autonomy ladder. |
| `compat.py` | Legacy linear-role → preset mapping + user seeding. |
| `runtime.py` / `pep.py` | Process singleton + `require()`/`check()` for internal call sites. |

HTTP surface: `backend/routers/permissions_router.py` (mounted in `server.py`).

## Integrating a new sensitive call site

```python
from services.permissions.pep import require, PermissionDenied

try:
    decision = require(subject=f"person:{user['username']}",
                       action="lock.unlock", resource="device:front_lock",
                       context={"session": {"channel": "app", "trust_level": 3}})
    # honour decision.obligations (step-up, notify, undo window…) before acting
except PermissionDenied as e:
    ...  # 403 with e.decision.reason
```

Bootstrap an existing deployment: `POST /api/permissions/bootstrap` (super_admin)
seeds legacy users + a default `space:home`.

## Design guarantees held by tests

- **Inheritance**: a grant on a space applies to devices inside it; siblings don't leak.
- **Deny-overrides + specificity**: a device-level deny beats a room-level allow ("everything except the heater").
- **Default-deny** everywhere; unknown resource ⇒ deny; missing context ⇒ fail-safe.
- **Roles are data**: presets compile to grants; custom/enterprise roles need no engine change.
- **New device classes** work via a manifest only (EV/mower seeded as proof).
- **Delegation** can only attenuate; revoking a root cascades.
- **AI** can never exceed the human it acts for; CRITICAL is never autonomous.
- **Point-in-time**: "who could unlock the door on date X" via log replay.

## Known follow-ups (not blockers)

- **Snapshotting**: the read-model replays the full event log whenever it grows.
  Correct and fast at home scale; add periodic snapshots before building/enterprise scale.
- **Live device-graph sync**: `store` currently holds its own space/device model.
  A reconciler should mirror `services.device_registry` / HA areas into it so
  operators don't double-enter devices. (Deliberately decoupled for now.)
- **Obligation enforcement in PEPs**: the engine *returns* obligations; each call
  site must honour step-up/two-person/undo. A shared PEP middleware could centralize this.
