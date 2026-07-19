# Device Presets — design spec (2026-07-19)

## Problem

A user often wants the same light in a few specific "positions" — e.g. the
kitchen at **80% + cool** while cooking, **40% + warm** in the evening. Today
they must drag two sliders every time. There is no way to save a position and
recall it in a tap.

Ziggy already *captures* this data invisibly: `services/state_memory.py` records
the last intentional brightness/warmth/colour of every light for power-loss
restore. But that is a single, hidden slot per device used only for auto-restore.

The device card also has a row **mislabelled "Presets"** that is actually a fixed
six-colour palette (`COLOR_PRESETS` in `DeviceControls.jsx`) — tapping a swatch
only sets `rgb_color`, never brightness or warmth — plus a "＋" that is an OS
colour picker, not a save button. So the surface exists but does the wrong job.

## Goal

Let a user save the light exactly as it is right now into a **named preset**, and
recall it with one tap — entirely on the device card. **No new page, no new
concept in the automations world** (automations / routines / library / quick-asks
stay untouched). A preset is a *still position*, never a trigger or an animation —
which is precisely why it is not a scene (scenes were deliberately removed from
Ziggy) and never touches more than the one device you are looking at.

## Non-goals (v1)

- Multi-device / room / whole-home presets (that is a scene; explicitly out).
- Climate and fan presets. The storage is kept generic so they can adopt this
  later, but only **lights** ship in v1 (and the home's AC isn't even integrated
  yet).
- Effects, transitions, schedules inside a preset.

## UX

On a light's detail card, replacing the current single palette row with two rows:

1. **Colors** (renamed from the mislabelled "Presets") — the existing six swatches
   + OS colour picker, unchanged. Quick tint that keeps current brightness.
2. **Presets** (new) — a row of **named pills**. Each pill has a mini **gauge
   icon** (warmth = colour, fill height = brightness), the **name**, and the
   **brightness %**. The pill whose stored position matches the light's live state
   shows **dark = active**. A dashed **＋ Save** pill at the end.

Interactions:
- **Tap a pill** → applies it (one `turn_on` with the saved settings). If the
  light is off it comes on into that preset.
- **＋ Save** → an inline field appears pre-filled with a suggested name
  (e.g. "Warm 40%"); accept or type over; it becomes a pill. No modal.
- **Long-press a pill** → rename or delete.
- The ＋ Save pill is hidden when the per-device cap (6) is reached.

## What a preset captures

`brightness_pct` (required) plus the light's *active* colour state:
- colour-temp bulb / temp mode → `color_temp_kelvin`
- colour bulb in colour mode → `rgb_color`

Nothing else. Sanitised on the way in.

## Architecture

**Backend**

- `services/device_presets.py` — pure store logic, no HA. JSON file at
  `user_files/device_presets.json`, shape `{ entity_id: [ {id, name, settings,
  saved_at}, ... ] }`. Home-scoped (shared by the household), mirroring
  `state_memory.py`, **kept separate** from it (different job: invisible restore
  vs. a named user-facing list).
  - `list_presets(entity_id) -> list`
  - `add_preset(entity_id, name, settings) -> dict` — sanitises settings, enforces
    `MAX_PRESETS_PER_ENTITY = 6` (raises `PresetLimitError`), validates
    name/brightness/rgb (raises `ValueError`).
  - `rename_preset(entity_id, id, name) -> dict` (raises `KeyError` if missing)
  - `delete_preset(entity_id, id) -> bool`
- `backend/routers/device_presets_router.py` — `get_current_user` (user tier):
  - `GET    /api/device/{entity_id}/presets`
  - `POST   /api/device/{entity_id}/presets`            body `{name, settings}`
  - `PATCH  /api/device/{entity_id}/presets/{id}`       body `{name}`
  - `DELETE /api/device/{entity_id}/presets/{id}`
  - `409` on cap (`PresetLimitError`), `400` on validation, `404` on missing.
- Registered in `backend/server.py` alongside the other routers.

**Frontend**

- `frontend/src/lib/api.js` — `getDevicePresets / addDevicePreset /
  renameDevicePreset / deleteDevicePreset`.
- `DeviceControls.jsx` `LightControls`:
  - Rename the colour row label `deviceControls.presets` → new
    `deviceControls.colors`.
  - New `<DevicePresetsRow entity onService>` sub-component: fetches presets for
    `entity.entity_id`, renders pills (gauge + name + %), computes active by
    comparing live brightness (±3%) and colour (temp ±150 K or rgb ±25), applies
    via `onService('turn_on', settings)`, and drives the inline save / long-press
    rename+delete against the api helpers.
  - Capture on save: `brightness_pct` from the live brightness state, plus
    `color_temp_kelvin` (temp mode) or `rgb_color` (colour mode).
- i18n (`en.js` + `he.js`): add `deviceControls.colors` (Colors / צבעים) and the
  save/rename/delete/placeholder/limit strings. `deviceControls.presets` is
  already `תבניות`, reused for the new row. Hebrew wording deferred to the Hebrew
  pass — keys only.

## Error handling

- Applying a preset uses the existing `onService` path (toasts on failure).
- Cap reached → ＋ Save hidden; a POST that still races the cap returns 409 and the
  UI shows a "remove one first" toast.
- Fetch failure → the Presets row simply renders empty (never blocks the card).

## Testing

- `tests/test_device_presets.py` — service unit tests (add/list/rename/delete,
  per-entity isolation, cap, sanitiser, bounds, persistence). TDD, written first.
- Frontend: build, then drive the real card on the Canary — save a position,
  recall it, confirm the light physically changes and the active pill lights up.
  (Per the real-life validation gate, the feature is not "done" until it moves a
  real bulb.)

## Rollout

Lands on `feat/beta-image-readiness`; deployed to the Canary via container
rebuild (a brief live-app blip), then validated on a real Zigbee bulb.
