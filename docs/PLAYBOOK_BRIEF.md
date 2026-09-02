# Ziggy Sales Playbook — shared brief for every writer

You are writing part of the **Ziggy Sales Playbook**: everything a customer might
want to know, and how we should tell it. It is the client-facing twin of the
technical Capability Catalog.

Read this whole file before writing anything.

---

## 1. Who reads this

Two people, both mid-conversation:

- **A prospective customer** — an Israeli household. Has never heard "Zigbee",
  does not care what a hub is, and is deciding whether this is worth money and
  letting a stranger install something in their home.
- **A salesperson** (often Youval) — sitting in that person's living room,
  needing the words *now*.

It is not for engineers. It is not documentation. If an entry would only make
sense to someone who has read the code, it is wrong.

## 2. The truth gate — the one rule that cannot bend

The technical catalog at `docs/capability-catalog.json` records what **actually
runs**: 76 capabilities, of which 61 are `live-prod`. It also records 6
`orphaned`, 3 `abandoned`, 4 `flagged` and 2 `canary-only` — things that were
built but do **not** ship, do not run, or are switched off.

**You may only describe things whose backing capabilities are `live-prod`.**

Every entry lists the capability ids it rests on in `capabilities[]`. A build
step verifies each one is `live-prod` and refuses to publish the entry
otherwise. So:

- Never describe a feature you cannot point to in the catalog as `live-prod`.
- Never soften a gap into a promise ("will soon", "is designed to").
- If something would sell well but isn't live, **leave it out**. Selling
  vapourware in someone's living room is the exact failure this gate exists to
  prevent.
- Read `what_it_does`, `known_gaps` and `status_evidence` on a capability before
  writing about it. `known_gaps` is where the honest caveats already are.

## 3. Voice — Hebrew is the product's language

Every entry is written **twice**: Hebrew and English. The Hebrew is
**authored, not translated** — write it first, in Hebrew, then write the English
as its own natural text. Translated marketing copy reads foreign, and this is a
product whose whole pitch is that it speaks your language.

**You MUST follow `frontend/src/lib/i18n/HEBREW_STYLE_GUIDE.md`.** Read it. The
rules that matter most here:

- **Gender-neutral by construction.** Never `בחר/י`. Use nouns for actions
  (`שמירה`, `הוספה`) and impersonal/infinitive for instructions
  (`אפשר לבחור`, `יש ללחוץ`) — never `אתה צריך`.
- **The brand is `זיגי`** in Hebrew prose. `Ziggy Home` only as the literal app
  name someone installs.
- **The hub is just `זיגי`.** The customer never learns there is a separate box.
  Never `מרכזייה`, `רכז`, `בקר`, `גשר` in customer-facing copy.
- **Maqaf `־`, not hyphen**, for Hebrew prefixes on Latin/numbers: `ל־22`,
  `ה־QR`. **Gershayim `״`**, never ASCII quotes.
- **Never leak engine terms** — no Home Assistant, Zigbee, MQTT, entity, sensor
  id, automation YAML, relay, fleet. The customer's world is rooms, lights, the
  AC, the door, people.
- **Dugri, not stiff.** Warm, direct, confident. No hype, no exclamation marks,
  no "revolutionary". An Israeli reading it should think *this was written by
  someone from here*.

English: same substance, plain and confident. Not a translation of the Hebrew's
sentence structure.

## 4. Entry schema

Write a JSON file: `{"entries": [ ... ]}`. Every entry:

```json
{
  "id": "lowercase-kebab-unique",
  "type": "moment|concept|objection|comparison|persona|journey|pitch|israel|install|pricing",
  "title_he": "…", "title_en": "…",
  "body_he": "…",  "body_en": "…",
  "capabilities": ["catalog-capability-id", "…"],
  "family": "comfort|safety|effort|control|money|trust",
  "moments": ["morning","leaving","away","arriving","evening","night"],
  "rooms": ["bedroom","living","kitchen","entrance","bathroom","outside","whole-home"],
  "tags": ["free-form"]
}
```

Optional, by type:

- **moment** — `problem_he` / `problem_en` (the pain, before any solution),
  `why_it_matters_he` / `why_it_matters_en`,
  `discovery_question_he` / `discovery_question_en` (what a salesperson ASKS to
  make the prospect feel this pain themselves — a question, never a pitch).
- **objection** — `objection_he` / `objection_en` (the fear in the customer's
  own words), and `body_*` is the honest answer.
- **comparison** — `alternative` (e.g. "Alexa routines", "Home Assistant DIY").
- **persona** — `fits_moments`: [moment ids that matter most to them].
- **pricing** — set `"needs_input": true` and leave numbers out entirely.
  **Never invent a price, a package, or a subscription tier.**

Rules on fields:

- `family`, `moments`, `rooms` are the axes the site groups by. Fill them
  thoughtfully — they generate the "problems / day in the life / rooms /
  families" views. `whole-home` is a valid room. An entry with no natural time
  of day may have an empty `moments`.
- `capabilities` may be empty **only** for `concept`, `pitch`, `persona`,
  `israel`, `install` and `pricing` entries that make no feature claim. Any
  entry describing something Ziggy does MUST list them.
- Length: `body_*` is 2–5 sentences for most types, up to ~10 for `journey`,
  `pitch`, `comparison` and `install`. Tight beats padded.

## 5. Quality bar

- **Concrete over abstract.** "האור בשירותים נדלק לבד ב־3 לפנות בוקר ונכבה
  אחריך" beats "ניהול תאורה חכם".
- **A moment is a moment.** Name the situation — a time, a room, a person doing
  something. Not a feature summary with warm adjectives.
- **Answer objections honestly.** If the honest answer has a caveat, include the
  caveat. A salesperson who repeats a claim that collapses in the customer's
  hallway loses the sale and the trust. An honest limit, well framed, sells.
- **No duplicated entries.** Before writing, check the catalog: several
  capabilities usually collapse into one customer-visible moment.
- **No emoji.** No marketing clichés ("seamlessly", "effortlessly",
  "peace of mind" as a phrase, "game-changing").

## 6. Grounding files

- `docs/capability-catalog.json` — what actually runs. Your source of truth.
- `docs/CAPABILITY_CATALOG.md` — the same, readable.
- `frontend/src/lib/i18n/HEBREW_STYLE_GUIDE.md` — the locked Hebrew voice.
- `frontend/src/lib/i18n/he.js` — the product's real Hebrew vocabulary. Use the
  same words the app uses; a customer should hear one voice.

Never read anything under `.claude/worktrees/` — stale duplicate trees.
