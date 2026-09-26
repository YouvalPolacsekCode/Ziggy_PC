# Ziggy frontend visual system — map for prototyping (origin/main e44e163)

Stack (`package.json`): React 18.3, Vite 5.4, Tailwind 3.4.14, `lucide-react@0.454`, `framer-motion@11.11`, Radix (dialog/slider/switch), Zustand 5. PostCSS is only tailwind + autoprefixer.

## 1. Colour tokens

**Attribute-driven theming, not media-query.** `tailwind.config.js:7` → `darkMode: ['selector', '[data-palette="dark"]']`. Tokens on `:root`/`[data-palette="light"]` (`index.css:164-211`) and `[data-palette="dark"]` (`:214-258`). **Default theme is LIGHT** (`uiStore.js:28`, persisted under `ziggy-ui`). Boot: inline script in `index.html:37-44` sets `<html data-palette>` before first paint. Runtime: `App.jsx:765`. **`prefers-color-scheme` is not followed** for the palette (only for `<meta theme-color>`).

| Var | Light | Dark |
|---|---|---|
| `--bg` / `--bg-2` / `--bg-3` | `#F9F7F3` / `#F1EEE8` / `#E8E4DC` | `#0B0D11` / `#0F1218` / `#14181F` |
| `--surface` / `-2` / `-3` | `#FFFFFF` / `#F5F3EE` / `#EDEAE3` | `#14191D` / `#1B2127` / `#232930` |
| `--ink` / `-2` / `-mute` / `-faint` / `-ghost` | `#1E1812` / `#3A2E22` / `#6E5A48` / `#74614F` / `#C7BAA9` | `#F2EBDE` / `#D8CFBE` / `#9A907F` / `#A99D8B` / `#3D3730` |
| `--line` / `-2` / `-3` | `#DDD6CA` / `#CABFAE` / `#B7A992` | `#2A241D` / `#3A3327` / `#524837` |
| **`--accent`** / `-2` / `-3` | **`#C96442`** / `#F7E8E2` / `#A14F31` | **`#E27A55`** / `#2A1A12` / `#F19475` |
| `--ok` / `--warn` / `--err` / `--info` / `--gold` | `#3D8A5F` / `#B07820` / `#C24530` / `#3D6A9E` / `#C99845` | `#6CBF8C` / `#E0AC5C` / `#E27A55` / `#7AAEE0` / `#D7AE6A` |
| `--accent-text` / `--ok-text` / `--warn-text` / `--err-text` | `#A14F31` / `#347551` / `#8D601A` / `#B8422E` | alias the fills |
| `--tile-base` | `#E8E4DC` (darker than bg) | `#20262C` (lighter than bg) |
| `--on-accent` | `#1E1812` | `#1E1812` |
| `--scrim` / `--backdrop` | ink 22% / `rgba(0,0,0,.40)` | ink 14% / `rgba(0,0,0,.62)` |

**Rule** (`index.css:188-196`): any text under 18px in a status colour must use `--*-text`; keep `--accent`/`--ok`/… for fills and icons.

Shadows: `--shadow-sm` `0 1px 0 rgba(0,0,0,.04)`; `--shadow-md` `… 0 8px 24px -12px rgba(0,0,0,.10)`; `--shadow-lg` `… 0 24px 48px -24px rgba(0,0,0,.16)`; `--shadow-fab`. Dark variants at `:253-256`.

Device tints (`lib/devices.js:94-131`): lights → `--gold`; media → `--accent`; climate/switches/sensors → `--info`; kettle/coffee/lock/power → `--warn`; alarm/leak/smoke/water_heater → `--err`; mower → `--ok`; cover/vacuum/door/window/binary/unknown → `--ink-mute`. Lights override with the **real bulb colour** when on (`liveTintFor`, `devices.js:824-832`).

Occupancy chip (`Rooms.jsx:222`): photo → `color-mix(in srgb, var(--ok) 55%, transparent)` + `#fff`; plain → `color-mix(… --ok 14%, var(--surface))` + `--ok-text`. Temperature chips: `<18°C` → `--info`, `>25°C` → `--err`. Room active dot: `--ok` + `box-shadow: 0 0 0 3px color-mix(… --ok 35%, transparent)`; idle `--line-2`.

Utilities (`index.css:423-457`): `.z-dot` + `.z-dot-on/-ok/-warn/-err/-info`; `.z-alert-*`; `.bg-*-soft` (12%); `.border-*-soft`; `.text-*-text`.

## 2. Typography

**One family: Heebo** (400/500/600/700). IBM Plex Mono only for the wall kiosk. `body`: Heebo, 17px, line-height 1.3.

Type roles (`index.css:310-322`, authoritative): `.z-display` 34/40/700/-0.02em · `.z-title` 20/26/600 · `.z-title3` 18/23/600 · `.z-headline` 15/20/600 · `.z-body` 15/20 · `.z-subhead` 13/18 mute · `.z-footnote` 12/16 mute · `.z-caption` 11/14/500 mute · `.z-eyebrow` 12/16/600/+0.06em uppercase mute. Tailwind `fontSize` scale (`tailwind.config.js:19-28`) drifts from these; the CSS wins in practice.

Hebrew (`index.css:324-344`): `[dir="rtl"] .z-display { letter-spacing: 0; line-height: 43px }`; body 1.45, p 1.55; `.icon-flip-rtl` → `scaleX(-1)`.

Numbers: **`.z-mono`** = `font-family: inherit; font-variant-numeric: tabular-nums; unicode-bidi: isolate` (not a mono font). `.z-code` is real mono (`ui-monospace, Menlo`), ltr, 0.92em. `[data-num]` = isolate + ltr + tabular.

Sizes at call sites: page title `.z-display`; section label `.z-eyebrow`; tile name 15/600 2-line clamp (dense 13); tile state 12px `.z-mono`; nav label 11px weight 600/500; sheet title 16/600; toast 13px; input **16px** (iOS zoom guard).

## 3. Radii, borders, shadows, glass, spacing

Radii: `--r-chip 6` · `--r-ctl 10` · `--r-card 16` · `--r-sheet 24`. **`0.5px solid var(--line)` is the universal hairline.** Focus ring `outline: 2px solid var(--accent); outline-offset: 2px`.

Blur: bottom nav `color-mix(--bg 92%, transparent)` + `blur(20px)`; More-menu backdrop `--scrim` + `blur(4px)`; modal overlay `--backdrop` + `blur(8px)`; room photo chips `blur(8px)`.

Spacing: 4/8/12/16/20/24/32. Card header `16px 16px 8px`, body `0 16px 16px`. Row card `12px 16px`, gap 16, minHeight 48. Tile padding 12 (dense 10), minHeight 132 (dense 104), `aspectRatio 1/1.05`. Sheet head `18px 20px 10px`, body `8px 20px calc(24px + safe-bottom)`. Grid gaps: rooms 12→16 @768; quick-controls 8→12; dashboard 16→24 @1024.

## 4. Layout

`--safe-*: env(safe-area-inset-*)`; `--vh: 100dvh`; `--nav-h: 56px`; `--sidebar-w: 240px`; `--nav-clearance: calc(var(--nav-h) + max(var(--safe-bottom), 8px) + 8px)`. Max widths: `--page-max-w 1120`, `-narrow 720`, `-wide 1240`. `.z-page`: narrow max, padding 20 / max(16, safe). Breakpoints: **768** (bottom nav ↔ sidebar; rooms 2→3 cols), **1024** (dashboard splits `minmax(0,1fr) 320px`; `--rooms-tile-h` 136→172; `.hide-lg/.only-lg`).

AppShell (`AppShell.jsx:279-337`): flex row; `<Sidebar>`; `<main className="flex-1 min-w-0 overflow-y-auto scrollbar-thin pb-nav" style={{ paddingTop: 'var(--safe-top)', scrollbarGutter: 'stable' }}>`; `<ConnectionStatus/>`; keyed `[data-motion-enter]` wrapper; `{showDock && <ChatDock/>}`.

Sidebar: `hidden md:flex`, sticky, `width: var(--sidebar-w)`, `--surface`, `borderRight: 0.5px solid var(--line)`, padding `16px 12px`. Bottom nav: `ROW_H = 56`, grid `repeat(5, minmax(0,1fr))`, maxWidth 480, glass bar, safe-area floor sibling. Tabs: Home · Rooms · Devices · Actions · More.

## 5. Icons

`lucide-react` ^0.454, default stroke 1.75, 2 for emphasis. `ZIcon` (`components/layout/ZIcon.jsx`): hand-drawn set `home, rooms, auto, devices, sparkle`; nav uses `size={26} stroke={active ? 2 : 1.6}`.

`DeviceIcon` (`lib/deviceIcons.jsx:112-155`): three styles from `uiStore.iconStyle`: **`emoji`** (default), `line` (35 SVGs in `assets/device-icons/`), `3d` (36 PNGs in `assets/device-icons-3d/`). `KIND_ASSET` maps kind → filenames; `ICON_CHOICES` (36) is the picker; `fill` mode renders 100% with a `--surface-2` plate for 3D.

Room icons: **no registry**; a photo-less room draws Lucide `<Home size={28} strokeWidth={1.75}/>`; photos from `lib/roomPhotos.js` (18 Unsplash keys). `.z-room-plain` = `--surface-2` + hairline.

Brand: `public/brand/ziggy-{bilingual,english,hebrew,stacked,symbol}[-dark].svg`, favicons, app icons, maskable, og-image. `Logo` API: `variant` bilingual|stacked|english|hebrew|symbol|wordmark, `tone` auto|light|dark|invert; `tone="auto"` emits both and CSS at `index.css:159-161` shows one per `[data-palette]`.

## 6. i18n

`lib/i18n/index.js`. Default `'en'`, persisted `ziggy-lang`. `applyToDocument(lang)` sets `<html lang dir>`. API: `useT()`, `useLang()`, `useIsRTL()`, `useTranslatedName()`, pure `t` for stores, `dirOf(text)`. Interpolation wraps letter-bearing values in FSI/PDI. Missing Hebrew keys fall back to English. Convention: `dir="auto"` on any element rendering a user-typed name or message.

## 7. Motion utilities

Tokens (`index.css:95-99`): `--dur-press 120ms`, `--dur-state 200ms`, `--dur-enter 240ms`, `--ease-standard cubic-bezier(0.2,0,0,1)`, `--ease-enter cubic-bezier(0.16,1,0.3,1)`. JS twins in `lib/motion.js`: `DUR_PRESS .12`, `DUR_STATE .2`, `DUR_ENTER .24`, `SPRING_SHEET {400, 30, 0.8}`, `T_STATE/T_ENTER/T_PRESS`, `FADE_UP`, `FADE`.

Tailwind animations: `wave-bar`, `fade-in`, `slide-up`, `sheet-in`, `pulse-ring`. `index.css` classes: `.z-pulse` (2.4s opacity .4↔1), `.z-spin` (1s). `.z-button:active { scale(.98) }`. **Global reduced-motion clamp at `index.css:718-720`** (`!important`, overrides the motion layer).

Motion layer (`motion/`): `data-motion` on `<html>`, resolution `?motion=` → localStorage `ziggy_motion` → ON. Variables (`motion.css:24-52`): `--m-std`, `--m-out`, `--m-glide (0.33,0.68,0.15,1)`, `--m-in-out (0.77,0,0.175,1)`, `--m-drawer (0.32,0.72,0,1)`, `--m-dur-page 340ms`, `--m-dur-page-back 260ms`, `--m-dur-large 560ms`, `--m-ring`.

Data-attribute hooks: `data-pressing` (scale .97/.985, 160ms) · `data-on` (colour 220 in / 160 out) · `data-motion-icon` (`zm-ignite` 360ms .94→1.06→1) · `data-pending` (`zm-pending` 1.1s opacity 1↔.62) · `data-motion-enter[="back"]` (`zm-page-in` 340 / `zm-page-back` 260) · `data-motion-stagger` (35ms × 8) · `data-motion-disclosure` + `data-open` (grid-rows 340 in / 180 out) · `data-motion-reveal` (clip-path 240) · `data-motion-chevron` · `data-motion-nav` + `data-tucked` · `data-motion-nav-hl` (320ms) · `data-motion-live` (**unwired**) · `data-scrubbing` · `data-motion-hold` + `data-motion-grow` (scaleY 1.35 / 1.12 / scaleX 1.045) · `data-motion-ring` (hover ring, pointer-fine only).

House rules: animations fill `backwards`, never `both`; exits faster than entrances; an inline `transition` outranks these rules and silently kills the hook; reduced motion strips travel/scale/loops but keeps colour/opacity. `main.jsx:42` wraps the app in `<MotionConfig reducedMotion="user">`.

## 8. Recipes (quoted from the real components)

**Card**: `.z-card` = `background: var(--surface); border: 0.5px solid var(--line); border-radius: var(--r-card)`; hover → `border-color: var(--line-2)`.

**Bottom nav** (`BottomNav.jsx:306-399`): `nav.fixed.bottom-0.z-30.md:hidden[data-motion-nav]` → glass bar `background: color-mix(in srgb, var(--bg) 92%, transparent); backdropFilter: blur(20px); borderTop: 0.5px solid var(--line)` → grid `repeat(5, minmax(0,1fr))`, height 56, maxWidth 480 → tab cell flex column, gap 4, `ZIcon size 26 stroke active?2:1.6 color active?--ink:--ink-mute`, label 11px weight 600/500 → safe-area floor sibling `height: max(env(safe-area-inset-bottom), 8px)`.

**Device tile** (`DeviceCard.jsx:345-517`), tinted recipe with `tint = facts.tint`: bg on `color-mix(tint 24%, var(--tile-base))` / off 8%; border on `color-mix(tint 36%, var(--line))` / off 14%; iconColor on `color-mix(tint 80%, var(--ink))` / off `--ink-mute`; iconBg on 36% / off 14% of tile-base; sub on `--ink-2` / off `--ink-faint`; arrow chip 28px top-8 end-8. Inverted (dashboard): bg on `--ink` / off `--surface`; fg on `--bg`; iconBg on `color-mix(--accent 30%, transparent)`. Structure: `button[data-on][data-pending]` → `div[data-motion-icon]` 34px r-ctl → name 15/600 2-line clamp → `.z-mono` 12px state line → `span[data-tile-stop]` chevron. **No inline `transition` when motion is on.**

**Row**: `.z-card[data-on]` flex gap 16 padding `12px 16px` minHeight 48 → icon 40px r-ctl (`color-mix(tint 14%, --surface-2)` when on) → `.z-headline` name + `.z-mono.z-subhead` secondary → `InlineControl` → `ChevronRight 18 .icon-flip-rtl` in `--ink-faint`.

**Power button** (`DeviceCard.jsx:104-124`): 40×40 r-ctl; on `--ink`/`--bg`; off `--surface-2`/`--ink-mute`/hairline; `data-motion-ring`; `<Power size={18} strokeWidth={2}/>`.

**Room tile** (`Rooms.jsx:170-261`): `motion.div[data-room-photo]` r-card overflow hidden `height: var(--rooms-tile-h)` → photo + `linear-gradient(180deg, transparent 40%, rgba(0,0,0,0.72))` or `.z-room-plain` with `<Home 28/1.75>` top-start → status dot top-end 8px (`--ok` + 3px halo when active) → name block bottom padding 12: 15/22/600 (#fff on photo) + `.z-mono` 12px count line. Chips: photo `blur(8px)` pill 12/16 padding 4/8; plain `--surface` + hairline. Grid `.z-rooms-grid[data-motion-stagger]`. Hero: `height 160, borderRadius '0 0 24px 24px'`.

**Toast** (`Toast.jsx`): container fixed `bottom: calc(var(--nav-h) + max(var(--safe-bottom), 8px) + 12px)`, centred, maxWidth 400, gap 8. Toast `motion.div` `{opacity 0, y 8, scale .98}` → `{1, 0, 1}` exit `{0, -4, .98}`, 240ms `[0.16,1,0.3,1]`, `--r-card`, `color-mix(type 8%, var(--surface))`, hairline, `--shadow-md`; row padding `12px 16px` gap 12: 8px dot + 13px message + 40px X. Durations: error 7000 / others 3000; 4s dedupe.

**Sheet** (`sheet.css:23-118`): `.z-msheet { height: calc(var(--vh) - var(--safe-top) - 10px); background: var(--surface); border: 0.5px solid var(--line); border-bottom: none; border-start-*-radius: var(--r-sheet); box-shadow: var(--shadow-lg); overflow: hidden; will-change: transform }`; head `18px 20px 10px` touch-action none cursor grab; grabber 44×14 hit / 36×5 `--line-2` pill; title 16/600/-0.015em; body `8px 20px calc(24px + safe-bottom)`. Dock: fixed inset-block 0, inset-inline-end 0, width 320, `border-inline-start` hairline.

**Centred modal** (`Modal.jsx:116-160`): overlay `--backdrop` + `blur(8px)` `T_STATE`; panel maxWidth 520, maxHeight 90dvh, `--surface`, hairline, `--r-sheet`, `--shadow-lg`, `{opacity 0, scale .98, y 8}` `T_ENTER` both ways; header `16px 16px 16px 24px` + `.z-title3` + `.z-icon-btn`; body padding 24.

**Primary button**: `.z-btn-primary` = `--ink` on `--bg`, r-ctl, `10px 16px`, minHeight 40, 15/600, gap 8, `transition: background var(--dur-press)`, hover `color-mix(--ink 86%, --bg)`. `Button` variants: primary / secondary (surface + hairline) / ghost / danger (`color-mix(--err 10%, --surface)` + `--err-text`) / accent (`--accent` + `--on-accent`); sizes sm 36 / md 40 / lg 44 / icon 40.

**Others**: Badge pill `4px 10px` 12/500; `.z-chip` `3px 10px` 12/500 surface-2 hairline, `.z-chip-accent`; Input 40px 16px r-ctl, focus `--accent` border + 2px 30% outline; Toggle 40×24 track (`--ok` / `--line-2`), 20px knob, `translateX(18|2)` (negated RTL), 200ms; Slider 44px root, 8px track (`--line`), `--ink` fill, 28px thumb `--shadow-md`, held `scaleY(1.35)` / thumb `scale(1.08)`; `.z-nav-item` 40px r-ctl 14/500, active `--surface-2` + hairline + 600.

## Gotchas for a prototype page

1. Set `data-palette` on `<html>` (or a wrapper) or every token resolves to light.
2. Set `data-motion="on"` on `<html>` or every `motion.css`/`controls.css`/`sheet.css` rule matches nothing.
3. Never add an inline `transition` to an element carrying `data-on`, `data-motion-grow` or `data-motion-enter`.
4. Borders are `0.5px`, not `1px`, everywhere.
5. Status text under 18px uses `--*-text`.
6. `.z-mono` is Heebo with tabular figures, not monospace.
7. `html, body, #root { max-width: 100vw; overflow-x: clip }`.
8. `--nav-h` and `--sidebar-w` are duplicated as JS constants in `BottomNav.jsx:41` and `Sidebar.jsx:147`.
9. `data-motion-live` is documented but unwired.
