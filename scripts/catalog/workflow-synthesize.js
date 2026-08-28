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

// The runtime may hand this script `args` as a JSON-encoded string rather than an object —
// this bit workflow-extract.js at real launch: destructuring a string yielded undefined for
// every field and the first call built on it threw a generic type error with 0 agents run.
// Normalise first, and fail fast with a NAMED error instead of letting `undefined` propagate
// into template literals and surface as a confusing downstream failure.
const rawArgs = typeof args === 'string' ? JSON.parse(args) : args
const { scratch, schemaText } = rawArgs || {}

if (!scratch || typeof scratch !== 'string') {
  throw new Error('workflow-synthesize: missing or invalid args.scratch (expected a non-empty string path)')
}
if (!schemaText || typeof schemaText !== 'string') {
  throw new Error('workflow-synthesize: missing or invalid args.schemaText (expected a non-empty string)')
}

const RAW = `${scratch}/catalog-raw`
const OUT = `${scratch}/catalog-synth`

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

// Appended only to the apply-maps agent, the one stage that actually emits full capability /
// mechanism records. merge_catalog.py's validate_record() rejects unknown fields under
// additionalProperties: false, and it computes composes_with/used_by itself — an agent that
// emits either field produces a normalized.json that fails to merge.
const NO_DERIVED_FIELDS_RULE = `
- Do NOT compute or emit "composes_with" or "used_by" on any record. A deterministic script
  (scripts/catalog/merge_catalog.py) derives both after you; emitting either field yourself
  will fail schema validation (additionalProperties: false) downstream.`

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
  `You have the complete verified Ziggy capability extraction: every territory's verified file at
${RAW}/*.verified.json. Read ALL of them first — your job needs the global picture, and it
cannot be done one territory at a time.

Your specific job: ${s.what}

Write your result as JSON to ${OUT}/map.${s.key}.json. Return {path, summary}.

RULES: never read .claude/worktrees/. Do not invent capabilities that no territory reported.
Do not change any "status" or "status_evidence" value — those were independently verified
and are not yours to touch.
${HARD_RULES}
${STATUS_UNCHANGED_RULE}

SCHEMAS:
${schemaText}`,
  { label: `crosslink:${s.key}`, phase: 'Cross-link', schema: DONE }
)))

const applied = await agent(
  `Apply the four normalization maps to produce the single global record set.

Read all of ${RAW}/*.verified.json and all of ${OUT}/map.*.json.

Produce ONE file ${OUT}/normalized.json with {"capabilities": [...], "mechanisms": [...]} where:
- every capability appears exactly once under its canonical id
- every mechanism appears exactly once under its canonical id
- layers are the normalized set
- every "uses" entry points at a mechanism id that exists in this file
- "status" and "status_evidence" are copied through UNCHANGED from the verified files

Do NOT compute composes_with or used_by — a deterministic script does that afterwards.
Return {path, summary} where summary gives final counts.
${HARD_RULES}
${STATUS_UNCHANGED_RULE}
${NO_DERIVED_FIELDS_RULE}

SCHEMAS:
${schemaText}`,
  { label: 'apply-maps', phase: 'Cross-link', schema: DONE }
)

phase('Narrative')
const narrative = await agent(
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
)

phase('Critique')
const critics = await parallel([
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

return {
  maps: maps.filter(Boolean).map((m) => m.path),
  normalized: applied ? applied.path : null,
  narrative: narrative ? narrative.path : null,
  gaps: critics.filter(Boolean).map((c) => ({ path: c.path, summary: c.summary })),
}
