# Dashboard, rooms, presence visualisation, home map, wall (origin/main e44e163)

## 0. Surfaces

Dashboard `pages/Dashboard.jsx` (1634 ln) `/` · Rooms list `pages/Rooms.jsx` `RoomsList` (L505) `/rooms` · Room detail `RoomDetail` (L1138) `/rooms/:roomId` · Home map viewer/builder `pages/HomeMap*.jsx` **NOT ROUTED** (dead code; `Rooms.jsx:8-9` has dead imports of `HomeMapCanvas` and `getMapRoomsSummary`; `T_PRESS` unused) · Wall `pages/Wall.jsx` `/wall` outside AppShell.

## 1. Dashboard hierarchy

`.z-dashboard-outer` (max `--page-max-w-wide` 1240) → `.z-dashboard-grid` (1 col <1024; `minmax(0,1fr) 320px` ≥1024). Main column order (`Dashboard.jsx:1235`):

1. Greeting block (`1245-1279`): eyebrow `greetingByTime()`; hero `.z-display` = `dashboard.homeAwake` / `homeCalm`; status row: 8px dot (green halo or `--line-2`) + `"{n} rooms active"` / `"All quiet"` + presence button.
2. `<ModeChips/>` (5 fixed modes; chip bg/colour swap, `opacity 0.7` while busy, **no transition**).
3. `<SystemHealthBanner/>` when `health.system_health`.
4. Rooms: phone/tablet carousel `.hide-lg` (`C_W 300, C_H 208, C_GAP 16`, scroll-snap centre, rAF-throttled active index) and desktop grid `.only-lg` (`roomsGridShape(n)`, `gridAutoRows 200`, `data-motion-stagger`, JS hover shadow). Both in DOM always.
5. Shortcuts (pill row; dashed CTA fallback).
6. Pinned devices `.z-quick-controls-grid` (2 → 4 cols @768), `data-motion-stagger`.
7. Alerts card `.hide-lg` (max 3 `AlertRow` + "See all N").
8. Tasks peek (feature-gated).
9. Just-now activity `.hide-lg`, collapsed by default, `maxHeight 220`.

Right rail `aside.z-dashboard-rail.only-lg` (sticky, `margin-top 128px`): Alerts (5), **Suggested** (the one accent surface), Recent Activity (`maxHeight 264`).

## 2. Room tile anatomy

**`RoomTileFace`** (`Dashboard.jsx:453-551`): photo (`objectFit cover` + `linear-gradient(180deg, transparent 40%, rgba(0,0,0,.72))`) or `.z-room-plain` + `<Home 28/1.75>`; top row = mark · chips · dot; name 15/600 (#fff on photo); status line 12px tabular.

Data (`buildRoomSummary`, `:33-75`): `activeCount` (lights on + media + climate + fans + switches + vacuums), `offlineCount` (**not rendered** on the dashboard tile), `parts[]` phrases, `tempSensor`/`humSensor` (`findRoomMetric`), `hasMotion`, `occupied` = `roomOccupancy()` **tri-state `true | false | null`**.

Status line: `activeCount > 0 ? "{n} active" : hasMotion ? "motion" : "idle"` + ` · parts[0]` when centred.

**Occupancy today** (`:481-485`): a pill containing only `<User size={14}/>`, bg `color-mix(--ok 55%, transparent)`, rendered **only when `occupied === true`**; `false` and `null` are indistinguishable; mounts/unmounts with no transition. Temperature chip (`:486-496`): `{raw.toFixed(1)}°`, bg `--info 55%` if <18°C, `--err 55%` if >25°C. Humidity chip neutral. Chips 12/16, padding 4/8, `blur(8px)`. Activity dot (`:506-513`): 8px, `--ok` + 3px 30% halo when active; **no transition**.

**Rooms-page `RoomTile`** (`Rooms.jsx:125-290`): `motion.div` fade only when motion is OFF; height `--rooms-tile-h` (136 / 172 @1024); dot top-end (suppressed on hover for the Edit/Delete cluster); chips top-start; count line `"{entityCount} · {n} on | idle" [· {n} off]` (this tile **does** show offline). `RoomReorderRow` = framer `Reorder.Item`, `whileDrag {scale 1.02, shadow-lg}`.

**Tap**: `useRoomTileMotion` → `useLongPress({ms 480})`; tap = `captureOriginFromEvent('room:'+id, e, '[data-room-photo]')` + `navigate('/rooms/'+id)`; long-press = `toggleRoomLights` (majority rule, toast `"{Room} · On|Off"`, forced `fetchAll`). No bottom sheet on these surfaces.

## 3. Room detail (`Rooms.jsx:1138-1739`)

Hero 160px, `borderRadius '0 0 24px 24px'`, `ref={heroRef}` (morph target); photo + double scrim; back `<ArrowLeft>` → `navigate('/rooms')` (not history back) and a kebab (Average temperature, Smart Presence, Edit, Delete); title `.z-display` + one `.z-mono` facts line `Occupied · 24.5° · 41% · {n} on · {n} total · {n} offline` — **the only place "Occupied" appears as a word**.

Body `ref={heroFollowRef}`: All-lights row (`.z-card[data-pending]`, `<Toggle>`, optimistic per-entity with rollback) → Devices in 5 sections `['lights','climate','media','other','sensors']` (lights = 3-col `DeviceCard variant="tile" tileStyle="inverted"`; sensors = `SensorsStrip`; else rows; stagger on the groups) → Capabilities (virtual devices) → Automations rows with `AutomationRunButton`.

## 4. Everything that changes over time and how it renders

| Datum | Render on change |
|---|---|
| Entity state | WS `state_changed` → `deviceStore.updateEntityState` (`602-648`); instant re-render; colour via `[data-on]` CSS only |
| Icon ignition | `zm-ignite` 360ms on `[data-on="true"] [data-motion-icon]` |
| Command in flight | `data-pending` breath 1.1s; QuickControlTile drops opacity 0.7 for toggles, not for scrubs |
| **Occupancy flip** | chip mounts/unmounts, no transition; hero facts string re-joins |
| Active count / dot | instant; dot has no declared transition |
| Room ordering | `sortedRooms` re-sorts active-first (`1146-1158`); **tiles jump with zero animation** |
| Temperature / humidity | instant number swap; chip tint can jump |
| People presence | WS `presence_transition` → refetch; button mounts/unmounts |
| Anomalies | WS → `loadAnomalies()`; Alerts card mounts/unmounts wholesale |
| Health | polled 20s; banner mounts/unmounts |
| Modes | chip bg/colour swap, no transition |
| Activity feed | fetched once on mount, never refreshes |
| Weather | not on the dashboard (wall only) |
| Camera preview | 15s `key={tick}` hard swap |

`Dashboard.jsx` has zero framer-motion; `HomeMapCanvas.jsx` has no animation at all.

## 5. Home map (`HomeMapCanvas.jsx`, unrouted)

Konva. Isometric `w2s`, `WALL_PX 28`, default room sizes by name. AI SVG base layer (button hidden) or `IsoRoomFallback` polygons. **Occupancy is visualised**: top-face fill `#bbf7d0`/`#145028` when `presence === 'occupied'`, `#fef3c7`/`#3d1a00` when `'uncertain'` — the only surface-colour occupancy in the codebase. Anomaly = 5px circle; device pins = white 13px circles with emoji + green dot when on. Drag/zoom/pinch; **no animation**.

## 6. Wall (`/wall`)

Full-viewport fixed; own manifest; body `saturate(0.45) opacity(0.72)` when the socket is down. Header: rail toggle, `ZiggyMark` (2s press = exit), date + greeting, Home/Automations tabs, clock + weather, theme/lang/edit/exit.

`WallGrid`: absolute cards on a 12-col grid (`colsForWidth`), `ROW_H 64`, `GRID_GAP 12`; long-press 320ms pickup, `setPointerCapture`, non-passive touchmove, `vibrate(12)`; `.zw-mod { transition: left/top/width/height .22s cubic-bezier(.2,.8,.2,1) }` — neighbours slide; `.is-dragging` `scale(1.03)` + drop-shadow; drop ghost dashed accent; resize corner. Expansion `ModuleExpanded` `zwPop .16s` scale .96→1, exit cut. 13 modules. `RoomsRail`: fixed furniture, `clamp(230px, 22vw, 310px)`, drawer <821px `translateX(±102%)` `.26s`; single-open accordion, chevron rotates, **room body pops with no height animation**; master switch; `DeviceRow` with pending `zwPending 1s`. **No occupancy or temperature in the rail.** `ZiggyBar` orb `zwOrb 4s` at rest, 1.1s while listening. Idle screen after 300s: black, clock, `zwOrb 3.5s`, `zwDrift 900s` burn-in drift. Reduced motion kills transitions/orbs.

## 7. Loading and empty states

`DataState` is **used nowhere**. Dashboard: no loading state; sections absent when empty; dashed CTAs. RoomsList: 4 static skeleton tiles (`opacity .6`, no shimmer) only on cold start; empty "No rooms yet / Add a room to start organizing devices / Add first room"; "No rooms match that search"; unassigned / no-room CTAs. RoomDetail: 160px skeleton hero + 3 rows; "Room not found"; "No devices in this room" / "All devices are hidden". HomeMap: `animate-pulse` 480px (the only pulse skeleton). Wall: `.zw-empty` strings; `ConnectionChip` waits 2500ms before claiming a problem.

## 8. Realistic content

Room names EN/HE (`nameDict.js:17-47`): Living Room/סלון · Bedroom/חדר שינה · Master Bedroom/חדר שינה ראשי · Kids Room/חדר ילדים · Nursery/חדר תינוק · Bathroom/חדר אמבטיה · Toilet/שירותים · Kitchen/מטבח · Dining Room/פינת אוכל · Office/משרד · Hallway/מסדרון · Entrance/כניסה · Balcony/מרפסת · Garden/גינה · Garage/חניה · Laundry Room/חדר כביסה · Guest Room/חדר אורחים · Gym/חדר כושר · Storage/מחסן · Pantry/מזווה · Roof/גג · Shelter/ממ״ד.

Device names (`nameDict.js:50-149`): Ceiling Light/אור תקרה · Main Light/אור ראשי · Floor Lamp/מנורת רצפה · Table Lamp · Night Light/מנורת לילה · LED Strip/רצועת לד · AC/מזגן · Ceiling Fan · Heater · Thermostat · TV/טלוויזיה · Soundbar · Projector · Streamer · Coffee Machine · Kettle · Robot Vacuum · Door Sensor/חיישן דלת · Motion Sensor/חיישן תנועה · Smoke Detector · Curtain · Blind/תריס · Smart Lock · Smart Plug · Boiler/דוד. Real hardware in comments: "Roni Room Sensor", "Switcher Boiler", Sonoff SNZB-04 Pro, "Office Temp · 25.6°".

Icons: `KIND_META` emoji table (💡 🎛️ 🔌 📺 🔊 ❄️ 💨 🪟 🔒 🛡️ 🤖 🔥 📷 🚶 🚪 👥 🌡️ 💧 🔋 👤 📦; reserved ⚡ ✦ ⚙️ 🏠); three live icon styles; `ZIcon` dashboard set `light, climate, media, lock, fan, plug, check, fwd, bolt, sunrise, sun, sunset, moon, leaf, family`; room detail `RoomZIcon` set.

Copy: `Home is calm`/`הבית רגוע` · `Home is awake`/`הבית ער` · `All quiet`/`הכל שקט` · `{n} rooms active`/`{n} חדרים פעילים` · `Nobody home`/`אף אחד לא בבית` · `{name} home`/`{name} בבית` · `motion`/`תנועה` · `idle`/`במנוחה` · `{n} lights on`/`{n} אורות דולקים` · **`Occupied`/`תפוס`** · `No rooms yet`/`אין עדיין חדרים` · `Add a room to start organizing devices`/`אפשר להוסיף חדר כדי להתחיל לארגן מכשירים` · modes `Sleep/שינה, Movie/סרט, Cleaning/ניקיון, Guests/אורחים, Vacation/חופשה` · wall `Hey Ziggy/היי זיגי`, `Listening…/מקשיבה…`, `TAP TO WAKE/הקישו כדי לחזור`. State labels (EN literals): On/Off · Playing/Paused/Idle · Heating/Cooling · Open/Closed · Locked/Unlocked · Motion/Clear · **Present/Empty** · Home/Away. Scene names: Good Morning/בוקר טוב · Good Night/לילה טוב · Movie Time/ערב סרט · Going Out/יוצא מהבית · Coming Home/חוזר הביתה · All Lights Off/כיבוי כל האורות.

**Not covered by any motion today**: room-tile reorder when a room becomes active, occupancy chip appear/disappear, the map, the rail's room-body expand/collapse, temperature chip tint jumps, activity/alert list insertions.
