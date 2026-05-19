# Instructions for Claude Code

You have been handed a design redesign package for the **Ziggy** smart-home + family-assistant app. Your job is to implement this redesign in the existing codebase **without losing any functionality**.

## Read these in order

1. **`Handover Kit.html`** — open in a browser. This is the brief. Read §01 (pruning contract) and §02 (coverage matrix) before doing anything else.
2. **`README.md`** — the technical handoff. Has codebase pointers, tokens, per-screen specs, build order.
3. **`design/Ziggy redesign.html`** — open in a browser. Live mocks of every drawn surface.
4. **`design/ziggy-tokens.css`** — the design tokens. Source of truth for colors / type / surfaces.

## The single most important rule

> **Every feature in the current app must survive the redesign — except for the 13 explicitly listed in the pruning contract (§3 of README, §01 of Handover Kit).**

If you find yourself deleting a page, modal, wizard, settings section, device controller, or behavior that is NOT on the pruning list — **stop**. Either it stays, or you need to escalate to the user for an explicit decision.

## Start here

1. Read the two HTML files in a browser. Get the vocabulary into your head.
2. Skim `frontend/src/App.jsx` to confirm the current route list matches what the README documents.
3. Run `frontend/` to see the current app live (`npm run dev` in `frontend/`).
4. Open `frontend/src/pages/` and `frontend/src/components/` to see what you're working with.
5. Phase your work per README §12. Tokens + base components first. Don't try to ship a single PR with everything.

## What to ask before building

The README §14 lists 6 open questions. Ask the user to resolve them before you start drawing wizards or admin surfaces. Specifically:
- Is `/ops` (admin console) in scope?
- HomeMap feature flag — hide or leave toggleable?
- Virtual Devices — admin-only or power-user surfaced?
- Wizard pattern — modal-over-page, full-screen, or inline?
- Voice orb — killed or kept alongside Ask tab?
- Alerts in bottom nav or secondary?

## When you have questions during build

Match the drawn screens' vocabulary rather than inventing. If a surface isn't drawn (e.g. Cover controller, Vacuum controller, Add Memory modal), follow the patterns in adjacent drawn surfaces (Light controller, Climate controller, Add Task modal) — same tokens, same component primitives, same density.

## Verification before any PR

Compare against the README §15 Definition of Done. Don't ship a screen that's missing its empty state, error state, RTL variant, or dark-mode variant. The whole point of this redesign is parity-or-better — not "looks good in light mode on a desktop browser".

Good luck. The design is opinionated; preserve that.
