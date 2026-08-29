export const meta = {
  name: 'ziggy-catalog-synthesize',
  description: 'Global dedup and normalization, value-story narrative, and completeness critique',
  phases: [
    { title: 'Cross-link' },
    { title: 'Narrative' },
    { title: 'Critique' },
  ],
}

const DONE = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'summary'],
  properties: { path: { type: 'string' }, summary: { type: 'string' } },
}

// Extends DONE for the five Cross-link-phase agents (the four normalization-map agents plus
// apply-maps) — the only agents that read catalog-raw directly and can therefore see whether
// the extraction swarm actually finished. The extraction swarm has already hit session limits
// twice; catalog-raw/ may hold fewer *.verified.json files than there are expected territories
// at synthesis time. Without a forced report, every agent here would just treat whatever is on
// disk as "the complete extraction" (which the old prompt literally told them), the workflow
// would report 8/8 agents succeeded, and one or more territories — each costing real money to
// produce — would silently vanish from normalized.json.
const DONE_COVERAGE = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'summary', 'territories_found', 'territories_missing'],
  properties: {
    path: { type: 'string' },
    summary: { type: 'string' },
    territories_found: { type: 'integer' },
    territories_missing: { type: 'array', items: { type: 'string' } },
  },
}

// The runtime may hand this script `args` as a JSON-encoded string rather than an object —
// this bit workflow-extract.js at real launch: destructuring a string yielded undefined for
// every field and the first call built on it threw a generic type error with 0 agents run.
// Normalise first, and fail fast with a NAMED error instead of letting `undefined` propagate
// into template literals and surface as a confusing downstream failure.
const rawArgs = typeof args === 'string' ? JSON.parse(args) : args
const { scratch, schemaText, names } = rawArgs || {}

if (!scratch || typeof scratch !== 'string') {
  throw new Error('workflow-synthesize: missing or invalid args.scratch (expected a non-empty string path)')
}
if (!schemaText || typeof schemaText !== 'string') {
  throw new Error('workflow-synthesize: missing or invalid args.schemaText (expected a non-empty string)')
}
if (!Array.isArray(names) || names.length === 0) {
  throw new Error(`workflow-synthesize: expected args.names to be a non-empty array, got ${typeof names}`)
}

const RAW = `${scratch}/catalog-raw`
const OUT = `${scratch}/catalog-synth`
const NAMES_LIST = names.join(', ')

// Rules appended to EVERY agent prompt in this workflow.
const HARD_RULES = `
HARD RULES — violating any of these invalidates your output:
- NEVER read or reference anything under .claude/worktrees/ — those are stale duplicate trees.
- Do NOT SSH anywhere, call the relay, or run scripts/fleet-health.py. Static reading only.
- Do NOT modify any file outside your assigned output path.`

// Appended only to the Cross-link stage (the four map agents and the apply-maps agent) —
// status was independently verified in Task 4's Verify phase and is not this workflow's to
// renegotiate.
const STATUS_UNCHANGED_RULE = `
- Do NOT change any "status" or "status_evidence" value on any capability or mechanism — those
  were independently verified in Task 4 and are not yours to renegotiate. Copy them through
  UNCHANGED, verbatim.`

// Appended only to the five Cross-link-phase agents. Forces every one of them to report
// coverage explicitly rather than silently trusting whatever is on disk. See DONE_COVERAGE
// above for why this exists.
function coverageInstructions() {
  return `
COVERAGE CHECK (required — do this before anything else): list ${RAW}/*.verified.json and count
how many files actually exist right now. Do NOT assume this is the complete extraction — the
extraction swarm has hit session limits before, and this set may be partial. Compare the
territory names you found against the full expected list below and identify any that are
missing entirely.

EXPECTED TERRITORIES: ${NAMES_LIST}

In your returned object, set "territories_found" to the number of verified files you actually
read, and "territories_missing" to the exact names (from the expected list above) of every
territory with no verified file on disk. If none are missing, return an empty array for
"territories_missing" — do not omit either field.`
}

// Appended only to the apply-maps agent, the one stage that actually emits full capability /
// mechanism records. Both composes_with and used_by are declared-optional properties on
// CAPABILITY_SCHEMA / MECHANISM_SCHEMA (added by controller ruling in Task 1 precisely so
// re-validating an assembled catalog never errors on them), so emitting them does NOT fail
// schema validation. What actually happens: merge_catalog.py's derive_composition() and
// build_used_by() compute both fields from each capability's "uses" list and OVERWRITE
// whatever is already there, unconditionally. Anything an agent emits here is silently
// discarded, not rejected — so emitting it wastes tokens and risks an inconsistent
// uses/composes_with pair sitting in the file for as long as it takes the merge script to run
// and fix it. Leave both fields out entirely.
const NO_DERIVED_FIELDS_RULE = `
- Do NOT compute or emit "composes_with" or "used_by" on any record. Both are computed
  downstream from each capability's "uses" list by scripts/catalog/merge_catalog.py
  (derive_composition / build_used_by), which overwrites whatever you emit unconditionally —
  your values are silently discarded either way, not validated against. Guessing at them wastes
  tokens and invites an inconsistent uses/composes_with pair sitting in the file in the
  meantime. Leave both fields out entirely.`

// Appended only to the two Critique-phase critic prompts. Controller ruling: these paths are
// deliberately-unassigned plumbing/assets/scaffolding, not gaps, and a critic that flags them
// produces noise that buries real findings.
const EXCLUDED_PATHS_RULE = `
EXCLUDED FROM GAP-HUNTING (controller ruling — these are plumbing, generated assets, or
scaffolding, NOT gaps, no matter how large they look): do not enumerate or flag anything under
frontend/src/components/ui/**, components/layout/**, hooks/**, assets/** (36 device icons),
marketing/**, frontend/src/lib/**, main.jsx, index.css, test-setup.js, tests/**.
This exclusion narrows WHERE you look for gaps — it does NOT lower the bar for what counts as
one. Do not be generous about a genuine gap anywhere else: a capability that "sort of covers" a
router or page does not claim it.`

const SLICES = [
  { key: 'capability-ids', what: 'capability id and name normalization: find capabilities recorded under different ids or names across territories and map them to ONE canonical id+name. Emit a mapping file.' },
  { key: 'mechanism-ids', what: 'mechanism identity: two territories will have named the same building block differently (e.g. "geofence-zones" vs "presence-zones"). Collapse them to one canonical id, unioning surfaces and used_by. Emit a mapping file.' },
  { key: 'layers', what: 'layer and audience normalization: the territories each invented their own layer strings. Collapse them into one coherent set of 8-12 layers that a product owner would recognise, and assign every capability to one.' },
  { key: 'uses-edges', what: 'uses-edge repair: capabilities reference mechanism ids that other territories defined. Using the whole set, fix every "uses" list so it points at ids that actually exist, and add obviously-missing edges you can prove from the surfaces.' },
]

phase('Cross-link')
const maps = await parallel(SLICES.map((s) => () => agent(
  `You have whatever verified territory files currently exist at ${RAW}/*.verified.json — this
may be a PARTIAL set, not the complete extraction (see COVERAGE CHECK below). Read all of them
first — your job needs the global picture across whatever is present, and it cannot be done
one territory at a time.

Your specific job: ${s.what}

Write your result as JSON to ${OUT}/map.${s.key}.json. Return {path, summary, territories_found,
territories_missing}.

RULES: never read .claude/worktrees/. Do not invent capabilities that no territory reported.
Do not change any "status" or "status_evidence" value — those were independently verified
and are not yours to touch.
${HARD_RULES}
${STATUS_UNCHANGED_RULE}
${coverageInstructions()}

SCHEMAS:
${schemaText}`,
  { label: `crosslink:${s.key}`, phase: 'Cross-link', schema: DONE_COVERAGE }
)))

const applied = await agent(
  `Apply the four normalization maps to produce the single global record set.

Read whatever verified territory files currently exist at ${RAW}/*.verified.json — this may be
a PARTIAL set, not the complete extraction (see COVERAGE CHECK below) — and all of
${OUT}/map.*.json.

Produce ONE file ${OUT}/normalized.json with {"capabilities": [...], "mechanisms": [...]} where:
- every capability appears exactly once under its canonical id
- every mechanism appears exactly once under its canonical id
- layers are the normalized set
- every "uses" entry points at a mechanism id that exists in this file
- "status" and "status_evidence" are copied through UNCHANGED from the verified files

Do NOT compute composes_with or used_by — a deterministic script does that afterwards.
Return {path, summary, territories_found, territories_missing} where summary gives final counts.
${HARD_RULES}
${STATUS_UNCHANGED_RULE}
${NO_DERIVED_FIELDS_RULE}
${coverageInstructions()}

SCHEMAS:
${schemaText}`,
  { label: 'apply-maps', phase: 'Cross-link', schema: DONE_COVERAGE }
)

// Surface any incomplete extraction — never silently. A partial synthesis is sometimes the
// right thing to run deliberately (e.g. to unblock downstream work while a stuck territory is
// retried), so this does NOT throw. It just makes the gap impossible to miss: a top-level field
// on the return value the controller can check without reading free-text summaries, plus a
// log() line so it shows up in the run's own output as it happens.
const crossLinkResults = [...maps, applied].filter(Boolean)
const missingTerritories = Array.from(
  new Set(crossLinkResults.flatMap((r) => r.territories_missing || []))
).sort()
if (missingTerritories.length > 0) {
  log(`WARNING: ${missingTerritories.length} territories missing from synthesis: ${missingTerritories.join(', ')}`)
}

// Narrative and Critique both depend only on ${OUT}/normalized.json, not on each other or on
// catalog-raw directly (so neither needs a coverage report — the coverage check already ran
// upstream, in Cross-link). Run them concurrently instead of serializing a full agent's
// wall-clock for nothing. They stay visually distinct phases for progress display via each
// agent's own `phase` option below — deliberately NOT via the global phase() transition, since
// once both groups are in flight at once neither can truthfully claim to be "the" current
// phase.
const [narrative, criticBackend, criticFrontend] = await parallel([
  () => agent(
    `Read ${OUT}/normalized.json.

Group the USER-FACING capabilities into 5-8 value stories — the way a person would describe
what Ziggy does for them, not the way an engineer would. Think in terms of what changes in
someone's life: comfort, safety, effort saved, control, peace of mind.

For each story give: title (3-5 words), blurb (2 sentences, no jargon, no entity ids, no
Home Assistant terminology — the user never sees HA), and capability_ids.

Every user-facing capability with status live-prod or canary-only must appear in exactly one
story. Operator/internal capabilities and orphaned/abandoned ones are excluded.

Write to ${OUT}/narrative.json as {"stories": [{"title","blurb","capability_ids"}]}.
Return {path, summary}.
${HARD_RULES}`,
    { label: 'narrative', phase: 'Narrative', schema: DONE }
  ),
  () => agent(
    `You are the completeness critic for the Ziggy backend and services.

Read ${OUT}/normalized.json. Then enumerate the real surface area:
- every file in backend/routers/ (49 of them)
- every file in services/ (134 of them)
- every route registered in backend/server.py

For each, decide: is it claimed by at least one capability or mechanism in the catalog, or is
it genuinely just plumbing? Anything neither claimed nor plumbing is a GAP — the swarm missed
a capability there.

Do not be generous. A capability that "sort of covers" a router does not claim it.

${EXCLUDED_PATHS_RULE}

Write ${OUT}/gaps.backend.json as {"unclaimed": [{"path","why_it_matters"}], "notes": "..."}.
Return {path, summary} with the gap count.
${HARD_RULES}`,
    { label: 'critic:backend', phase: 'Critique', schema: DONE }
  ),
  () => agent(
    `You are the completeness critic for the Ziggy frontend, mobile, relay and ops surface.

Read ${OUT}/normalized.json. Then enumerate:
- every file in frontend/src/pages/ (41) and the routes in frontend/src/App.jsx
- every file in relay/ (46)
- every script/tool directly under scripts/ (33 top-level entries, including the canary/,
  factory/, catalog/ and linux/ subdirectories — look inside those too, not just the top level)
- the ziggy_mobile repo at /Users/YouvalPolacsek/ziggy_mobile (144 tracked files)

For each, decide: claimed by a capability, genuine plumbing, or a GAP. Pay special attention
to whether the mobile-native territory was actually covered — the native ziggy-presence
plugin, FCM registration, geofencing and the OTA updater must each be represented.

Do not be generous. A capability that "sort of covers" a page or script does not claim it.

${EXCLUDED_PATHS_RULE}

Write ${OUT}/gaps.frontend.json as {"unclaimed": [{"path","why_it_matters"}], "notes": "..."}.
Return {path, summary} with the gap count.
${HARD_RULES}`,
    { label: 'critic:frontend', phase: 'Critique', schema: DONE }
  ),
])
const critics = [criticBackend, criticFrontend]

return {
  maps: maps.filter(Boolean).map((m) => m.path),
  normalized: applied ? applied.path : null,
  narrative: narrative ? narrative.path : null,
  gaps: critics.filter(Boolean).map((c) => ({ path: c.path, summary: c.summary })),
  territories_missing: missingTerritories,
}
