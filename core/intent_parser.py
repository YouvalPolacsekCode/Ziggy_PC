import re
import json
from core.settings_loader import settings
from integrations.openai_client import get_client

# ---------------------------------------------------------------------------
# Fast path — answered locally, no API call
# ---------------------------------------------------------------------------
_FAST_PATTERNS = [
    (re.compile(r"\b(what time|what'?s the time|current time|time now|tell me the time)\b"), "get_time"),
    (re.compile(r"\b(what'?s the date|today'?s date|current date|what date is it)\b"), "get_date"),
    (re.compile(r"\b(what day|which day|day of the week|what weekday)\b"), "get_day_of_week"),
]

_TRIGGER_PREFIX = "ziggy do"

# ---------------------------------------------------------------------------
# Build the room list from settings so tool descriptions stay in sync
# with whatever aliases are defined in settings.yaml.
# ---------------------------------------------------------------------------
_ROOMS = ", ".join(sorted(settings.get("room_aliases", {}).keys()))

TOOLS = [
    # ---- Lights ----
    {"type": "function", "function": {
        "name": "toggle_light",
        "description": "Turn a light on or off in a room",
        "parameters": {"type": "object", "properties": {
            "room":    {"type": "string", "description": f"Room name. Options: {_ROOMS}"},
            "turn_on": {"type": "boolean", "description": "true = on, false = off"},
        }, "required": ["room", "turn_on"]},
    }},
    {"type": "function", "function": {
        "name": "set_light_color",
        "description": "Change the colour of a light in a room",
        "parameters": {"type": "object", "properties": {
            "room":  {"type": "string", "description": f"Room name. Options: {_ROOMS}"},
            "color": {"type": "string", "description": "Colour name e.g. blue, red, warm white"},
        }, "required": ["room", "color"]},
    }},
    {"type": "function", "function": {
        "name": "adjust_light_brightness",
        "description": "Set the brightness of a light (0–100%)",
        "parameters": {"type": "object", "properties": {
            "room":       {"type": "string", "description": f"Room name. Options: {_ROOMS}"},
            "brightness": {"type": "integer", "description": "Percentage 0–100"},
        }, "required": ["room", "brightness"]},
    }},

    # ---- AC / Climate ----
    {"type": "function", "function": {
        "name": "control_ac",
        "description": "Turn air conditioning on or off",
        "parameters": {"type": "object", "properties": {
            "room":    {"type": "string", "description": f"Room name. Options: {_ROOMS}"},
            "turn_on": {"type": "boolean"},
        }, "required": ["room", "turn_on"]},
    }},
    {"type": "function", "function": {
        "name": "set_ac_temperature",
        "description": "Set the AC thermostat to a target temperature",
        "parameters": {"type": "object", "properties": {
            "room":        {"type": "string", "description": f"Room name. Options: {_ROOMS}"},
            "temperature": {"type": "integer", "description": "Target temperature in °C"},
        }, "required": ["room", "temperature"]},
    }},
    {"type": "function", "function": {
        "name": "get_temperature",
        "description": "Get the current temperature reading from a room sensor",
        "parameters": {"type": "object", "properties": {
            "room": {"type": "string", "description": f"Room name. Options: {_ROOMS}"},
        }, "required": ["room"]},
    }},
    {"type": "function", "function": {
        "name": "get_humidity",
        "description": "Get the current humidity reading from a room sensor",
        "parameters": {"type": "object", "properties": {
            "room": {"type": "string", "description": f"Room name. Options: {_ROOMS}"},
        }, "required": ["room"]},
    }},

    # ---- TV ----
    {"type": "function", "function": {
        "name": "control_tv",
        "description": "Turn a TV on or off",
        "parameters": {"type": "object", "properties": {
            "turn_on": {"type": "boolean"},
            "device":  {"type": "string", "description": "TV alias e.g. living room tv, bedroom tv (optional)"},
        }, "required": ["turn_on"]},
    }},
    {"type": "function", "function": {
        "name": "set_tv_source",
        "description": "Switch the TV input or launch a streaming app",
        "parameters": {"type": "object", "properties": {
            "source": {"type": "string", "description": "Input or app: HDMI 1, HDMI 2, Netflix, YouTube, Prime Video, Disney+, etc."},
            "device": {"type": "string", "description": "TV alias (optional)"},
        }, "required": ["source"]},
    }},

    # ---- Files & Notes ----
    {"type": "function", "function": {
        "name": "save_note",
        "description": "Save a quick note or memo",
        "parameters": {"type": "object", "properties": {
            "content": {"type": "string", "description": "The note content to save"},
        }, "required": ["content"]},
    }},
    {"type": "function", "function": {
        "name": "read_notes",
        "description": "Read recent saved notes",
        "parameters": {"type": "object", "properties": {
            "limit": {"type": "integer", "description": "How many notes to show (default 3)"},
        }},
    }},
    {"type": "function", "function": {
        "name": "save_file",
        "description": "Save content to a named file",
        "parameters": {"type": "object", "properties": {
            "filename": {"type": "string", "description": "Filename including extension e.g. shopping.txt"},
            "content":  {"type": "string", "description": "File content"},
        }, "required": ["filename", "content"]},
    }},
    {"type": "function", "function": {
        "name": "read_file",
        "description": "Read the contents of a saved file by name",
        "parameters": {"type": "object", "properties": {
            "filename": {"type": "string"},
        }, "required": ["filename"]},
    }},
    {"type": "function", "function": {
        "name": "list_files",
        "description": "List all saved files",
        "parameters": {"type": "object", "properties": {}},
    }},

    # ---- Countdown ----
    {"type": "function", "function": {
        "name": "countdown",
        "description": "Count how many days until (or since) a date or event",
        "parameters": {"type": "object", "properties": {
            "date":  {"type": "string", "description": "Date or event name e.g. 'Christmas', 'March 15', '2025-06-01'"},
            "event": {"type": "string", "description": "Event description (alternative to date)"},
        }},
    }},

    # ---- Tasks ----
    {"type": "function", "function": {
        "name": "add_task",
        "description": "Create a new task, to-do item, or reminder",
        "parameters": {"type": "object", "properties": {
            "task":     {"type": "string"},
            "due":      {"type": "string", "description": "Due date/time in natural language or ISO format"},
            "priority": {"type": "string", "enum": ["high", "medium", "low"]},
            "reminder": {"type": "string", "description": "When to send a reminder"},
            "repeat":   {"type": "string", "description": "Repeat frequency e.g. daily, weekly"},
        }, "required": ["task"]},
    }},
    {"type": "function", "function": {
        "name": "list_tasks",
        "description": "Show all current tasks and reminders",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "mark_task_done",
        "description": "Mark a task as completed",
        "parameters": {"type": "object", "properties": {
            "task": {"type": "string", "description": "Task name or number"},
        }, "required": ["task"]},
    }},
    {"type": "function", "function": {
        "name": "remove_task",
        "description": "Delete a specific task by name",
        "parameters": {"type": "object", "properties": {
            "task": {"type": "string"},
        }, "required": ["task"]},
    }},
    {"type": "function", "function": {
        "name": "remove_tasks",
        "description": "Delete ALL tasks at once",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "remove_last_task",
        "description": "Delete the most recently added task",
        "parameters": {"type": "object", "properties": {}},
    }},

    # ---- Memory ----
    {"type": "function", "function": {
        "name": "remember_memory",
        "description": "Save a fact or preference to long-term memory",
        "parameters": {"type": "object", "properties": {
            "key":   {"type": "string"},
            "value": {"type": "string"},
        }, "required": ["key", "value"]},
    }},
    {"type": "function", "function": {
        "name": "recall_memory",
        "description": "Retrieve a saved fact or preference from memory",
        "parameters": {"type": "object", "properties": {
            "key": {"type": "string"},
        }, "required": ["key"]},
    }},
    {"type": "function", "function": {
        "name": "delete_memory",
        "description": "Delete a saved memory entry",
        "parameters": {"type": "object", "properties": {
            "key": {"type": "string"},
        }, "required": ["key"]},
    }},

    # ---- Date / Time (also handled by fast path) ----
    {"type": "function", "function": {
        "name": "get_time",
        "description": "Get the current time",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "get_date",
        "description": "Get today's date",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "get_day_of_week",
        "description": "Get the current day of the week",
        "parameters": {"type": "object", "properties": {}},
    }},

    # ---- System info ----
    {"type": "function", "function": {
        "name": "get_system_status",
        "description": "Get system health: CPU, RAM, uptime",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "get_ip_address",
        "description": "Get the device IP address",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "get_disk_usage",
        "description": "Check available disk space",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "get_wifi_status",
        "description": "Check WiFi connection status",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "get_network_adapters",
        "description": "List network adapters and interface details",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "ping_test",
        "description": "Ping a domain to test network connectivity",
        "parameters": {"type": "object", "properties": {
            "domain": {"type": "string", "description": "Domain to ping e.g. google.com"},
        }, "required": ["domain"]},
    }},

    # ---- Ziggy lifecycle ----
    {"type": "function", "function": {
        "name": "restart_ziggy",
        "description": "Restart the Ziggy assistant service",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "shutdown_ziggy",
        "description": "Shut down the Ziggy assistant completely",
        "parameters": {"type": "object", "properties": {}},
    }},

    # ---- Ziggy identity ----
    {"type": "function", "function": {
        "name": "ziggy_status",
        "description": "Ask how Ziggy is doing or check its mood/status",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "ziggy_identity",
        "description": "Ask who or what Ziggy is",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "ziggy_help",
        "description": "Ask what Ziggy can do or what commands are available",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "ziggy_chat",
        "description": "Ask for a fun fact, joke, or entertaining response",
        "parameters": {"type": "object", "properties": {}},
    }},

    # ---- Media ----
    {"type": "function", "function": {
        "name": "media_stream_youtube",
        "description": "Cast or stream a YouTube video to a screen",
        "parameters": {"type": "object", "properties": {
            "input_text":  {"type": "string", "description": "YouTube URL or search query"},
            "device_hint": {"type": "string", "description": "Target device e.g. living room tv"},
        }, "required": ["input_text"]},
    }},
    {"type": "function", "function": {
        "name": "media_spotify_playlist",
        "description": "Play a Spotify playlist, album, or artist",
        "parameters": {"type": "object", "properties": {
            "target":      {"type": "string", "description": "Playlist, album, or artist name"},
            "device_hint": {"type": "string"},
        }, "required": ["target"]},
    }},
    {"type": "function", "function": {
        "name": "media_start_movie_in_app",
        "description": "Launch a movie or show in a streaming app",
        "parameters": {"type": "object", "properties": {
            "title":       {"type": "string"},
            "app":         {"type": "string", "description": "Netflix, Prime Video, Disney+, etc."},
            "device_hint": {"type": "string"},
        }, "required": ["title", "app"]},
    }},
    {"type": "function", "function": {
        "name": "media_cast_camera_live",
        "description": "Show a security camera live feed on a screen",
        "parameters": {"type": "object", "properties": {
            "camera_name": {"type": "string", "description": "Camera name e.g. front door, entry"},
            "device_hint": {"type": "string"},
        }, "required": ["camera_name"]},
    }},
    {"type": "function", "function": {
        "name": "media_play_podcast_episode",
        "description": "Play a podcast episode on a speaker",
        "parameters": {"type": "object", "properties": {
            "podcast_name": {"type": "string"},
            "episode_hint": {"type": "string", "description": "Episode title or keyword"},
            "device_hint":  {"type": "string"},
        }, "required": ["podcast_name"]},
    }},

    # ---- Web ----
    {"type": "function", "function": {
        "name": "web_recipe_read",
        "description": "Fetch and read a recipe from a URL or by dish name",
        "parameters": {"type": "object", "properties": {
            "input_text":  {"type": "string", "description": "Recipe URL or dish name"},
            "device_hint": {"type": "string"},
        }, "required": ["input_text"]},
    }},
    {"type": "function", "function": {
        "name": "web_news_brief",
        "description": "Summarise the latest news headlines",
        "parameters": {"type": "object", "properties": {
            "device_hint": {"type": "string"},
            "voice":       {"type": "boolean"},
        }},
    }},
    {"type": "function", "function": {
        "name": "web_trip_updates",
        "description": "Get travel, traffic, or route information",
        "parameters": {"type": "object", "properties": {
            "city_or_route": {"type": "string"},
        }, "required": ["city_or_route"]},
    }},
    {"type": "function", "function": {
        "name": "web_stocks_update",
        "description": "Get stock prices or market quotes",
        "parameters": {"type": "object", "properties": {
            "tickers":     {"type": "string", "description": "Comma-separated tickers e.g. AAPL, TSLA"},
            "device_hint": {"type": "string"},
        }, "required": ["tickers"]},
    }},
    {"type": "function", "function": {
        "name": "web_search_summary",
        "description": "Search the web for a topic and summarise the results",
        "parameters": {"type": "object", "properties": {
            "query":       {"type": "string"},
            "device_hint": {"type": "string"},
        }, "required": ["query"]},
    }},

    # ---- Communication ----
    {"type": "function", "function": {
        "name": "comm_read_emails",
        "description": "Read recent emails from inbox",
        "parameters": {"type": "object", "properties": {
            "limit": {"type": "integer"},
        }},
    }},
    {"type": "function", "function": {
        "name": "comm_send_email",
        "description": "Send an email to a contact",
        "parameters": {"type": "object", "properties": {
            "name":    {"type": "string"},
            "subject": {"type": "string"},
            "body":    {"type": "string"},
        }, "required": ["name", "subject", "body"]},
    }},
    {"type": "function", "function": {
        "name": "comm_quick_message",
        "description": "Send a quick message via Telegram or WhatsApp",
        "parameters": {"type": "object", "properties": {
            "contact_name": {"type": "string"},
            "text":         {"type": "string"},
            "channel":      {"type": "string", "enum": ["telegram", "whatsapp"]},
        }, "required": ["contact_name", "text"]},
    }},
    {"type": "function", "function": {
        "name": "comm_broadcast_announcement",
        "description": "Broadcast a text-to-speech announcement to one or all rooms",
        "parameters": {"type": "object", "properties": {
            "text":         {"type": "string"},
            "rooms_or_all": {"type": "string", "description": "Room name or 'all'"},
        }, "required": ["text"]},
    }},
    {"type": "function", "function": {
        "name": "comm_read_sms",
        "description": "Read recent SMS text messages",
        "parameters": {"type": "object", "properties": {
            "limit": {"type": "integer"},
        }},
    }},

    # ---- Visual ----
    {"type": "function", "function": {
        "name": "visual_cast_calendar",
        "description": "Show today's calendar or schedule on a screen",
        "parameters": {"type": "object", "properties": {
            "device_hint": {"type": "string"},
        }},
    }},
    {"type": "function", "function": {
        "name": "visual_cast_album",
        "description": "Show a photo album or slideshow on a screen",
        "parameters": {"type": "object", "properties": {
            "album_name":  {"type": "string"},
            "source":      {"type": "string", "description": "google_photos or local"},
            "device_hint": {"type": "string"},
        }, "required": ["album_name"]},
    }},
    {"type": "function", "function": {
        "name": "visual_cast_camera",
        "description": "Display a security camera feed on screen",
        "parameters": {"type": "object", "properties": {
            "camera_name": {"type": "string"},
            "device_hint": {"type": "string"},
        }, "required": ["camera_name"]},
    }},
    {"type": "function", "function": {
        "name": "visual_image_slideshow",
        "description": "Play an image slideshow from a folder or criteria",
        "parameters": {"type": "object", "properties": {
            "criteria_or_folder": {"type": "string"},
            "device_hint":        {"type": "string"},
            "duration":           {"type": "number", "description": "Seconds per image"},
        }, "required": ["criteria_or_folder"]},
    }},

    # ---- Internet / Network ----
    {"type": "function", "function": {
        "name": "get_internet_speed",
        "description": "Get current internet download and upload speed",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "get_internet_status",
        "description": "Check whether the internet is connected and get the external IP",
        "parameters": {"type": "object", "properties": {}},
    }},

    # ---- Sun / Daylight ----
    {"type": "function", "function": {
        "name": "get_sun_times",
        "description": "Get today's sunrise and sunset times",
        "parameters": {"type": "object", "properties": {}},
    }},

    # ---- Presence ----
    {"type": "function", "function": {
        "name": "is_someone_home",
        "description": "Check whether someone is home or away",
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string", "description": "Person name (optional)"},
        }},
    }},

    # ---- Shopping list ----
    {"type": "function", "function": {
        "name": "add_shopping_list_item",
        "description": "Add an item to the shopping list",
        "parameters": {"type": "object", "properties": {
            "item": {"type": "string", "description": "Item to add"},
        }, "required": ["item"]},
    }},
    {"type": "function", "function": {
        "name": "get_shopping_list",
        "description": "Show the current shopping list",
        "parameters": {"type": "object", "properties": {}},
    }},

    # ---- Reference ----
    {"type": "function", "function": {
        "name": "ref_read_note_or_file",
        "description": "Find and read a saved note or file",
        "parameters": {"type": "object", "properties": {
            "query":       {"type": "string"},
            "device_hint": {"type": "string"},
        }, "required": ["query"]},
    }},
    {"type": "function", "function": {
        "name": "ref_show_grocery",
        "description": "Show the grocery or shopping list",
        "parameters": {"type": "object", "properties": {
            "device_hint": {"type": "string"},
        }},
    }},
    {"type": "function", "function": {
        "name": "ref_search_history_or_memory",
        "description": "Search command history or memory logs by keyword",
        "parameters": {"type": "object", "properties": {
            "keyword":     {"type": "string"},
            "device_hint": {"type": "string"},
        }, "required": ["keyword"]},
    }},
    {"type": "function", "function": {
        "name": "ref_read_saved_recipe",
        "description": "Read a previously saved recipe note",
        "parameters": {"type": "object", "properties": {
            "meal_name":   {"type": "string"},
            "device_hint": {"type": "string"},
        }, "required": ["meal_name"]},
    }},
]

_SYSTEM_PROMPT = (
    "You are Ziggy, a smart home assistant. "
    "The user is giving a voice or text command. "
    "Use the available tools to handle smart home control, tasks, media, and system queries. "
    f"Known rooms: {_ROOMS}. "
    "If the input is conversational and doesn't match any tool, do NOT call a tool — just respond naturally."
)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def quick_parse(text: str) -> dict:
    if not isinstance(text, str) or not text.strip():
        return {"intent": "chat_with_gpt", "params": {"text": ""}, "source": "noop"}

    text = text.strip()

    # Strip optional trigger prefix
    lower = text.lower()
    if lower.startswith(_TRIGGER_PREFIX):
        text = text[len(_TRIGGER_PREFIX):].strip()
        lower = text.lower()

    # Fast path: time/date/day — no API call
    for pattern, intent in _FAST_PATTERNS:
        if pattern.search(lower):
            print(f"[Intent Parser] ⚡ Fast path: {intent}")
            return {"intent": intent, "params": {}, "source": "fast"}

    return _parse_with_tools(text)


def _parse_with_tools(text: str) -> dict:
    try:
        response = get_client().chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user",   "content": text},
            ],
            tools=TOOLS,
            tool_choice="auto",
        )

        msg = response.choices[0].message

        if msg.tool_calls:
            call = msg.tool_calls[0]
            intent = call.function.name
            params = json.loads(call.function.arguments)
            print(f"[Intent Parser] ✅ Tool: {intent} | params: {params}")
            return {"intent": intent, "params": params, "source": "tools"}

        # No tool matched → conversation
        print("[Intent Parser] 💬 No tool matched, routing to chat")
        return {"intent": "chat_with_gpt", "params": {"text": text}, "source": "tools"}

    except Exception as e:
        print(f"[Intent Parser] ⚠️ Error: {e}")
        return {"intent": "chat_with_gpt", "params": {"text": text}, "source": "error"}
