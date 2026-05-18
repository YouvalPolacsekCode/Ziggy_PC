# Ziggy – Claude Operating Context

## What Ziggy Is

Ziggy is a local AI-powered smart home assistant and automation platform.

It runs on a **mini PC or Mac** and acts as the intelligence layer on top of systems like Home Assistant and other integrations.

Ziggy provides:

- natural language control
- smart home orchestration
- automation execution
- task and reminder management
- file and note management
- system utilities
- conversational AI interaction
- remote control via Telegram

The system is designed to eventually evolve into a **commercial smart home platform**.

Claude should treat the codebase as a **serious long-term software system**, not a prototype.

---

# Core Design Philosophy

Ziggy should be:

- modular
- robust
- extensible
- maintainable
- understandable

Avoid:

- monolithic code
- tight coupling
- fragile logic
- hidden side effects

Prefer:

- clear module boundaries
- explicit interfaces
- readable code
- predictable execution flows

---

# High Level Architecture

The system conceptually follows this pipeline:

User Input  
→ Intent Detection  
→ Parameter Extraction  
→ Action Routing  
→ Execution  
→ Response

Input sources may include:

- voice
- Telegram
- CLI
- API
- future UI

Actions may include:

- smart home control
- task operations
- file operations
- system utilities
- conversational AI responses

---

# Major Capability Areas

## Conversational AI

Ziggy supports natural language interaction.

This includes:

- question answering
- general conversation
- thought partner mode
- fallback responses when no structured command exists

Conversation should not interfere with structured command execution.

---

## Smart Home Control

Ziggy acts as the AI layer above Home Assistant.

Responsibilities include:

- device control
- device state queries
- automation triggering
- room summaries

Supported domains may include:

- lights
- switches
- climate
- sensors
- binary sensors
- media players

Design integrations so they are easily replaceable.

---

## Task Management

Ziggy includes a full task system.

Tasks support:

- creation
- updates
- deletion
- listing

Task attributes may include:

- due date
- reminder time
- priority
- repeat frequency
- completion state

Natural language input should be converted into structured task data.

---

## File and Note Management

Ziggy can create and manage local files.

Supported formats may include:

- TXT
- Markdown
- JSON
- YAML
- CSV
- XLSX
- DOCX
- PPTX
- PDF

Files are stored locally.

---

## System Tools

Ziggy includes system diagnostics and utilities.

Examples:

- system status
- disk usage
- IP address
- network adapters
- ping tests
- restarting Ziggy

System commands must be safe and controlled.

---

## Telegram Interface

Telegram is a major control interface.

Features include:

- sending commands
- receiving responses
- task management
- smart home control
- button-based flows

The Telegram layer must be resilient and stable.

---

# Engineering Principles

## Modularity

The project should be divided into modules such as:

- intent parsing
- action handling
- integrations
- utilities
- memory
- interfaces

Each module should have a clear responsibility.

---

## Separation of Concerns

Intent detection should not contain execution logic.

Execution modules should not perform intent detection.

Parsing, routing, and execution must be separated.

---

## Error Handling

The system must never crash from missing hardware or integrations.

Instead it should:

- log the error
- return an informative response
- continue operating

---

## Logging

All major flows should produce logs.

Logs should help debug:

- intent detection
- parameter extraction
- integration failures
- automation execution

---

# How Claude Should Work On This Project

Claude should behave like a **senior software architect reviewing and improving a production system**.

When analyzing code Claude should:

1. Understand the architecture
2. Identify structural issues
3. Suggest improvements
4. Detect bugs
5. Propose cleaner module boundaries
6. Simplify complex logic
7. Improve reliability

Claude **is allowed to refactor code aggressively** if it improves architecture or stability.

However, changes should remain understandable and maintainable.

---

# Important Rule

Claude must **never assume missing functionality exists**.

If something is unclear or missing from the codebase, Claude must explicitly state that instead of inventing behavior.

---

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Ziggy_PC** (7825 symbols, 15193 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Ziggy_PC/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Ziggy_PC/clusters` | All functional areas |
| `gitnexus://repo/Ziggy_PC/processes` | All execution flows |
| `gitnexus://repo/Ziggy_PC/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
