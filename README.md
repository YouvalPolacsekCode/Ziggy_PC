Ziggy_PC (Core)
Local, extensible AI assistant focused on intents → actions, with optional voice, Telegram, Home Assistant, and MQTT integrations. This repo currently contains only the core Ziggy components (no external web app).

Features (current)
Intent parsing → action handling (core/intent_parser.py → core/action_parser.py)

Interfaces: voice + Telegram (interfaces/voice_interface.py, interfaces/telegram_interface.py)

Home Assistant control (services/home_automation.py)

MQTT client utilities (services/mqtt_client.py)

Local task & file tools (services/task_manager.py, services/file_manager.py)

Wake word listener (services/wake_word_listener.py)

OpenAI integration wrapper (integrations/openai_wrapper.py)

Demo scripts (YouTube casting, email/recipe reading) in core/scripts/

Repo structure (key parts)
bash
Copy
Edit
config/              # .env, settings.yaml, ziggy_memory.yaml, contacts.yaml
core/                # engine: intent_parser, action_parser, ziggy_main, etc.
interfaces/          # voice_interface.py, telegram_interface.py, dashboard.py
services/            # home_automation, mqtt_client, system_tools, tasks, wake word
integrations/        # openai_wrapper.py
routers/             # telegram_action_router.py
routines/            # sample_routine.py (extensible)
memory/              # state/ persistence (state_manager.py)
ui/                  # ziggy_buttons.py
docs/                # HA setup docs, examples
user_files/          # user data (notes, tasks.json)
utils/               # helpers.py
Requirements
Python 3.11+ (recommended)

Windows or Linux/macOS

Optional integrations:

Home Assistant (URL + Long-Lived Access Token)

MQTT broker

Telegram bot token

OpenAI API key (if you use integrations/openai_wrapper.py)

Microphone (for voice)

Setup
1) Create & activate venv
Windows (PowerShell):

powershell
Copy
Edit
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
macOS/Linux:

bash
Copy
Edit
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
Note: a venv/ folder exists in this repo right now. You should remove it from git history and keep venv local-only (see “Housekeeping” below).

2) Configure environment & settings
config/.env — runtime secrets and tokens (already present; keep it out of git)

config/settings.yaml — app configuration (already present)

Typical variables used by the codebase (align with your files):

config/.env (example keys you likely need)

makefile
Copy
Edit
# OpenAI (used by integrations/openai_wrapper.py)
OPENAI_API_KEY=sk-...

# Telegram (used by interfaces/telegram_interface.py)
TELEGRAM_BOT_TOKEN=123456:ABC...

# MQTT (used by services/mqtt_client.py)
MQTT_HOST=localhost
MQTT_PORT=1883
MQTT_USERNAME=
MQTT_PASSWORD=

# Optional: STT/TTS or other service keys if you added them
config/settings.yaml

Home Assistant block is expected by services/home_automation.py:

yaml
Copy
Edit
home_assistant:
  url: "http://homeassistant.local:8123"
  token: "YOUR_LONG_LIVED_ACCESS_TOKEN"

# Optional helpers for device resolution used by home_automation.py
room_aliases:
  "living room": "main area"
device_map:
  "main area":
    light: "light.living_room_main"
    temperature: "sensor.living_room_temperature"
Also present:

config/ziggy_memory.yaml – long-term memory

config/contacts.yaml – used by skills/scenarios (e.g., messaging)

Running Ziggy
Option A — Core entry
bash
Copy
Edit
python core/ziggy_main.py
This is your main loop/driver for intents → actions. (If you route input differently, document that here.)

Option B — Telegram interface
bash
Copy
Edit
python interfaces/telegram_interface.py
Requires TELEGRAM_BOT_TOKEN in .env.

Routes messages to core/intent_parser.py and core/action_parser.py.

Extra actions are in routers/telegram_action_router.py and ui/ziggy_buttons.py.

Option C — Voice interface
bash
Copy
Edit
python interfaces/voice_interface.py
Uses mic input → intent parsing → actions.

For wake word, run:

bash
Copy
Edit
python services/wake_word_listener.py
Option D — Home Assistant tests / demos
bash
Copy
Edit
python core/scripts/test_home_automation.py
Ensure config/settings.yaml has valid home_assistant.url and token.

Other demos
bash
Copy
Edit
python core/scripts/demo_cast_youtube.py
python core/scripts/demo_read_emails.py
python core/scripts/demo_read_recipe.py
python microphone_test.py
Logs & Data
Logs: logs/

User files: user_files/ (e.g., tasks.json, notes)

Memory/state: memory/state/ (via state_manager.py)

Developing & Extending
New intents: add patterns/logic in core/intent_parser.py; handle in core/action_parser.py.

New services: create a module in services/ and call from action_parser.

Routines: add scenario flows in routines/ or skills_pack_1/.

Buttons/UX: adjust ui/ziggy_buttons.py and Telegram router.

Testing (current state)
Ad-hoc tests exist as Python files:

bash
Copy
Edit
python backend_test.py
python backend_system_test.py
python backend_error_test.py
Recommended next:

Move tests into tests/ and use pytest.

Add minimal CI (GitHub Actions) to run lint + tests.

Housekeeping (recommended)
Remove committed venv: it’s currently in the repo. Do this to clean it up:

bash
Copy
Edit
# from repo root (with the venv deactivated)
git rm -r --cached venv
echo "venv/" >> .gitignore
git add .gitignore
git commit -m "Remove committed venv; ignore locally"
Keep .env and any secrets uncommitted (already the case).

Consider adding a README_SKILLS_PACK_1.md link from this README so people discover those scenarios.

Troubleshooting
Import errors: run from repo root and ensure venv is active.

HA calls fail: verify home_assistant.url is reachable from this machine and token is valid.

Telegram not responding: confirm bot token and that the bot has at least one chat initiated.

Audio issues: confirm microphone permissions and default device; test with microphone_test.py.

