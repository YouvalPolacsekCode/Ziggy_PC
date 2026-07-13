# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Ziggy** is a locally-hosted AI smart home platform combining natural language control, Home Assistant integration, and a full-stack React web interface. The architecture is:

```
User Input (Web / Voice / Telegram)
    ↓
Intent Parser → Action Router → Domain Handlers
    ↓
FastAPI Backend (8001) ← → React Frontend (3000)
    ↓
Home Assistant + MQTT + Telegram Bot + LLM + IR Blasters
```

Core stack: **Python 3.11+ backend** (FastAPI, async), **React 18 + Vite + Tailwind** frontend, **Home Assistant WebSocket integration**, **offline LLM support** (Ollama).

## Quick Start Commands

### Local Development Setup

```bash
# Python backend
python3 -m venv .venv
source .venv/bin/activate          # macOS/Linux
# OR .\.venv\Scripts\Activate.ps1  # Windows
pip install -r requirements.txt

# Frontend
cd frontend && npm install && cd ..
```

### Running Ziggy

**Full stack (recommended):**
```bash
# Terminal 1: Backend (runs on port 8001)
python core/ziggy_main.py

# Terminal 2: Frontend dev server (runs on port 3000)
cd frontend && npm run dev
```

**Frontend only (against running backend):**
```bash
cd frontend && npm run dev
```

**Voice interface (standalone):**
```bash
python interfaces/voice_interface.py
```

**Telegram bot interface:**
```bash
python interfaces/telegram_interface.py
```

### Testing

```bash
# Run all tests
pytest

# Run a single test file
pytest tests/test_anomaly_engine.py

# Run specific test class
pytest tests/test_anomaly_engine.py::TestAnom01

# Run with verbose output
pytest -v

# Run async tests (test_anomaly_engine.py uses pytest-asyncio)
pytest tests/test_anomaly_engine.py -v
```

### Linting & Code Quality

Ziggy uses standard Python patterns (no formal linter configured). For cleanliness:
- Follow PEP 8 conventions
- Use type hints (the codebase uses them throughout)
- Async functions in services; sync in handlers where HA sync calls are needed
- Document intent classifiers and handler logic inline

## Architecture & Design Patterns

### Data Flow: Intent → Handler → Result

1. **User input** → FastAPI `/api/intent` or `/api/chat` endpoint
2. **Intent parsing** (`core/intent_parser.py`): NLU classifies text into `{intent, params}`
3. **Action routing** (`core/action_parser.py`): Routes intent to the appropriate handler
4. **Domain handler** (`core/handlers/{light,climate,task,etc.}.py`): Executes the action
5. **Result rendering** (`core/result_utils.py`): Formats response for the user

**Key insight:** Handlers return `{"status", "message", "data"}`. The result is broadcast to all connected WebSocket clients via `backend.ws_manager.manager.broadcast()`.

### Multi-Threaded Architecture

`core/ziggy_main.py` spawns daemon threads for:
- **API** (FastAPI server on 8001)
- **Vite** (frontend dev server on 3000, auto-stop on shutdown)
- **Voice** (wake-word detection + STT/TTS pipeline)
- **PatternEngine** (learns usage patterns, emits suggestions)
- **SensorAlerts** (monitors doors/motion, pushes notifications)
- **Reminder** (task due dates, calendar notifications)
- **Ollama** (local LLM server for pattern synthesis)

All threads are **daemon=True**. Graceful shutdown via `core.shared_flags.shutdown_event` (SIGTERM handler sets it).

### Configuration

**File:** `config/settings.yaml` (loaded by `core/settings_loader.py`)

Key sections:
- `home_assistant`: HA URL + long-lived token
- `openai`: API key for LLM fallback (Ollama preferred for Hebrew)
- `telegram`: Bot token + allowed user IDs
- `device_map`: Room-to-entity mapping (maps room names to HA entity_ids)
- `features`: Toggle voice, pattern learning, sensor alerts, etc.
- `debug`: Enable dashboard, log levels

**Room-to-Entity Mapping Example:**
```yaml
device_map:
  living_room:
    light: light.living_room
    temperature: climate.ac_living_room
    motion: binary_sensor.motion_living_room
```

### Handler Structure

Each domain handler lives in `core/handlers/{domain}.py` and exports an async function `handle_{domain}(intent_data, context)` that:
1. Validates params
2. Calls the appropriate service (e.g., `home_automation.py` for HA calls)
3. Returns `{"status": "ok|error", "message": "...", "data": {...}}`

**Example: Light handler**
```python
async def handle_light(intent_data, context):
    action = intent_data.get("action")  # "on", "off", "dim"
    room = intent_data.get("room")
    if action == "on":
        result = await home_automation.turn_on_light(room)
    return {"status": "ok" if result else "error", "message": "..."}
```

Handlers can emit structured events via `core.debug_bus.bus.emit()` for dashboard telemetry.

### Home Assistant Integration

- **REST calls**: `services/home_automation.py` wraps the HA REST API
- **Real-time sync**: `services/ha_subscriber.py` maintains a WebSocket subscription to HA state changes
- **Device registry**: `services/device_registry.py` caches a canonical in-memory device model (synced from HA on startup + periodic reconciliation)
- **Entity filtering**: `services/entity_filter.py` hides system entities from the UI (sensor.foo_debug, etc.)
- **Capability detection**: `services/capability_catalog.py` infers dimmability, color support, etc. per entity

### Pattern Learning & Suggestions

- **Pattern detector** (`services/pattern_detector.py`): Scans event history for recurring usage (e.g., "lights on every weekday at 7am")
- **Suggestion engine** (`services/suggestion_engine.py`): Converts patterns into actionable routines
- **Local LLM synthesis** (Ollama): Uses local model to generate natural-language routine descriptions instead of hardcoded templates
- **Async background task**: Runs on configurable schedule (default 10 min) without blocking FastAPI

### Anomaly Detection

`services/anomaly_engine.py` flags unusual states:
- **ANOM-01:** All away + lights on
- **ANOM-02:** Open door + AC running
- **ANOM-03:** Motion in empty room at night
- **ANOM-04:** Motion detected during quiet hours
- (More rules can be added)

Anomalies can be snoozed per-room. Snooze state is currently in-memory (TODO: persist to SQLite across restarts).

### FastAPI Routers

All routers are registered in `backend/server.py` and follow a consistent pattern:

```python
from fastapi import APIRouter, Depends
from backend.routers.auth_deps import get_current_user

router = APIRouter()

@router.post("/api/endpoint")
async def handler(req: Request, user = Depends(get_current_user)):
    # Implementation
    return {"status": "ok", ...}
```

**Key routers:**
- `intent_router`: `/api/intent`, `/api/chat`, `/api/voice` (30/min rate limit)
- `device_router`: `/api/devices`, `/api/device/{id}/capability`
- `automation_router`: CRUD for automations
- `routine_router`: CRUD for routines (time-based triggers)
- `task_router`: Task list management
- `suggestion_router`: Pattern-learned suggestions
- `map_router`: Home floor plan rendering
- `admin_router`: System settings

### WebSocket Broadcasting

All real-time updates flow through `backend.ws_manager.manager`:

```python
# In any service/handler
await manager.broadcast({
    "type": "device_state_updated",
    "entity_id": "light.living_room",
    "state": "on",
})
```

Frontend subscribes to `ws://localhost:8001/ws` and updates state in Zustand stores.

## Frontend Architecture

**Tech Stack:** React 18 + Vite + Zustand (state) + Tailwind CSS + Framer Motion + Radix UI

**Key directories:**
- `frontend/src/pages/`: Page components (Dashboard, Rooms, Devices, etc.)
- `frontend/src/components/`: Reusable UI components
- `frontend/src/stores/`: Zustand state (authStore, cameraStore, quickAskStore, etc.)
- `frontend/src/lib/`: Utilities (API calls, intent schemas, quick-asks definitions)

**State Management:** Zustand stores handle auth, device state, UI prefs. Component-level state for forms/temporary UI state.

**API Communication:**
- `fetch()` for HTTP (REST)
- `WebSocket` for real-time updates
- All endpoints at `http://localhost:8001/api/...`

**Styling:** Tailwind + PostCSS. Framer Motion for animations. Custom Badge component in `frontend/src/components/ui/Badge.jsx`.

## Extension Points

### Adding a New Intent

1. **Classify the intent:** Add a case in `core/intent_parser.py` that recognizes the user's language pattern
   ```python
   def quick_parse(text):
       if "turn on" in text.lower():
           return {"intent": "light_on", "params": extract_room_from_text(text)}
   ```
2. **Route to handler:** In `core/action_parser.py`, map intent to handler
   ```python
   def handle_intent(intent_data):
       if intent_data["intent"] == "light_on":
           return await handle_light(intent_data, context)
   ```
3. **Implement handler:** Create or extend handler in `core/handlers/light_handler.py`

### Adding a New Service

1. Create `services/my_service.py`
2. Export an async function `async def my_service_function(...)`
3. Import and call from handlers or routers
4. If background task: spawn thread in `core/ziggy_main.py` with `thread_wrapper("MyService", ...)`

### Adding a Frontend Page

1. Create React component in `frontend/src/pages/MyPage.jsx`
2. Add route in `frontend/src/App.jsx`
3. Wire API calls via `frontend/src/lib/api.js`
4. Use Zustand stores for shared state

### Adding a Home Assistant Entity

1. Update `config/settings.yaml` to map the entity to a room
   ```yaml
   device_map:
     living_room:
       motion: binary_sensor.motion_living_room  # Add this
   ```
2. Handler code automatically reads from device registry on startup

### Adding a New Router

1. Create `backend/routers/my_router.py` with `router = APIRouter()`
2. Add endpoints with `@router.get()`, `@router.post()`, etc.
3. Import and register in `backend/server.py`: `from backend.routers.my_router import router as my_router`
4. Then in the app setup: `app.include_router(my_router)` (find the existing include_router calls)

## Important Files Reference

| File | Purpose |
|------|---------|
| `core/ziggy_main.py` | Main entry point; spawns all threads |
| `core/intent_parser.py` | NLU classifier |
| `core/action_parser.py` | Routes intents to handlers |
| `core/handlers/*.py` | Domain-specific action logic |
| `core/settings_loader.py` | Config file loading + validation |
| `core/result_utils.py` | Response formatting |
| `services/home_automation.py` | HA REST API wrapper |
| `services/ha_subscriber.py` | HA WebSocket state sync |
| `services/device_registry.py` | Canonical device model |
| `services/task_manager.py` | Task CRUD + reminders |
| `services/pattern_detector.py` | Usage pattern detection |
| `services/suggestion_engine.py` | Pattern → routine conversion |
| `services/anomaly_engine.py` | Anomaly detection rules |
| `backend/server.py` | FastAPI app wiring |
| `backend/routers/intent_router.py` | Intent processing endpoints |
| `backend/ws_manager.py` | WebSocket broadcast hub |
| `backend/middleware/error_handler.py` | Unified error responses |
| `frontend/package.json` | Frontend deps (React, Vite, Tailwind) |
| `frontend/vite.config.js` | Vite build config |
| `config/settings.yaml` | User configuration |

## Known TODOs & Technical Debt

See `TODOS.md` for full list. Key items:

1. **Hebrew voice pipeline:** Handlers should generate Hebrew responses natively instead of translating English responses (saves 600ms latency)
2. **Anomaly snooze persistence:** Currently in-memory; should persist to SQLite across server restarts
3. **AI-generated home map visual:** Infrastructure built but GPT-4o struggles to enrich isometric SVG. Consider top-down projection or two-pass approach.

## Debugging Tips

### Check Backend Logs

```bash
# Tail output from running backend
tail -f logs/*.log

# Or stream stdout directly
python core/ziggy_main.py 2>&1 | grep -i error
```

### Check Frontend Dev Server

```bash
cd frontend && npm run dev
# Logs appear in the same terminal; check browser console (F12) for React errors
```

### Test HA Connection

```bash
# In Python shell
from services.home_automation import get_state
state = get_state("light.living_room")
print(state)
```

### Test Voice Pipeline

```bash
python interfaces/voice_interface.py
# Speaks "Hello" + waits for voice input
# Type in console or speak after wake word "Hey Ziggy"
```

### View Device Registry

```bash
from services.device_registry import get_device_model
model = get_device_model()
print(model)  # Shows all entities synced from HA
```

### Check WebSocket Events

In browser console (F12):
```javascript
// Assuming ws is the WebSocket connection
ws.onmessage = (e) => console.log(JSON.parse(e.data))
```

## Performance Considerations

- **HA WebSocket sync:** Runs continuously. Updates device registry in ~100ms per event.
- **Intent parsing:** Can call OpenAI (500ms) or use local model (50-200ms). Optimize with quick_parse fallback.
- **Pattern learning:** Async background task (10 min default). Doesn't block FastAPI.
- **Voice STT:** Whisper API (~3s for 30s audio). Local faster-whisper (~1-2s).
- **Frontend:** Vite HMR enabled. Zustand stores are subscription-based (efficient re-renders).

## Deployment Notes

- Set `web_interface.frontend_dev: false` in `settings.yaml` to skip Vite spawning (use production build instead)
- Frontend production build: `cd frontend && npm run build` → outputs to `frontend/dist/`
- Serve frontend dist via `backend` (FastAPI can serve static files)
- For cloud/headless: `_has_audio_input_device()` check skips Voice thread gracefully
- Use `.env` file (or `config/settings.yaml`) for secrets (HA token, OpenAI key, etc.)

---

**Last updated:** 2026-07-06 | Ziggy v1.0
