export const meta = {
  name: 'ziggy-catalog-extract',
  description: 'Dual-angle extraction, reconciliation and static liveness verification per territory',
  phases: [
    { title: 'Extract' },
    { title: 'Reconcile' },
    { title: 'Verify' },
  ],
}

const SUMMARY = {
  type: 'object',
  additionalProperties: false,
  required: ['territory', 'path', 'capability_count', 'mechanism_count', 'notes'],
  properties: {
    territory: { type: 'string' },
    path: { type: 'string' },
    capability_count: { type: 'integer' },
    mechanism_count: { type: 'integer' },
    notes: { type: 'string' },
  },
}

const { territories, scratch, schemaText, rules } = args

// Repo roots a territory can point at. Most territories live in ziggy_pc; one
// (mobile-native) lives entirely in the sibling ziggy_mobile checkout. Agents
// must resolve every file path against the correct root, not assume ziggy_pc.
const ROOT_PATHS = {
  ziggy_pc: '/Users/YouvalPolacsek/ziggy_pc',
  ziggy_mobile: '/Users/YouvalPolacsek/ziggy_mobile',
}

const RULES = `
HARD RULES — violating any of these invalidates your output:
- NEVER read or reference anything under .claude/worktrees/ — those are stale duplicate trees.
- Do NOT modify any file outside your assigned output path.
- Do NOT SSH anywhere, call the relay, or run scripts/fleet-health.py. Static reading only.
- status_evidence MUST cite a concrete file path, flag name, or commit SHA. A claim with no
  citation is a failure. If you cannot prove it, use status "orphaned" and say why.
- When you return the summary object, set "path" to the exact file you just wrote (the
  code.json / history.json / reconciled.json / verified.json path given to you above).
- ${rules}

RECORD SCHEMAS (emit exactly these shapes):
${schemaText}
`

// Builds the "which repo am I actually looking at" preamble for a territory.
// Every territory object carries a roots array naming its repo root(s); for
// every territory except mobile-native that's ["ziggy_pc"], but mobile-native
// is ["ziggy_mobile"] and its files live under a completely different checkout.
function rootNote(t) {
  const roots = t.roots && t.roots.length ? t.roots : ['ziggy_pc']
  const lines = roots.map((r) => `  - "${r}" = ${ROOT_PATHS[r] || '(unknown root — ask, do not guess)'}`)
  const primary = ROOT_PATHS[roots[0]] || roots[0]
  return `
TERRITORY ROOT(S):
${lines.join('\n')}
Every file path listed below is relative to ${primary}${roots.length > 1 ? ' (or the other root listed above, per file)' : ''}.
Set your working directory there before reading files or running git/grep — do NOT assume
/Users/YouvalPolacsek/ziggy_pc if this territory's root is different.`
}

// The universal "live-prod" rule (backend/server.py reachability + presence in the newest
// release-* tag) does not exist for mobile-native — that repo has neither a backend/server.py
// nor release-* tags. This carve-out is gated by t.roots the same way rootNote/testsNote are,
// so it can render in ONLY the mobile-native verifier prompt, never in the other 17 — a
// verifier wrongly reasoning "app-shell entrypoint" about a ziggy_pc capability (e.g.
// mobile-and-push, which is real ziggy_pc code) would be exactly the false live-prod this
// verify stage exists to catch.
function mobileLiveProdNote(t) {
  const roots = t.roots && t.roots.length ? t.roots : ['ziggy_pc']
  if (!roots.includes('ziggy_mobile')) return ''
  return `
  (This territory has no backend/server.py and no release-* tag — the mobile-native variant of
  "live-prod" applies instead: shipped in a built app artifact reachable from the Capacitor app
  shell's own entrypoints, e.g. wired into MainActivity/AppDelegate or the JS bundle's app root,
  not merely present in the source tree. Say so explicitly in status_evidence when you apply
  this variant. This variant applies ONLY to this territory — every other territory uses the
  backend/server.py + release-* rule above, unmodified.)`
}

// Only ziggy_pc has the shared tests/ directory (150 files, ~2215 tests) that
// is deliberately excluded from every territory's file list. Territories
// rooted elsewhere get a generic version of the same instruction.
function testsNote(t) {
  const roots = t.roots && t.roots.length ? t.roots : ['ziggy_pc']
  if (roots.includes('ziggy_pc')) {
    return `
Also locate covering tests for each capability. ziggy_pc/tests/ (150 test files, ~2215 tests
total) is deliberately excluded from your files list above, so it will not show up by browsing
— search it directly, by capability/feature keyword, function name, or route path (grep test
names and docstrings). Record what you find in each capability's "tests" field as repo-relative
paths, ideally down to the test function, e.g. "tests/test_anomaly_engine.py::TestAnom01". Leave
"tests" empty for a capability you genuinely found no coverage for — do not guess or pad it.`
  }
  return `
Also locate covering tests for each capability. Search for a tests/ directory under your
territory root (if one exists), AND search /Users/YouvalPolacsek/ziggy_pc/tests/ (150 test
files, ~2215 tests total) — capabilities in this territory can plausibly be covered from the
main ziggy_pc repo (e.g. a native plugin or OTA behaviour exercised by a ziggy_pc integration
test) even though the territory's own root has no such tree. Record matches in the "tests"
field as paths relative to whichever root they live under, prefixed so it's unambiguous, e.g.
"ziggy_pc/tests/test_mobile_push.py::test_x". Leave "tests" empty rather than guessing.`
}

const names = Object.keys(territories)

const results = await pipeline(
  names,

  // Stage 1: both angles, blind to each other.
  (name) => {
    const t = territories[name]
    const files = t.files.slice(0, 400).join('\n')
    const communities = t.communities.slice(0, 40).join(', ')
    return parallel([
      () => agent(
        `You are mapping the "${name}" territory of the Ziggy smart-home codebase, CODE-FIRST.
Territory: ${t.description}
${rootNote(t)}

Read the code. Your job is to name every CAPABILITY (something a person gets) and every
MECHANISM (a reusable building block) visible in these files.

Files in your territory:
${files}

Matching graphify community wiki pages live in graphify-out/wiki/ (under the ziggy_pc root) —
these are named:
${communities}
They are symbol-level, so use them for orientation and for their "Relationships" sections,
not for product meaning. You may also run: graphify explain "<node>" and graphify path "<a>" "<b>".

A capability is what a user or operator GETS. A mechanism is what capabilities are BUILT FROM.
Apply the stopping rule: only record a mechanism if you believe 2+ capabilities use it, or it
owns its own store/engine (set domain_concept true in that case).
${testsNote(t)}

Set "angle" to "code" on every record. Set "territory" to "${name}".

Write your output as JSON to ${scratch}/catalog-raw/${name}.code.json with shape
{"capabilities": [...], "mechanisms": [...]}. Create the directory if needed.
Then return the summary object.
${RULES}`,
        { label: `code:${name}`, phase: 'Extract', schema: SUMMARY }
      ),
      () => agent(
        `You are mapping the "${name}" territory of the Ziggy smart-home codebase, HISTORY-FIRST.
Territory: ${t.description}
${rootNote(t)}

Do NOT start from the code. Start from the record of what was built:
- git log for these paths (run it with your working directory at the root above). Useful:
  git log --oneline --no-merges -- <path> ...
  Ziggy's commit messages are unusually narrative and often name the feature and the bug.
- docs/ (under the ziggy_pc root) — runbooks, audits, handoffs, design specs relevant to
  this territory.
- /Users/YouvalPolacsek/.claude/projects/-Users-YouvalPolacsek-ziggy-pc/memory/*.md —
  92 memory files, many of which are feature journals with status notes.
- frontend/src/lib/i18n/en.js (under the ziggy_pc root) — the user-facing vocabulary;
  strings name features that the code does not.

Your unique value is finding capabilities that the code alone will NOT show: things built
then unwired, things shipped then superseded, things whose only trace is a commit and a
memory note. Record those with status "abandoned" or "orphaned" and say what happened.

Paths in scope:
${files}

Set "angle" to "history" on every record. Set "territory" to "${name}".

Write JSON to ${scratch}/catalog-raw/${name}.history.json with shape
{"capabilities": [...], "mechanisms": [...]}. Then return the summary object.
${RULES}`,
        { label: `history:${name}`, phase: 'Extract', schema: SUMMARY }
      ),
    ])
  },

  // Stage 2: reconcile the two angles.
  (pair, name) => agent(
    `Reconcile the two independent extractions of the "${name}" territory of Ziggy.

Read both:
- ${scratch}/catalog-raw/${name}.code.json    (what the code shows)
- ${scratch}/catalog-raw/${name}.history.json (what the record shows)

Produce ONE merged set. Rules:
- Same capability found by both angles: merge into one record, union the lists (including
  "tests"), keep the better pitch and what_it_does.
- In code but NOT in history: keep it, and set "disagreement" to "undocumented — no commit
  or doc names this".
- In history but NOT in code: keep it, set status to "abandoned" or "orphaned" as the
  evidence supports, and set "disagreement" to "in history only — <what happened>".
- Deduplicate mechanisms by meaning, not just by id. Two names for one thing become one.
- Re-apply the stopping rule after merging.

Set "angle" to "reconciled" on every record. Set "territory" to "${name}".

Write JSON to ${scratch}/catalog-raw/${name}.reconciled.json and return the summary.
${RULES}`,
    { label: `reconcile:${name}`, phase: 'Reconcile', schema: SUMMARY }
  ),

  // Stage 3: prove every status claim. Independent of the reconciler.
  (rec, name) => {
    const t = territories[name]
    return agent(
      `You are an independent verifier for the "${name}" territory of Ziggy. You did not write
these records and you should not trust them.
${rootNote(t)}

Read ${scratch}/catalog-raw/${name}.reconciled.json.

For EVERY capability, prove or correct its "status" by reading the actual wiring:
- "live-prod" requires a call path reachable from backend/server.py (its startup hook) or
  from a services/ziggy_scheduler.py tick, AND presence in the newest release-* tag.
  Check with: git tag --list 'release-*' --sort=-creatordate | head -1
${mobileLiveProdNote(t)}
- CRITICAL: core/ziggy_main.py is NOT the production entrypoint. The container runs
  uvicorn backend.server:app. Anything started ONLY in ziggy_main.py is "orphaned",
  no matter how complete it looks. Four features were already found dead this exact way.
  tests/test_prod_entrypoint_starts_services.py encodes this rule.
- "flagged" means wired but gated behind a config/settings.yaml feature flag that is off
  by default. Name the flag in status_evidence.
- "canary-only" means on main but not in the newest release-* tag.
- "orphaned" means no caller reachable from a prod entrypoint.
- "abandoned" means gone from the tree.
- If a capability's "tests" field names a test, treat an existing, currently-passing test for
  that exact path as SUPPORTING evidence for a "live-prod" claim — cite it in status_evidence
  alongside the entrypoint/tag proof. Run it if you can do so quickly and statically
  (e.g. pytest <path> -q); if you don't run it, do not claim it passes. A passing test is
  supporting evidence only — it never substitutes for the entrypoint-reachability and
  release-tag checks above. A test importing dead code still passes; that is not liveness.

Rewrite status and status_evidence wherever the claim does not hold. Every status_evidence
MUST cite a file path, a flag name, or a commit SHA. Do not soften a demotion — a feature
wrongly listed as live is the single worst failure this catalog can have.

Leave capabilities and mechanisms otherwise unchanged.

Write the corrected JSON to ${scratch}/catalog-raw/${name}.verified.json and return the
summary, using "notes" to say how many statuses you changed and which.
${RULES}`,
      { label: `verify:${name}`, phase: 'Verify', schema: SUMMARY }
    )
  }
)

const ok = results.filter(Boolean)
log(`verified ${ok.length}/${names.length} territories`)

return {
  territories: ok,
  total_capabilities: ok.reduce((n, r) => n + r.capability_count, 0),
  total_mechanisms: ok.reduce((n, r) => n + r.mechanism_count, 0),
  failed: names.filter((n) => !ok.some((r) => r.territory === n)),
}
