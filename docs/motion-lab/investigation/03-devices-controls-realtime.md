# Devices, cards, detail/sheet, controls, realtime (origin/main e44e163)

## 1. Device list (`pages/Devices.jsx`, 3133 ln)

Two view modes `'room' | 'type'` (chips hard-coded English "By room / By type", `:2793`); `domain` filter from `?filter=`; picking any filter other than `all` **force-switches to `'type'`** (`:2803`). By room: `getGroupedZiggyRooms()` then Smart Sensors, No Room, Unassigned. By type: `DOMAIN_GROUPS` (`domainRegistry.js:314-349`). Grid `repeat(auto-fill, minmax(220px, 1fr))` gap 8.

`CollapsibleGroup` (`:1400-1458`): motion-on uses `Disclosure` (`grid-template-rows 0fr→1fr`, 240 open / 180 close, double-rAF); motion-off uses framer height. Chevron `data-motion-chevron`. Collapsed set is local state, not persisted. **FLIP armed by intent**: `layoutKey = viewMode|domain|search|collapsedGroups`; `layoutArmed` on pointerdown for 900ms (`:2595-2601`).

Filters (`buildStatusFilters` `:1114-1125`): all, 📦 unassigned, 🏠 noroom, 🔴 offline, 🟢 active, 🔗 connected, 📡 ir, ✨ smart_sensors + dynamic domain chips. Search matches name and entity_id. Offline: toggle suppressed when `unavailable`; state text `text-ink-faint`; `formatEntityState` collapses unavailable/unknown/null to "Unavailable"/"לא זמין". Status dots (`STATUS_DOT`) for `lost | unclaimed | unconfigured`; labels "Left the hub — pair it again" / "Removed from hub" / "Not assigned to Ziggy" / "Not linked" **replace** the state line in red. Attention banner (`:2712-2778`) and unassigned banner (`:2690-2707`, enters, no exit). Ghost device page (`DeviceDetail.jsx:186-259`). Header subtitle `"{active} of {total} active · {totalEntities} total"`. Skeleton: 6 static 60px bars. Empty: plain text, 3 of 4 branches not i18n'd. Dead: `DeviceMenu`, `IRCardMenu`, `IRDeviceCard`.

## 2. Card anatomy — two implementations

**Devices-page `DeviceCard`** (`Devices.jsx:1772-2189`): header row = 40×40 icon box r12 (`background: isActive ? --ink : --surface-2`, `data-motion-icon`, `<DeviceIcon size 21 fill>`, IR pill, status dot) + chevron → `/devices/:id` + `Toggle` when toggleable; name 14/600; per-kind state row; secondary lines; expanded control surface (`:2164-2181`, framer height 0↔auto 220ms `[0.32,0.72,0,1]`, renders `<UnifiedDeviceRemote>`).

| kind | toggle | state row | tap |
|---|---|---|---|
| light / lamp / led_strip | ✅ | On/Off; `· {n}%` **only mid-scrub** | body = scrub-to-dim; chevron = detail |
| switch / plug / water_heater | ✅ | On/Off + Show controls | same |
| climate | ✅ | hvac mode + `Now 24°` | same |
| cover | ❌ | `Open · 60%` / `Closed` | chevron |
| media | ✅ | Playing + title | same |
| fan | ✅ | On + `{n}%` | same |
| lock | ❌ | Locked/Unlocked | chevron |
| sensors | ❌ | one line `23.4°C · Temperature`; no expander | chevron |
| camera | ❌ | state only | chevron |
| IR | ✅ if toggle cmd | `AssumedStatePicker` chip (live = `animate-pulse` green dot; estimated = amber ring; stale = 40% grey) + `CompactAcStepper` | chip popover |
| controller | ❌ | `"{count} buttons"` + up to 4 deep-link pills | pills |
| smart sensor | `SmartSensorCard` | Occupied/Clear (תפוס/פנוי) | ⋮ menu |

**Shared `components/device/DeviceCard.jsx`** (Rooms, hub): `variant='tile'` (square, icon box top-start, name 2-line clamp + mono state, 28px chevron chip; **tap = toggle** when toggleable; `tinted` vs `inverted`), `variant='row'` (40px icon, `z-headline`, `secondaryLine`, `MetricPills` ≤3, `InlineControl`, chevron; tap anywhere = open). `InlineControl` per kind: 40px `ToggleButton` (`data-motion-ring`) / `TempStepper` + toggle / `PlayPauseButton` + toggle / `CoverButtons` / `StatusPill` (tone per `sensorTone`) / bare mono value / `Live` pill / `Unavailable` pill. `card_kind` from the backend is consumed only for `'controller'`.

## 3. Detail page & sheet

`DeviceDetail.jsx` (1810 ln): back + refresh (`z-spin`, `selfHealRefresh`) → crumb → `h1.z-display` 2-line clamp + `room · kind` → **2 tabs** Controls / Info (`:1172-1204`, pill transitions 200ms; **content is a hard subtree swap, page height jumps**) → Controls: unavailable card + "Not responding? Fix it", light-hold card, one `z-card` with `<DeviceRemote>`, `CameraPanel`, entity_id footer → Info: identity card, Diagnostics (`BatteryBar` no transition, `SignalBars`), `SensorHistoryChart`, Hardware, IR codeset, Capabilities chips, siblings `FoldSection`, automations, Room assignment (lock toggle reveals radio list, no height animation), Manage tiles (36 `ICON_CHOICES`), Who can use, Danger zone. **The ONE on/off is the remote's own power button.**

`DeviceRemote.jsx:93-147` switches on KIND: TVRemote / MediaTransportRemote / ACRemote / BoilerRemote / LightControls / CoverControls / LockControls / VacuumControls / IrFanRemote / FanControls / SwitchRemote / SensorRemote / GenericControls. Light: `BrightnessLamp` well 128×184 (tap toggle, vertical drag; level slides 260 off / 300 on / 180 value; handle `scaleY(1.5) scaleX(1.12)` held) → gradient Brightness + Temperature sliders (`{K}K · warm|neutral|cool`) → Presets (long-press 500ms menu) → 9 swatches + `<input type=color>` → Effects → full-width power. Climate `ACRemote`: 72px ▲ → big `{n}°` + `hvacLabel · {cur}° NOW` → ▼ → mode chips (Power/Snowflake/Flame/Wind) → fan/swing/preset/extras → schedule → power. `ClimateControls` SVG `Dial` (no transition on the arc) reachable only via legacy switch. Cover `[Open][■][Close]` + Position slider. Media: NowPlayingHero → `ScrubBar` native range → 52/64/52 transport → d-pad → volume → power.

`DeviceSheet`: `DETENTS [0.72, 1]`, `ELASTIC {top .12}`; content = grabber + name + `<DeviceRemote>` (automations/suggestion withheld). Presentation decided during render (`App.jsx:342-372`). `SheetSurface`: `FLICK 900`, `PROJECT .12`, `PAST_TOP_PX 60` = promote, dismiss `dy>120 || v>600`, velocity-projected `nearest(...)`, backdrop painted from the live drag; **`.z-msheet` uses `height`, not `max-height`** or detents collapse. Grabber tap cycles / promotes. Handoff: `navigate(same, {replace:true})`, `_TRAIL_MS 340`, `.z-msheet-handoff` 120ms hold + 160ms glide; docked frame `T_HANDOFF`. Wide ≥768 + `dock` = `.z-mdock` 320px, no drag, `Maximize2`. Detail chunk pre-warmed. Haptics: detent `medium`, dismiss `light`, flick-to-top `medium`.

## 4. Controls

**Slider** (`ui/Slider.jsx`, Radix): 44px root, 8px track, 28px thumb; `haptic(selection)` per bucket (5% on 0-100); `data-motion-hold` → track `scaleY(1.35)`, thumb `scale(1.08)`, 160 grab / 130 release; `data-scrubbing` kills fill transition, echo glides 140ms after. No optimistic write of its own.

**Toggle** (`ui/Toggle.jsx`, Radix Switch): 40×24, 20px knob, `--ok` / `--line-2`, `background var(--dur-state)`, knob `CSS_EASE.out`; RTL flips travel; `haptic(light)` on pointerdown; `data-motion-ring`.

Bespoke: `BrightnessLamp` (relative drag, 3px threshold, 5% ticks, tap-with-no-movement = toggle); `GradientSlider` (`data-motion-grow="bar"` `scaleY(1.12)`, thumb divides it out); `Dial` (no transition).

Long-press exists in exactly one place here: device presets (500ms). `useLongPress` from gestures.js is not used by any device component. Haptics call sites: slider ticks, toggle press, swatch/effect/mode chips `light`, `adjustTemp` `medium` (only when the value moved), scrub ticks, sheet detents.

Scrub (`useScrub`): 3-way disambiguation; command once on release; card `touchAction: pan-y`; mid-scrub `· {n}%` appended then vanishes on release.

**Optimistic updates — five strategies**: `DeviceCard.jsx:733-772` flips store, `revert()` on throw + toast, `pending` blocks re-entry, `data-pending` breathes · `Devices.jsx:1833-1837` HA toggle **no local flip** (backend's fire-and-forget WS broadcast), IR flips `assumed_state`, `pending` never guards (double-tap sends twice, deliberately) · `LightControls` commit lock (`lastCommittedBri/Temp` until HA within ±2% / ±100K; no rollback) · `SwitchRemote` `predictedOn` + `opacity .85` · `ACRemote` optimistic for power only · `DeviceDetail` `pendingTile` no revert · `wall/useWallControl.js:123-141` the only snapshot + rollback pair. Failure = toast (`toast.didNotRespond`).

## 5. Realtime

`hooks/useWebSocket.js`: module singleton; retry 750ms ×5 then 3s; ping 20s; visibility reconnect; buffer last 50 with `_seq`; `useWsMessages()` / `useWsConnected()`; `wsSubscribe` narrowing. Dispatch `App.jsx:446-588` by `_seq` cursor: **`state_changed`** → `updateEntityState` (+ camera motion events); `entity_removed`; `entity_renamed`; `mode_changed`; `light_hold_changed`; `command_failed` → toast; `ir_command_detected` → IR state + **toast "Physical remote: {cmd}" only when `source !== 'ziggy_command'`**; `ir_unknown_signal` / `ir_walk_capture` window events; `execution_result` → toast; reconnect → `fetchAll({force:true})`. **No `device_state_updated` handler** (the CLAUDE.md name is not what the frontend listens for).

Store (`deviceStore.js:602-650`): fast-path out when unchanged; only the matched entity gets a new reference; narrow selectors; `DeviceCard` memo'd on entity reference.

**Visual acknowledgement of a remote change: essentially none by design.** Same `[data-on]` crossfade + one-shot ignition for local and remote; slider echo glides; only IR has an origin cue (pulsing dot + toast). No flash, badge, or "changed elsewhere" affordance.

## 6. Numbers — nothing interpolates

No `useMotionValue` / `useSpring` / `useTransform` / count-up in these views. Brightness % (`Math.round(brightness/255*100)`), colour temp `{n}K`, target °C (`ACRemote.jsx:325` `.z-display`, `DeviceControls.jsx:936`, `CompactAcStepper`), current temp (`SensorRemote.jsx:53` 56px hero), sensor values, humidity, power W, battery % (bar width **no transition**), cover %, volume (`VolumeBars` cut), media position (1Hz `setInterval`, the only advancing number), boiler time-left (1Hz), fan %, signal bars, counts, IR learn countdown. Typography `.z-mono`, `.z-display`.

## 7. Icons

`DeviceIcon` three styles (emoji default, line SVG, 3D PNG); custom tokens `kind:` / `icon:`; `fill` mode with `--surface-2` plate for 3D. On vs off: **the glyph is the same asset**; only the box recolours (Devices page `--ink`/`--surface-2`; shared row `color-mix(tint 14%)`; tile tinted/inverted). The only icon motion is `zm-ignite`. **No icon morphs**: Play↔Pause, Lock↔LockOpen, Volume2↔VolumeX hard-swap. `liveTintFor()` derives the bulb colour.

## 8. Realistic content

Entity ids: `light.living_room`, `climate.ac_living_room`, `binary_sensor.motion_living_room`, `binary_sensor.bedroom_occupied`, `switch.switcher_touch_*`, `sensor.switcher_boiler_power`, `light.kitchen`, `switch.kitchen_kettle`, `switch.bedroom_fan`, `switch.living_room_tv`, `ir.<uuid>`, `controller.<signature>`. Hardware: Switcher Touch/Heater/V2/V4/Mini Plug/Breeze/Runner, Sonoff SNZB-04 Pro, Aqara H1M, Broadlink RM4, SLZB-07, LG webOS, Chromecast, Apple TV, Fire TV, Android TV, Tadiran AC.

Store entity shape: `entity_id, state, friendly_name, domain, display_name?, icon?, is_tile?, hidden?` + per-domain attribute whitelist (light: brightness, color_temp, min/max_mireds, rgb_color, hs_color, color_mode, effect…; climate: hvac_mode(s), temperature, current_temperature, fan_mode(s), preset, swing, min/max_temp…; media_player: volume_level, media_title, source(s), app_name…; cover: current_position; fan: percentage; sensor: unit_of_measurement, device_class). **Gaps**: `last_changed`, `color_temp_kelvin`, `battery`, `rssi`, `media_position` are NOT in the list payload. Store-added: `_linkedIr`, `_ir`, `_irDevice`, `_controller`, `_group {group_id, kind, card_kind, name, room, entities[], metrics[], capabilities}`, `_promotedTile`. Capability tokens: `power, brightness, color_temp, color, effects, temp, hvac_mode, fan_mode, swing, preset, volume, mute, prev/next_track, play_pause, sources, dpad, numpad, speed, open, close, stop, position, lock_unlock`.

Copy: `devices.subtitleActive` `{active} of {total} active · {totalEntities} total` / `{active} מתוך {total} פעילים` · filters All/Unassigned/No Room/Offline/Active/Connected/IR Remotes/Smart Sensors (הכל/לא משויכים/ללא חדר/לא מקוונים/פעילים/מחוברים/שלטי אינפרא/חיישנים חכמים) · Show controls/הצגת בקרות · Removed from hub/הוסר מזיגי · Left the hub — pair it again/התנתק מהבית — צריך לצמד מחדש · Controls/Info בקרות/מידע · Not responding? Fix it / לא מגיב? תקן · Brightness/בהירות · Temperature/טמפרטורה · Fan speed/מהירות מאוורר · Open/Close/Stop פתיחה/סגירה/עצירה · Lock/Unlock נעילה/פתיחה · Turn On/Off הפעלה/כיבוי · `Physical remote: {cmd}` / `שלט פיזי: {cmd}` · `{name} did not respond` · On/Off/Unavailable דולק/כבוי/לא זמין.

## 9. What changes and cuts

**State**: tab switch (1); all numbers (2); BatteryBar width (3); Dial arc (4); Signal/Volume bars (5); PresetGauge (6); glyph swaps (7); gradient sliders never reflect on/off (8, deliberate); status badge replacing the state line (9); IR confidence dot band (10); StatusPill tone (11, door open flips off→warn instantly); chip active state background/weight (12); SwitchRemote `opacity .85` competing with breathing (13).

**Position**: Show-controls expansion pushes the grid without FLIP (14); grid reflow on card height change un-FLIPped by design (15); groups below an opened group don't FLIP (16); filter chips have no transition or sliding indicator (17); banners enter with no exit (18); blasters/smart-sensor groups appear after fetch (19); skeleton→content (20); empty↔list (21); DeviceDetail skeleton (22); `FanControls` remounts a different tree on off (23); `MediaPlayerControls` returns null when off (24); `ScrubBar`/`OsNav` pop in/out (25); room-assignment list reveal (26).

**Hierarchy**: an active card only changes colour (27); sort order never changes with state (28); attention banner and card not linked (29); primary/sibling change re-renders cold (30); `data-pending` applied inconsistently (31).

**Context**: list→detail handoff handled (32); cold load / deep link / POP / not-in-store → full page with no transition (33); sibling/crumb navigation within detail = same-route push with only the page rise (34); remote-origin change has no cue (35); `IREditModal` raw fixed div with no animation (36); `PresetMenu` has none (37); nothing on the card records a failed command after revert (38).
