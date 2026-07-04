# Ziggy Website Proof Scene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the production-quality opening sequence of the new Ziggy site — box on doorstep → lid opens → house draws itself in ink → door dive → living room → first sketch-to-photoreal morph — as the quality gate before the full site is built.

**Architecture:** A standalone static folder (`ziggy-website-v2/`) untouched by the current site. One pinned "stage" inside a tall scroll track; a single anime.js v4 timeline synced to scroll drives four acts (hero / rise / dive / room). Scene artwork is Higgsfield-generated plates (ink + photoreal twins of the same room) with a hand-coded SVG "life layer" on top for everything that moves or glows.

**Tech Stack:** Plain HTML/CSS/JS (no build), anime.js v4 via CDN ESM, Higgsfield MCP for plate generation (main-session task), Playwright MCP for visual verification.

## Global Constraints

- Static folder only — no npm, no bundler, no framework (spec §6)
- Hebrew-first: `<html lang="he" dir="rtl">`; all copy Hebrew (spec §1)
- Light mode always: paper background, darkness only inside drawings (spec §4)
- Glow rule: static things are quiet ink; only what Ziggy touches glows/moves (spec §4)
- Fonts: Assistant (body) + Suez One (display), copied from `ziggy-website/fonts/`
- `prefers-reduced-motion: reduce` → no flight; calm static reveal (spec §5)
- Do not modify anything inside `ziggy-website/` (old site stays live)
- anime.js v4 from `https://cdn.jsdelivr.net/npm/animejs@4/+esm`
- Verification server: `python3 -m http.server 8080 --directory ziggy-website-v2` (from repo root); screenshots via Playwright MCP against `http://localhost:8080`

---

### Task 1: Scaffold, fonts, paper theme, page skeleton

**Files:**
- Create: `ziggy-website-v2/index.html`
- Create: `ziggy-website-v2/css/style.css`
- Create: `ziggy-website-v2/js/flight.js` (stub this task)
- Copy: `ziggy-website/fonts/*.woff2` → `ziggy-website-v2/fonts/`

**Interfaces:**
- Produces: DOM ids consumed by all later tasks — `#scroll-track`, `#stage`, `#act-hero`, `#act-rise`, `#act-dive`, `#act-room`; CSS custom properties `--paper`, `--paper-dawn`, `--ink`, `--ink-dawn`, `--amber`, `--cold`

- [ ] **Step 1: Copy fonts**

```bash
mkdir -p ziggy-website-v2/fonts ziggy-website-v2/css ziggy-website-v2/js ziggy-website-v2/img
cp ziggy-website/fonts/assistant-hebrew.woff2 ziggy-website/fonts/assistant-latin.woff2 ziggy-website/fonts/suezone-hebrew.woff2 ziggy-website/fonts/suezone-latin.woff2 ziggy-website-v2/fonts/
```

- [ ] **Step 2: Write `index.html`**

```html
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>זיגי — בית חכם בקופסה</title>
  <meta name="description" content="קופסה אחת מגיעה הביתה — ובית שלם מתעורר. זיגי, עוזר הבית שמבין עברית.">
  <link rel="stylesheet" href="css/style.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="#">זיגי<b>.</b></a>
  </header>

  <div id="scroll-track">
    <div id="stage">
      <!-- Act 1: hero — box on the doorstep, pre-dawn -->
      <section id="act-hero" class="act">
        <div class="hero-art"><!-- Task 2: box SVG --></div>
        <h1>בית חכם. <em>בקופסה.</em></h1>
        <p class="sub">קופסה אחת מגיעה הביתה — ובית שלם לומד להקשיב לכם. בעברית.</p>
        <form class="waitlist" novalidate>
          <input type="email" name="email" placeholder="you@email.com" autocomplete="email" required>
          <button type="submit">לרשימת ההמתנה</button>
        </form>
        <div class="scroll-hint">גללו לפתוח את הקופסה ↓</div>
      </section>

      <!-- Act 2: the house rises from the box, drawn line by line -->
      <section id="act-rise" class="act" aria-hidden="true">
        <div class="rise-art"><!-- Task 3: house SVG --></div>
      </section>

      <!-- Act 3: door-dive speed streaks -->
      <section id="act-dive" class="act" aria-hidden="true">
        <svg id="streaks" viewBox="0 0 1000 600" preserveAspectRatio="none">
          <line x1="0" y1="90"  x2="1000" y2="80"/>
          <line x1="0" y1="220" x2="1000" y2="230"/>
          <line x1="0" y1="360" x2="1000" y2="350"/>
          <line x1="0" y1="500" x2="1000" y2="510"/>
        </svg>
      </section>

      <!-- Act 4: living room — ink plate, photo plate, life layer -->
      <section id="act-room" class="act" aria-hidden="true">
        <img id="room-ink"   class="plate" src="img/room-ink.webp"   alt="">
        <img id="room-photo" class="plate" src="img/room-photo.webp" alt="">
        <div id="life-layer"><!-- Task 6: SVG life layer + chat bubble --></div>
      </section>
    </div>
  </div>

  <section class="proof-outro">
    <p>זה רק הפתיח. 🏡</p>
  </section>

  <script type="module" src="js/flight.js"></script>
</body>
</html>
```

- [ ] **Step 3: Write `css/style.css`**

```css
/* ---------- fonts ---------- */
@font-face { font-family: 'Assistant'; src: url('../fonts/assistant-hebrew.woff2') format('woff2'); unicode-range: U+0590-05FF; font-weight: 300 800; font-display: swap; }
@font-face { font-family: 'Assistant'; src: url('../fonts/assistant-latin.woff2') format('woff2'); unicode-range: U+0000-00FF; font-weight: 300 800; font-display: swap; }
@font-face { font-family: 'Suez One'; src: url('../fonts/suezone-hebrew.woff2') format('woff2'); unicode-range: U+0590-05FF; font-display: swap; }
@font-face { font-family: 'Suez One'; src: url('../fonts/suezone-latin.woff2') format('woff2'); unicode-range: U+0000-00FF; font-display: swap; }

/* ---------- paper theme ---------- */
:root {
  --paper: #f4ecdc;        /* warm cream, midday */
  --paper-dawn: #edeef0;   /* cool pale paper, pre-dawn */
  --ink: #6b4e33;          /* sepia ink */
  --ink-dawn: #7a8699;     /* grey-blue dawn ink */
  --amber: #e8940a;        /* Ziggy glow */
  --cold: #6aa9d8;         /* AC air */
  --text: #3a2e20;
}
* { box-sizing: border-box; margin: 0; }
body { background: var(--paper-dawn); color: var(--text); font-family: 'Assistant', sans-serif; transition: background 0.4s linear; }
h1, .brand { font-family: 'Suez One', serif; }

.topbar { position: fixed; top: 0; right: 0; left: 0; z-index: 50; padding: 18px 28px; }
.brand { font-size: 24px; color: var(--text); text-decoration: none; }
.brand b { color: var(--amber); }

/* ---------- flight stage ---------- */
#scroll-track { height: 700vh; position: relative; }
#stage { position: sticky; top: 0; height: 100vh; overflow: hidden; }
.act { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; text-align: center; padding: 24px; }
#act-rise, #act-dive, #act-room { opacity: 0; pointer-events: none; }

h1 { font-size: clamp(34px, 6vw, 64px); }
h1 em { font-style: normal; color: var(--amber); }
.sub { font-size: clamp(15px, 2.2vw, 20px); opacity: .8; max-width: 34em; }

.waitlist { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
.waitlist input { padding: 12px 18px; border: 1.5px solid var(--ink); border-radius: 999px; background: transparent; font: inherit; min-width: 240px; direction: ltr; text-align: left; }
.waitlist button { padding: 12px 26px; border: 0; border-radius: 999px; background: var(--amber); color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
.scroll-hint { font-size: 13px; opacity: .6; position: absolute; bottom: 22px; }

#streaks { position: absolute; inset: 0; width: 100%; height: 100%; }
#streaks line { stroke: var(--ink); stroke-width: 2; opacity: .7; }

.plate { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
#room-photo { opacity: 0; }
#life-layer { position: absolute; inset: 0; }

.proof-outro { min-height: 40vh; display: flex; align-items: center; justify-content: center; font-size: 22px; background: var(--paper); }

/* ---------- reduced motion: calm stacked reveal ---------- */
@media (prefers-reduced-motion: reduce) {
  #scroll-track { height: auto; }
  #stage { position: static; height: auto; overflow: visible; }
  .act { position: static; min-height: 70vh; opacity: 1 !important; pointer-events: auto; }
}
```

- [ ] **Step 4: Write stub `js/flight.js`**

```js
// Master flight timeline — filled in from Task 3 onward.
console.log('ziggy flight: stub loaded');
```

- [ ] **Step 5: Verify it renders**

Run: `python3 -m http.server 8080 --directory ziggy-website-v2` (background), open `http://localhost:8080` with Playwright MCP, screenshot.
Expected: RTL Hebrew hero on pale cool paper, headline "בית חכם. בקופסה.", email input + orange button, scroll hint; console shows `ziggy flight: stub loaded`; no 404s except the two plate images (created in Task 4).

- [ ] **Step 6: Commit**

```bash
git add ziggy-website-v2
git commit -m "feat(site-v2): scaffold proof scene — paper theme, RTL hero, flight stage skeleton"
```

---

### Task 2: Instrument-grade box SVG + breathing wave (hero art)

**Files:**
- Modify: `ziggy-website-v2/index.html` (fill `.hero-art`)
- Modify: `ziggy-website-v2/css/style.css` (append hero-art styles)

**Interfaces:**
- Produces: SVG element ids consumed by Task 3's timeline — `#box-svg`, `#lid-l`, `#lid-r`, `#wave` (group of `<rect class="wbar">`), `#box-glow-dot`

- [ ] **Step 1: Replace `<div class="hero-art"><!-- Task 2: box SVG --></div>` in `index.html`**

```html
<div class="hero-art">
  <svg id="box-svg" viewBox="0 0 420 300" fill="none">
    <!-- ground: main line + bezel tick comb -->
    <line x1="30" y1="252" x2="390" y2="252" stroke="currentColor" stroke-width="1.6"/>
    <line x1="40" y1="259" x2="380" y2="259" stroke="currentColor" stroke-width="6" stroke-dasharray="1.2 10.8" opacity=".4"/>
    <line x1="40" y1="262" x2="380" y2="262" stroke="currentColor" stroke-width="11" stroke-dasharray="1.4 58.6" opacity=".5"/>
    <!-- doorstep -->
    <rect x="58" y="238" width="120" height="14" rx="2" stroke="currentColor" stroke-width="1.2" opacity=".55"/>
    <!-- registration marks -->
    <g stroke="currentColor" stroke-width="1" opacity=".5">
      <path d="M 16 30 L 16 16 L 30 16"/><path d="M 390 16 L 404 16 L 404 30"/>
      <path d="M 404 272 L 404 286 L 390 286"/><path d="M 30 286 L 16 286 L 16 272"/>
    </g>
    <!-- the box: double-stroked body, tape, label -->
    <g id="box-body">
      <rect x="160" y="160" width="130" height="92" rx="4" stroke="currentColor" stroke-width="1.8"/>
      <rect x="166" y="166" width="118" height="80" rx="3" stroke="currentColor" stroke-width=".7" opacity=".45"/>
      <line x1="225" y1="160" x2="225" y2="252" stroke="currentColor" stroke-width="1" opacity=".5"/>
      <text x="225" y="212" text-anchor="middle" font-size="24" font-family="Suez One, serif" fill="currentColor">זיגי</text>
      <circle id="box-glow-dot" cx="278" cy="172" r="3" class="glow-amber"/>
    </g>
    <!-- lids (animated open in Task 3) -->
    <rect id="lid-l" x="160" y="152" width="65" height="9" rx="2" stroke="currentColor" stroke-width="1.6"/>
    <rect id="lid-r" x="225" y="152" width="65" height="9" rx="2" stroke="currentColor" stroke-width="1.6"/>
    <!-- dimension annotation -->
    <line x1="160" y1="140" x2="290" y2="140" stroke="currentColor" stroke-width=".9" opacity=".55"/>
    <line x1="160" y1="136" x2="160" y2="144" stroke="currentColor" stroke-width=".9" opacity=".55"/>
    <line x1="290" y1="136" x2="290" y2="144" stroke="currentColor" stroke-width=".9" opacity=".55"/>
    <text x="225" y="133" text-anchor="middle" font-size="10" font-family="ui-monospace, monospace" fill="currentColor" opacity=".7">בית שלם · 40cm</text>
    <!-- breathing voice wave above the box -->
    <g id="wave">
      <rect class="wbar" x="195" y="96" width="4" height="18" rx="2"/>
      <rect class="wbar" x="205" y="88" width="4" height="34" rx="2"/>
      <rect class="wbar" x="215" y="80" width="4" height="50" rx="2"/>
      <rect class="wbar" x="225" y="86" width="4" height="38" rx="2"/>
      <rect class="wbar" x="235" y="78" width="4" height="54" rx="2"/>
      <rect class="wbar" x="245" y="90" width="4" height="30" rx="2"/>
      <rect class="wbar" x="255" y="98" width="4" height="14" rx="2"/>
    </g>
  </svg>
</div>
```

- [ ] **Step 2: Append to `css/style.css`**

```css
.hero-art { width: min(420px, 80vw); color: var(--ink-dawn); }
#box-svg { width: 100%; height: auto; display: block; }
.wbar { fill: var(--amber); }
.glow-amber { fill: var(--amber); filter: drop-shadow(0 0 5px var(--amber)); }
#lid-l { transform-origin: 160px 156px; }
#lid-r { transform-origin: 290px 156px; }
```

- [ ] **Step 3: Verify + polish loop**

Screenshot `http://localhost:8080` at 1440×900 and 390×844.
Expected: box drawn in cool grey-blue ink on the doorstep, tick comb under the ground line, glowing amber dot on the box, wave bars visible above the box, dimension label legible, nothing clipped on mobile width. Adjust coordinates until composition is balanced (box slightly below vertical center, headline clear of the art).

- [ ] **Step 4: Commit**

```bash
git add ziggy-website-v2
git commit -m "feat(site-v2): instrument-grade box hero art with breathing wave"
```

---

### Task 3: anime.js wiring — scroll-synced master timeline, lid open, house line-draw

**Files:**
- Modify: `ziggy-website-v2/index.html` (fill `.rise-art` with house SVG)
- Modify: `ziggy-website-v2/js/flight.js` (replace stub)

**Interfaces:**
- Consumes: `#lid-l`, `#lid-r`, `#wave .wbar` (Task 2); act ids (Task 1)
- Produces: `window.__flightTl` (the master timeline, exposed for verification); house SVG ids `#house-svg`, `.hline` (drawable paths), `#front-door`

- [ ] **Step 1: Replace `<div class="rise-art"><!-- Task 3: house SVG --></div>` in `index.html`**

```html
<div class="rise-art">
  <svg id="house-svg" viewBox="0 0 460 340" fill="none">
    <!-- construction guides -->
    <line class="hguide" x1="30" y1="300" x2="430" y2="300" stroke="currentColor" stroke-width="1" stroke-dasharray="5 7" opacity=".35"/>
    <!-- house lines, drawn in order: base → walls → roof → door → windows -->
    <path class="hline" d="M 90 300 L 370 300" stroke="currentColor" stroke-width="2"/>
    <path class="hline" d="M 100 300 L 100 170 M 360 300 L 360 170" stroke="currentColor" stroke-width="2"/>
    <path class="hline" d="M 84 176 L 230 84 L 376 176" stroke="currentColor" stroke-width="2.2"/>
    <path class="hline" d="M 230 84 L 230 64" stroke="currentColor" stroke-width="1.6"/>
    <path id="front-door" class="hline" d="M 208 300 L 208 216 Q 208 208 216 208 L 244 208 Q 252 208 252 216 L 252 300" stroke="currentColor" stroke-width="2"/>
    <circle class="hline" cx="244" cy="258" r="2.5" stroke="currentColor" stroke-width="1.4"/>
    <path class="hline" d="M 128 210 h 52 v 44 h -52 Z M 154 210 v 44 M 128 232 h 52" stroke="currentColor" stroke-width="1.5"/>
    <path class="hline" d="M 282 210 h 52 v 44 h -52 Z M 308 210 v 44 M 282 232 h 52" stroke="currentColor" stroke-width="1.5"/>
    <!-- roof solar boiler (the דוד) -->
    <path class="hline" d="M 268 128 l 44 26 M 268 122 a 12 8 0 0 1 0 12" stroke="currentColor" stroke-width="1.5"/>
    <!-- annotations -->
    <text x="120" y="150" font-size="11" font-family="ui-monospace, monospace" fill="currentColor" opacity="0" class="hnote">בית · דגם 001</text>
  </svg>
</div>
```

- [ ] **Step 2: Append to `css/style.css`**

```css
.rise-art { width: min(560px, 88vw); color: var(--ink-dawn); }
#house-svg { width: 100%; height: auto; }
#front-door { color: var(--amber); filter: drop-shadow(0 0 6px var(--amber)); }
```

- [ ] **Step 3: Replace `js/flight.js` with the master timeline**

```js
import { animate, createTimeline, stagger, onScroll, svg, utils } from 'https://cdn.jsdelivr.net/npm/animejs@4/+esm';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!REDUCED) {
  // idle breathing wave — independent loop, not scroll-synced
  animate('.wbar', {
    scaleY: [0.35, 1, 0.35],
    duration: 1600,
    delay: stagger(140),
    loop: true,
    ease: 'inOutSine',
    transformOrigin: '50% 100%',
  });

  const tl = createTimeline({
    defaults: { ease: 'inOutQuad' },
    autoplay: onScroll({
      target: '#scroll-track',
      sync: true,
      enter: 'top top',
      leave: 'bottom bottom',
    }),
  });

  tl
    // Act 1 → 2: lids open, hero copy drifts away, rise act appears
    .add('#lid-l', { rotate: -120, duration: 700 })
    .add('#lid-r', { rotate: 120, duration: 700 }, '<')
    .add('#act-hero h1, #act-hero .sub, #act-hero .waitlist, #act-hero .scroll-hint',
         { opacity: 0, y: -40, duration: 500, delay: stagger(60) }, '<+=200')
    .add('#act-hero', { opacity: 0, duration: 400 })
    .add('#act-rise', { opacity: 1, duration: 400 }, '<')
    // Act 2: the house draws itself line by line
    .add(svg.createDrawable('#house-svg .hline'), {
      draw: '0 1', duration: 2600, delay: stagger(180), ease: 'inOut(2)',
    })
    .add('.hnote', { opacity: 0.7, duration: 300 })
    // Act 2 → 3: dive toward the front door
    .add('#act-rise', {
      scale: 9, opacity: [1, 0], duration: 1400, ease: 'in(2)',
      transformOrigin: '50% 72%', // the door's position in the composition
    })
    .add('#act-dive', { opacity: [0, 1, 0], duration: 700 }, '<+=500')
    .add('#streaks line', { x2: [0, 1000], duration: 500, delay: stagger(60) }, '<')
    // Act 4 arrival is added in Task 6
    ;

  window.__flightTl = tl;
  console.log('ziggy flight: timeline built, duration =', tl.duration);
} else {
  // reduced motion: reveal everything statically
  document.querySelectorAll('.act').forEach(a => { a.style.opacity = 1; a.removeAttribute('aria-hidden'); });
}
```

- [ ] **Step 4: Verify scroll sync**

Open `http://localhost:8080`, check console for `timeline built, duration = <number > 0>`. Scroll slowly with Playwright (`mouse.wheel`) and screenshot at 0%, 25%, 50% scroll depth.
Expected: 0% — closed box + breathing wave; 25% — lids open, hero text gone, house partially drawn; 50% — full house with glowing door, then zoom-in blur/streaks.
**If `onScroll` fails to drive the timeline** (console error or static page), replace the `autoplay:` line with `autoplay: false,` and append this manual sync fallback at the end of the `if` block — then re-verify:

```js
  const track = document.getElementById('scroll-track');
  addEventListener('scroll', () => {
    const r = track.getBoundingClientRect();
    const progress = Math.min(1, Math.max(0, -r.top / (r.height - innerHeight)));
    tl.seek(progress * tl.duration);
  }, { passive: true });
```

- [ ] **Step 5: Commit**

```bash
git add ziggy-website-v2
git commit -m "feat(site-v2): scroll-synced master timeline — lid open, house line-draw, door dive"
```

---

### Task 4: Generate the living-room plates (MAIN SESSION — uses Higgsfield MCP)

**Files:**
- Create: `ziggy-website-v2/img/room-photo.webp`
- Create: `ziggy-website-v2/img/room-ink.webp`

**Interfaces:**
- Produces: the two same-room plates consumed by Task 6/7. Both MUST depict the identical room from the identical camera angle (this is the master-home consistency test from spec §8).

- [ ] **Step 1: Generate the photoreal plate**

Call `mcp__claude_ai_higgsfield__generate_image` with model `nano_banana_pro`, aspect_ratio `16:9`, count 2, prompt:

> Photorealistic bright airy Israeli living room interior, late morning warm daylight, cream walls, comfortable beige fabric sofa with cushions against the right wall, round wooden coffee table with a steaming cup, tall window with sheer white curtains on the left flooding sunlight, potted fiddle-leaf plant near the window, white wall-mounted air conditioner unit high on the back wall centered above the sofa. Wide symmetrical eye-level shot, 35mm look, soft natural light, premium real-estate photography quality. No people, no text, no watermarks.

Pick the better of the two results (composition: AC clearly visible, sofa right, window left, breathing room around center for the life layer).

- [ ] **Step 2: Generate the ink twin FROM the photo**

Call `generate_image` again with model `nano_banana_pro`, aspect_ratio `16:9`, count 2, `medias: [{value: "<job_id of chosen photo>", role: "image"}]`, prompt:

> Redraw this exact room as a fine architectural ink drawing on warm cream drafting paper: identical composition, identical furniture positions and window and air conditioner placement, sepia-brown hairline linework, dashed construction lines, tick marks along the floor like a watch bezel comb, small dimension annotations with leader lines, corner registration marks, subtle dot-grid paper texture. Keep every object exactly where it is in the reference photo. No color fills except paper cream, no readable text.

Pick the result that best matches the photo's geometry (overlaying them at 50% opacity should show aligned walls/sofa/AC).

- [ ] **Step 3: Download and convert**

```bash
cd ziggy-website-v2/img
curl -sL "<photo rawUrl>" -o room-photo.png
curl -sL "<ink rawUrl>" -o room-ink.png
sips -s format webp -s formatOptions 82 room-photo.png --out room-photo.webp
sips -s format webp -s formatOptions 82 room-ink.png --out room-ink.webp
rm room-photo.png room-ink.png
ls -la   # each .webp expected well under 400KB
```

(If this `sips` build lacks webp output, keep optimized PNGs — `sips --resampleWidth 1920` — and update the two `src` attributes in `index.html` to `.png`.)

- [ ] **Step 4: Verify alignment**

Open both images side by side (Read tool). Expected: same room, same camera; sofa/AC/window in the same thirds. If misaligned, regenerate Step 2 with the other photo candidate or a stronger "identical composition" instruction. Do not proceed until aligned — the morph in Task 7 depends on it.

- [ ] **Step 5: Commit**

```bash
git add ziggy-website-v2/img
git commit -m "feat(site-v2): living-room plates — photoreal + aligned ink twin"
```

---

### Task 5: Waitlist form behavior

**Files:**
- Create: `ziggy-website-v2/js/waitlist.js`
- Modify: `ziggy-website-v2/index.html` (script tag + status element)

**Interfaces:**
- Consumes: `.waitlist` form (Task 1)
- Produces: `initWaitlist()` — validates email, shows Hebrew status text; wired to the same submission mechanism as the old site once verified (see Step 1)

- [ ] **Step 1: Read the old site's submit handler**

Read `ziggy-website/js/main.js` — find the waitlist submit logic and note the endpoint/mechanism it uses (form POST target, fetch URL, or third-party). Copy the same mechanism. **If the old site has no real endpoint** (e.g. it only simulates success), implement the same simulation and add a `TODO-launch` comment listing what to connect — and report this finding in the task summary.

- [ ] **Step 2: Write `js/waitlist.js`** (structure; endpoint per Step 1 finding)

```js
export function initWaitlist() {
  const form = document.querySelector('.waitlist');
  const msg = document.createElement('p');
  msg.className = 'form-msg';
  msg.setAttribute('role', 'status');
  form.after(msg);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      msg.textContent = 'כתובת אימייל לא תקינה 🤔';
      return;
    }
    msg.textContent = 'רגע…';
    try {
      await submitEmail(email);
      msg.textContent = 'נרשמתם! הקופסה מתקרבת 📦';
      form.email.value = '';
    } catch {
      msg.textContent = 'משהו השתבש — נסו שוב עוד רגע';
    }
  });
}

// Default implementation — REPLACE the body with the old site's real
// mechanism if Step 1 found one; otherwise keep this simulation.
async function submitEmail(email) {
  // TODO-launch: connect real waitlist backend (none found in old site → simulation)
  await new Promise(r => setTimeout(r, 600));
  console.log('waitlist (simulated):', email);
}
```

- [ ] **Step 3: Wire and style**

In `index.html` before `</body>`: `<script type="module">import {initWaitlist} from './js/waitlist.js'; initWaitlist();</script>`
In `style.css` append: `.form-msg { min-height: 1.4em; font-size: 14px; opacity: .85; }`

- [ ] **Step 4: Verify**

With Playwright: type `not-an-email` → submit → expect "כתובת אימייל לא תקינה"; type a valid email → submit → expect the success or in-flight message per the mechanism found.

- [ ] **Step 5: Commit**

```bash
git add ziggy-website-v2
git commit -m "feat(site-v2): waitlist form with Hebrew validation states"
```

---

### Task 6: Living room act — arrival, parallax, life layer, chat bubble

**Files:**
- Modify: `ziggy-website-v2/index.html` (fill `#life-layer`)
- Modify: `ziggy-website-v2/css/style.css` (life layer + bubble styles)
- Modify: `ziggy-website-v2/js/flight.js` (extend timeline)

**Interfaces:**
- Consumes: `#act-room`, `#room-ink`, `#room-photo` (Tasks 1+4); `window.__flightTl` pattern (Task 3)
- Produces: `#life-layer` children — `#ac-air` (3 paths), `#ac-gauge-needle`, `#bubble-ac`; timeline beats "roomArrive" and "ziggyActs" (marked by comments in the add chain)

- [ ] **Step 1: Fill `#life-layer` in `index.html`**

```html
<div id="life-layer">
  <svg id="life-svg" viewBox="0 0 1376 768" preserveAspectRatio="xMidYMid slice">
    <!-- cold air from the AC (position tuned to the plate in Step 4) -->
    <g id="ac-air">
      <path d="M 640 250 Q 620 300 640 350 Q 660 400 630 450" />
      <path d="M 700 250 Q 680 300 700 350 Q 720 400 690 450" />
      <path d="M 760 250 Q 740 300 760 350 Q 780 400 750 450" />
    </g>
    <!-- drawn gauge beside the AC -->
    <g id="ac-gauge">
      <circle cx="880" cy="220" r="34" fill="none"/>
      <path d="M 858 240 A 30 30 0 1 1 902 240" fill="none" stroke-dasharray="1.4 6.6" stroke-width="5" opacity=".6"/>
      <line id="ac-gauge-needle" x1="880" y1="220" x2="880" y2="196" stroke-width="2.5"/>
      <text x="880" y="272" text-anchor="middle" font-size="20" font-family="ui-monospace, monospace">24°</text>
    </g>
  </svg>
  <div id="bubble-ac" class="chat-bubble">חלון הסלון פתוח והמזגן עבד — כיביתי 🍃</div>
</div>
```

- [ ] **Step 2: Append styles**

```css
#life-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
#ac-air path { stroke: var(--cold); stroke-width: 4; fill: none; stroke-dasharray: 12 14; filter: drop-shadow(0 0 6px var(--cold)); opacity: 0; }
#ac-gauge circle, #ac-gauge path, #ac-gauge line { stroke: var(--amber); }
#ac-gauge { filter: drop-shadow(0 0 6px var(--amber)); opacity: 0; }
#ac-gauge text { fill: var(--amber); }
.chat-bubble { position: absolute; top: 14%; inset-inline-start: 8%; background: #ffb35c; color: #3a2410; border-radius: 16px 16px 16px 4px; padding: 12px 18px; font-size: clamp(14px, 2vw, 18px); box-shadow: 0 6px 22px rgba(0,0,0,.18); opacity: 0; direction: rtl; }
```

- [ ] **Step 3: Extend the timeline in `flight.js`** (append before `window.__flightTl = tl;`)

```js
  tl
    // Act 4 "roomArrive": arrive inside — ink room scales in from the dive
    .add('#act-room', { opacity: [0, 1], scale: [0.55, 1], duration: 1000, ease: 'out(2)' }, '<-=200')
    // gentle in-room camera drift (the parallax feel on a single plate)
    .add('#room-ink', { scale: [1.12, 1.02], x: [30, -30], duration: 2400, ease: 'linear' }, '<')
    // "ziggyActs": gauge + air + bubble spring in
    .add('#ac-gauge', { opacity: [0, 1], duration: 400 })
    .add('#ac-gauge-needle', { rotate: [-70, 12], duration: 700, ease: 'outBack(2)', transformOrigin: '880px 220px' }, '<')
    .add('#ac-air path', { opacity: [0, 1], strokeDashoffset: [0, -80], duration: 1200, delay: stagger(180) }, '<+=200')
    .add('#bubble-ac', { opacity: [0, 1], y: [24, 0], scale: [0.85, 1], duration: 650, ease: 'outElastic(1, .6)' }, '<+=300');
```

- [ ] **Step 4: Position pass**

Screenshot at the `ziggyActs` scroll depth. The air paths and gauge must sit on the AC in the actual generated plate — edit the `d`/`cx`/`cy` coordinates in `index.html` to match the plate from Task 4 (viewBox is 1376×768 = plate pixel space, so coordinates can be read directly off the image).
Expected: air flows from the AC vent, gauge floats beside it, bubble top-right corner area, nothing covering the sofa's center.

- [ ] **Step 5: Commit**

```bash
git add ziggy-website-v2
git commit -m "feat(site-v2): living room act — arrival, life layer, springing chat bubble"
```

---

### Task 7: The morph — ink becomes reality + paper warms

**Files:**
- Modify: `ziggy-website-v2/js/flight.js`
- Modify: `ziggy-website-v2/css/style.css`

**Interfaces:**
- Consumes: `#room-ink`, `#room-photo` (aligned plates, Task 4); the "ziggyActs" beat (Task 6)

- [ ] **Step 1: Append the morph to the timeline in `flight.js`**

```js
  tl
    // "morph": the room becomes real as Ziggy acts — the page's magic trick
    .add('#room-photo', { opacity: [0, 1], scale: [1.04, 1], duration: 2000, ease: 'inOut(2)' })
    .add('#room-ink',   { opacity: [1, 0], duration: 2000, ease: 'inOut(2)' }, '<')
    // ink life layer PERSISTS over the photo (the AR look) — just re-assert it
    .add('#life-layer', { opacity: [1, 1], duration: 100 }, '<')
    // paper warms from dawn to midday cream
    .add('body', { backgroundColor: '#f4ecdc', duration: 2000, ease: 'linear' }, '<');
```

- [ ] **Step 2: Soft-edge the morph**

Append to `style.css` — the photo fades in with a subtle wipe so it feels painted-in, not crossfaded:

```css
#room-photo { -webkit-mask-image: linear-gradient(105deg, black 60%, transparent 88%); mask-image: linear-gradient(105deg, black 60%, transparent 88%); -webkit-mask-size: 300% 100%; mask-size: 300% 100%; -webkit-mask-position: 100% 0; mask-position: 100% 0; }
```

And in the morph step of `flight.js`, extend the `#room-photo` add with mask travel:

```js
    .add('#room-photo', { opacity: [0, 1], scale: [1.04, 1], maskPosition: ['100% 0', '0% 0'], duration: 2000, ease: 'inOut(2)' })
```

(Replace the plain version from Step 1 — one `#room-photo` add only.)

- [ ] **Step 3: Verify the full flight**

Scroll the entire track with Playwright, screenshot at 8 evenly spaced depths.
Expected sequence: closed box (cool paper) → lids open + text away → house draws → glowing door → dive + streaks → ink room + gauge/air/bubble → reality wipes in left-to-right over the ink room with the glowing life layer intact on top → paper is warm cream → outro section scrolls in normally.

- [ ] **Step 4: Commit**

```bash
git add ziggy-website-v2
git commit -m "feat(site-v2): sketch-to-reality morph with persisting ink life layer"
```

---

### Task 8: Mobile vertical variant + reduced-motion pass

**Files:**
- Modify: `ziggy-website-v2/js/flight.js`
- Modify: `ziggy-website-v2/css/style.css`

**Interfaces:**
- Consumes: full timeline (Tasks 3–7)

- [ ] **Step 1: Wrap axis-dependent values in a portrait check**

In `flight.js`, above the timeline, add:

```js
const PORTRAIT = matchMedia('(orientation: portrait)').matches;
```

Change the in-room drift add (Task 6 Step 3) to swap axis on portrait:

```js
    .add('#room-ink', PORTRAIT
      ? { scale: [1.18, 1.05], y: [24, -24], duration: 2400, ease: 'linear' }
      : { scale: [1.12, 1.02], x: [30, -30], duration: 2400, ease: 'linear' }, '<')
```

(Orientation changes reload semantics: acceptable for the proof scene; full Scope-based responsive swap lands in phase 2.)

- [ ] **Step 2: Mobile layout pass**

Append to `style.css`:

```css
@media (max-width: 640px) {
  #scroll-track { height: 600vh; }
  .hero-art { width: 78vw; }
  .rise-art { width: 92vw; }
  .chat-bubble { top: 10%; inset-inline-start: 6%; inset-inline-end: 6%; }
  .waitlist input { min-width: 0; flex: 1; }
}
```

- [ ] **Step 3: Verify mobile + reduced motion**

Playwright at 390×844: full scroll-through, screenshots at 6 depths — expect the same story, nothing clipped, bubble readable. Then emulate `prefers-reduced-motion: reduce` (Playwright `emulateMedia`): expect all four acts stacked statically, visible, scrollable, no console errors.

- [ ] **Step 4: Commit**

```bash
git add ziggy-website-v2
git commit -m "feat(site-v2): mobile vertical drift + reduced-motion static fallback"
```

---

### Task 9: Polish loop + judgment package

**Files:**
- Modify: any of `ziggy-website-v2/*` (tuning only — no new features)

**Interfaces:**
- Consumes: everything

- [ ] **Step 1: Timing polish loop (up to 3 rounds)**

For each round: full-scroll screenshot sweep (8 depths, desktop + mobile) → judge against these criteria → tune numbers (durations, eases, stagger values, transform origins) → re-sweep:
- The dive lands ON the door (transform-origin correct at all viewport sizes)
- No act is visible for less than ~half a viewport of scroll (nothing feels skipped)
- The morph reads as "reality painting in", not a crossfade
- Text is legible at every captured depth
- 60fps feel: no layout-triggering properties animated (transforms/opacity only — verify no `top/left/width` in any `tl.add`)

- [ ] **Step 2: Side-by-side judgment package for the owner**

```bash
# server for the owner to scroll themselves
python3 -m http.server 8080 --directory ziggy-website-v2
```

Present to the owner: the local URL + instruction to open `https://animejs.com` in the adjacent tab, plus the 8-depth screenshot strips (desktop + mobile). The owner judges per spec §8. Record verdict in the plan file under this task.

- [ ] **Step 3: Commit any tuning**

```bash
git add ziggy-website-v2
git commit -m "polish(site-v2): proof scene timing and composition tuning"
```

---

## After the gate

If the owner passes the proof scene: write the phase-2 plan (scenes 1–9, interactive moment, trust block, finale, FAQ) reusing this file's patterns — plates per scene via the Task 4 recipe with the chosen photo as the standing master-home reference. If the owner fails it: capture the specific gaps as revisions to this plan before any phase-2 work.
