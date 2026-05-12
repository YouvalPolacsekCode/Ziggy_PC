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

---

### TODO: Persist anomaly snooze state across server restarts
**What:** Persist ANOM-04 (and other rule) snooze-until timestamps to SQLite (`user_files/home_map.db`) so a server restart doesn't immediately re-alert on snoozed rooms.

**Why:** Currently the anomaly engine holds snooze state in-memory. A restart at midnight clears all snooze entries — ANOM-04 (motion in quiet hours) will fire immediately on the next motion event after restart, waking the user if they were snoozed.

**How to implement:** Add a `anomaly_snooze(room_id TEXT, rule_id TEXT, snooze_until TEXT)` table to `home_map.db`. Load it on startup, write on snooze, clear on expiry.

**Depends on:** home_map.db SQLite implementation must ship first (Layer 1 canvas work).

**Context:** Low-priority for V1 since server restarts during sleep are rare, but the failure is user-facing and annoying.

---

## AI-Generated Home Map Visual (on hold)

### Status: infrastructure built, UI hidden, not yet working end-to-end

**What:** Replace the Konva isometric polygon rendering in the Map view with an AI-enhanced SVG background, while keeping device pin icons as a live Konva overlay on top. The user builds their floor plan once in the 2D editor; the system generates a polished visual from it automatically.

**Why:** The current isometric Konva renderer (coloured polygon boxes) is technically correct but visually limited. SmartThings-level quality requires furniture, gradients, and architectural details that can't be hand-coded. An AI step can enrich the geometry we already compute into something that looks premium.

**Core architecture (already implemented):**

The key insight is that the AI must enrich geometry we provide — not generate geometry itself. This preserves coordinate alignment between the background image and the live device overlays.

```
canvas_rooms DB  →  layout_hash (SHA-256 of sorted positions)
                →  generate_base_svg() — Python runs same w2s() math as frontend
                →  GPT-4o prompt: "enrich this SVG, do not move polygon points"
                →  enhanced SVG stored in map_render table (home_map.db)

Frontend view mode:
  GET /api/map/render  →  status: ready | not_generated | generating
  If ready:  KonvaImage (SVG) as base layer + device pins Konva layer on top
  If not:    isometric Konva fallback (current view) + "Generate" button
```

**Files already built:**
- `services/map_renderer.py` — layout hash, base SVG generator, GPT-4o async call, SQLite cache
- `backend/routers/map_router.py` — `GET /api/map/render` + `POST /api/map/render/generate`
- `frontend/src/lib/api.js` — `getMapRender()`, `triggerMapRender()`
- `frontend/src/pages/HomeMapCanvas.jsx` — SVG base layer + device pin layer split (code present, button hidden)
- `home_map.db` schema — `map_render(layout_hash, svg, viewbox_x/y/w/h, generated_at, model)`

**Why it's on hold:**
The GPT-4o call completes but the returned SVG is either invalid, empty, or not meaningfully better than the base. The prompt needs tuning — GPT struggles to add furniture shapes inside parallelogram (isometric) polygons without corrupting the existing polygon points. Possible fixes:
1. Switch from isometric to top-down (orthographic) projection for the base SVG — rectangles are far easier for GPT to add furniture inside than parallelograms
2. Use a structured intermediate format (room list + sizes) and let GPT generate the entire SVG from scratch with strict coordinate constraints
3. Try a different model (o1, Claude) or a code-generation approach (GPT writes a Python SVG renderer)

**What works correctly today:**
- Layout hash is stable and correct
- Base SVG generation is pixel-perfect (same w2s() math as frontend)
- Async background task runs without blocking FastAPI
- SQLite caching is working
- Frontend layer split is correct — device pins will align perfectly once a valid SVG is returned
- Coordinate system is sound: SVG viewBox + KonvaImage at (viewbox.x, viewbox.y) + device pins at w2s() = perfect overlay

**To re-enable the UI button:** in `HomeMapCanvas.jsx`, replace the comment `{/* AI render button — hidden until feature is ready */}` with the four render-status buttons (idle/generating/ready/failed).

**Next steps when resuming:**
1. Try top-down projection instead of isometric for the base SVG (easier for LLM furniture placement)
2. Tune the prompt — add explicit coordinate constraints and example furniture shapes
3. Validate the returned SVG strictly before storing (check polygon point counts match input)
4. Consider a two-pass approach: GPT adds furniture in a separate layer, not modifying the base geometry at all
