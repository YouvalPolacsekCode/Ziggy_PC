# Ziggy Commercial Website Redesign — "בית חכם בקופסה"

**Date:** 2026-07-04
**Status:** Approved by owner (brainstorm via visual companion, session 5251-1783186278)
**Replaces:** current `ziggy-website/` landing page (kept until new site approved for swap)

## 1. Purpose and success criteria

One-page cinematic waitlist-capture site, Hebrew-first (RTL) with English toggle.
The single job: make visitors *feel* the product and leave an email.

Success bar set by owner: visual/motion quality in the territory of animejs.com
("capturing, mesmerizing, innovating"). A **proof scene** gates the full build
(see §8) — judged side-by-side against animejs.com before the remaining scenes
are built.

## 2. Core concept

**"Smart home in a box" — one continuous flight.**

A cardboard box sits on a doorstep before dawn. Scrolling opens the lid; a
line-drawn house rises out of it and the camera dives through the front door —
the page's only door-dive. From there the entire page is one uninterrupted
scroll-driven flight through the home across a full day (morning → night),
ending with the house folding back into the box, which shows a shipping label
with an empty address line: the waitlist form.

The narrative arc the owner chose: the day starts with the family *leaving* —
the first scenes show the house working alone; the family flows back in through
the afternoon/evening. Message: "הבית עובד בשבילכם גם כשאתם לא שם."

## 3. Page structure (top to bottom)

| Beat | Time | Content |
|------|------|---------|
| Hero | 05:50 | Box on doorstep, dark blueprint-blue sky. Headline "בית חכם. בקופסה." + waitlist form above the fold + "גללו לפתוח ↓" |
| Opening | 06:00 | Lid opens, house rises line-by-line (SVG draw), camera dives through front door |
| Scene 1 | 08:00 | כולם יוצאים — lights shut off in a staggered wave. Ziggy: "כולם יצאו 👋 כיביתי 4 אורות ומזגן" |
| Scene 2 | 09:00 | Robot vacuum tours the empty house. Ziggy: "הבית ריק — שלחתי את השואב 🤖" |
| Scene 3 | 13:00 | Open window + running AC → Ziggy turns it off alone. "חלון הסלון פתוח והמזגן עבד — כיביתי 🍃" |
| Scene 4 | 16:00 | Kids come home. "עומר הגיע הביתה 🎒 הדלקתי לו מזגן בסלון" |
| Scene 5 | 18:15 | User: "זיגי, אני בדרך" → house preps (AC, entrance light) |
| Interactive | 19:00 | **Flight pauses. Visitor types/speaks a Hebrew command; the drawn house obeys.** Canned command suggestions below input; graceful fallback reply for unrecognized input |
| Scene 6 | 19:30 | User: "זיגי, ערב סרט" → lights dim, TV turns on, blinds drop |
| Scene 7 | 20:00 | הדוד המפורסם — boiler heated itself before showers, turns off after. "הדוד חם 🔥 ואכבה אותו ב־20:45 לחסוך" |
| Scene 8 | 23:00 | Motion in the yard → floodlight cone. (Cat tail behind the planter.) "זיהיתי תנועה בחצר — הדלקתי תאורה 💡" |
| Scene 9 | 23:30 | User: "לילה טוב, זיגי" → camera pulls back as rooms go dark, house becomes a single point of light |
| Trust block | — | Quiet, static: what's in the box · works-with (תדיראן/אלקטרה/טורנדו, switches, sensors) · privacy ("זיגי גר אצלכם, לא בענן") · Hebrew-first |
| Finale | — | House folds back into the box; box rotates to show shipping label with empty line → email fills it → "אנחנו פותחים את הדלת לאט" |
| FAQ + footer | — | Existing 6-question accordion (updated), final CTA, minimal footer |

Chat layer: every scene surfaces a Telegram-style bubble — dark bubble = user
commanding, orange bubble = Ziggy reporting proactively. Bubbles float in like
phone notifications beside the camera.

## 4. Art direction

**Style:** "instrument-grade ink schematic" — the anime.js engine-lens language.
Fine hairline linework, tick-mark combs (bezel trick), dashed construction
lines, monospace measurement labels, corner registration marks, tiny screws/
gauges on hero objects.

**The rule:** everything static is quiet ink; **only what Ziggy touches glows
and moves** (air flow, gauge needles, lamp halos, annotations).

**Palette — LIGHT MODE (owner revision 2026-07-04, "wife rule"):** the page is
always light. Warm cream drafting-paper base with sepia-brown hairline ink,
like an architect's hand drawing. The day-cycle rides on top without darkening
the page: cool pale paper + grey-blue ink at morning → full warm cream + sepia
at midday → dusk-amber paper (still light) at evening → at night the darkness
lives INSIDE the drawings (hatched shading within room frames, drawn moon/
stars, Ziggy's glows at maximum drama) while the page itself stays paper.
Reference Higgsfield jobs: 0e0ed5cd (day), adba8e23 (night-on-light).
This supersedes the earlier dark-base palette (option ג of the style screen);
the "day paints the drawing" idea survives, re-expressed on a light base.

**Detail hierarchy (anime.js recipe):**
- Instrument grade: the box, house exterior, each scene's hero object (AC, דוד, vacuum, floodlight)
- Level 2 (illustrated): surrounding furniture and rooms
- Level 1 (light): far background parallax layers
- Shared detail kit everywhere: tick combs, dimension lines, mono labels, corner marks

## 5. Motion system

- **Parallax layers:** each room in 3–4 depth layers (far wall / furniture /
  blurred foreground silhouette) moving at different speeds
- **Door dive:** used exactly once (hero → inside). Zoom into a glowing
  doorway, beat of speed-streaks, next scene opens
- **Ink streaking:** during fast whooshes the linework stretches into speed
  lines — native to the sketch style
- **Desktop:** horizontal flight, right-to-left (Hebrew reading direction)
- **Mobile:** flight rotates 90° — vertical descent through the floors
  (roof/דוד שמש → bedrooms → living room → yard). Implemented via anime.js
  Scope media queries (same timeline, axis swap)
- All driven by one master timeline synced to scroll (`onScroll({sync:true})`)
- `prefers-reduced-motion`: no flight; scenes appear as calm static reveals

## 6. Technical architecture

- Static folder, **no build step** (owner decision). Plain HTML/CSS/JS
- anime.js v4 as ES module from CDN; used APIs: `createTimeline`, `onScroll`,
  `stagger`, `createDrawable` (line drawing), `morphTo`, springs, `createScope`
- **Hybrid art pipeline (owner-approved after Higgsfield comparison):**
  - Scene "plates" generated with Higgsfield (nano_banana_pro) from a shared
    base prompt encoding §4; reference jobs 26f59d4a / e8c81cd3
  - Plates split into parallax layers (generation + background removal)
  - Coded SVG "life layer" on top for everything animated/glowing/interactive
  - Consistency risk across 9 scenes is acknowledged and tested by the proof scene
- RTL-first with existing i18n toggle mechanism (`data-i18n`, localStorage)
- Waitlist form reuses the existing endpoint/mechanism from current site
- Interactive moment: text input (+ Web Speech API Hebrew voice where
  supported); small intent matcher over a fixed command set; graceful fallback
- Performance: images as optimized WebP, lazy-loaded per scene; target fast
  load on mobile data

## 7. Explicitly out of scope (v1)

- No separate product/privacy pages (structure 1 chosen: one epic page)
- No pricing, ordering, or checkout
- No real 3D (Three.js) and no scroll-scrubbed video
- No CMS/build tooling
- Scenes not picked by owner (wake-up, kitchen, garden, laundry, leak, blinds,
  guests, kids-bedtime, school-day, energy report) — kept in this doc's git
  history for future versions

## 8. Delivery plan — proof scene first

1. **Proof scene (gate):** the opening beat (hero → box opens → house rises →
   door dive → arrival in the living room), full production quality: generated
   plates, SVG life layer, real anime.js motion, typography, RTL. Owner judges
   side-by-side vs animejs.com
2. On pass: remaining scenes 1–9, interactive moment, trust block, finale, FAQ
3. Swap into `ziggy-website/` after owner approval; old site preserved in git

## 9. Open items

- Real Ziggy chat screenshots/copy: owner may supply real moments from his home
  to replace invented bubble texts (validation-gate principle: scenes are
  promises — only ship what Ziggy can do by launch)
- English copy pass after Hebrew locks
- Font pairing: keep Assistant + Suez One or revisit during proof scene
