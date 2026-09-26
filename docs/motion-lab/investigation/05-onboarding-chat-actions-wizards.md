# Onboarding, chat, actions, bundles, wizards, pairing, IR remote, mobile gestures (origin/main e44e163)

Nothing in this scope consumes `motion/gestures.js` or the `data-motion-*` hooks; these surfaces use plain framer-motion + inline CSS transitions.

## 1. Onboarding

**Web** (`WebOnboarding.jsx`, 268 ln): steps `SETUP → SENSORS → STARTER → NOTIFY → LOCATION → DONE`; advance = bare conditional, **every step is a hard cut**; subtitle swaps in place; **no progress indicator** (only `SensorsStep` has a text `{current} of {total}`); `WebSetupStep` inline error with no transition; `WebLocationStep` foreground geolocation.

**Native** (`MobileOnboarding.jsx`, 662 ln): first pair `PAIR → CLAIM → SENSORS → STARTER → NOTIFY → LOCATION → MOTION → DONE`; subsequent `PAIR → PERSON → …`. Same hard cuts. QR moment = `PairStep`: 34px tracked `codeInput` (LTR, tabular, `ABC123`), Pair → Pairing…, "Scan QR instead" via `CapacitorBarcodeScanner`; **zero motion on the scan/found moment**. Desktop half: `PairWithPhone.jsx` 160px canvas QR + live `mm:ss` expiry, no motion on generate/expire. `LocationStep` uses the `ZiggyPresence` plugin (home r=150m, near r=2000m, ≤18 zones). `MotionStep` auto-skips without the plugin. `PersonStep` 48px rows.

**Shared steps** (`onboarding/steps.jsx`): `SensorsStep` one sensor per screen from the kit manifest, `[Skip this one] [Next / Save and continue]`, index advance re-renders in place (cut). `StarterStep` checkbox cards, `transition: background/border-color var(--dur-state)` but the 24px ink circle + `Check` **appears instantly**; serial install loop, no per-card progress. `NotifyStep` / `PermissionScreen` title + body + Allow / Skip. **`DoneStep`**: 64px `color-mix(--ok 12%)` disc + 32px `Check` + "You're all set." — **static, no scale-in, no check draw**; `Continue` pops at 1000ms with no fade; auto-advance at 1500ms with no exit. Styles: `primaryBtn` ink-on-bg 44px, `transition: background var(--dur-press)` only.

**LoginPage**: dark-pinned; `loading | login | setup`; 20px `z-spin`; submit spinner + "Signing in…"; loading→login swap is a cut; error line no transition. Tagline "Ziggy · Local · Your data".

## 2. Chat

Three mounts, never two: `/chat` page (`AIChat.jsx`, 2285 ln), wide dock (400px `aside`, ≥1024, `AppShell.jsx:80-139`), bottom sheet (`ChatSheet.jsx`). FAB `ChatBubble.jsx`: 56px `--ink` circle, `Logo symbol invert 26`, fixed above the nav, z 35; unread badge from `ziggy_response` pushes; **no keyframes** — transitions only; `[data-open] { opacity 0; scale(.9) }` "the sheet folds into the bubble" beat; tucks with the nav.

Sheet: `PANEL_H_CSS = min(72vh, vh - safe-top - 48)`; keyboard-aware; header-only drag; dismiss 120px / 600px/s; one detent; `Maximize2` → `/chat`, `X`. Route change collapses it.

**Messages** (`Message`, `:135-345`): entry `{opacity 0, y 6|8}` `T_ENTER`; bubble 12/16 padding, `--r-card` with a 6px tail corner on the speaker's side; user inverted; timestamp 12px trailing; `ZiggyAvatar` 28px; action chips with green `Check`; "Said wrong?" TTS flag state machine (text/colour swaps, no motion); `PatternCard` save → instant swap.

**Streaming / thinking**: **no token streaming** — the whole reply is appended at once; only TTS audio streams (MSE). `ThinkingBubble`: three 8px dots `{y [0,-4,0]}` 800ms staggered infinite; Pro-mode 4-stage label cycles at 0/1200/2800/5000ms with `{opacity 0, y 4}`; **not inside AnimatePresence → the dots vanish in one frame** when the reply lands. `LiveUserBubble` dictation with a pulsing dot. Auto-scroll `scrollIntoView({behavior:'smooth'})`.

**Voice**: `orbState idle | listening | transcribing | thinking | speaking`. Composer mic 48px, the one accent element; pointer capture + window-level fail-safes; recording → pulsing ring `motion.span {scale 1→1.55, opacity .55→0}` 1.2s infinite + button `scale(1.06)` + 4px accent ring; Send mode `whileTap {scale .9}`; `vibrate(8)` after the recorder starts. `VoiceWave` 5 bars on `waveBar` — the one ambient loop ("mic is open"). Status pill appears/swaps/disappears **with no transition**. Two capture paths (desktop MediaRecorder + Web SR; mobile SR-only), native Capacitor `SpeechRecognition`.

**Cards** (`ChatCards.jsx`, 13 kinds): `enterProps` `{opacity 0, y 4}` 0.18s `EASE_ENTER` delay `min(order,8) * 0.03`; `useHeightFlip` / `useHeightFollow` WAAPI 240ms for Show all / Less; chip `.zc-chip` transitions + `:active scale(.97)`; container query `@container (min-width: 720px)`; `.zc-cell` hover `translateY(-1px)`. `Chip` is the switch (`aria-pressed`, optimistic `useFlip`, rollback with "Didn't go through" for 1200ms, **explicitly no shake**). Deep link: hover chevron or **500ms long-press on touch** → `useChatNav`. `RoomTile`, `CapabilityTile` (open spans both columns), `WhyNotCard` ("Try a fix"), `NavigateCard` receipt.

**Follow-navigate** (`useFollowNavigateCards.js`): only `msg.live === true` + `card.kind === 'navigate'`; fired once per id in a module-level Set; `loadThreadMessages` never sets `live`. `useChatNav`: wide → dock; `navigate(path, {state:{fromChat:true}})`; then close the sheet.

**Threads** (`ThreadList.jsx`): 48px rows; running threads show a green dot + "Thinking…"; **no reorder/enter animation**; the drawer (`AIChat.jsx:2023-2056`) is a **plain conditional** fixed scrim + 320px panel — cuts in and out.

Other: empty state (the only AnimatePresence on the page) 56px sparkle disc, "What can I do for you?", suggestion chips (Goodnight / Movie time / Who is home? / Good morning); quick-ask chip row above the composer appears with no transition; rehearsal banner cut; diagnostic chip; composer `--r-sheet`, `dir` flips on Hebrew.

## 3. Actions (`Actions.jsx`, 745 ln)

Tabs: **Automatic** / **On-demand** (`role=tablist`), active = `--surface` pill + hairline, `transition: background/color`; **no sliding indicator — the pill's position cuts**. Bodies in `AnimatePresence mode="wait"` with `FADE_UP`. Header `+` → create chooser (`Modal sheet 420`, 3 rows: Automatic / On-demand / From the library). Library `Modal sheet 620` → `TemplatesTab` with `TemplateCard` (chevron rotate, height-auto disclosure). `SuggestionNudgeStrip` max 2, popLayout, `[Add] [Later] [✕]`. "Start with one of these" when `< 3` automations.

`AutomationCard` (146 ln): 40px glyph box, `z-headline` name, `z-subhead` summary, one `z-mono` meta line, warn/danger lines, `Toggle` + Run / View / Delete. `motion.div layout layoutDependency={layoutKey}`, `{opacity 0, y 6}`, exit `{0, scale .98}`. **Run: `triggerAutomation` then toast "Triggered"; no busy state on the card**; outcome arrives as a WS toast (`'{label} — {n} step(s) completed'`, 7s on error). Deep-link focus ring `box-shadow 0 0 0 2px accent 55%` for 3000ms. `layoutKey` excludes climate rows so a late row "just lands". Skeleton 3×82 → list cut. Delete = shared promise confirm modal 380. New automation: `addAutomation` → toast → `fetchAutomations()`; the new card fades+rises, others FLIP.

**Bundle preview** (`BundlePreviewCard.jsx`, 849 ln): `STATUS idle | applying | success | results | undone`. Mount `{opacity 0, y 8}`. Sections Recipes / Occupancy sensors / Modes / Automatic actions / Voice commands / Left out with natural-language `triggerSummary()`. Per-artifact Included/Excluded pill, rename, timeout; excluding sets `opacity .45` **with no transition**. Apply → `Spinner` + "Creating…"; `ResultRow`s pass/fail; **Undo** → `deleteAutomationBundle`; `UNDONE`. Collapse into chat replaces the message in place. **Every view swap is a hard cut; only the initial mount animates.**

**Wizard** (`AutomationWizard.jsx`): steps Name · Trigger · Conditions · Actions · Review; `StepFrame` with `StepDots` (7px pills, current widens to 18px, `transition: width/background`); **body slides** `{opacity 0, x 8} → {0} → {x −8}` `T_ENTER` in `AnimatePresence mode="wait"`; `TriggerEditor` swaps the field set with no transition; conditions with And/Or connectors; actions `Reorder.Group axis="y"`; `ReviewPanel`. Bundle engine: `BundleWizard` (same slide) and `BundleEditor` (**locked `SummaryList` ↔ unlocked `EditorBody` is a conditional cut** — the biggest hierarchy change on the page).

**Routines** (`Routines.jsx`): `RoutineCard` popLayout `{opacity 0, y 8}` exit `{0, .96}`; 34px emoji square `--ok 12%`; Run / View / Edit / Delete; `RoutineWizard` `StepIndicator` (number → ✓ and connector fill **no transition**), body slide 0.15s; `StepRow` collapsed ↔ expanded = **two different renders with no transition**. Step types: device, turn_off_all_lights, turn_off_everything, automation, ir_command, delay, notify, message, media_play. Icons `⚡ ☀️ 🌙 🏠 🎬 🏋️ 🛏️ ☕ 🌿 🔒 💡 🎵`.

**Quick asks** (`QuickAsks.jsx`): 2-col 120px cards, whole card fires the intent; `{opacity 0, y 6}` exit `{0, .97}`; **firing gives only a toast — no press, busy or success state on the card**.

## 4. Pairing (`PairingWizard.jsx`, 997 ln)

`select → idle → pairing → found | timeout | error | switcher_flow` in `Modal fullScreen`. `StepDots` Ready · Pairing · Configure (24px circles, 32px connectors, `transition-colors 200`). Select: 7 protocol rows (Zigbee, Z-Wave, Matter, IR Device, IR Blaster, Wi-Fi, Switcher). Ready: 64px disc + instructions; Matter QR scan. **Pairing**: Zigbee/Z-Wave = 128px `CountdownRing` (`strokeDashoffset` `transition-all 200`) + live seconds + **the one breathing halo** `{scale [1,1.18,1], opacity [.5,.1,.5]}` 2s infinite + "Pairing mode active" + "Scanning for devices…"; Matter = 64px `z-spin`; Wi-Fi/Broadlink = discovered-flow list (no stagger) or `ConfigFlowRunner`. **Found**: `bg-ok-soft` banner + `CheckCircle2` + "Device found!" + name input + `RoomPicker` (`{opacity 0, y −4}`) — **no pop, no check draw, no haptic**. Timeout / error: opacity-only enter, tips block instant. Step swaps `STEP_MOTION` `{opacity 0, y 6} → {0} → {0, −4}` `T_ENTER` `mode="wait"`. **No radar sweep, no ripples, no found "pop"** — the halo and ring are the entire searching vocabulary. `SwitcherPairingFlow`: zero motion, progress auto-advances 2500ms.

## 5. Remote (IR)

`Remote.jsx`: loading state is just a header "Loading…"; loading→loaded is a cut. `DeviceRemote` by KIND. `TVRemote.jsx` (756 ln): top row `repeat(auto-fit, minmax(74px,1fr))` `BigButton` Power (`tone=err`) / Mute / Source / Numpad; `BigButton` press feedback = **`transition: background var(--dur-press)` only** (press scale comes only from the global `pressLayer`, so absent with motion off); d-pad; numpad; `PillBtn` secondaries; volume spinners; `main ↔ numpad` view swap is a grid replacement cut. **No "sent" acknowledgement for an IR press**; failures = toast. `BoilerRemote` has real in-flight state (`busy`, `z-spin`, dial `stroke-dashoffset 1s linear`). `SwitchRemote` optimistic `predictedOn` + `opacity .85`.

## 6. Mobile gestures present

| Gesture | Where | Behaviour |
|---|---|---|
| Swipe-back | `gestures.js:71-166`, `AppShell.jsx:216` | leading 32px edge, 1:1 follow, commit 30% / 500px/s, wrong direction ×0.18, direction-locked, refuses controls, settle 240/200, `haptic(medium)`; `DETAIL_RE` routes, never `/chat` |
| Sheet drag (detents) | `SheetSurface.jsx` | FLICK 900, projection 0.12, rubber-band 0.12, body drag only at scrollTop 0, `haptic(medium)` per detent |
| Chat sheet drag | `ChatSheet.jsx` | header only, dismiss 120px / 600px/s, one detent |
| Library / chooser sheet | `Modal.jsx:30-53` | `[0.6, 1]`, bodyDrag |
| Horizontal scrub | `gestures.js:269-320`; DeviceCard, Dashboard, Devices | brightness by drag across a tile, 5% ticks |
| Long-press → room lights | `Rooms.jsx:136-140`, `Dashboard.jsx:422-434` | 480ms |
| Long-press → device page (chat) | `ChatCards.jsx:426, 443-471` | 500ms touch only |
| Long-press → pick up wall module | `WallGrid.jsx:166, 190-255` | 320ms, `vibrate(12)` |
| Drag reorder (actions) | `AutomationWizard.jsx:228-232` | framer Reorder |
| Drag reorder (hub sections) | `hubStore.js:42-183` | pointer-based |
| Scroll chrome / nav tuck | `gestures.js:327-346` | edge 72, delta 6 |
| Push-to-talk | `AIChat.jsx:1840-1867` | pointer capture + fail-safes |
| Pull-to-refresh | — | **not implemented** |
| Pinch / zoom | — | **not implemented** (except the unrouted map) |

Haptics: `navigator.vibrate` only (`motion.js` + 4 ad-hoc `vibrate(8|12)` sites). **`@capacitor/haptics` is not used.** Capacitor plugins referenced: BarcodeScanner, SpeechRecognition, ZiggyPresence, Geolocation, Network, App, Preferences.

## 7. What cuts

Onboarding: every step advance in both wizards (1-2); subtitle swaps (3); sensor index advance, no progress bar (4); starter check appears instantly (5); **the success moment** (6); pairing error / busy label (7); wall-mode row (8); login loading→login (9); QR generate/expire (10).
Chat: `ThinkingBubble` unmount (11); threads drawer (12); status pill (13); rehearsal banner (14); header chips (15); "New chat" button appearing (16); quick-ask row (17); empty-state exit and list entrance uncoordinated (18); mic ↔ Send glyph cut (19); "Said wrong?" form (20); ThreadList (21); no shared-element fold into the bubble (22).
Actions: tab pill position (23); skeleton→list (24); bundle preview→applying→results→undone (25); include/exclude opacity (26); **locked ↔ editing** (27); trigger type field-set swap (28); `StepIndicator` number→✓ (29); `StepRow` collapsed↔expanded (30); routines skeleton/empty/list (31); quick-ask fires with no on-card state (32); Run/View/Delete no busy state (33).
Pairing: discovered rows no stagger (34); timeout/error enter opacity only (35); "Device found!" no pop (36); Switcher flow no motion (37); ConfigFlowRunner (38).
Remote: loading→loaded (39); no per-press acknowledgement (40); main↔numpad swap (41).
Cross-cutting: `Actions.jsx:521` wraps a plain `<div>` in popLayout so card exits do nothing (42).

## 8. Copy + content

Chat: `What can I do for you?` / `מה אפשר לעשות עבורך?` · `Try: "open shades and start coffee"` / `למשל: ״פתח תריסים והכן קפה״` · `Listening… / Transcribing… / Thinking… / Speaking…` / `מקשיב… / מתמלל… / חושב… / מדבר…` · pro stages `Looking at your home… · Checking which sensors are available… · Designing the bundle… · Almost ready…` · `Hold to speak` / `להחזיק כדי לדבר` · suggestions `Goodnight · Movie time · Who is home? · Good morning` / `לילה טוב · זמן סרט · מי בבית? · בוקר טוב` · `Said wrong?` / `נאמר לא נכון?` · `PATTERN DETECTED` / `זוהתה תבנית` · `Action saved!` / `הפעולה נשמרה!`.
Onboarding: `Welcome to Ziggy Home` / `ברוכים הבאים ל־Ziggy Home` · `You're all set.` / `הכל מוכן.` · `Pair / Pairing… / Scan QR instead` / `צימוד / מצמד… / סריקת QR במקום` · `Confirm your sensors` · `Starter actions` · `Install selected` → `Installing…` · `Allow / Skip for now` · login `Sign in to your home` / `Welcome back` / `טוב לראות אותך שוב`.
Pairing: `Ready · Pairing · Configure` / `מוכן · מצמד · הגדרה` · `Pairing mode active` / `מצב צימוד פעיל` · `Scanning for devices…` / `סורק מכשירים…` · `Device found!` / `נמצא מכשיר!` · `No device detected` / `לא זוהה מכשיר` · `Try again` / `ניסיון חוזר` · `Ziggy found {n} devices ready to add:`.
Actions: title `Actions`, tabs `Automatic / On-demand`, `Start with one of these`, `No Automatic actions yet / Create one to automate your home`; chooser `Automatic — Starts itself — a sensor, a state, or the clock` / `On-demand — You start it — with a tap` / `From the library`; recipes **Leave Home / יציאה מהבית** ("Everyone's out? Ziggy switches things off."), **Pre-cool on Arrival / קירור לקראת הגעה**, **Window Open — AC Off / חלון פתוח — כיבוי מזגן**, **Motion Light / אור לפי תנועה**, Night Watch, Smart Room — {room}, Smart Light Schedule, Climate · {room}; toasts `Action saved` / `Triggered` / `הופעלה` / `{label} — {n} step(s) completed` / `{label} — {n} שלבים הושלמו`; wizard `Name · Trigger · Conditions · Actions · Review`; pro card `ZIGGY PRO · BUNDLE PREVIEW`, `Accept & Create`, `Undo`, `Undone — everything this bundle created was removed.`; routines `New On-demand action`, placeholder `e.g. Good Morning`, `Run now`; intents `Turn off all lights · Set AC in [room] to 22 degrees · Turn on the TV in [room] · Good night · Good morning`.
Quick asks: `Turn off all lights` / `כיבוי כל האורות` · `Who's home?` / `מי בבית?` · `Weather` / `מזג אוויר` · emoji palette `💡 🌡️ 👤 ✅ 🌙 📋 🌤️ 📰 🔒 🛋️ 🌀 🎵 ⚙️ 📦 🏠 ⚡ 🔔 🛒`.
IR walk wizard (the most motion-complete wizard in the repo): `Teach Ziggy your remote` · `Heard it!` · `Ziggy learned your remote's language!` · `You two speak the same language now!`; `ProgressBar` animated width; `CaptureFlash` 96px `--ok` disc `{opacity 0, scale .4} → 1 → exit 1.15`; `ListeningPulse` `Ear` `{scale [1,1.25,1]}` 1.6s; done disc `{scale .5, rotate −12} → {1, 0}`.
