# 🤖 Ziggy_PC (Core AI Assistant)

Ziggy_PC is a **local, extensible AI assistant** that processes **intents → actions**, integrates with **voice input**, **Telegram**, **Home Assistant**, **MQTT**, and more — all without requiring cloud dependencies for basic operation.

> **Note:** This repo currently contains only the **core Ziggy components** — the web interface & API have been removed.

---

## ✨ Features

- **Natural Language Intent Parsing** → Action Execution  
  (`core/intent_parser.py` → `core/action_parser.py`)
- **Multiple Interfaces**
  - 🎙 Voice control (`interfaces/voice_interface.py`)
  - 💬 Telegram bot (`interfaces/telegram_interface.py`)
- **Smart Home Integration**
  - Home Assistant control (`services/home_automation.py`)
  - MQTT client support (`services/mqtt_client.py`)
- **Utilities**
  - Task manager (`services/task_manager.py`)
  - File manager (`services/file_manager.py`)
  - Wake word listener (`services/wake_word_listener.py`)
- **Extensibility**
  - Add new skills in `skills_pack_1/`
  - Create routines in `routines/`

---

## 📂 Repository Structure

```plaintext
config/         # Settings, memory, contacts
core/           # Main engine: intent parsing, action handling
interfaces/     # Voice & Telegram interfaces
services/       # Home automation, MQTT, system tools
integrations/   # API wrappers (e.g., OpenAI)
skills_pack_1/  # Example skills & scenarios
routines/       # Example automation flows
routers/        # Telegram routing
memory/         # Persistent state
ui/             # UI elements (e.g., Telegram buttons)
docs/           # Documentation & setup guides
user_files/     # Notes, tasks, user data
utils/          # Helper functions
logs/           # Runtime logs
```

---

## 🛠 Requirements

- **Python 3.11+**
- **Windows / macOS / Linux**
- Optional integrations:
  - Home Assistant URL + Long-Lived Access Token
  - MQTT broker
  - Telegram bot token
  - OpenAI API key (if using `integrations/openai_wrapper.py`)

---

## ⚙️ Setup

### 1️⃣ Create & Activate Virtual Environment

**Windows (PowerShell):**
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

**macOS/Linux:**
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

> 🚨 **Note:** A `venv/` is currently committed in the repo.  
> Remove it from version control and add `venv/` to `.gitignore`.

---

### 2️⃣ Configure Environment & Settings

**`config/.env`** — store tokens and secrets (keep out of git).

Example:
```env
OPENAI_API_KEY=sk-...
TELEGRAM_BOT_TOKEN=123456:ABC...
MQTT_HOST=localhost
MQTT_PORT=1883
MQTT_USERNAME=
MQTT_PASSWORD=
```

**`config/settings.yaml`** — core configuration.
```yaml
home_assistant:
  url: "http://homeassistant.local:8123"
  token: "YOUR_LONG_LIVED_ACCESS_TOKEN"

room_aliases:
  "living room": "main area"

device_map:
  "main area":
    light: "light.living_room_main"
    temperature: "sensor.living_room_temperature"
```

---

## 🚀 Running Ziggy

### Core
```bash
python core/ziggy_main.py
```

### Telegram Interface
```bash
python interfaces/telegram_interface.py
```

### Voice Interface
```bash
python interfaces/voice_interface.py
```

### Wake Word
```bash
python services/wake_word_listener.py
```

### Demo Scripts
```bash
python core/scripts/demo_cast_youtube.py
python core/scripts/demo_read_emails.py
python core/scripts/demo_read_recipe.py
python core/scripts/test_home_automation.py
```

---

## 📜 Logs & Data

- **Logs:** `logs/`
- **User Data:** `user_files/` (`tasks.json`, notes)
- **Persistent Memory:** `memory/state/`

---

## 🧩 Extending Ziggy

- Add **new intents** in `core/intent_parser.py` and handle them in `core/action_parser.py`.
- Create **new services** in `services/` and integrate in the action parser.
- Build **custom skills** inside `skills_pack_1/`.
- Add **automation flows** in `routines/`.

---

## ✅ Housekeeping

- Remove `venv/` from repo:
```bash
git rm -r --cached venv
echo "venv/" >> .gitignore
git commit -m "Remove venv from repo"
```
- Commit `.env.example` and `settings.example.yaml` (no secrets).
- Consider adding tests under `tests/` and a GitHub Actions CI pipeline.

---

## 🆘 Troubleshooting

- **Import errors:** Run scripts from repo root with venv active.
- **HA issues:** Check `settings.yaml` URL and token.
- **Telegram not responding:** Ensure the bot token is correct and conversation initiated.
- **Audio problems:** Check mic permissions; test with `microphone_test.py`.

---

## 📄 License

_(Add your chosen license here — MIT, Apache 2.0, etc.)_
