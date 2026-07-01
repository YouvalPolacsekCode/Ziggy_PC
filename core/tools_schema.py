"""
OpenAI function-calling tool definitions for the Ziggy intent parser.
Extracted here so intent_parser.py stays focused on call logic only.
"""
from core.settings_loader import settings
from services.room_alias_bank import all_known_room_names

_ROOMS = ", ".join(all_known_room_names(settings.get("room_aliases", {})))


def _automation_device_types() -> str:
    """
    Build a human-readable description of all controllable device types for
    the automation tools.  Returned as a comma-separated hint string for GPT.
    """
    try:
        from services.domain_registry import DOMAIN_REGISTRY
        # Ziggy alias overrides shown first, then remaining registry domains
        aliases = {"light": "light", "climate": "ac/climate", "media_player": "tv/media_player",
                   "switch": "switch", "fan": "fan"}
        extra = [k for k in DOMAIN_REGISTRY if DOMAIN_REGISTRY[k].controllable and k not in aliases]
        parts = list(aliases.values()) + sorted(extra)
        return ", ".join(parts)
    except Exception:
        return "light, ac, tv, media_player, switch, valve, lock, cover, vacuum, alarm_control_panel"


def _automation_all_services() -> str:
    """Return all possible action services for the automation builder."""
    try:
        from services.domain_registry import DOMAIN_REGISTRY
        services = set()
        for meta in DOMAIN_REGISTRY.values():
            for action in meta.actions.values():
                services.add(action.service)
        return ", ".join(sorted(services))
    except Exception:
        return "turn_on, turn_off, open_valve, close_valve, lock, unlock"


def _build_control_device_tool() -> list[dict]:
    """
    Build the generic control_device tool from domain_registry at import time.

    Returns a list (possibly empty on error) so it can be splatted into TOOLS
    with *_build_control_device_tool() without disrupting the list literal.
    Adding a new HA domain to domain_registry automatically expands this tool.
    """
    try:
        from services.domain_registry import voice_controllable
        vc = voice_controllable()

        # Exclude domains already covered by dedicated tools so GPT doesn't
        # double-route.  Add any new dedicated-tool domain here.
        _DEDICATED = frozenset({"light", "switch", "climate", "fan", "media_player"})
        domains = sorted(k for k in vc if k not in _DEDICATED)
        if not domains:
            return []

        hints = "; ".join(
            f"{domain} ({meta.voice_hint})" for domain, meta in vc.items()
            if domain not in _DEDICATED and meta.voice_hint
        )
        return [{
            "type": "function",
            "function": {
                "name": "control_device",
                "description": (
                    "Control any smart home device not covered by a more specific tool. "
                    f"Supports: {hints}. "
                    "Use this for valves, locks, covers/blinds, alarms, vacuums, lawn mowers, "
                    "humidifiers, water heaters, and any future device type added to Ziggy."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "domain": {
                            "type": "string",
                            "enum": domains,
                            "description": "The HA domain of the device to control",
                        },
                        "action": {
                            "type": "string",
                            "description": (
                                "Natural language action: open, close, start, stop, dock, "
                                "lock, unlock, turn on, turn off, arm away, arm home, disarm, mow, pause"
                            ),
                        },
                        "room": {
                            "type": "string",
                            "description": f"Room name (optional). Options: {_ROOMS}",
                        },
                        "entity_id": {
                            "type": "string",
                            "description": "Specific HA entity ID if known (optional)",
                        },
                    },
                    "required": ["domain", "action"],
                },
            },
        }]
    except Exception:
        return []


TOOLS = [
    # ---- Lights ----
    {"type": "function", "function": {
        "name": "toggle_light",
        "description": "Turn a light on or off in a room. Call this even if the room is not specified — the handler will ask which room.",
        "parameters": {"type": "object", "properties": {
            "room":    {"type": "string", "description": f"Room name. Options: {_ROOMS}. Leave empty if the user didn't specify."},
            "turn_on": {"type": "boolean", "description": "true = on, false = off"},
        }, "required": ["turn_on"]},
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
            "Switch a TV to a specific channel number by sending IR digit codes. "
            "Use when the user says 'channel 5', 'go to channel 12', etc. "
            "Works for any TV controlled via IR blaster, including hybrid TVs that also have a HA media_player entity — "
            "use this tool for channel entry regardless of whether a media_player entity exists."
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

    # ---- Generic device control (any HA domain — auto-built from domain_registry) ----
    *_build_control_device_tool(),

    # ---- Files & Notes ----
    {"type": "function", "function": {
        "name": "save_note",
        "description": "Save a quick note or memo. Call this even when the user hasn't given the content yet — the handler will ask for it.",
        "parameters": {"type": "object", "properties": {
            "content": {"type": "string", "description": "The note content to save (leave empty if the user didn't specify)"},
            "title":   {"type": "string", "description": "Optional title for the note"},
        }, "required": []},
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
        "description": "Create a new task, to-do item, or reminder. Call this even when the task name is missing — the handler will ask for it.",
        "parameters": {"type": "object", "properties": {
            "task":     {"type": "string", "description": "The task description (leave empty if the user didn't specify)"},
            "due":      {"type": "string", "description": "Due date/time in natural language or ISO format"},
            "priority": {"type": "string", "enum": ["high", "medium", "low"]},
            "reminder": {"type": "string", "description": "When to send a reminder"},
            "repeat":   {"type": "string", "description": "Repeat frequency e.g. daily, weekly"},
        }, "required": []},
    }},
    {"type": "function", "function": {
        "name": "list_tasks",
        "description": (
            "Show all current tasks and to-do items. "
            "Use ONLY when the user explicitly asks to SEE, SHOW, or LIST their tasks. "
            "Do NOT use for 'remind me' — that is add_task. "
            "Do NOT use for 'what do I have to do' if it sounds like they want to create something."
        ),
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
        "name": "list_rooms",
        "description": (
            "List all configured rooms in the home. Use when the user asks: "
            "'what rooms do I have', 'which rooms are configured', 'what rooms are there', "
            "'show me my rooms', 'list rooms'."
        ),
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
        "description": "Read recent emails from inbox. Use 'sender' to filter by person (e.g. 'Read my latest email from John').",
        "parameters": {"type": "object", "properties": {
            "limit":       {"type": "integer", "description": "Max number of emails to return (default 5)"},
            "sender":      {"type": "string",  "description": "Filter by contact name or email address, e.g. 'John', 'maya@example.com'"},
            "unread_only": {"type": "boolean", "description": "Only return unread emails (default true)"},
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
        "description": "Send a quick message via email or WhatsApp",
        "parameters": {"type": "object", "properties": {
            "contact_name": {"type": "string"},
            "text":         {"type": "string"},
            "channel":      {"type": "string", "enum": ["email", "whatsapp"]},
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
                "enum": ["time", "state", "numeric_state", "sunrise", "sunset", "time_pattern"],
                "description": (
                    "What triggers the automation. "
                    "Use 'time' for clock-based schedules. "
                    "Use 'state' for exact entity state matches (on/off/home). "
                    "Use 'numeric_state' for numeric sensor thresholds (temperature above 24, humidity below 60). "
                    "Use 'sunrise'/'sunset' for sun-based triggers. "
                    "Use 'time_pattern' for periodic triggers (every N minutes, every N hours) — set trigger_minutes/hours/seconds."
                ),
            },
            "trigger_time":      {"type": "string", "description": "HH:MM for time triggers, e.g. '07:00'"},
            "trigger_entity_id": {"type": "string", "description": "For 'state' triggers: must be a full HA entity ID with a dot, e.g. binary_sensor.office_door, input_boolean.away_mode. For 'numeric_state' triggers: entity ID or room name (Ziggy will resolve room → sensor)."},
            "trigger_state":     {"type": "string", "description": "Exact state value for state triggers, e.g. 'on', 'home'"},
            "trigger_above":     {"type": "number", "description": "For numeric_state triggers: fire when value rises ABOVE this number (e.g. 24 for 'temp above 24')"},
            "trigger_below":     {"type": "number", "description": "For numeric_state triggers: fire when value falls BELOW this number"},
            "trigger_offset":    {"type": "string", "description": "Offset for sunrise/sunset, e.g. '+00:30:00'"},
            "trigger_for_minutes": {"type": "integer", "description": "For state triggers: how many minutes the state must hold before firing. Essential for occupancy patterns ('no motion for 5 minutes' → set to 5). Omit if the trigger should fire immediately."},
            "trigger_minutes":   {"type": "string", "description": "For time_pattern triggers: minutes interval. Use '/15' for 'every 15 minutes', '30' for 'at minute 30 of each hour'."},
            "trigger_hours":     {"type": "string", "description": "For time_pattern triggers: hours interval. Use '/2' for 'every 2 hours'."},
            "trigger_seconds":   {"type": "string", "description": "For time_pattern triggers: seconds interval. Use '/30' for 'every 30 seconds'."},
            "mode":              {"type": "string", "enum": ["single", "restart", "queued", "parallel"], "description": "What happens when a new trigger fires while the automation is still running. 'single' (default) drops new triggers. 'restart' cancels the running instance and starts fresh — use for motion-driven automations so each new motion event resets any countdown. 'queued' runs sequentially. 'parallel' runs concurrently."},
            "action_room":       {"type": "string", "description": f"Room to act on. Options: {_ROOMS}"},
            "action_device_type":{"type": "string", "description": f"Device type to act on: {_automation_device_types()}"},
            "action_entity_id":  {"type": "string", "description": "Specific HA entity ID for the action (use this instead of action_room when you know the exact entity, e.g. light.gledopto_gl_b_004p)"},
            "action_service":    {"type": "string",
                                  "description": f"HA service to call. Common: turn_on, turn_off. Device-specific: {_automation_all_services()}"},
            "conditions":        {
                "type": "array",
                "description": (
                    "Optional list of conditions that ALL must be true before the action runs. "
                    "Use for 'only if X is on', 'only when door is open', 'only when temp below 24'. "
                    "Each condition: {\"entity_id\": \"light.office_light\", \"operator\": \"is\", \"value\": \"on\"} "
                    "Operators: 'is' (state equals), 'is_not', 'above' (numeric), 'below' (numeric)."
                ),
                "items": {
                    "type": "object",
                    "properties": {
                        "entity_id": {"type": "string"},
                        "operator":  {"type": "string", "enum": ["is", "is_not", "above", "below"]},
                        "value":     {"type": "string"},
                    },
                    "required": ["entity_id", "operator", "value"],
                },
            },
        }, "required": ["trigger_type"]},
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
        "description": "Delete an automation. Call this even when the ID is not specified — the handler will ask which one.",
        "parameters": {"type": "object", "properties": {
            "automation_id": {"type": "string", "description": "The automation ID to delete (leave empty if not specified)"},
        }, "required": []},
    }},
    {"type": "function", "function": {
        "name": "toggle_automation",
        "description": "Enable or disable an automation. Call this even when the ID is not specified — the handler will ask which one.",
        "parameters": {"type": "object", "properties": {
            "automation_id": {"type": "string", "description": "The automation ID (leave empty if not specified)"},
            "enable":         {"type": "boolean", "description": "true to enable, false to disable"},
        }, "required": ["enable"]},
    }},
    {"type": "function", "function": {
        "name": "create_occupancy_sensor",
        "description": (
            "Create a room occupancy sensor that fuses multiple presence signals "
            "(motion, mmWave, door open) into a single 'is anyone in this room' entity. "
            "Use this when the user wants to make a room 'smart' — automations can then check "
            "one entity instead of repeating motion-OR-presence-OR-door logic in every rule."
        ),
        "parameters": {"type": "object", "properties": {
            "room":             {"type": "string", "description": f"Room this sensor is for. Options: {_ROOMS}"},
            "sensor_entities":  {
                "type": "array",
                "items": {"type": "string"},
                "description": (
                    "OPTIONAL. List of HA entity IDs whose 'on' state means 'someone present'. "
                    "Typically motion + presence + door, e.g. "
                    "['binary_sensor.bedroom_motion', 'binary_sensor.bedroom_presence', 'binary_sensor.bedroom_door']. "
                    "Pass these when the user names specific sensors. If the user only names the ROOM "
                    "(e.g. 'create an occupancy sensor for the kitchen'), OMIT this — call the tool with just "
                    "'room' and Ziggy will confirm which of the room's sensors to fuse in the same turn. "
                    "Never invent entity IDs to satisfy this field."
                ),
            },
            "friendly_name":    {"type": "string", "description": "Display name for the new sensor. Pass the user's preferred language verbatim (Hebrew supported, e.g. 'תפוסה - חדר שינה')."},
            "delay_off_seconds":{"type": "integer", "description": "How many seconds after all source sensors go quiet before the occupancy sensor reports clear. Damps flicker. Default 30."},
        }, "required": ["room"]},
    }},
    # ---- Ziggy Pro Mode designer (D3): outcome → multi-artifact bundle ----
    {"type": "function", "function": {
        "name": "design_automation_set",
        "description": (
            "ZIGGY PRO MODE: Use when the user describes a holistic OUTCOME for their home "
            "(not a single specific action). Triggers when they say things like 'set up smart bedroom', "
            "'make the bathroom intelligent', 'design a morning routine', 'automate the office', "
            "'תכין לי אורות חכמים בחדר השינה', 'תארגן לי שגרת בוקר'. "
            "The designer reasons over the user's actual rooms, entities, integrations, and the "
            "11 community templates to produce a complete bundle of automations + sensors + state "
            "flags + voice intents. Returns a PREVIEW the user reviews and accepts. "
            "DO NOT use this when the user has a single specific request ('turn off bedroom lights "
            "at 23:00') — use create_automation for that. DO use this for 'make my bedroom smart' "
            "even if the user might have meant just one automation — the designer can decide."
        ),
        "parameters": {"type": "object", "properties": {
            "outcome": {"type": "string", "description": "The user's outcome description, verbatim. The designer needs the original phrasing to infer scope and language."},
        }, "required": ["outcome"]},
    }},
    {"type": "function", "function": {
        "name": "apply_automation_bundle",
        "description": (
            "Execute a previously-designed bundle. Called after design_automation_set has shown "
            "a preview and the user has explicitly accepted it (e.g. 'yes create it', 'looks good, do it', "
            "'אשר', 'תיצור'). The frontend's Accept tap goes directly to the apply endpoint instead, "
            "so this tool path is for users who confirm conversationally. Pass the full bundle JSON "
            "exactly as design_automation_set returned it."
        ),
        "parameters": {"type": "object", "properties": {
            "bundle": {"type": "object", "description": "The complete bundle JSON from the most recent design_automation_set call."},
        }, "required": ["bundle"]},
    }},

    # ---- Community templates (bundled HA blueprints, surfaced as Ziggy templates) ----
    {"type": "function", "function": {
        "name": "list_blueprints",
        "description": (
            "BROWSE/DISCOVERY ONLY. List Ziggy's bundled community automation templates so the user "
            "can see what's on offer. Use ONLY when the user is browsing and has NOT named a specific "
            "template to use — e.g. 'what automations can I set up?', 'show me the templates', "
            "'what templates do you have?', 'is there a template for X?'. "
            "If the user names a specific template to USE or APPLY ('use the motion-activated light "
            "template', 'set up the bathroom light template'), do NOT call this — call instantiate_blueprint "
            "directly. "
            "Returns each template's id, name, short description, and number of inputs to fill. "
            "Never use the word 'blueprint' in your reply — call them 'templates' or 'community templates'."
        ),
        "parameters": {"type": "object", "properties": {}},
    }},
    {"type": "function", "function": {
        "name": "instantiate_blueprint",
        "description": (
            "Create an automation from a bundled community template (SINGLE-SHOT). "
            "Call this AS SOON AS the user names a template they want to use or apply — "
            "'use the motion-activated light template', 'set up the bathroom light template', "
            "'apply the AC schedule template for the bedroom'. You do NOT need to call list_blueprints "
            "first, and you do NOT need all the input values up front: pass the template id plus whatever "
            "inputs you can infer (e.g. the room), and Ziggy will ask the user for any missing required "
            "inputs in the same turn. "
            "Common template ids: 'motion_light' (motion-activated light — turns a light on with motion and "
            "off after no motion), 'ac_schedule' (AC on/off schedule), 'blinds_sunset' (blinds by sun). "
            "Israeli defaults (24°C AC, sunset-based blinds, weekday wake times) are baked in; only override "
            "when the user explicitly asks for something different. "
            "Never hallucinate entity ids — if you don't know an input value, leave it out and let Ziggy ask."
        ),
        "parameters": {"type": "object", "properties": {
            "blueprint_id": {
                "type": "string",
                "description": "Template id (e.g. 'motion_light', 'ac_schedule'). For 'the motion-activated light template' use 'motion_light'.",
            },
            "inputs": {
                "type": "object",
                "description": (
                    "OPTIONAL. Map of input key → value for inputs you already know. Keys come from the chosen "
                    "template (e.g. for motion_light: {'motion_entity': 'binary_sensor.bathroom_motion', "
                    "'light_target': 'light.bathroom', 'no_motion_wait': 120}). Values are HA entity ids, numbers, "
                    "times, or strings. Omit entirely (or pass only what you know) when the user hasn't provided "
                    "concrete values — Ziggy will prompt for the rest. Never invent entity ids to fill this."
                ),
                "additionalProperties": True,
            },
            "name": {
                "type": "string",
                "description": "Optional custom name for the created automation. Omit to use the template's default name.",
            },
        }, "required": ["blueprint_id"]},
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
            "trigger_type":      {"type": "string", "enum": ["time", "state", "numeric_state", "sunrise", "sunset", "time_pattern"],
                                  "description": "Change the trigger type"},
            "trigger_time":      {"type": "string", "description": "New HH:MM for time triggers"},
            "trigger_entity_id": {"type": "string", "description": "New entity ID or room name for state/numeric_state triggers"},
            "trigger_state":     {"type": "string", "description": "New state value for state triggers"},
            "trigger_above":     {"type": "number", "description": "New above threshold for numeric_state triggers"},
            "trigger_below":     {"type": "number", "description": "New below threshold for numeric_state triggers"},
            "trigger_offset":    {"type": "string", "description": "New offset for sunrise/sunset triggers"},
            "trigger_for_minutes": {"type": "integer", "description": "For state triggers: how many minutes the state must hold before firing. Set to 0 or omit to fire immediately."},
            "mode":              {"type": "string", "enum": ["single", "restart", "queued", "parallel"], "description": "Change how concurrent triggers are handled. Same semantics as in create_automation."},
            "action_room":       {"type": "string", "description": f"New room for the action. Options: {_ROOMS}"},
            "action_device_type":{"type": "string", "description": f"New device type: {_automation_device_types()}"},
            "action_service":    {"type": "string", "description": f"New HA service: {_automation_all_services()}"},
        }, "required": ["automation_name"]},
    }},

    # ---- Anomalies ----
    {"type": "function", "function": {
        "name": "get_active_anomalies",
        "description": (
            "Get all currently active smart home anomalies and alerts. "
            "Use when the user asks 'anything I should know?', 'any alerts?', "
            "'what anomalies are there?', or 'is everything OK at home?'"
        ),
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

    # ---- Debug mode ----
    {"type": "function", "function": {
        "name": "debug_mode",
        "description": (
            "Control Ziggy's debug mode or query recent debug info. "
            "Use when the user wants to: enable/disable debug, set debug level, "
            "check what scope to debug, see why something failed, see recent decisions, "
            "show debug logs, or explain the last action."
        ),
        "parameters": {"type": "object", "properties": {
            "action": {
                "type": "string",
                "enum": ["enable", "disable", "set_level", "show_failures", "show_recent", "explain_last", "status"],
                "description": (
                    "enable=turn on verbose debug, disable=turn off, "
                    "set_level=set a specific level (basic/verbose/trace), "
                    "show_failures=list recent failed actions, "
                    "show_recent=show last N debug events, "
                    "explain_last=explain the most recent action result, "
                    "status=show current debug config"
                ),
            },
            "level": {
                "type": "string",
                "enum": ["off", "basic", "verbose", "trace"],
                "description": "Debug level to set (only used with set_level action)",
            },
            "scope": {
                "type": "string",
                "description": "Optional scope filter: intent, ha, ir, automation, sensor, presence",
            },
            "limit": {
                "type": "integer",
                "description": "How many events to show (default 10)",
            },
        }, "required": ["action"]},
    }},
]

SYSTEM_PROMPT = (
    "You are Ziggy, a smart home assistant. "
    "The user is giving a voice or text command. "

    # ── Confidence gate (most important rule) ──────────────────────────────────
    "CONFIDENCE GATE: Only call a tool when you are CLEARLY confident the user "
    "intends that specific action. A request must be unambiguous and actionable "
    "to warrant a tool call. "
    "DO NOT call any tool if: the input is nonsense, random characters, poetic, "
    "metaphorical, humorous, impossible, or clearly not a real home-automation command. "
    "DO NOT guess or hallucinate — if a required parameter (room, device, time, task name) "
    "is completely absent and cannot be inferred from conversation context, do NOT call the tool. "
    "When in doubt, skip tool calls and let the input fall through as unrecognized. "

    # ── Clear-command routing ──────────────────────────────────────────────────
    "When the user's intent IS clear, prefer using a tool over a conversational reply. "
    "For clear home-control, scheduling, automation, tasks, reminders, files, system, "
    "or media commands — call the most appropriate tool. "

    # ── Multi-device rule ──────────────────────────────────────────────────────
    "MULTI-DEVICE RULE: When a command targets multiple individual devices (e.g. 'turn on all lights', "
    "'turn them back on' after a bulk off, 'turn on office and bedroom lights'), issue ONE tool call per device "
    "using the specific per-room tool (e.g. toggle_light). Do NOT invent a new combined tool. "
    "Use the known rooms list and conversation context to determine which devices to include. "

    # ── Ziggy Pro Mode (outcome-shaped requests) ──────────────────────────────
    "ZIGGY PRO MODE: For HOLISTIC outcome requests where the user describes WHAT they want their "
    "home to do (not a single specific action), call design_automation_set. "
    "EN triggers — any of these phrasings: "
    "'set up smart <room>', 'make <room> smart', 'make <room> intelligent', 'automate the <room>', "
    "'design a <morning|evening|night|away> routine', 'design something for <room>', "
    "'I want my <room> to ...', 'I want <thing> to happen automatically when ...', "
    "'set up <room> with smart behavior', 'help me automate ...', 'organize <room> automations'. "
    "HE triggers — any of: "
    "'תכין לי <חדר> חכם', 'תכין לי שגרת ...', 'תעשה את <חדר> חכם', 'תעשה אוטומציה ל...', "
    "'תארגן לי <חדר>', 'הפוך את <חדר> לחכם', 'אני רוצה ש<חדר> ...', 'תגדיר לי <חדר> חכם', "
    "'תעשה אוטומציה ל<חדר> — <תיאור>' (with descriptive details after a dash). "
    "IMPORTANT for HE 'תעשה אוטומציה': even when the user adds specific outcome details like "
    "'אורות נדלקים כשמזהים תנועה' (lights turn on when motion detected), this is still an "
    "OUTCOME describing WHAT THEY WANT — design_automation_set figures out the entities from "
    "home context. Do NOT fall to create_automation expecting entity_ids. "
    "TIE-BREAKER: when an outcome COULD be fulfilled by a single specialized tool (toggle_light, "
    "create_occupancy_sensor, create_automation, instantiate_blueprint) BUT the user described WHAT THEY "
    "WANT THE HOME TO DO rather than WHAT SPECIFIC ARTIFACT TO CREATE, prefer design_automation_set. "
    "The user will see a preview before anything is created, so erring toward Pro Mode is safe. "
    "Examples of the tie-breaker: "
    "  'make the kitchen smart' → design_automation_set (NOT create_occupancy_sensor), "
    "  'automate bedroom lights' → design_automation_set (NOT create_automation), "
    "  'תעשה אוטומציה לסלון' → design_automation_set. "
    "Only use the specialized tool when the user is VERY explicit about a single artifact: "
    "  'create an occupancy sensor in the kitchen' → create_occupancy_sensor (explicit primitive), "
    "  'turn off bedroom lights at 23:00' → create_automation (explicit single trigger+action). "
    "design_automation_set returns a PREVIEW the user reviews; nothing is created until they accept. "

    # ── Occupancy sensor (explicit primitive) ──────────────────────────────────
    "OCCUPANCY SENSOR: When the user EXPLICITLY asks to create an occupancy/presence sensor for a room "
    "('create an occupancy sensor for the kitchen', 'add a presence sensor for the office', "
    "'תוסיף חיישן תפוסה למטבח'), call create_occupancy_sensor with just the room. Do NOT require the user "
    "to name sensor entities and do NOT fall through to unrecognized — Ziggy asks which sensors to fuse in "
    "the same turn. This is distinct from 'make the kitchen smart' (that stays design_automation_set). "

    # ── Templates: browse vs. use ──────────────────────────────────────────────
    "TEMPLATES ROUTING: Distinguish BROWSING from USING a template. "
    "If the user is browsing ('what templates are there?', 'show me the templates'), call list_blueprints. "
    "If the user names a SPECIFIC template to use or apply ('use the motion-activated light template', "
    "'set up the bathroom light template', 'apply the AC schedule template for the bedroom', "
    "'תשתמש בתבנית של אור לפי תנועה'), call instantiate_blueprint DIRECTLY (single-shot) — do NOT call "
    "list_blueprints first. Pass the template id (e.g. 'motion_light' for the motion-activated light template) "
    "and any inputs you can infer; Ziggy asks the user for the remaining required inputs in the same turn. "

    # ── Automation / routine routing ───────────────────────────────────────────
    "For scheduling requests like 'every day at X', 'at 12 PM', 'automatically', 'schedule', "
    "'create a routine', 'create an automation' — use create_automation ONLY if a room AND "
    "device type can be clearly identified from the request or conversation context. "
    "If the user says 'create an automation' or 'create a routine' with no device/room details, "
    "do NOT call create_automation — fall through as unrecognized so the user is prompted for details. "
    "For ANY change to an existing automation or routine (rename, change time, change device, "
    "change room, reassign, update description) — ALWAYS use update_automation. "
    "In create_automation, set action_device_type='tv' for TV/television targets, 'media_player' "
    "for any media device, 'light' for lights, 'ac' for air conditioning, 'switch' for wall switches. "
    "In create_automation, use trigger_type='numeric_state' (not 'state') for threshold conditions "
    "like 'temperature above 24' or 'humidity below 60', and fill trigger_above/trigger_below accordingly. "

    "Never instruct the user to use external apps or Home Assistant UI — use Ziggy's own tools to fulfill requests directly. "
    f"Known rooms: {_ROOMS}. "

    # ── IR routing rules ───────────────────────────────────────────────────────
    "IR routing rules: "
    "use ir_send_command / ir_set_ac_temperature for devices without a HA entity (IR blaster only). "
    "use ir_send_channel for 'channel N' commands on IR TVs. "
    "use ir_play_sequence for named macros ('open Netflix', 'sleep mode') on IR devices. "
    "use ir_learn_command when the user wants to teach Ziggy a new IR button. "
    "use control_ac / set_ac_temperature for smart ACs with a HA climate entity. "
    "use control_tv / set_tv_source for smart TVs with a HA media_player entity. "
    "use control_device for any device type not covered above: valve, lock, cover, alarm, vacuum, lawn_mower, humidifier, water_heater. "
    "Only use chat_with_gpt if no other tool applies and the input is pure casual conversation."

    # ── Hebrew support ─────────────────────────────────────────────────────────
    "\n\nHebrew support: The user may speak Hebrew or mix Hebrew with English. "
    "Apply the same confidence gate to Hebrew input — do NOT call tools for Hebrew nonsense or gibberish. "
    "ALWAYS call the correct tool regardless of input language when intent is clear. "
    "Respond in the same language the user used. "

    "Hebrew action verbs: תדליק/הדלק = turn on, תכבה/כבה = turn off, "
    "הגדל/תגדיל = increase/brighten, הקטן/תקטין = decrease/dim, "
    "הגדר/תגדיר = set, כוון/תכוון = adjust, "
    "פתח/תפתח = open, סגור/תסגור = close, "
    "הוסף = add, מחק = delete, עצור = stop, הפעל = activate. "

    "Hebrew device types: אור/תאורה = light, מזגן/מיזוג = AC, "
    "טלוויזיה = TV, מאוורר = fan, "
    "תריסים/תריס = blinds/cover, מנעול = lock, חיישן = sensor. "

    "Hebrew queries: מה הטמפרטורה = get_temperature, מה הלחות = get_humidity, "
    "מה הסטטוס / מה מצב הבית = ziggy_status, מי בבית = is_someone_home, "
    "מה השעה = get_time, מה התאריך = get_date, "
    "כבה הכל = turn_off_all_lights, לילה טוב = turn_off_everything. "

    "Mixed Hebrew-English commands are valid — treat English device names or entity IDs as-is "
    "and interpret the Hebrew part for action and room context. "
    "Example: 'תדליק את office light' → toggle_light(room=office, turn_on=true). "
    "Example: 'Ziggy תכבה את האור במטבח' → toggle_light(room=kitchen, turn_on=false). "
    "Example: 'המזגן בסלון על 24 מעלות' → set_ac_temperature(room=living_room, temperature=24). "
    "Example: 'תוסיף task למחר ב-10:30' → add_task with due time 10:30 tomorrow. "
    "Example: 'החיישן binary_sensor.office_motion לא מגיב' → treat as a status question about that entity. "

    "Hebrew room names are pre-normalized to English display names before this prompt arrives. "
    "Hebrew device type words may also be pre-normalized to English equivalents."
)
