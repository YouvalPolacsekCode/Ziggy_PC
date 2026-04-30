# Ziggy TODOs

## Hebrew Voice Pipeline (post-sprint-1)

### TODO: Hebrew response generation in action handlers
**What:** Update all 15+ action handlers to produce Hebrew responses when the voice
command was Hebrew, eliminating the EN→HE gpt-4o-mini translation call.

**Why:** Currently all handlers return English responses, requiring an extra API call
(+600ms latency) to translate to Hebrew. For a commercial Hebrew-first product,
handlers should generate responses in the user's language natively.

**How to apply:** Pass a `lang` parameter through `handle_intent()` → individual
handlers. Handlers can use a simple template lookup dict for common response phrases,
or call GPT with a Hebrew-response instruction.

**Depends on:** Hebrew voice pipeline (sprint 1) must ship first to validate the
overall flow before refactoring all handlers.

**Target:** Reduces Hebrew command latency from 2 API calls → 1 API call.

---

### TODO: Add python-bidi to requirements.txt
**What:** Add `python-bidi>=0.4.2` to `requirements.txt` (or `pyproject.toml` if it
exists).

**Why:** `fix_hebrew_direction()` now imports `bidi.algorithm.get_display` with an
ImportError fallback. The fallback is safe but the dependency should be explicit.

**Context:** Added in the Hebrew voice pipeline implementation (sprint 1, Step 7).
Currently the function silently degrades to a no-op if bidi is missing.
