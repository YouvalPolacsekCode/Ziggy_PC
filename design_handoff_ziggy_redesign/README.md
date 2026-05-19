# Handoff: Ziggy Frontend Redesign

> **For the developer (or Claude Code agent) implementing this.**  
> The files in `design/` are **design references created in HTML/React** — prototypes showing intended look, vocabulary, and behavior. They are **not** production code to copy directly. Your task is to **recreate these designs in the existing Ziggy frontend codebase** (`frontend/`) using its current React + Vite + Zustand + Radix + Tailwind stack and established patterns.
>
> Treat `Handover Kit.html` (in this folder, openable in any browser) as the **single source of truth** for scope, fidelity, and what counts as &ldquo;done&rdquo;. This README expands on it with codebase-specific implementation guidance.

---

## 1 · Overview

Ziggy is a self-hosted smart-home + family-assistant app. The current frontend lives at `frontend/src/` and ships **21 user-facing routes** with extensive admin tools. This redesign:

- **Compresses the IA from 21 → 8 routes** (full ledger in §3).
- **Introduces a new visual system** with two palettes: *warm light* (evolved current DNA) and *premium dark* (Josh-inspired).
- **Rebuilds the control vocabulary** to be dial-first, photo-first, and opinionated.
- **Adds first-class RTL/Hebrew parity** as a baseline, not an afterthought.
- **Preserves every existing capability** except the 13 surfaces listed in the pruning contract (§3).

### Non-negotiable

> **&ldquo;I want to see and have any and every capability I currently have.&rdquo;**

Beyond what was formally agreed in the IA pruning discussion, **nothing** in the current app may be missing when the redesign ships. That includes every modal, every wizard step, every settings toggle, every per-domain device controller, the entire admin console, role-gated views, error states, empty states, loading skeletons, and Hebrew/RTL parity for all of it. **If it exists today, it has to exist tomorrow** — redrawn in the new system, but functionally at parity or better.

---

## 2 · Fidelity

The mocks in `design/` are **high-fidelity** for the surfaces they cover:
- Pixel-perfect colors, type, spacing, border-radii, shadows.
- Exact tokens in `design/ziggy-tokens.css` — use these as the source of truth.
- The visual language across screens is consistent — match it precisely.

However, **coverage is partial (~18%)**. Many surfaces are not drawn yet. For those, follow the system established in the drawn screens: same tokens, same type roles, same component patterns. **Do not invent new visual vocabulary** — extend what's there. When in doubt, ask the designer.

---

## 3 · Pruning contract (THE ONLY allowed deletions)

These 13 changes are the **only** deletions/absorptions sanctioned. Anything not on this list must survive the redesign 1:1.

| Verdict | Today | Becomes | Notes |
|---|---|---|---|
| **Killed** | Scenes (`/scenes`) | _gone_ | Quick-routines carousel on Dashboard replaces entry. Delete `pages/Scenes.jsx`, `CreateSceneModal`, scene state. |
| **Deferred** | HomeMap (`HomeMap.jsx`, `HomeMapBuilder.jsx`, `HomeMapCanvas.jsx`) | _hidden behind feature flag, not shipped_ | Confirm: do we hide the admin toggle entirely? See open question §1 of Handover Kit. |
| **Merged** | Routines (`/routines`) | `/automations` (tab: "Active") | `RoutineWizard` (3-step) becomes the "simple" creation path inside Automations. |
| **Merged** | Suggestions (`/suggestions`) | `/automations` (tab: "Suggested") | All four states (pending/accepted/snoozed/rejected) preserved as card treatments. |
| **Merged** | Anomalies (`/anomalies`) | `/alerts` | Three internal tabs (Active / History / Rules) preserved as sub-views or filters. |
| **Merged** | Cameras (`/cameras`) | Rooms (live tile) + Alerts (motion events) | Live MJPEG stream modal survives — invoked from a room's camera tile. |
| **Merged** | Quick Asks (`/quick-asks`) | Settings panel + Dashboard widget | CRUD lives under Settings › Quick Asks. Dashboard `quick_ask` widget surfaces pinned asks. |
| **Merged** | Memory (`/memory`) | Settings panel | CRUD inside Settings. No top-level route. |
| **Demoted** | Tasks (`/tasks`) | Still its own page, removed from bottom-nav | Reachable from Dashboard widget + sidebar/overflow. Page, modals, AI suggestions all preserved. |
| **Demoted** | Virtual Devices (`/virtual-devices`) | `Settings › Admin › Capabilities` | All three sub-surfaces preserved: `AddVirtualDeviceWizard`, `TriggerModal`, edit modal. |
| **Already merged** | Admin Settings | `Settings` (tab: "Admin", role-gated) | Already structurally true. Every sub-section preserved (see §6). |
| **Stays as-is** | `/ops` console | _not part of redesign_ | Super-admin only. Confirm scope. Default: leave untouched. |
| **Stays as-is** | Auth surfaces (`/login`, `/invite/:token`, change-pw drawer) | _redrawn in new tokens but functionally same_ | Public + role-gated routes. |

**Final IA — 8 user-facing routes:**
1. `/` Dashboard
2. `/rooms` (list + `/rooms/:id` detail)
3. `/devices` (list + `/devices/:entityId` detail)
4. `/chat` AI Ask
5. `/automations` (Active + Suggested tabs)
6. `/alerts` (Active + History + Rules tabs)
7. `/tasks`
8. `/settings` (General + Admin tabs)

**Mobile bottom nav (5):** Home · Rooms · Ask · Devices · Automations  
**Secondary (sidebar/overflow):** Alerts · Tasks · Settings

---

## 4 · Existing codebase — what to reuse, what to replace

### Stack (already in place — do NOT switch)
- **React 18** + **Vite** (`frontend/vite.config.js`)
- **React Router v6** (`BrowserRouter`, `Routes`, nested layouts) — see `App.jsx`
- **Zustand** for state (`stores/` — `authStore`, `deviceStore`, `automationStore`, `cameraStore`, `chatStore`, `quickAskStore`, `suggestionStore`, `taskStore`, `uiStore`)
- **Radix Dialog** for modals (`components/ui/Modal.jsx`)
- **framer-motion** for transitions (already imported in Routines, Settings, etc.)
- **Tailwind** (`tailwind.config.js`) — note that current code mixes Tailwind with CSS variables and inline styles; the new tokens lean toward CSS-variable usage. **Keep Tailwind**, but expose all new tokens as CSS variables (see §5).
- **react-router-dom** for navigation
- **lucide-react** icons (you'll see `Bot`, `Key`, `Mail`, `Wifi`, `Sliders`, `Brain`, `User`, `Lock`, `Moon`, `Sun`, etc. throughout)

### System layers (must keep working — do NOT break)
- **WebSocket** (`hooks/useWebSocket.js`) — live HA entity state push, automation refresh, IR command detection, execution results.
- **Push notifications** — service worker registration (`/sw.js`), VAPID subscription in `App.jsx`.
- **Presence pinging** — geolocation `watchPosition` + 2-min keep-alive, `/api/presence/ping` (see `App.jsx`).
- **Auth events** — `ziggy:unauthorized` window event triggers re-login UI without page reload (no WS drop).
- **Role gating** — `useAuthStore` exposes `role`; check with `hasRole(role, 'admin'|'super_admin')`.
- **Toasts** — `useUIStore().addToast(message, type, durationMs)` with types `success | info | warning | error`.

### Existing UI components to redress (don't replace wholesale)
| Component | Path | Action |
|---|---|---|
| `Modal` | `components/ui/Modal.jsx` | Restyle to match new tokens (border-radius 18, surface, hairline, ink). Keep Radix Dialog underneath. |
| `Button` | `components/ui/Button.jsx` | Define variants matching `.z-btn-primary` / `.z-btn-secondary` (see §5 utility classes). |
| `Card` | `components/ui/Card.jsx` | Match `.z-card` / `.z-card-soft`. |
| `Toggle` | `components/ui/Toggle.jsx` | Restyle thumb/track in new ink/surface tokens. |
| `Slider` | `components/ui/Slider.jsx` | Match `.z-slider-track` / `.z-slider-fill`. |
| `Input`, `Select` | same folder | Restyle field, focus ring (`outline: 2px solid var(--accent)`). |
| `Toast` | same folder | Stack rules, auto-dismiss timings (3s / 7s for errors). |
| `EntitySelect` | same folder | Dropdown that escapes overflow-hidden — keep behavior, restyle. |
| `IntentParamForm`, `DeviceControls` | same folder | **Keep all 8 domain controllers logically intact** — restyle visuals per §7. |
| `AppShell`, `BottomNav`, `Sidebar` | `components/layout/` | Rebuild around the new 5-tab bottom nav + secondary sidebar/overflow. |
| `VoiceOrb` | `components/orb/VoiceOrb.jsx` | **Confirm fate** — IA doc says it goes away (replaced by Ask tab), but see open question §5. Default: remove. |

### Existing pages — migration table

| Today's page | Action | New home |
|---|---|---|
| `Dashboard.jsx` | Rebuild | `pages/Dashboard.jsx` — new hero + quick routines + controls grid + 6 widgets (alerts, presence, active_rooms, security, activity, quick_ask) |
| `Rooms.jsx` (RoomsList + RoomDetail) | Rebuild | Same file. Photo-first tiles, hero photo on detail, grouped device sections. |
| `Devices.jsx` | Rebuild | Grouped-by-room layout. Preserve all card variants (Wi-Fi standalone, IR standalone, IR-merged-with-Wi-Fi). |
| `DeviceDetail.jsx` | Rebuild | Hosts the 8 domain controllers + rename modal + room reassign. |
| `Automations.jsx` | Rebuild | Two tabs: Active, Suggested. Library modal. Two wizards (full Automation + simpler Routine). |
| `Routines.jsx` | Delete the route, **keep RoutineWizard logic** | Merge wizard into `Automations.jsx` as the "simple" path. |
| `Suggestions.jsx` | Delete the route, keep suggestion store + logic | Surface inside Automations "Suggested" tab. |
| `Anomalies.jsx` | Delete the route, **keep all logic** | New `pages/Alerts.jsx` with Active/History/Rules tabs. |
| `Cameras.jsx` | Delete the route, **keep LiveModal + motion log** | LiveModal invoked from RoomDetail camera tile. Motion events feed Alerts. |
| `Memory.jsx` | Delete the route, keep CRUD | New panel inside Settings. |
| `QuickAsks.jsx` | Delete the route, keep CRUD | New panel inside Settings + Dashboard widget. |
| `Tasks.jsx` | Keep, restyle | Same route, just not in bottom nav. |
| `VirtualDevices.jsx` | Restyle, move | New home: `Settings › Admin › Capabilities` (sub-route or panel). |
| `Scenes.jsx` | **Delete entirely** | Route + page + CreateSceneModal + scene-related store actions. |
| `HomeMap*.jsx` | Leave dormant | Behind feature flag. Don't link to from new nav. |
| `Settings.jsx` | Rebuild | General + Admin tabs. Absorbs Memory + Quick Asks panels. |
| `AdminSettings.jsx` | Restyle, keep all sections | Lives inside Settings's Admin tab. |
| `AdminConsole.jsx`, `CloudAdmin.jsx`, `DebugPage.jsx` | **Out of scope** | Keep current visuals. |
| `LoginPage.jsx`, `AcceptInvite.jsx` | Rebuild in new tokens | Same routes, new look. |

---

## 5 · Design tokens (the source of truth)

**Both palettes are defined in `design/ziggy-tokens.css`. Copy the variables into `frontend/src/index.css` (or a new `tokens.css` imported from `main.jsx`). Scope by `[data-palette="light"|"dark"]` on `<html>` or a root container.**

### Warm light palette
```css
[data-palette="light"] {
  --bg: #F5F2ED;     --bg-2: #EDE8E0;     --bg-3: #E5DFD4;
  --surface: #FFFFFF; --surface-2: #F8F4EE; --surface-3: #EFE9E0;
  --ink: #1E1812;    --ink-2: #3A2E22;    --ink-mute: #6E5A48;
  --ink-faint: #9E8B78; --ink-ghost: #C7BAA9;
  --line: #DDD6CA;   --line-2: #CABFAE;   --line-3: #B7A992;
  --accent: #C96442; --accent-2: #F7E8E2; --accent-3: #A14F31;
  --ok: #3D8A5F;     --warn: #B07820;     --err: #C24530;
  --info: #3D6A9E;   --gold: #C99845;
  --shadow-sm: 0 1px 0 rgba(0,0,0,0.04);
  --shadow-md: 0 1px 0 rgba(0,0,0,0.04), 0 8px 24px -12px rgba(0,0,0,0.10);
  --shadow-lg: 0 1px 0 rgba(0,0,0,0.04), 0 24px 48px -24px rgba(0,0,0,0.16);
  color-scheme: light;
}
```

### Premium dark palette
```css
[data-palette="dark"] {
  --bg: #0A0907;     --bg-2: #0F0E0B;     --bg-3: #161410;
  --surface: #1A1714; --surface-2: #221E19; --surface-3: #2C2620;
  --ink: #F2EBDE;    --ink-2: #D8CFBE;    --ink-mute: #9A907F;
  --ink-faint: #645B4E; --ink-ghost: #3D3730;
  --line: #2A241D;   --line-2: #3A3327;   --line-3: #524837;
  --accent: #E27A55; --accent-2: #2A1A12; --accent-3: #F19475;
  --ok: #6CBF8C;     --warn: #E0AC5C;     --err: #E27A55;
  --info: #7AAEE0;   --gold: #D7AE6A;
  --shadow-sm: 0 1px 0 rgba(0,0,0,0.4);
  --shadow-md: 0 4px 16px -4px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(255,230,180,0.04);
  --shadow-lg: 0 24px 60px -24px rgba(0,0,0,0.9), 0 0 0 0.5px rgba(255,230,180,0.04);
  color-scheme: dark;
}
```

### Typography
- **Display / UI**: `Heebo`, 300/400/500/600/700/800 (Hebrew + Latin)
- **Mono / data**: `IBM Plex Mono`, 400/500/600
- **Optional**: `Inter` for desktop interfaces

```css
.z-display { font-weight: 700; letter-spacing: -0.025em; line-height: 1.04; }
.z-title   { font-weight: 600; letter-spacing: -0.015em; }
.z-eyebrow {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-faint);
  font-weight: 500;
}
.z-mono { font-family: 'IBM Plex Mono', monospace; font-feature-settings: "ss01", "tnum"; }
```

### Surfaces & utilities
```css
.z-card       { background: var(--surface);   border: 0.5px solid var(--line); border-radius: 18px; }
.z-card-soft  { background: var(--surface-2); border: 0.5px solid var(--line); border-radius: 16px; }

.z-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 11px; border-radius: 999px;
  background: var(--surface-2); border: 0.5px solid var(--line);
  font-size: 11.5px; font-weight: 500; color: var(--ink-2); line-height: 1;
}
.z-chip-accent { background: var(--accent-2); color: var(--accent-3); }

.z-icon-btn {
  width: 36px; height: 36px; border-radius: 12px;
  background: var(--surface-2); border: 0.5px solid var(--line);
  display: flex; align-items: center; justify-content: center; color: var(--ink-2);
}

.z-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; }
.z-dot-on   { background: var(--ok);   box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 22%, transparent); }
.z-dot-warn { background: var(--warn); box-shadow: 0 0 0 3px color-mix(in srgb, var(--warn) 22%, transparent); }
.z-dot-err  { background: var(--err);  box-shadow: 0 0 0 3px color-mix(in srgb, var(--err) 22%, transparent); }
.z-dot-info { background: var(--info); box-shadow: 0 0 0 3px color-mix(in srgb, var(--info) 22%, transparent); }

.z-slider-track { height: 6px; border-radius: 999px; background: var(--line); position: relative; overflow: hidden; }
.z-slider-fill  { position: absolute; inset: 0 auto 0 0; background: var(--ink); border-radius: 999px; }
```

### Buttons (define as variants of `<Button />`)
```css
.z-btn-primary {
  background: var(--ink); color: var(--bg);
  padding: 10px 16px; border-radius: 10px; border: none;
  font-size: 13px; font-weight: 600; cursor: pointer;
}
.z-btn-secondary {
  background: var(--surface); color: var(--ink);
  border: 0.5px solid var(--line);
  padding: 10px 16px; border-radius: 10px;
  font-size: 13px; font-weight: 600; cursor: pointer;
}
```

### Focus state (global)
```css
button:focus-visible, input:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
```

---

## 6 · Per-screen specs

Each screen below tells you **what to build, what to preserve from the current page, and what surfaces feed it**. Open `design/Ziggy redesign.html` in any browser to see the live mocks alongside this.

### 6.1 Dashboard (`/`)
- **Layout**: phone-first column. Greeting block (eyebrow + display title + status row with `z-dot`) → hero room card (220px) → quick-routines carousel → 2-col controls grid → today's tasks peek → recent activity strip.
- **Hero card**: rounded 22px, image with gradient overlay, room name chip top-left (blurred glass), temp/humidity top-right (mono), now-playing bottom-left.
- **Quick routines**: horizontally scrollable chips, active state inverts (background `var(--ink)`, foreground `var(--bg)`). Replaces Scenes entirely.
- **Quick controls**: 2×2 grid of `ControlTile` (icon + label + sub + on/off pill). Reuse pattern for any tile.
- **Widgets** (preserve all 6 from current `Dashboard.jsx`): `alerts`, `presence` (Who's home), `active_rooms`, `security`, `activity`, `quick_ask`. User-reorderable (use existing logic).
- **Bottom nav active**: `home`.
- **Live state**: hero + tiles update via WebSocket; show subtle "syncing" treatment when disconnected.

### 6.2 Rooms list (`/rooms`)
- **Tiles** 2-col grid. Each tile 156px tall, full-bleed photo, gradient overlay, status dot top-right (`z-dot-on` if devices active, `z-dot-info` if motion), name + `${devices} · ${active}` mono bottom.
- **Search bar**: full-width pill, `z-icon-btn`-styled icon, placeholder text in `--ink-faint`.
- **View toggle** (top-right): Tiles ⟷ Map. Map is disabled if HomeMap is hidden.
- **Modals preserved**: AddRoom, EditRoom (photo picker + custom upload), DeleteRoom confirm with consequences ("X devices will be unassigned"), AssignDevice picker.

### 6.3 Room detail (`/rooms/:id`)
- **Hero**: 220px photo with two-stop gradient, back/more icon buttons (blurred glass), title (28px, -0.025em) + temp/humidity inline, status row.
- **Room toggle row**: big "Everything off" CTA (full-width `--ink` button) + secondary AI/sparkle icon button.
- **Grouped device sections**: each starts with an eyebrow (`Lights · 2 of 3 on`).
  - **Lights**: 3-col grid of square tiles. On-state inverts background. Show icon (gold when on), name, value (`90%` / `off`).
  - **Climate**: row card with icon-tile + label + temp +/- stepper (mono center).
  - **Media**: row card with album/source + circular play/pause button.
  - **TV / IR**: row card with "Remote" button that opens **IRRemoteDrawer** (bottom sheet).
  - **Cover / Fan / Lock / Vacuum**: sections owed — match the same row-card pattern.
- **Sensors strip**: 3-col mini-cards (icon + value mono + label).
- **Camera tile** (if room has one): rectangular photo strip with "Live" badge — tap opens `LiveModal`.
- **Bottom nav active**: `rooms`.

### 6.4 Devices (`/devices`)
- **Grouped by room** (NOT flat). Each group has a header (room name + count + status). Tapping the room header jumps to `/rooms/:id` (bidirectional).
- **Search bar** at top (same pattern as Rooms).
- **Pair button** (header right) opens `PairingWizard`. From there, branching paths: Wi-Fi auto-discovery, Zigbee permit-join, IR (hands off to `IRWizard`).
- **Card variants preserved**:
  - Wi-Fi/Zigbee standalone: HA controls inline (toggle/slider/temp).
  - IR standalone: shows "Remote" button → opens `IRRemoteDrawer`.
  - IR-merged-with-Wi-Fi: HA controls + IR Power-On row + Remote button.
- **Filter chips**: domain (light/climate/media/cover/fan/lock/vacuum/sensor/switch) + status (on/off/unreachable).

### 6.5 Device detail (`/devices/:entityId`)
- **Header**: device name (rename via tap → `RenameModal`), assigned room (tap to reassign), domain badge.
- **Primary control surface**: dispatches on `entity.domain` exactly as `DeviceControls.jsx` does today. **All 8 controllers must work** — see §7 for the per-domain spec.
- **History strip**: 24h sparkline of state changes (on/off ticks, value graph for sensors).
- **Metadata**: HA entity ID (mono), unique_id, integration, last_changed, last_updated.
- **Destructive**: "Remove from Ziggy" at the bottom — confirm modal.

### 6.6 AI Chat / Ask (`/chat`)
- **Replaces the floating voice orb** (default — confirm in open questions).
- **States**:
  - Idle: input chip + suggested asks (from Quick Asks).
  - Listening: live waveform, transcript appears in real time.
  - Processing: skeleton "thinking" indicator.
  - Responding: token-streamed bubble.
  - Compound command: shows a preview ("I'll turn off the living room lights AND lock the front door — confirm?").
- **History scrollback**: previous user/assistant turns. Long-press to copy / regenerate.
- **Voice toggle**: mic icon prominent. Permission-prompt UX needed if denied.
- **Bottom nav active**: `ask`.

### 6.7 Automations (`/automations`)
- **Two tabs**: `Active` (currently-enabled automations + favorited routines) · `Suggested` (AI-proposed).
- **Active tab**: list cards showing trigger summary + actions count + enable toggle. Tap → `AutomationViewModal` (read-only summary) → "Edit" reopens wizard.
- **Suggested tab**: card per suggestion with Accept · Snooze · Dismiss. All four states preserved (pending/accepted/snoozed/rejected).
- **Library button**: opens `LibraryModal` with template cards, each prefills `AutomationWizard`.
- **Create button**: opens `AutomationWizard` (full) or `RoutineWizard` (simple) — design a step-zero picker, or default to the simpler wizard with an "advanced" toggle.
- **AutomationWizard fields** (preserve all):
  - **Trigger types**: `time`, `state`, `zone` (enter/leave home), `sunrise`, `sunset`, `webhook`.
  - **State per-domain operators**: see `pages/Automations.jsx` line 27+. Motion/door/window/lock/smoke/gas/moisture/etc. each have specific on/off labels (e.g. door "Opens" / "Closes"; lock "Locks" / "Unlocks").
  - **Conditions**: entity-state (with `is` / `is_not` / `above` / `below` operators) + time-window.
  - **Actions**: `call_service`, `ir_command`, `ziggy_intent`, `send_intent`, `delay`, `notify`. Each has its own form.
- **RoutineWizard**: 3 steps — Name · Steps · Review (currently in `pages/Routines.jsx`).
- **Bottom nav active**: `automations`.

### 6.8 Alerts (`/alerts`)
- **Three tabs preserved**: `Active` · `History` · `Rules`.
- **Active tab**: list of unresolved anomalies. Severity color (`err` / `warn` / `info`). Per-alert actions: Acknowledge · Snooze (1h / 24h) · Mute device.
- **History tab**: time-bucketed list. "Today" / "This week" / "Earlier".
- **Rules tab**: editable rule list (entity, condition, severity, dedupe window). Add/edit/delete.
- **Header counts**: critical / warning / today's events.
- **Sub-rails**: offline devices, low battery — feed in here from existing data sources.
- **Cross-feeds**: motion events from cameras land here; binary sensor pushes land here.

### 6.9 Tasks (`/tasks`)
- **Same logic as current `pages/Tasks.jsx`**. Restyle only.
- **Add/Edit modals preserved**. Fields: title, assignee, due, recurring rule.
- **AI suggestions row**: distinct treatment (purple accent or sparkle icon).
- **Reachable**: Dashboard widget + sidebar/overflow. NOT in bottom nav.

### 6.10 Settings (`/settings`) — General tab
Preserve every section from current `Settings.jsx`:
1. **Appearance** — light/dark toggle (drives `data-palette`).
2. **Language & Region** — language picker (incl. Hebrew) + timezone + Save.
3. **Account** — signed-in user, role badge, Change password (inline expand-drawer), Sign out.
4. **System Status** — live health card. OK / degraded / down states.
5. **Presence tracking** — per-person rows (name, mode: always/home/away, distance, last seen). Owns geolocation prompt UX.
6. **Zigbee Bridge** — coordinator info, paired count, "Permit join 60s" action.
7. **Users & Access** — super-admin only.
8. **Quick Asks** — new panel (CRUD list, Create modal, Edit modal). Migrate from `pages/QuickAsks.jsx`.
9. **Memory** — new panel (profile-grouped list, search, Add modal, Edit modal). Migrate from `pages/Memory.jsx`.

### 6.11 Settings (`/settings`) — Admin tab (role-gated)
Preserve every section from current `AdminSettings.jsx`:
1. **Notifications** — push subscriptions, channel toggles, test notification.
2. **API Keys** — Anthropic, OpenAI, Gemini, etc. Masked entry, "test", per-key model.
3. **Email (SMTP)** — host, port, username, password, from, TLS, test-email.
4. **MQTT** — broker config. Show **"Restart required"** badge after save.
5. **Feature Flags** — `smart_home`, `voice`, `task_tracking`, `file_management`, `home_map`, `buddy_mode`, `ifttt`, `local_storage`, `zigbee_support`. **Restart required.**
6. **Developer Tools** — dry-run mode, verbose logging, replay last intent.
7. **Ollama** — endpoint URL, model picker, temperature.
8. **Pattern Learning** — per-domain toggles, sensitivity slider, "forget patterns" destructive.
9. **Capabilities (Virtual Devices)** — new home for `pages/VirtualDevices.jsx`. Preserve `AddVirtualDeviceWizard` (3-step) + `TriggerModal` + edit modal.

### 6.12 Tablet wall display (10")
- Horizontal layout. Big clock + weather. Active rooms grid. Quick controls along the bottom. No bottom nav (touch-down dock).
- Designed in `design/ziggy-screens-*.jsx` — see `TabletWallDisplay`.

### 6.13 Desktop dashboard (web)
- Sidebar nav (left). Main grid: hero + widgets + room grid.
- Designed — see `DesktopDashboard`.

### 6.14 Onboarding (first run)
- Drawn as a trio: voice permission → location permission → push permission.
- Owed: invite redemption flow → household member invites → "ready to use" state.

### 6.15 RTL / Hebrew
- Every screen must mirror cleanly. Drawn for Dashboard — apply same audit to every other screen.
- Directional icons (back/forward arrows) flip.
- Bottom nav order flips.
- Sliders flip direction (`z-slider-fill` anchors right).
- Number formatting stays LTR (`unicode-bidi: plaintext` on mono spans).

---

## 7 · Device controllers (per HA domain)

Eight controllers live in `frontend/src/components/ui/DeviceControls.jsx`. Restyle each — **don't change the dispatch logic** (`switch (entity.domain)`).

| Domain | Surface vocabulary |
|---|---|
| `light` | Brightness slider (`z-slider-track`), color picker (hue ring or swatch grid), color-temp warm↔cool slider, favorite colors row, on/off toggle. **Drawn ✓** |
| `climate` | Mode chips (heat/cool/auto/dry/fan), large setpoint dial (numeric mono in center, +/- on sides), fan speed chips, swing toggle, humidity target. **Drawn ✓** |
| `media_player` | Play/pause big circle, prev/next, volume slider, mute, source select, shuffle, repeat, queue list. |
| `cover` | Open / Close / Stop trio, position slider 0–100, tilt slider for blinds (if supported). |
| `fan` | Speed chips (off/low/med/high/preset), oscillate toggle, direction toggle. |
| `lock` | Lock/Unlock big button (color shifts), "Locked by Maya 14m ago" attribution, keypad code management (if HA exposes). |
| `vacuum` | Start / Pause / Dock / Spot row, battery indicator, current room badge, recent clean history list. |
| Generic fallback | Domain-aware: switch (`Toggle`), binary sensor (read-only `z-dot` + state label), sensor (large value + unit + 24h sparkline), script (Run button), automation (toggle + Edit), button (Press), scene (Activate — but Scenes are killed, leave the dispatch for safety). |

### IR controllers (separate vocabulary)
- **IRRemoteDrawer** (`DeviceControls.jsx` line 1001) — full bottom sheet. **Drawn ✓** Layout varies by IR category (TV vs AC vs fan vs audio):
  - **TV**: power, channel +/-, volume +/-, mute, digit pad 0–9, source, navigation D-pad, OK, back, home, menu, color buttons.
  - **AC**: power, mode (cool/heat/dry/fan/auto), temp +/-, fan speed, swing.
  - **Fan**: power, speed +/-, oscillate.
  - **Audio**: power, volume, source, play/pause, prev/next.
- All button presses fire `ir_command` actions. Physical remote presses are detected via WebSocket (`ir_command_detected` message) and reflected back into the UI + toast.

---

## 8 · Modals & wizards inventory

All 20 must exist. Style each with `Modal` (Radix) using new tokens.

### Wizards (multi-step, 7 total)
1. **PairingWizard** — `components/PairingWizard.jsx`. Branches to Wi-Fi / Zigbee / IR.
2. **IRWizard** — `components/IRWizard.jsx`. ~5 steps: pick category, capture codeset, map buttons, name, assign to room.
3. **AutomationWizard** — inside `pages/Automations.jsx`. Trigger → Conditions → Actions → Review.
4. **RoutineWizard** — inside `pages/Routines.jsx`. Name → Steps → Review.
5. **AddVirtualDeviceWizard** — inside `pages/VirtualDevices.jsx`. Capability → Configure → Assign.
6. **TriggerModal** — runtime-params prompt for capabilities with required input.
7. **InviteModal** — `pages/CloudAdmin.jsx`. Two modes: invite user / new home. **Stays in /ops, out of scope.**

**Pattern decision needed** (Handover Kit §08): modal-over-page vs full-screen takeover. Recommendation: **full-screen takeover for 4+ step wizards** (IR, Pairing, full Automation), **modal-over-page for ≤3-step** (Routine, Virtual Device).

### Simple modals (13)
- AddRoom, EditRoom, DeleteRoom confirm, AssignDeviceToRoom (in `pages/Rooms.jsx`)
- AddTask, EditTask (in `pages/Tasks.jsx`)
- AddMemory, EditMemory (in `pages/Memory.jsx` — moves to Settings panel)
- CreateQuickAsk, EditQuickAsk (in `pages/QuickAsks.jsx` — moves to Settings panel)
- RenameDevice (in `pages/DeviceDetail.jsx`)
- LinkIrToWifi, IREdit (in `pages/Devices.jsx`)
- AutomationViewModal, LibraryModal (in `pages/Automations.jsx`)
- LiveCameraModal (in `pages/Cameras.jsx`)
- Generic delete-confirm pattern (used across rooms, automations, tasks, memory, quick asks, virtual devices — extract into one component).

### Drawers
- **IRRemoteDrawer** — bottom sheet, see §7.
- **Change password** — inline expand-drawer inside Settings › Account (NOT a modal). Already in `Settings.jsx`, restyle in place.

---

## 9 · Interactions & behavior

### Live state
- WebSocket pushes `state_changed` events with `entity_id` + `new_state` + `attributes`. `useDeviceStore().updateEntityState(...)` already handles this — every tile reading from the store updates automatically.
- Show a subtle "syncing" treatment when `connected === false`. Suggested: dim borders + a `z-dot-warn` in the app shell.
- **Physical IR remote detection**: WS event `ir_command_detected` triggers a toast (`"Physical remote: power"`) AND updates the IR entity's assumed state. Already wired in `App.jsx`. Just style the toast.

### Execution results
- WS event `execution_result` reports automation/routine runs:
  - Success: toast `${label} — ${steps_total} step(s) completed`.
  - Failure: 7-second toast `${label} — ${steps_failed}/${steps_total} failed: ${first_error}`. Should support an "expand" affordance to see all step errors.

### Transitions
- Tabs: instant.
- Modal open/close: 150ms ease-out (Radix default).
- Sheet/drawer: 220ms cubic-bezier(0.32, 0.72, 0, 1) — iOS-feeling.
- Page transitions: framer-motion `initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}` — already used in Routines, follow this pattern.
- Slider thumb drag: native, no transition during drag.

### Empty states (every list)
Each gets:
1. Iconographic illustration (placeholder OK for now).
2. One-line "no X yet" headline.
3. Two-line explainer.
4. Primary CTA.

Lists that need empty states: rooms, devices, automations (active + suggested), alerts (active + history + rules), tasks, memory, quick asks, cameras, virtual devices.

### Loading skeletons
- Match silhouette of final content. Use `--surface-2` shimmer.
- First load only — subsequent re-fetches keep stale content visible (optimistic UI).

### Error states
- Network down banner (top-of-app strip, `--err` background).
- Per-screen: "Couldn't load — Retry" inside the affected section, not full-screen.
- Per-action: error toast + leave optimistic state un-rolled back if appropriate.

### Permission prompts
- Voice mic: triggered from Ask tab or onboarding. Permission-denied: show "enable in browser settings" hint with re-try.
- Geolocation: from Settings › Presence tracking or onboarding. Already gated by `navigator.permissions?.query` — see `App.jsx`.
- Push: from Settings › Notifications or onboarding. Already gated.

---

## 10 · State management

All state stays in existing Zustand stores. New surfaces (Alerts, Settings panels for Memory/QuickAsks) consume from the same stores — **don't fork the data layer**.

- **`uiStore`** — theme, toasts, modals-open flags.
- **`authStore`** — user, role, login/logout, `ziggy:unauthorized` listener.
- **`deviceStore`** — entities map, room assignments, `updateEntityState`. Single source of truth for HA state.
- **`automationStore`** — automations list, fetch, CRUD. `fetchAutomations()` already auto-fires on WS `ziggy_response` events for automation intents.
- **`cameraStore`** — cameras list + live motion event log (last 50). Feed Alerts from here.
- **`chatStore`** — conversation history.
- **`taskStore`** — tasks list + AI suggestions.
- **`quickAskStore`** — pinned asks.
- **`suggestionStore`** — AI automation suggestions (pending/accepted/snoozed/rejected).

**New** for the redesign:
- **`alertStore`** (new) — unifies Anomalies + offline-device + motion events into one queryable feed. Wire to existing WS messages — no new backend needed.
- **`paletteStore`** (or extend `uiStore`) — drives `data-palette` attribute on root.

---

## 11 · Assets

- **Fonts**: Heebo + IBM Plex Mono via Google Fonts (already imported in `ziggy-tokens.css`).
- **Icons**: `lucide-react` (already a dependency). The `ZIcon` component in `ziggy-atoms.jsx` is a thin lookup wrapper — use lucide directly in production code.
- **Room photos**: `roomPhotos.js` lib already exists in current codebase with preset bundle. Preserve it. Add custom-upload path (already partial).
- **Hero / placeholder imagery**: the mocks use Unsplash URLs. Replace with bundled assets or let users supply their own room photos.

---

## 12 · Build order (recommended phasing)

1. **Tokens + base components** (1–2 days): copy `ziggy-tokens.css` into `index.css`, restyle `Modal`, `Button`, `Card`, `Toggle`, `Slider`, `Input`, `Select`, `Toast`. Verify both palettes.
2. **App shell + nav** (1 day): new `BottomNav` (5 tabs) + `Sidebar` (3 secondary). Light/dark toggle wired to `data-palette`.
3. **Dashboard + Rooms + RoomDetail** (3 days): the three highest-traffic surfaces. Includes hero card, photo tiles, room toggle, grouped sections.
4. **Devices + DeviceDetail + 5 missing controllers** (4 days): Media, Cover, Fan, Lock, Vacuum, Generic. IR drawer restyle.
5. **Automations (Active + Suggested) + AutomationWizard + RoutineWizard + LibraryModal** (4 days): the biggest single chunk.
6. **Alerts (Active + History + Rules)** (2 days): new page, ingests existing data sources.
7. **AI Chat states** (2 days): listening, processing, responding, compound preview.
8. **Tasks** (1 day): restyle existing.
9. **Settings (General + Admin) + absorbed panels (Memory, QuickAsks, Capabilities)** (4 days): every sub-section.
10. **PairingWizard + IRWizard** (3 days): full re-skin.
11. **Auth (Login + Invite)** (2 days).
12. **Onboarding flow** (2 days).
13. **Empty/loading/error states pass** (2 days): comb every list.
14. **RTL audit** (2 days): every screen.
15. **Tablet + Desktop variants** (3 days): for the primary surfaces.

**Total ballpark: ~35 dev-days for full parity + redesign.** Sequence so something user-visible ships every week.

---

## 13 · Files in this bundle

| File | Purpose |
|---|---|
| `Handover Kit.html` | The brief — open in browser. Pruning contract + coverage matrix + definition of done. **Read first.** |
| `handover.css` | Styles for the handover kit. |
| `design/Ziggy redesign.html` | Live mocks. Open in browser to see every drawn surface. |
| `design/ziggy-tokens.css` | **The token source of truth.** Copy variables into `frontend/src/index.css`. |
| `design/ziggy-atoms.jsx` | Icons, PhoneShell, BottomNav, ControlTile, Eyebrow — reference patterns. |
| `design/ziggy-screens-{1..4}.jsx` | Per-section screen mocks. Reference layouts. |
| `design/ziggy-canvas.jsx` | Canvas composition — maps every screen pair into the artboard grid. |
| `design/design-canvas.jsx` | Canvas chrome (pan/zoom). Not relevant to implementation. |

---

## 14 · Open questions (resolve before building)

These are documented in `Handover Kit.html §08`, but called out here so they're not missed:

1. **Is `/ops` (admin console) in scope?** Default: out. Confirm.
2. **Confirm HomeMap stays deferred, including admin feature-flag visibility.**
3. **Virtual Devices visibility**: under admin only, or surfaced for power users?
4. **Wizard pattern**: modal-over-page, full-screen takeover, inline expansion? Pick one rule.
5. **Floating voice orb fate**: killed (default per IA), or kept alongside Ask tab?
6. **Alerts nav depth**: secondary nav OK, or should it be in the bottom 5?

---

## 15 · Definition of done

The handover kit (`Handover Kit.html §07`) lists 14 acceptance criteria. The condensed version:

- [ ] Every today-route either has an artboard or is on the §3 pruning ledger.
- [ ] All 20 modals/wizards have at least one drawn state.
- [ ] All 8 device controllers work in the new system.
- [ ] All 15 settings sub-sections exist somewhere in new Settings.
- [ ] Every primary screen has light + dark + RTL variants.
- [ ] Every list has empty, loading, and error states.
- [ ] Role-gated surfaces have a designed denial (not silent redirect).
- [ ] Every destructive action has a consequence-explaining confirm.
- [ ] Onboarding connects start-to-finish.
- [ ] Tablet + Desktop cover the same primary surfaces as phone.
- [ ] Live state affordances: syncing dot, disconnected banner, physical-remote toast.
- [ ] Sign-off on each pruning decision in §3.

---

**Questions during build → ping the designer.** The redesign is opinionated; preserve that. When in doubt, match the drawn screens' vocabulary rather than inventing.
