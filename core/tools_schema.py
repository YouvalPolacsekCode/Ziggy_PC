"""
OpenAI function-calling tool definitions for the Ziggy intent parser.
Extracted here so intent_parser.py stays focused on call logic only.
"""
from core.settings_loader import settings

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
    {"type": "function", "function": {
        "name": "toggle_all_lights_in_room",
        "description": "Turn on or off ALL lights in a room at once",
        "parameters": {"type": "object", "properties": {
            "room":    {"type": "string", "description": f"Room name. Options: {_ROOMS}"},
            "turn_on": {"type": "boolean", "description": "true = on, false = off"},
        }, "required": ["room", "turn_on"]},
    }},
    {"type": "function", "function": {
        "name": "turn_off_all_lights",
        "description": "Turn off ALL lights in the house. Use this when the user says 'turn off all lights', 'lights off', 'all lights off'. Does NOT affect TVs, media players, or other devices.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "turn_off_everything",
        "description": "Turn off all lights AND all devices (including TV, media players) in the entire house. Only use when the user explicitly says 'everything off', 'shut everything down', or 'good night' meaning all devices.",
        "parameters": {"type": "object", "properties": {}},
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
    {"type": "function", "function": {
        "name": "report_all_temperatures",
        "description": "Get temperature readings from every room at once",
        "parameters": {"type": "object", "properties": {}},
    }},

    # ---- TV (smart TV with native HA media_player entity) ----
    {"type": "function", "function": {
        "name": "control_tv",
        "description": (
            "Turn a smart TV on or off. "
            "Use this only for TVs that have a Home Assistant media_player entity (e.g. LG WebOS, Android TV, Chromecast). "
            "For TVs controlled via IR blaster (no HA entity), use ir_send_command instead."
        ),
        "parameters": {"type": "object", "properties": {
            "turn_on": {"type": "boolean"},
            "device":  {"type": "string", "description": "TV alias e.g. living room tv (optional)"},
        }, "required": ["turn_on"]},
    }},
    {"type": "function", "function": {
        "name": "set_tv_source",
        "description": (
            "Switch the input source or launch a streaming app on a smart TV with a HA media_player entity. "
            "For IR-only TVs, use ir_send_command with action='hdmi_1' etc."
        ),
        "parameters": {"type": "object", "properties": {
            "source": {"type": "string", "description": "Input or app: HDMI 1, HDMI 2, Netflix, YouTube, Prime Video, Disney+, etc."},
            "device": {"type": "string", "description": "TV alias (optional)"},
        }, "required": ["source"]},
    }},

    # ---- IR Blaster devices (Broadlink) ----
    {"type": "function", "function": {
        "name": "ir_send_command",
        "description": (
            "Control a device managed by an IR blaster (Broadlink): "
            "TV volume/navigation/HDMI/channels, AC power/mode/fan, ceiling fan speed, soundbar input. "
            "Use this for devices WITHOUT a native Home Assistant entity. "
            "Do NOT use for smart TVs with HA media_player (use control_tv / set_tv_source). "
            "Do NOT use for smart ACs with HA climate entity (use control_ac / set_ac_temperature). "
            "For AC temperature, use ir_set_ac_temperature instead of this tool."
        ),
        "parameters": {"type": "object", "properties": {
            "device_type": {
                "type": "string",
                "enum": ["tv", "ac", "fan", "soundbar", "projector", "custom"],
                "description": "Type of the IR device",
            },
            "action": {
                "type": "string",
                "description": (
                    "Exact action to send. "
                    "TV: power, volume_up, volume_down, mute, hdmi_1, hdmi_2, hdmi_3, "
                    "nav_up, nav_down, nav_left, nav_right, nav_ok, back, menu, home, channel_up, channel_down. "
                    "AC: power, mode_cool, mode_heat, mode_fan, mode_dry, mode_auto, "
                    "fan_low, fan_medium, fan_high, fan_auto, swing_on, swing_off. "
                    "Fan: power, speed_low, speed_medium, speed_high, oscillate. "
                    "Soundbar: power, volume_up, volume_down, mute, input_hdmi, input_optical, input_bluetooth."
                ),
            },
            "room": {"type": "string", "description": f"Room name (optional if only one device of this type). Options: {_ROOMS}"},
        }, "required": ["device_type", "action"]},
    }},
    {"type": "function", "function": {
        "name": "ir_set_ac_temperature",
        "description": (
            "Set the temperature of an AC unit controlled via IR blaster. "
            "Use this when the AC has NO Home Assistant climate entity. "
            "For smart thermostats with HA support, use set_ac_temperature instead. "
            "Can optionally set the mode (cool, heat, fan, auto, dry) at the same time."
        ),
        "parameters": {"type": "object", "properties": {
            "temperature": {"type": "integer", "description": "Target temperature in °C (16–30)"},
            "mode": {
                "type": "string",
                "enum": ["cool", "heat", "fan", "auto", "dry"],
                "description": "AC mode (optional — omit to keep current mode)",
            },
            "room": {"type": "string", "description": f"Room name (optional). Options: {_ROOMS}"},
        }, "required": ["temperature"]},
    }},
    {"type": "function", "function": {
        "name": "ir_send_channel",
        "description": (
            "Switch an IR-controlled TV to a specific channel number by sending digit codes. "
            "Use when the user says 'channel 5', 'go to channel 12', etc. "
            "Only for IR-blaster TVs — not for smart TVs with HA media_player."
        ),
        "parameters": {"type": "object", "properties": {
            "channel": {"type": "integer", "description": "Channel number to switch to (e.g. 5, 12, 100)"},
            "room": {"type": "string", "description": f"Room name (optional). Options: {_ROOMS}"},
        }, "required": ["channel"]},
    }},
    {"type": "function", "function": {
        "name": "ir_play_sequence",
        "description": (
            "Play a named command sequence (macro) on an IR device. "
            "Examples: 'open Netflix' → sequence_name='netflix', 'sleep mode' → sequence_name='sleep_mode'. "
            "Sequences are pre-programmed ordered steps of IR commands with delays."
        ),
        "parameters": {"type": "object", "properties": {
            "sequence_name": {"type": "string", "description": "Sequence name (e.g. 'netflix', 'sleep_mode', 'hdmi_gaming')"},
            "device_type": {
                "type": "string",
                "enum": ["tv", "ac", "fan", "soundbar", "projector", "custom"],
                "description": "Device type the sequence belongs to (default: tv)",
            },
            "room": {"type": "string", "description": f"Room name (optional). Options: {_ROOMS}"},
        }, "required": ["sequence_name"]},
    }},
    {"type": "function", "function": {
        "name": "ir_learn_command",
        "description": (
            "Put an IR blaster into 20-second learning mode to record a new command from a remote. "
            "Use when the user says 'learn command', 'teach Ziggy a button', etc. "
            "Requires device_id and command_name."
        ),
        "parameters": {"type": "object", "properties": {
            "device_id": {"type": "string", "description": "ID of the IR virtual device"},
            "command_name": {"type": "string", "description": "Logical command name to learn (e.g. 'power', 'volume_up', 'netflix')"},
        }, "required": ["device_id", "command_name"]},
    }},

    # ---- Files & Notes ----
    {"type": "function", "function": {
        "name": "save_note",
        "description": "Save a quick note or memo",
        "parameters": {"type": "object", "properties": {
            "content": {"type": "string", "description": "The note content to save"},
            "title":   {"type": "string", "description": "Optional title for the note"},
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
        "name": "search_notes",
        "description": "Search saved notes by keyword or title",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "Search keyword"},
        }, "required": ["query"]},
    }},
    {"type": "function", "function": {
        "name": "append_to_note",
        "description": "Append text to an existing note",
        "parameters": {"type": "object", "properties": {
            "filename": {"type": "string", "description": "Note filename or title keyword"},
            "content":  {"type": "string", "description": "Text to append"},
        }, "required": ["filename", "content"]},
    }},
    {"type": "function", "function": {
        "name": "delete_note",
        "description": "Delete a note by title or keyword",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string", "description": "Note title or keyword to match"},
        }, "required": ["query"]},
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
        "name": "delete_file",
        "description": "Delete a saved file by name",
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
    {"type": "function", "function": {
        "name": "postpone_task",
        "description": "Delay a task's due date by a number of days",
        "parameters": {"type": "object", "properties": {
            "task": {"type": "string", "description": "Task name"},
            "days": {"type": "integer", "description": "Number of days to postpone (default 1)"},
        }, "required": ["task"]},
    }},
    {"type": "function", "function": {
        "name": "task_summary",
        "description": "Get a summary of pending, done, and overdue task counts",
        "parameters": {"type": "object", "properties": {}},
    }},

    # ---- Events ----
    {"type": "function", "function": {
        "name": "add_event",
        "description": "Add a named event or occasion with a date (e.g., birthday, anniversary)",
        "parameters": {"type": "object", "properties": {
            "name":     {"type": "string", "description": "Event name e.g. 'Adi's birthday'"},
            "date_str": {"type": "string", "description": "Date in natural language or YYYY-MM-DD"},
            "notes":    {"type": "string"},
            "repeat":   {"type": "string", "description": "yearly, monthly, none (default none)"},
        }, "required": ["name", "date_str"]},
    }},
    {"type": "function", "function": {
        "name": "list_events",
        "description": "List upcoming events and occasions",
        "parameters": {"type": "object", "properties": {
            "limit": {"type": "integer"},
        }},
    }},
    {"type": "function", "function": {
        "name": "remove_event",
        "description": "Remove a named event",
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string"},
        }, "required": ["name"]},
    }},
    {"type": "function", "function": {
        "name": "days_until_event",
        "description": "How many days until a named event",
        "parameters": {"type": "object", "properties": {
            "name": {"type": "string"},
        }, "required": ["name"]},
    }},
    {"type": "function", "function": {
        "name": "next_event",
        "description": "What is the next upcoming event",
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

    # ---- Date / Time ----
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
    {"type": "function", "function": {
        "name": "get_weather",
        "description": "Get current weather for a city",
        "parameters": {"type": "object", "properties": {
            "city": {"type": "string", "description": "City name e.g. Tel Aviv, London"},
        }, "required": ["city"]},
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

    # ---- Automations ----
    {"type": "function", "function": {
        "name": "create_automation",
        "description": (
            "Create a scheduled or triggered automation or routine. "
            "Use this when the user says 'every day at X', 'automatically turn on/off', "
            "'create a routine', 'schedule X to happen at Y time', "
            "'when the temperature is above/below X', 'when a sensor state changes', etc. "
            "Both 'automation' and 'routine' map to this tool when a trigger or schedule is involved."
        ),
        "parameters": {"type": "object", "properties": {
            "name":              {"type": "string", "description": "Friendly name, e.g. 'Kitchen lights noon'"},
            "trigger_type":      {
                "type": "string",
                "enum": ["time", "state", "numeric_state", "sunrise", "sunset"],
                "description": (
                    "What triggers the automation. "
                    "Use 'time' for clock-based schedules. "
                    "Use 'state' for exact entity state matches (on/off/home). "
                    "Use 'numeric_state' for numeric sensor thresholds (temperature above 24, humidity below 60). "
                    "Use 'sunrise'/'sunset' for sun-based triggers."
                ),
            },
            "trigger_time":      {"type": "string", "description": "HH:MM for time triggers, e.g. '07:00'"},
            "trigger_entity_id": {"type": "string", "description": "Entity ID or room name for state/numeric_state triggers, e.g. sensor.roni_room_temperature or 'roni room'"},
            "trigger_state":     {"type": "string", "description": "Exact state value for state triggers, e.g. 'on', 'home'"},
            "trigger_above":     {"type": "number", "description": "For numeric_state triggers: fire when value rises ABOVE this number (e.g. 24 for 'temp above 24')"},
            "trigger_below":     {"type": "number", "description": "For numeric_state triggers: fire when value falls BELOW this number"},
            "trigger_offset":    {"type": "string", "description": "Offset for sunrise/sunset, e.g. '+00:30:00'"},
            "action_room":       {"type": "string", "description": f"Room to act on. Options: {_ROOMS}"},
            "action_device_type":{"type": "string", "description": "Device type to act on: light, ac, tv, media_player, switch"},
            "action_service":    {"type": "string", "enum": ["turn_on", "turn_off"],
                                  "description": "Action to perform"},
        }, "required": ["trigger_type", "action_room", "action_device_type", "action_service"]},
    }},
    {"type": "function", "function": {
        "name": "list_active_devices",
        "description": "List all devices that are currently active (on, playing, running). Use when user asks 'what is on?', 'list active devices', 'what devices are active?', 'show active devices'.",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "list_automations",
        "description": "List all existing automations",
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "delete_automation",
        "description": "Delete an automation by ID",
        "parameters": {"type": "object", "properties": {
            "automation_id": {"type": "string", "description": "The automation ID to delete"},
        }, "required": ["automation_id"]},
    }},
    {"type": "function", "function": {
        "name": "toggle_automation",
        "description": "Enable or disable an automation",
        "parameters": {"type": "object", "properties": {
            "automation_id": {"type": "string", "description": "The automation ID"},
            "enable":         {"type": "boolean", "description": "true to enable, false to disable"},
        }, "required": ["automation_id", "enable"]},
    }},
    {"type": "function", "function": {
        "name": "update_automation",
        "description": (
            "Update any property of an existing automation or routine. "
            "Use for ANY change: rename, change trigger time, change trigger condition, "
            "change target device or room, reassign to a room, update description, etc. "
            "Only provide the fields you want to change — unspecified fields are kept as-is."
        ),
        "parameters": {"type": "object", "properties": {
            "automation_name":   {"type": "string", "description": "Name or partial name of the automation to find (required to identify it)"},
            "new_name":          {"type": "string", "description": "New name for the automation"},
            "description":       {"type": "string", "description": "New description"},
            "room":              {"type": "string", "description": f"Assign to this room. Options: {_ROOMS}. Pass empty string \"\" to unassign / remove from all rooms."},
            "trigger_type":      {"type": "string", "enum": ["time", "state", "numeric_state", "sunrise", "sunset"],
                                  "description": "Change the trigger type"},
            "trigger_time":      {"type": "string", "description": "New HH:MM for time triggers"},
            "trigger_entity_id": {"type": "string", "description": "New entity ID or room name for state/numeric_state triggers"},
            "trigger_state":     {"type": "string", "description": "New state value for state triggers"},
            "trigger_above":     {"type": "number", "description": "New above threshold for numeric_state triggers"},
            "trigger_below":     {"type": "number", "description": "New below threshold for numeric_state triggers"},
            "trigger_offset":    {"type": "string", "description": "New offset for sunrise/sunset triggers"},
            "action_room":       {"type": "string", "description": f"New room for the action. Options: {_ROOMS}"},
            "action_device_type":{"type": "string", "description": "New device type: light, ac, tv, media_player, switch"},
            "action_service":    {"type": "string", "enum": ["turn_on", "turn_off"], "description": "New action"},
        }, "required": ["automation_name"]},
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

SYSTEM_PROMPT = (
    "You are Ziggy, a smart home assistant. "
    "The user is giving a voice or text command. "
    "ALWAYS prefer to use a tool to handle the request — call the most appropriate tool rather than responding conversationally. "
    "Only skip tool calls when the user is explicitly having casual small-talk or explicitly asking for general information with no actionable command. "
    "For ANY request involving home control, scheduling, automation, tasks, reminders, files, system, or media — ALWAYS call a tool. "
    "For scheduling requests like 'every day at X', 'at 12 PM', 'automatically', 'schedule', 'create a routine', 'create an automation' — ALWAYS use create_automation. "
    "For ANY change to an existing automation or routine (rename, change time, change device, change room, reassign, update description) — ALWAYS use update_automation. "
    "In create_automation, set action_device_type='tv' for TV/television targets, 'media_player' for any media device, 'light' for lights, 'ac' for air conditioning, 'switch' for wall switches. "
    "In create_automation, use trigger_type='numeric_state' (not 'state') for threshold conditions like 'temperature above 24' or 'humidity below 60', and fill trigger_above/trigger_below accordingly. "
    "Never instruct the user to use external apps or Home Assistant UI — use Ziggy's own tools to fulfill requests directly. "
    f"Known rooms: {_ROOMS}. "
    "IR routing rules: "
    "use ir_send_command / ir_set_ac_temperature for devices without a HA entity (IR blaster only). "
    "use ir_send_channel for 'channel N' commands on IR TVs. "
    "use ir_play_sequence for named macros ('open Netflix', 'sleep mode') on IR devices. "
    "use ir_learn_command when the user wants to teach Ziggy a new IR button. "
    "use control_ac / set_ac_temperature for smart ACs with a HA climate entity. "
    "use control_tv / set_tv_source for smart TVs with a HA media_player entity. "
    "Only use chat_with_gpt if no other tool applies and the input is pure casual conversation."
    "\n\nHebrew support: The user may speak Hebrew or mix Hebrew with English. "
    "ALWAYS call the correct tool regardless of input language. "
    "Respond in the same language the user used. "
    "Hebrew action verbs: תדליק/הדלק = turn on, תכבה/כבה = turn off, "
    "הגדל/תגדיל = increase/brighten, הקטן/תקטין = decrease/dim, "
    "מה הטמפרטורה = get_temperature, מה הלחות = get_humidity, "
    "כבה הכל = turn_off_all_lights, לילה טוב = turn_off_everything. "
    "Hebrew room names are pre-normalized to English display names before this prompt arrives."
)
