# Ziggy Capability Catalog — Design

**Date:** 2026-08-28
**Status:** approved design, pending implementation plan
**Author:** Youval + Claude

## Problem

Thirteen months and 833 commits of Ziggy have produced more capability than
any one person can hold in their head. The cost is concrete:

1. **Recall.** When someone asks what Ziggy does, the answer is whatever comes
   to mind that day, not what was actually built.
2. **Composition.** New feature ideas get designed from scratch against
   foundations that already exist. "Can that work with this?" has no answer
   short of re-reading the code.
3. **Coupling blindness.** `precool.jsx` carries a comment explaining that
   Leave Home switched the AC off, which is why its guard reads `all_away` a
   particular way. Two capabilities shared a mechanism and nobody had the map.
   That class of bug recurs until the map exists.

A code graph already exists (`graphify-out/graph.json`: 12,732 nodes, 28,189
edges, 536 communities, 405 wiki pages) and does not solve this. Its wiki pages
are symbol-level — `_within_cooldown()`, `_ingest_position_locked()` — with
zero product meaning. The graph knows modules. The missing layer is
capabilities.

## Non-goals

- No changes to any Ziggy runtime code.
- No live fleet probe. Statuses are proven statically; the catalog does not
  claim which release tag a given customer home is running today.
- Not a replacement for graphify. The catalog sits above it and cites it.
- Not the marketing site, and not Jeff.

## Scope

**In:** `ziggy_pc` (1,253 tracked files) and `~/ziggy_mobile` (144 files) —
the product end to end. Mobile is included because mechanisms that Ziggy
capabilities depend on live only there: the native `ziggy-presence` plugin,
FCM registration, geofencing, the OTA updater. Excluding it would leave
dependency edges dangling at a plugin the catalog cannot see.

**Out:** the marketing site (`Documents/Youval Corp./ziggy/website`) and Jeff
(`Documents/Youval Corp./app`) — separate products, better served by their own
catalogs once the tooling is extracted.

**Explicitly excluded from all traversal:** `.claude/worktrees/**`. These are
stale duplicate trees. Left in, they double-count every capability and report
abandoned worktree code as shipped.

## Design

### The catalog is a file; the website is a view

The system of record is **`docs/capability-catalog.json`**, git-tracked and
regenerable, plus a generated **`docs/CAPABILITY_CATALOG.md`** that is
greppable and diffable in review. Regenerating after a month of shipping means
re-running the swarm and **diffing the JSON** — the diff is the answer to
"what did I build since last time."

### Two tiers

A single tier cannot express Ziggy. "Pre-cool on Arrival" is not a feature; it
is an assembly of presence persons, geofence zones, a native `zone_entered`
trigger, the `all_away` condition, the bundle recipe engine, the smart-AC-vs-IR
dual action path, and temperature-sensor gating — six of which are used by
other capabilities. Likewise there is no "alert feature": there are alert
*kinds* (anomaly, sensor, vision, HA-outage, health, suggestions) riding a
shared *delivery substrate* (`mobile_push` FCM, `push_actions`,
`push_preferences`, `push_stats`, Telegram, in-app WS).

**Tier 1 — Capability.** What a person gets.

| Field | Purpose |
|---|---|
| `id`, `name` | stable slug + user-facing name |
| `pitch` | one benefit line, for the Pitch lens |
| `what_it_does` | 2–4 sentences, plain language |
| `layer`, `audience` | grouping; `user-facing` / `operator` / `internal` |
| `status` | `live-prod` / `canary-only` / `flagged` / `orphaned` / `abandoned` |
| `status_evidence` | the proof — entrypoint path, flag name, release tag |
| `uses` | mechanism ids (Tier 2) |
| `composes_with` | **derived**, not asserted — see below |
| `surfaces`, `entry_points`, `tests` | files, API routes, test files |
| `first_shipped`, `commit` | provenance from git history |
| `known_gaps` | honest caveats |

**Tier 2 — Mechanism.** Reusable building blocks, each with a **`used_by`**
reverse index (the "where else is this used?" answer) and a `health` note for
known fragility (e.g. *`lan_host` is IP-pinned and drifts with DHCP*).

**Stopping rule.** Something is a mechanism only if it is **used by 2+
capabilities**, *or* it is a named domain concept with its own store/engine.
Everything else is implementation detail and stays out. This keeps Tier 2 at a
browsable size and stops it degenerating into "every function."

**Mechanism kinds** — `trigger` · `condition/guard` · `action` ·
`alert-channel` · `engine` · `store` · `bridge`. Typing them yields
cross-cutting inventories for free: every trigger an automation can use, every
way Ziggy can notify you, every guard available.

### Composition is derived, not guessed

Two capabilities `compose_with` each other **iff they share mechanisms**. This
is computed from the `uses` edges rather than reasoned about by an agent, which
makes it cheap, consistent, and defensible. "Could this new idea reuse
pre-cool?" is answered as *"both would sit on presence-zones and the bundle
engine, which already carry six other features."*

### Three lenses, one dataset

- **Pitch** — value stories, user-facing only, dead code hidden.
- **Capability** — searchable cards, filter by layer and status.
- **Engineering** — subsystems, entry points, tests, known debt.

## The swarm

Concurrency is capped at 8 on this machine (10 cores), so ~72 agents run in
roughly 9 waves. Expected wall clock 30–45 minutes across two workflows.

**Phase A — Partition.** No agents. Territories are computed deterministically
from the 405 wiki pages plus their Relationships adjacency, mapped to *product
domains* rather than directories: chat/assistant · automations & bundles ·
presence · device pairing & classification · IR/AC · climate & lighting
engines · rooms & dashboard IA · mobile & push · cloud/relay/billing · fleet &
release channel · auth/permissions/onboarding · cameras/vision/anomaly ·
backup & DR · Hebrew/RTL/i18n · platform (HA bridge, MQTT, WS) · mobile-native.

**Phase B — Dual-angle extraction (2 per territory).** Two agents per
territory, blind to each other:
- *Code-first*: wiki pages, source, routers, pages, services.
- *History-first*: the 833-commit log filtered to its paths, `docs/`, the 92
  memory files, i18n keys.

The second angle is what surfaces capabilities that exist only in history —
built, then unwired or removed.

**Phase C — Reconcile (1 per territory).** Merges the two angles and flags
disagreement: in code but not in history = undocumented; in history but not in
code = removed or dead. Disagreements are recorded, not silently resolved.

**Phase D — Verify (1 per territory).** Independent of the reconciler. Proves
every `status` claim against real entrypoints — `backend/server.py`, scheduler
ticks, feature flags, release tags. This is the pass that catches the
`ziggy_main.py` class of lie, where four features were once found dead because
they were only started in a file that never runs under uvicorn. Static only.

*(Workflow 1 ends here: B→C→D pipelined per territory, no barriers. Output
reviewed before Workflow 2.)*

**Phase E — Cross-link (barrier, 4 agents).** Genuinely needs the full set:
global dedup (the same capability surfaces in three territories), mechanism
name normalization, building the `used_by` index, and emitting the derived
`composes_with` edges.

**Phase F — Narrative (2 agents).** Groups the deduped set into value stories
and writes pitch lines.

**Phase G — Completeness critic (2 agents).** Walks every router, page, and
service and asserts each is either claimed by a capability or explicitly marked
plumbing. Output is a gap list — what the swarm missed — not a pass/fail.

## Viewer

A published Artifact: self-contained HTML with the catalog inlined, private by
default, shareable by link, redeployable to the same URL on regeneration.
Three lens tabs, search, filter by layer and status, and a **Compose mode** —
pick any two capabilities and see their shared mechanisms. Status is
colour-coded so `orphaned` and `abandoned` are unmissable.

Not a new site: the marketing site has a different job, and this needs zero
infrastructure.

## Extraction seam (future plugin)

Build for Ziggy first, extract second — the right generic abstraction only
becomes obvious after doing this once for real. The seam is designed in now at
no extra cost: everything Ziggy-specific lives in a single
**`catalog.config.json`** — territory definitions, source globs, exclusions,
the "prod entrypoint is `backend/server.py`" status rule, lens names. The
workflow script and viewer template read that config and contain zero Ziggy
knowledge.

Extraction then becomes: copy three files into a plugin repo and add a
bootstrapper that infers territories from any project's graphify communities.
That is a separate build, after this catalog has been used in anger.

## Deliverables

1. `docs/capability-catalog.json` — canonical, two tiers
2. `docs/CAPABILITY_CATALOG.md` — generated, readable, diffable
3. `catalog.config.json` — the extraction seam
4. Published Artifact — three lenses plus Compose mode
5. A drift report — orphaned and abandoned capabilities, plus the critic's gap
   list

## Risks

| Risk | Mitigation |
|---|---|
| Stale worktrees double-count | Hard exclusion of `.claude/worktrees/**` in every territory glob |
| Tier 2 degenerates into "every function" | The 2+ consumers stopping rule, enforced in the extraction schema |
| Agents assert status they did not prove | Phase D is independent of Phase C and must cite a file path |
| Duplicate capabilities across territories | Phase E dedup runs on the full set behind a barrier |
| Catalog silently misses a subsystem | Phase G critic enumerates every router/page/service |
| Cost overrun | Split into two workflows with a human checkpoint between |

## Open questions

None. All five design decisions are settled: three lenses over one dataset;
static liveness verification; two tiers with the 2+ consumers rule;
`ziggy_pc` + `ziggy_mobile`; deep swarm with dual-angle extraction.
