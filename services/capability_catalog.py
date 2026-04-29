"""
Static registry of all Ziggy capabilities that can be instantiated as virtual devices.

Each param in params_schema has a `param_type`:
  "config"  — set once when creating the device (which device, which service, which contact).
              Stored as default_params. Shown in the Add Device wizard.
  "runtime" — changes every invocation (what to search, what movie, what to say).
              NOT shown in wizard. Provided by voice at runtime, or pre-set in an automation step,
              or prompted when manually triggering from the UI.
"""
from __future__ import annotations

CAPABILITY_CATALOG: dict[str, dict] = {

    # ── Media ─────────────────────────────────────────────────────────────────
    "media_stream_youtube": {
        "name": "YouTube Player",
        "category": "media",
        "icon": "📺",
        "description": "Cast a YouTube video or search query to a screen",
        "params_schema": {
            "device_hint": {
                "type": "string", "label": "Target device",
                "required": True, "param_type": "config", "input_mode": "media_select",
            },
            "input_text": {
                "type": "string", "label": "Search query or YouTube URL",
                "param_type": "runtime",
                "placeholder": "e.g. Pink Floyd Dark Side of the Moon",
            },
        },
    },
    "media_spotify_playlist": {
        "name": "Spotify Player",
        "category": "media",
        "icon": "🎵",
        "description": "Play a Spotify playlist, album or artist on a speaker",
        "params_schema": {
            "device_hint": {
                "type": "string", "label": "Target speaker",
                "required": True, "param_type": "config", "input_mode": "media_select",
            },
            "target": {
                "type": "string", "label": "Playlist / album / artist",
                "param_type": "runtime",
                "placeholder": "e.g. Morning Playlist",
            },
        },
    },
    "media_start_movie_in_app": {
        "name": "Movie Launcher",
        "category": "media",
        "icon": "🎬",
        "description": "Launch a movie or show in a streaming app",
        "params_schema": {
            "device_hint": {
                "type": "string", "label": "Target device",
                "required": True, "param_type": "config", "input_mode": "media_select",
            },
            "app": {
                "type": "string", "label": "Streaming app (Netflix, Prime Video, Disney+…)",
                "required": True, "param_type": "config",
            },
            "title": {
                "type": "string", "label": "Movie or show title",
                "param_type": "runtime",
                "placeholder": "e.g. The Dark Knight",
            },
        },
    },
    "media_cast_camera_live": {
        "name": "Camera Feed",
        "category": "media",
        "icon": "📷",
        "description": "Show a live security camera feed on a screen",
        "params_schema": {
            "camera_name": {
                "type": "string", "label": "Camera",
                "required": True, "param_type": "config", "input_mode": "camera_select",
            },
            "device_hint": {
                "type": "string", "label": "Target screen",
                "param_type": "config", "input_mode": "media_select",
            },
        },
    },
    "media_play_podcast_episode": {
        "name": "Podcast Player",
        "category": "media",
        "icon": "🎙️",
        "description": "Play a podcast episode on a speaker",
        "params_schema": {
            "device_hint": {
                "type": "string", "label": "Target speaker",
                "required": True, "param_type": "config", "input_mode": "media_select",
            },
            "podcast_name": {
                "type": "string", "label": "Podcast show name",
                "param_type": "runtime",
                "placeholder": "e.g. Lex Fridman Podcast",
            },
            "episode_hint": {
                "type": "string", "label": "Episode keyword (optional)",
                "param_type": "runtime",
            },
        },
    },

    # ── Web ───────────────────────────────────────────────────────────────────
    "web_recipe_read": {
        "name": "Recipe Reader",
        "category": "web",
        "icon": "🍳",
        "description": "Find and read a recipe by dish name or URL",
        "params_schema": {
            "device_hint": {
                "type": "string", "label": "Target device",
                "param_type": "config", "input_mode": "media_select",
            },
            "input_text": {
                "type": "string", "label": "Dish name or recipe URL",
                "param_type": "runtime",
                "placeholder": "e.g. pasta carbonara",
            },
        },
    },
    "web_news_brief": {
        "name": "News Brief",
        "category": "web",
        "icon": "📰",
        "description": "Read out the latest news headlines",
        "params_schema": {
            "device_hint": {
                "type": "string", "label": "Target device",
                "param_type": "config", "input_mode": "media_select",
            },
            "voice": {
                "type": "boolean", "label": "Format for voice", "default": True,
                "param_type": "config",
            },
        },
    },
    "web_trip_updates": {
        "name": "Trip Updates",
        "category": "web",
        "icon": "🗺️",
        "description": "Get weather and travel info for a city",
        "params_schema": {
            "city_or_route": {
                "type": "string", "label": "City (e.g. Tel Aviv)",
                "required": True, "param_type": "config",
            },
        },
    },
    "web_stocks_update": {
        "name": "Stock Ticker",
        "category": "web",
        "icon": "📈",
        "description": "Get stock prices for your chosen tickers",
        "params_schema": {
            "tickers": {
                "type": "string", "label": "Tickers (comma-separated, e.g. AAPL, TSLA)",
                "required": True, "param_type": "config",
            },
            "device_hint": {
                "type": "string", "label": "Target device",
                "param_type": "config", "input_mode": "media_select",
            },
        },
    },
    "web_search_summary": {
        "name": "Web Search",
        "category": "web",
        "icon": "🔍",
        "description": "Search the web and get a summarised answer",
        "params_schema": {
            "device_hint": {
                "type": "string", "label": "Target device",
                "param_type": "config", "input_mode": "media_select",
            },
            "query": {
                "type": "string", "label": "Search query",
                "param_type": "runtime",
                "placeholder": "e.g. What is the capital of France?",
            },
        },
    },
    "get_weather": {
        "name": "Weather",
        "category": "web",
        "icon": "⛅",
        "description": "Get current weather for a configured city",
        "params_schema": {
            "city": {
                "type": "string", "label": "City name (e.g. Tel Aviv)",
                "required": True, "param_type": "config",
            },
        },
    },

    # ── Communication ─────────────────────────────────────────────────────────
    "comm_read_emails": {
        "name": "Email Reader",
        "category": "communication",
        "icon": "📧",
        "description": "Read latest unread emails from Gmail",
        "params_schema": {
            "limit": {
                "type": "number", "label": "Max emails to read", "default": 5,
                "param_type": "config",
            },
        },
    },
    "comm_send_email": {
        "name": "Email Sender",
        "category": "communication",
        "icon": "✉️",
        "description": "Send an email to a configured contact",
        "params_schema": {
            "name": {
                "type": "string", "label": "Recipient (from contacts in settings)",
                "required": True, "param_type": "config",
            },
            "subject": {
                "type": "string", "label": "Subject",
                "param_type": "runtime",
                "placeholder": "e.g. Quick update",
            },
            "body": {
                "type": "string", "label": "Message body",
                "param_type": "runtime",
            },
        },
    },
    "comm_quick_message": {
        "name": "Quick Message",
        "category": "communication",
        "icon": "💬",
        "description": "Send a message to a contact via Telegram or WhatsApp",
        "params_schema": {
            "contact_name": {
                "type": "string", "label": "Contact name",
                "required": True, "param_type": "config",
            },
            "channel": {
                "type": "select", "label": "Channel", "options": ["telegram", "whatsapp"],
                "default": "telegram", "param_type": "config",
            },
            "text": {
                "type": "string", "label": "Message text",
                "param_type": "runtime",
                "placeholder": "e.g. On my way home",
            },
        },
    },
    "comm_broadcast_announcement": {
        "name": "House Announcement",
        "category": "communication",
        "icon": "📣",
        "description": "Broadcast a spoken announcement to one or all rooms",
        "params_schema": {
            "rooms_or_all": {
                "type": "string", "label": "Room name or 'all'", "default": "all",
                "param_type": "config",
            },
            "text": {
                "type": "string", "label": "Announcement text",
                "param_type": "runtime",
                "placeholder": "e.g. Dinner is ready!",
            },
        },
    },
    "comm_read_sms": {
        "name": "SMS Reader",
        "category": "communication",
        "icon": "💬",
        "description": "Read recent SMS text messages (requires Twilio or Android Companion)",
        "params_schema": {
            "limit": {
                "type": "number", "label": "Max messages to read", "default": 5,
                "param_type": "config",
            },
        },
    },

    # ── Visual / Display ──────────────────────────────────────────────────────
    "visual_cast_album": {
        "name": "Photo Album",
        "category": "visual",
        "icon": "🖼️",
        "description": "Show a photo album slideshow on a screen",
        "params_schema": {
            "source": {
                "type": "select", "label": "Source", "options": ["local", "google_photos"],
                "default": "local", "param_type": "config",
            },
            "device_hint": {
                "type": "string", "label": "Target screen",
                "param_type": "config", "input_mode": "media_select",
            },
            "album_name": {
                "type": "string", "label": "Album name or keyword",
                "param_type": "runtime",
                "placeholder": "e.g. vacation 2024",
            },
        },
    },
    "visual_cast_calendar": {
        "name": "Calendar Display",
        "category": "visual",
        "icon": "📅",
        "description": "Show today's calendar on a screen",
        "params_schema": {
            "device_hint": {
                "type": "string", "label": "Target screen",
                "param_type": "config", "input_mode": "media_select",
            },
        },
    },
    "visual_cast_camera": {
        "name": "Security Camera",
        "category": "visual",
        "icon": "🔒",
        "description": "Display a security camera feed on a screen",
        "params_schema": {
            "camera_name": {
                "type": "string", "label": "Camera",
                "required": True, "param_type": "config", "input_mode": "camera_select",
            },
            "device_hint": {
                "type": "string", "label": "Target screen",
                "param_type": "config", "input_mode": "media_select",
            },
        },
    },
    "visual_image_slideshow": {
        "name": "Image Slideshow",
        "category": "visual",
        "icon": "🎞️",
        "description": "Play a slideshow from a local photos folder",
        "params_schema": {
            "device_hint": {
                "type": "string", "label": "Target screen",
                "param_type": "config", "input_mode": "media_select",
            },
            "duration": {
                "type": "number", "label": "Seconds per image", "default": 5,
                "param_type": "config",
            },
            "criteria_or_folder": {
                "type": "string", "label": "Folder name or keyword filter",
                "param_type": "runtime",
                "placeholder": "e.g. kids",
            },
        },
    },

    # ── Reference ─────────────────────────────────────────────────────────────
    "ref_read_note_or_file": {
        "name": "Note/File Reader",
        "category": "reference",
        "icon": "📄",
        "description": "Find and read a saved note or file",
        "params_schema": {
            "device_hint": {
                "type": "string", "label": "Target device",
                "param_type": "config", "input_mode": "media_select",
            },
            "query": {
                "type": "string", "label": "File name or keyword",
                "param_type": "runtime",
                "placeholder": "e.g. shopping list",
            },
        },
    },
    "ref_show_grocery": {
        "name": "Grocery List",
        "category": "reference",
        "icon": "🛒",
        "description": "Show the grocery or shopping list",
        "params_schema": {
            "device_hint": {
                "type": "string", "label": "Target device",
                "param_type": "config", "input_mode": "media_select",
            },
        },
    },
    "ref_search_history_or_memory": {
        "name": "History Search",
        "category": "reference",
        "icon": "🔎",
        "description": "Search past commands or memory for a keyword",
        "params_schema": {
            "device_hint": {
                "type": "string", "label": "Target device",
                "param_type": "config", "input_mode": "media_select",
            },
            "keyword": {
                "type": "string", "label": "Search keyword",
                "param_type": "runtime",
                "placeholder": "e.g. recipe",
            },
        },
    },
    "ref_read_saved_recipe": {
        "name": "Saved Recipe",
        "category": "reference",
        "icon": "📋",
        "description": "Read cooking instructions from a saved recipe note",
        "params_schema": {
            "device_hint": {
                "type": "string", "label": "Target device",
                "param_type": "config", "input_mode": "media_select",
            },
            "meal_name": {
                "type": "string", "label": "Meal name",
                "param_type": "runtime",
                "placeholder": "e.g. carbonara",
            },
        },
    },

    # ── Tasks ─────────────────────────────────────────────────────────────────
    "add_task": {
        "name": "Add Task",
        "category": "tasks",
        "icon": "✅",
        "description": "Create a new task or reminder",
        "params_schema": {
            "priority": {
                "type": "select", "label": "Default priority",
                "options": ["high", "medium", "low"], "default": "medium",
                "param_type": "config",
            },
            "task": {
                "type": "string", "label": "Task description",
                "param_type": "runtime",
                "placeholder": "e.g. Call the dentist",
            },
            "due": {
                "type": "string", "label": "Due date (natural language)",
                "param_type": "runtime",
                "placeholder": "e.g. tomorrow at 3pm",
            },
        },
    },

    # ── System ────────────────────────────────────────────────────────────────
    "get_system_status": {
        "name": "System Status",
        "category": "system",
        "icon": "🖥️",
        "description": "Read out CPU, RAM and uptime",
        "params_schema": {},
    },
}

CATEGORIES: list[dict] = [
    {"id": "media",         "label": "Media & Streaming",  "icon": "📺"},
    {"id": "web",           "label": "Web & Online",        "icon": "🌐"},
    {"id": "communication", "label": "Communication",       "icon": "📧"},
    {"id": "visual",        "label": "Visual & Display",    "icon": "🖼️"},
    {"id": "reference",     "label": "Reference",           "icon": "📄"},
    {"id": "tasks",         "label": "Tasks",               "icon": "✅"},
    {"id": "system",        "label": "System",              "icon": "🖥️"},
]


def get_catalog() -> list[dict]:
    return [{"id": cap_id, **meta} for cap_id, meta in CAPABILITY_CATALOG.items()]


def get_capability(cap_id: str) -> dict | None:
    return CAPABILITY_CATALOG.get(cap_id)
