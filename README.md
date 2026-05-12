# Ziggy — Local AI Smart Home Platform

Ziggy is a **locally-hosted AI assistant and smart home platform** built around natural language control, Home Assistant integration, and a full-stack web interface. It runs on a mini PC or Mac and acts as the intelligence layer above your smart home — no cloud required for core operation.

---

## What Ziggy Does

- **Natural language control** — talk or type to control lights, climate, media, switches, and more
- **Full web UI** — React dashboard with room views, device controls, automations, routines, tasks, and AI chat
- **Home Assistant integration** — real-time entity sync via WebSocket subscription, room-aware device model
- **Automation pipeline** — create, update, and execute automations via chat or UI
- **Routine scheduling** — time-based and trigger-based routines with natural language setup
- **Task management** — create, track, and manage tasks with due dates, priorities, and reminders
- **Pattern learning** — detects usage patterns over time and surfaces smart suggestions
- **Anomaly detection** — flags unusual device states (empty room with devices running, doors left open, etc.)
- **State memory** — restores light/climate/fan settings after a power loss or physical switch toggle
- **Voice interface** — wake word detection, Whisper STT, Piper TTS
- **Telegram bot** — full remote control via Telegram with button-based flows
- **IR blaster control** — control non-smart devices via IR
- **Virtual devices** — define and control software-layer devices
- **Home map** — visual floor plan with live device status
- **Quick Asks** — saved one-tap shortcuts for frequent commands
- **Sensor alerts** — push notifications when doors open, motion detected, etc.

---

## Architecture

```
User Input (Web / Voice / Telegram)
        │
        ▼
  Intent Parser  →  Action Router  →  Handler (light / climate / media / task / ...)
        │
        ▼
  FastAPI Backend (port 8001)  ←→  React Frontend (port 3000)
        │
        ├── Home Assistant  (REST + WebSocket)
        ├── MQTT broker
        ├── Telegram Bot
        ├── OpenAI / Ollama (LLM)
        └── IR Blasters
```

### Backend — `backend/`

FastAPI app with 17 routers and a WebSocket hub. Starts via `core/ziggy_main.py`.

| Router | Purpose |
|--------|---------|
| `intent_router` | Receives chat messages, runs intent pipeline |
| `device_router` | Device state reads and capability queries |
| `ha_router` | Direct Home Assistant passthrough |
| `automation_router` | CRUD and execution of automations |
| `routine_router` | CRUD and execution of routines |
| `task_router` | Task management |
| `event_router` | Event log access |
| `capability_router` | Per-entity capability catalog |
| `virtual_device_router` | Virtual device management |
| `ir_router` | IR blaster commands |
| `suggestion_router` | Pattern-learned suggestions |
| `quick_ask_router` | Saved quick-ask shortcuts |
| `pairing_router` | Device pairing wizard |
| `map_router` | Home map rendering |
| `auth_router` | Session auth |
| `admin_router` | Admin settings |
| `status_router` | System health endpoint |

### Core — `core/`

| Module | Purpose |
|--------|---------|
| `intent_parser.py` | Classifies natural language into structured intents |
| `action_parser.py` | Routes intents to the correct handler |
| `handlers/` | 20+ domain handlers (light, climate, media, sensor, automation, task, …) |
| `tools_schema.py` | OpenAI function-calling tool definitions |
| `session_manager.py` | Multi-session conversation state |
| `conversation_context.py` | Short-term context within a session |
| `memory.py` | Persistent key-value memory |
| `routine_file.py` | Routine persistence |
| `automation_file.py` | Automation persistence |

### Services — `services/`

| Service | Purpose |
|---------|---------|
| `home_automation.py` | Home Assistant REST API wrapper |
| `ha_subscriber.py` | Real-time HA WebSocket event stream |
| `state_memory.py` | Records intended device state; restores after power loss |
| `device_registry.py` | Canonical in-memory device model synced with HA |
| `capability_catalog.py` | Per-entity capability detection (dimmable, color, etc.) |
| `entity_filter.py` | Hides irrelevant HA entities from Ziggy |
| `pattern_detector.py` | Finds recurring usage patterns across event history |
| `suggestion_engine.py` | Converts patterns into actionable suggestions |
| `anomaly_engine.py` | Detects abnormal device states |
| `sensor_alerts.py` | Pushes alerts on door/motion sensor triggers |
| `quick_ask_manager.py` | Saves and serves quick-ask shortcuts |
| `ziggy_scheduler.py` | Cron-style task and routine scheduler |
| `task_manager.py` | Task CRUD and reminder logic |
| `ir_manager.py` | IR blaster command dispatch |
| `virtual_devices.py` | Virtual device definitions and state |
| `media_manager.py` | Chromecast / media player control |
| `map_renderer.py` | Home floor-plan SVG renderer |
| `mqtt_client.py` | MQTT pub/sub |
| `communication_manager.py` | Telegram message dispatch |
| `system_tools.py` | Disk, IP, network, system diagnostics |
| `file_manager.py` | Local file creation and management |

### Frontend — `frontend/`

React + Vite single-page app with Tailwind CSS and Framer Motion.

| Page | Purpose |
|------|---------|
| `Dashboard` | Home overview — active rooms, quick stats, suggestions |
| `Rooms` | Per-room device cards with live state and controls |
| `Devices` | Full device list with capability-aware controls |
| `Automations` | Create and manage automations via UI or chat |
| `Routines` | Schedule-based routines with step builder |
| `Tasks` | Task list with due dates and priorities |
| `AIChat` | Full conversational AI interface |
| `QuickAsks` | Saved one-tap command shortcuts |
| `Suggestions` | Pattern-learned home automation suggestions |
| `Scenes` | Scene management |
| `Memory` | Ziggy's persistent memory viewer |
| `HomeMap` | Visual floor plan with live device status |
| `VirtualDevices` | Virtual device management |
| `Settings / AdminSettings` | System and user configuration |

---

## Requirements

- **Python 3.11+**
- **Node.js 18+** (for frontend)
- Windows / macOS / Linux

**Optional integrations:**

| Integration | Required for |
|------------|-------------|
| Home Assistant + Long-Lived Token | Smart home control |
| MQTT broker | MQTT-based devices |
| Telegram bot token | Remote control via Telegram |
| OpenAI API key | LLM-powered intent parsing |
| Ollama (local) | Offline LLM alternative |
| Piper TTS / Whisper | Voice interface |
| OpenWakeWord model | Wake word detection |

---

## Setup

### 1. Python environment

```powershell
# Windows
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

```bash
# macOS / Linux
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Frontend

```bash
cd frontend
npm install
```

### 3. Configuration

Edit `config/settings.yaml`:

```yaml
home_assistant:
  url: "http://homeassistant.local:8123"
  token: "YOUR_LONG_LIVED_ACCESS_TOKEN"

openai:
  api_key: "sk-..."

telegram:
  enabled: true
  token: "YOUR_BOT_TOKEN"
  allowed_users: [YOUR_TELEGRAM_USER_ID]

web_interface:
  backend_port: 8001
  frontend_port: 3000
```

Room-to-entity mapping lives under `device_map` in the same file. Each room key maps device types (`light`, `temperature`, `motion`, `ac`, etc.) to HA entity IDs.

---

## Running Ziggy

### Full stack (recommended)

**Terminal 1 — Backend:**
```bash
python core/ziggy_main.py
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```

Open `http://localhost:3000` in your browser.

### Voice interface
```bash
python interfaces/voice_interface.py
```

### Telegram bot
```bash
python interfaces/telegram_interface.py
```

---

## Project Structure

```
backend/
  routers/          # 17 FastAPI routers
  server.py         # App wiring and startup
  ws_manager.py     # WebSocket connection hub

core/
  intent_parser.py  # NLU — maps text to intent
  action_parser.py  # Routes intent to handler
  handlers/         # Domain handlers (light, climate, media, task, …)
  tools_schema.py   # LLM function-calling schemas
  ziggy_main.py     # Main entry point

services/           # All business logic and integrations
interfaces/         # Voice and Telegram interfaces
integrations/       # External API wrappers
frontend/           # React + Vite web app
config/             # settings.yaml, contacts.yaml, memory
routines/           # Saved routine definitions
user_files/         # Tasks, notes, state memory, events
memory/             # Persistent key-value store
logs/               # Runtime logs
docs/               # Setup guides and references
tests/              # Test suite
```

---

## Extending Ziggy

- **New intent** — add a case in `core/intent_parser.py`, handle it in `core/action_parser.py` or a new handler under `core/handlers/`
- **New service** — add a module in `services/` and wire it into the appropriate handler
- **New API endpoint** — add a router in `backend/routers/` and register it in `backend/server.py`
- **New frontend page** — add a page component in `frontend/src/pages/` and a route in `frontend/src/App.jsx`
- **New room** — add the room key under `device_map` in `config/settings.yaml` and map its HA entity IDs

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Import errors | Run from repo root with venv active |
| HA not connecting | Check `settings.yaml` URL and token; confirm HA is reachable |
| WebSocket events missing | Check `ha_subscriber.py` logs; HA WebSocket token may be expired |
| Telegram not responding | Verify bot token and `allowed_users` list |
| Voice not working | Check mic permissions; run `microphone_test.py` |
| Frontend blank | Ensure backend is running on port 8001; check browser console |

---

## License

_(Add your chosen license here — MIT, Apache 2.0, etc.)_
