# Ziggy Motion Lab

**Status: Phase 2, round 2 complete (2026-09-28). STOP POINT. Nothing here is integrated into the product.**

A concept board for how Ziggy should move, built as a fully isolated route at
`/motion-lab`. Phase 1 investigated the real frontend (origin/main at e44e163);
Phase 2 built 50 interactive concepts with 183 variants across ten sections,
opened by a live "one tap, six consequences" cascade. Phase 3 (implementation)
starts only when individual ideas are approved.

Published copy (private): https://claude.ai/artifact/8LES8JcHSjKnK1nYHZ5Zj1
(built from `lab.html` via `vite.lab.config.js`; hash routing, no backend).

## Run it

```bash
cd frontend && npm run dev
# open http://localhost:3000/motion-lab
```

Dev builds always mount the lab. A production build only mounts it with
`?lab=on` (sticky per browser, `?lab=off` clears it). No backend, no login.

## What was built

- `frontend/src/lab/` — the whole lab. `MotionLab.jsx` (shell + own router),
  `LabContext.jsx` (speed / theme / direction / reduced-motion / frame),
  `time.js` (scaling transitions by the lab speed; shared easings and springs),
  `ui/` (Demo frame, Stage, Knobs), `ziggy/` (Ziggy-look primitives on the real
  tokens), `mock/home.js` (a realistic bilingual home), `sections/` (one file
  per section).
- `frontend/src/App.jsx` — six additive lines mounting the lab before the auth
  wall, exactly as the marketing site is mounted.
- `frontend/package.json` — `gsap` and `@gsap/react` added (free since 3.13,
  including MorphSVG / Flip / DrawSVG). Used only where Motion cannot do the
  job (path morphs, the orb, the breeze loop).

Sections: Overview · Navigation · Cards · Devices · Rooms · Controls ·
Feedback · Data · Page transitions · Moments · Experimental.

Deciding: every demo has a **Decide** strip (Pick this / Maybe / Keep today + a
note); the Decisions page lists them with a general Notes-to-Claude box. In the
published artifact these save to the artifact's shared `db`
(`decisions/<demoId>`, `notes/general`) and Claude reads them back with the
ArtifactData tool; on the dev server or LAN they stay in the browser and
"Copy as JSON" hands them over. Tablet and desktop frames render the real
shell (sidebar, no bottom nav, wider grid); phone-only gestures are pinned to
a phone frame.

Review tools: per-demo **Compare** (variant A = today, beside the selected
one), principle tags (continuity · causality · hierarchy · state · physical ·
restraint), a spec readout (duration / bounce / easing), ★ for my pick, and
keyboard shortcuts (1–9 variant, R replay, C compare, S speed, D dark,
H hebrew, M reduced motion).

Every demo: a phone / tablet / desktop stage in Ziggy's real palette, light and
dark, English and Hebrew (RTL), a variant switcher, Replay, per-demo knobs
(duration, bounce, easing…), and a global speed control (1× → 0.1×). A haptic
indicator in the toolbar shows which haptic a prototype fired.

## Investigation

`investigation/` holds the Phase 1 maps, each with file:line references into
origin/main:

- `01-navigation-shell-motion-layer.md` — routes, both navs, the page transition
  system, every primitive of the existing motion layer, all 41 framer-motion
  call sites, and 36 recorded traps.
- `02-dashboard-rooms-presence-map.md` — dashboard hierarchy, room tile anatomy,
  occupancy rendering, wall mode, loading/empty states, realistic content.
- `03-devices-controls-realtime.md` — device list, both card implementations,
  detail page + sheet, every control, the WS → store path, numbers that change.
- `04-feedback-loading-empty-modals.md` — toasts, modals/sheets/menus inventory,
  loading and empty states, success/error feedback, banners, confirmations.
- `05-onboarding-chat-actions-wizards.md` — onboarding, chat, actions, bundles,
  wizards, pairing, IR remote, every mobile gesture in the codebase.
- `06-visual-system.md` — colour tokens, type, radii, layout, icons, i18n, and
  copy-paste recipes for every Ziggy surface.
- `07-motion-research-2026-09.md` — current Motion 13 / GSAP 3.15 / platform
  facts with URLs, and synthesised motion tokens.

`findings.md` is the synthesis: what changes state without motion today, the
principle, the proposed architecture, and the risks.
