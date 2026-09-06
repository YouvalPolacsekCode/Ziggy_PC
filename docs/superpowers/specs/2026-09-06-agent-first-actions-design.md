# Agent-first Ziggy — Actions, Sync, Cards, MCP

**Date:** 2026-09-06 · **Status:** approved in session ("implement this into ziggy live for everyone") · builds on the v3 brain spec of the same day.

## Thesis

Anything the app can do, the agent can do, and vice versa — from ONE definition.
Ziggy already had the agent side (core/agent/tools.py) and the app side
(routers) as two separate worlds. This makes the tool registry the ground
truth and hangs the app, the chat cards and external agents off it.

## 1. Actions registry — `core/actions/`

- `Action(name, description, params, run, kind, risk)`; `registry.list()`,
  `registry.get(name)`, `registry.run(name, args, *, actor, source, lang)`.
- Built from `core/agent/tools.py::TOOL_SCHEMAS` + `execute_tool` at import
  (adapter). A tool IS an action. No second definition anywhere.
- `run()` executes with the caller's actor (permission ladder, rehearsal
  contextvar already in force), journals the call (§2), broadcasts
  `ziggy_action` (§2), returns the tool envelope `{ok, message, data}`.
- `GET /api/actions` → `[{name, description, params, kind, risk}]`
  `POST /api/actions/{name}` `{args}` → envelope. Both authenticated.

## 2. Bidirectional sync

- **Agent → app:** after every tool execution (chat, voice, MCP, app) the hub
  broadcasts `{"type":"ziggy_action","name","args","ok","kind","actor","source"}`.
  The app's action hook refreshes the automations list on automation actions;
  device state already flows from HA over the existing `device_state_updated`.
- **App → agent:** `services/ui_journal.py` ring buffer (last 30, 24 h) of
  actions taken in the app: `/api/actions/*`, the `/api/ha/control` tile
  toggle, quick-asks. `core/agent/context.py` adds a section
  "WHAT PEOPLE DID IN THE APP RECENTLY" so "why is the kitchen light on?" can
  be answered with "you turned it on from the app at 21:04".

## 3. Embedded UI in chat

- Tool results carry `data.kind` and enough structure to render:
  `device_list` (entity ids + names + on), `automations`, `capabilities`,
  `why_not`, `home_health`, `down_devices`, `repair_history`,
  `recent_activity`, `camera_look`, `needs_approval`.
- The runner sets `data.card` to the last renderable tool result of the turn
  (bundle preview keeps its own path). Threads persist `data`, so cards
  survive reload.
- `frontend/src/components/chat/ChatCards.jsx`: one component per kind;
  interactive controls call `/api/actions/*` (device toggles, automation
  switches, "fix it" on a why-not card). Rendered above the text bubble.

## 4. External agents — `/mcp`

- `backend/routers/mcp_router.py`: MCP Streamable HTTP, JSON responses
  (no SSE), JSON-RPC 2.0: `initialize`, `notifications/initialized`, `ping`,
  `tools/list`, `tools/call`. Tools = the registry, names and schemas verbatim,
  descriptions in English. `tools/call` → `content:[{type:"text"}]` +
  `structuredContent` = envelope. Errors as JSON-RPC errors.
- Auth: `Authorization: Bearer <token>`; tokens minted per user in Settings →
  External assistants (`services/external_tokens.py`, hashed at rest in
  auth.db, named, revocable, last-used stamp). The call runs as
  `person:<username>`: permission ladder, rehearsal, entitlements all apply.
  No wall-tablet context. Rate limit 60/min per token.
- URL shown in Settings: `<tunnel_url>/mcp`. Works with Claude Code
  (`claude mcp add --transport http … --header`), Cursor, mcp-remote.
  OAuth for claude.ai/ChatGPT web connectors is a follow-up (flagged).

## 5. Shipping the catalog

`docs/` is excluded from the hub image. `services/data/capability-catalog.json`
is the shipped copy; `capability_lookup` reads it first. A test asserts the
shipped copy loads and matches the docs copy's counts.

## 6. Out of scope (stated)

Realtime speech-to-speech (needs a relay WebSocket proxy + app audio pipeline).
Sidebar/full-screen layouts (chat already has a page and a thread drawer).
OAuth for web connectors.

## 7. Tests

Registry builds from schemas; run() journals + broadcasts; actions router
list/run/auth; ui_journal window; context section; MCP initialize/list/call/
auth/rate-limit; external tokens mint/verify/revoke; runner card selection;
catalog shipped copy. Frontend: ChatCards render per kind; vitest + build.
