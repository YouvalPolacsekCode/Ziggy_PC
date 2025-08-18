import re
import openai
import json
from core.settings_loader import settings
from core.memory import list_memory
from core.task_file import load_task_json

openai.api_key = settings["openai"]["api_key"]

def normalize_room(params: dict) -> dict:
    if "location" in params and "room" not in params:
        params["room"] = params.pop("location")
    if "area" in params and "room" not in params:
        params["room"] = params.pop("area")
    return params

TRIGGER_PHRASE = "ziggy do"

# ---------- Safer Web Q&A routing guard (define ABOVE the patterns list) ----------
_LOCAL_NEG = r"(light|lamp|bulb|ac|air ?con|climate|hvac|tv|television|source|hdmi|task|todo|reminder|note|memory|wifi|network|ip|disk|adapter|ziggy|camera|album|slideshow|calendar|ping)"

INTENT_PATTERNS = [
    # ---------------- Memory ----------------
    (r"(remember|save|store|note|log|record|memorize|keep|retain|jot|take note|write down|stash|bookmark) (that )?.*", "remember_memory"),  # Remember memory entry
    (r"(what did i say|what have i said|what did i tell you|what have i told you|do you remember|what do you remember|recall|retrieve|bring up|look up|remind me|show me what you remember) (about|regarding|concerning|on|for)? .*", "recall_memory"),  # Recall memory entry
    (r"(delete|remove|clear|forget|discard|wipe|erase|purge|drop|clear out|trash) (memory|fact|note|info|entry|record|item)?(s)?( for| about)? .*", "delete_memory"),  # Delete memory entry

    # ---------------- Tasks ----------------
    (r"(add|set|schedule|insert|create|plan|log|record|track|make|start|open) (a )?(task|todo|to-?do|reminder|item)", "add_task"),  # Add task
    (r"(remove|delete|cancel|discard|erase|clear|eliminate|forget|drop) (a )?(task|todo|to-?do|reminder|item)", "remove_task"),  # Remove task
    (r"(delete|remove|clear|wipe|empty|purge) (all )?(tasks|todos|to-?dos|reminders|items)", "remove_tasks"),  # Remove all tasks
    (r"(delete|remove|clear|wipe|drop) (the )?(last|previous|most recent) (task|todo|to-?do|reminder|item)", "remove_last_task"),  # Remove last task
    (r"(list|show|display|view|see|get|check|read|review|what('?| )?s on) (my )?(tasks|todos|to-?dos|reminders|list)", "list_tasks"),  # List tasks
    (r"(mark|complete|finish|check off|resolve|end|close|finalize|done|set as done) (task|todo|to-?do|reminder)", "mark_task_done"),  # Mark task done

    # ---------------- Lights ----------------
    (r"(turn|switch|activate|deactivate|power|toggle|start|stop|kill|enable|disable).* (light|lights|lamp|lamps|bulb|bulbs|lighting)", "toggle_light"),  # Toggle light
    (r"(set|change|make|adjust|modify|tune|select|define|shift|switch).* (light|lights|lamp|lamps|bulb|bulbs|lighting).*(color|to|shade|hue|tone|style|look)", "set_light_color"),  # Set light color
    (r"(dim|brighten|increase|decrease|raise|lower|adjust|tweak|modify|reduce|boost).* (light|lights|lamp|lamps|bulb|bulbs|lighting)", "adjust_light_brightness"),  # Adjust light brightness

    # ---------------- AC / Climate ----------------
    (r"(turn|switch|start|power|activate|enable|boot|launch|toggle).* (ac|a/c|air ?con(ditioner)?|climate|hvac|thermostat)", "control_ac"),  # Control AC
    (r"(set|put|adjust|change|define|tune|program|configure).* (ac|a/c|air ?con(ditioner)?|climate|hvac|thermostat).*(?P<temperature>\d+)", "set_ac_temperature"),  # Set AC temperature
    (r"\b(what('?| is)?|what's|tell me|show|get)\b.*\b(temp(erature)?|how (hot|cold))\b.*\b(in|at)\b.*", "get_temperature"),
    (r"\b(what('?| is)?|what's|tell me|show|get)\b.*\b(humidity|how humid)\b.*\b(in|at)\b.*", "get_humidity"),

    # ---------------- TV ----------------
    (r"(turn|switch|start|stop|power|activate|enable|launch|toggle).* (tv|television|screen|display)", "control_tv"),  # Control TV
    # 1) Generic “set tv source …” (we’ll extract the value with a helper)
    (r"\b(set|change|adjust|switch|select|define|update|modify|put)\b.*\b(tv|television|screen|display)\b.*\b(source|input)\b", "set_tv_source"),
    # 2) Common phrasing that already includes the value after "to"
    (r"\b(set|change|adjust|switch|select|define|update|modify|put)\b.*\b(tv|television|screen|display)\b.*\b(source|input)\b\s*(to|=)?\s*(?P<tvsrc>(hdmi[\s\-]*\d+|\d+|netflix|netfilx|youtube|yt|prime(?: video)?|disney(?:\+| plus)?|apple tv|hbo|max|hulu|paramount\+?|peacock|youtube tv))\b", "set_tv_source"),

    # ---------------- Ziggy System Control ----------------
    (r"(restart|reboot|reload|reset|refresh|reinitialize|cycle|relaunch|kick|bounce).* (ziggy|assistant|service|app)", "restart_ziggy"),  # Restart Ziggy
    (r"(shutdown|power down|turn off|kill|halt|deactivate|stop|exit|quit|close).* (ziggy|assistant|service|app)", "shutdown_ziggy"),  # Shutdown Ziggy

    # ---------------- Date & Time ----------------
    (r"(what day is it|tell me the day|which day is it|day of the week|what weekday is it|current day|today('?| )?s day|day today)", "get_day_of_week"),  # Get day of week
    (r"(what(\\'?s| is|\\u2019s|s the| time is| does the clock say| tell me the time| current time| time now| clock time| give me the time| what time))", "get_time"),  # Get time
    (r"(what(\\'?s| is|\\u2019s|s the| date is| calendar date| current date| what date| today('?| )?s date))", "get_date"),  # Get date

    # ---------------- Ziggy Info ----------------
    (r"(how are you|how do you feel|what’s up|how’s it going|status|are you ok|mood check|your mood|how are things|how do you feel today)", "ziggy_status"),  # Ziggy status/mood
    (r"(who are you|what are you|identify yourself|your name|introduce yourself|what is ziggy|who is ziggy|tell me about yourself|what do i call you)", "ziggy_identity"),  # Ziggy identity
    (r"(what can you do|what do you support|what are your abilities|your features|available commands|capabilities|help options|how can you help|what commands do you understand)", "ziggy_help"),  # Ziggy help/abilities
    (r"(tell|say|show|share|give|suggest|read|speak|entertain me|fun fact|something fun|joke|random fact).* (fun|joke|fact)?", "ziggy_chat"),  # Fun/chat mode

    # ---------------- System Info ----------------
    (r"(what('|’)?s|show|status|how is|check|report).* (system|machine|host|server|computer|status|health|diagnostics?)", "get_system_status"),  # Get system status
    (r"(ip address|what('|’)?s my ip|my network|my ip address|ip info|external ip|public ip|local ip)", "get_ip_address"),  # Get IP address
    (r"(disk usage|space left|storage left|available disk|free disk|how much space|disk space|storage usage|drive space)", "get_disk_usage"),  # Get disk usage
    (r"(wifi status|check wifi|is wifi up|wifi info|my wifi|internet status|network up|online status|connectivity)", "get_wifi_status"),  # Get Wi-Fi status
    (r"(network adapters|list adapters|show interfaces|network interfaces|my adapters|ethernet info|nic list|interfaces list)", "get_network_adapters"),  # Get network adapters
    #(r"(ping|check|test|lookup|probe|latency test) (?P<domain>\S+)", "ping_test"),  # Ping test

    # ---------------- Media ----------------
    (r"\b(stream|cast|play|send|put on|throw|beam|watch|open|start|resume)\b.*\b(youtube|yt|video|clip|link)\b", "media_stream_youtube"),  # Stream YouTube
    (r"\b(play|start|put on|resume|queue|shuffle|mix)\b.*\b(spotify|playlist|album|artist|track|song|music)\b", "media_spotify_playlist"),  # Play Spotify
    (r"\b(start|play|open|launch|watch|resume|continue)\b.*\b(movie|film|show|episode|series|season)\b.*\b(netflix|prime(?: video)?|disney(?:\+| plus)?|apple tv|hbo|max|hulu|paramount|peacock|youtube tv)\b", "media_start_movie_in_app"),  # Play movie/show in app
    (r"\b(cast|show|display|play|stream|view|put|open)\b.*\b(camera|cam|doorbell|security|cctv|live|feed|stream)\b", "media_cast_camera_live"),  # Cast live camera
    (r"\b(play|start|resume|continue|listen(?: to)?|queue|put on)\b.*\b(podcast|episode|show)\b", "media_play_podcast_episode"),  # Play podcast episode

    # ---------------- Web & Online Content ----------------
    (r"\b(read|show|open|display|summarize|speak|walk me through|tell me|go through|explain)\b.*\b(recipe|ingredients|cooking|instructions)\b", "web_recipe_read"),  # Read recipe
    (r"\b(news|headlines|brief|update|summary|bulletin|what('?| )?s happening|top stories|latest|catch me up)\b", "web_news_brief"),  # News brief
    (r"\b(trip|travel|route|flight|itinerary|traffic|commute|drive to|train|bus|travel update|road conditions|delays|weather)\b.*", "web_trip_updates"),  # Trip updates
    (r"\b(stocks?|stock market|market|quote|price|ticker|portfolio|share price|equities|indices?)\b.*", "web_stocks_update"),  # Stocks update
    (r"\b(search|google|lookup|find info|web|internet|look up|research|dig up|what does the web say)\b.*", "web_search_summary"),  # Web search

    # 1) Question form (ends with ?) and not about local stuff
    (rf"^(?!.*\b{_LOCAL_NEG}\b).*\?\s*$", "web_search_summary"),

    # 2) Interrogatives at start, but not local
    (rf"^(?!.*\b{_LOCAL_NEG}\b)\s*(who|what|when|where|which|whom|whose|how)\b.*", "web_search_summary"),

    # 3) “Tell me about …” or “Explain …” / “What’s the story on …” (not local)
    (rf"^(?!.*\b{_LOCAL_NEG}\b)\s*(tell me about|explain|give me info on|what'?s the story on)\b.*", "web_search_summary"),

    # 4) News brief phrasing (explicit) — safer than “current/latest” alone
    (r"^(top|latest|current)\s+(news|headlines|stories|updates?)\b.*", "web_news_brief"),
    (r".*\b(news brief|news summary|catch me up)\b.*", "web_news_brief"),

    # ---------------- Communication ----------------
    (r"\b(read|check|show|get|list|fetch|what('?| )?s in|scan|summarize)\b.*\b(email|emails|inbox|mail|gmail|outlook|messages)\b", "comm_read_emails"),  # Read emails
    (r"\b(send|email|mail|compose|draft|shoot|fire off)\b.*\b(email|message|mail)\b", "comm_send_email"),  # Send email
    (r"\b(message|send|dm|text|ping|notify|im|shoot a message|drop a note)\b.*\b(telegram|whatsapp|tg|wa)\b", "comm_quick_message"),  # Send quick message
    (r"\b(broadcast|announce|announcement|tts|say|speak|tell everyone|page|call out|make an announcement)\b.*", "comm_broadcast_announcement"),  # Broadcast announcement
    (r"\b(read|check|show|get|list|fetch|pull)\b.*\b(sms|texts?|text messages|messages|phone messages)\b", "comm_read_sms"),  # Read SMS

    # ---------------- Visual & Display ----------------
    (r"\b(show|cast|display|put|project|throw up|bring up)\b.*\b(calendar|agenda|today('?| )?s schedule|events)\b", "visual_cast_calendar"),  # Cast calendar
    (r"\b(show|cast|display|play|start|put on|open)\b.*\b(album|photos?|pictures?|gallery|slideshow|memories)\b", "visual_cast_album"),  # Cast album/photos
    (r"\b(show|cast|display|stream|view|put|bring up)\b.*\b(camera|cam|doorbell|security|cctv|live|feed|stream)\b", "visual_cast_camera"),  # Cast camera
    (r"\b(slideshow|start a slideshow|show|play)\b.*\b(images?|pictures?|photos?|folder|gallery|collection)\b", "visual_image_slideshow"),  # Show slideshow

    # ---------------- Reference & Look-up ----------------
    (r"\b(show|read|open|display|view|pull up|find|locate|bring up)\b.*\b(note|file|document|doc|txt|markdown|md|readme)\b", "ref_read_note_or_file"),  # Read note/file
    (r"\b(show|read|open|display|get|list|what('?| )?s on|pull up)\b.*\b(grocery|shopping|pantry) list\b", "ref_show_grocery"),  # Show grocery list
    (r"\b(search|find|look up|scan|query|grep|filter|look through)\b.*\b(history|memory|memories|log|logs|past commands?|command history)\b", "ref_search_history_or_memory"),  # Search history/memory
    (r"\b(read|show|open|display|get|pull up)\b.*\b(saved recipe|recipe note|my recipe|stored recipe)\b", "ref_read_saved_recipe"),  # Read saved recipe
]

INTENT_PARAM_FORMATS = {
    # tasks
    "add_task": {"task": "buy groceries", "priority": "high", "due": "2025-08-01 17:00", "reminder": "2025-08-01 16:00", "repeat": "daily"},
    "remove_task": {"task": "buy groceries"},
    "remove_tasks": {},
    "remove_last_task": {},
    "list_tasks": {},
    "mark_task_done": {"task": "feed the cat"},

    # home automation
    "toggle_light": {"room": "kitchen", "turn_on": True},
    "set_light_color": {"room": "bedroom", "color": "blue"},
    "adjust_light_brightness": {"room": "living room", "brightness": 70},
    "control_ac": {"turn_on": True},
    "set_ac_temperature": {"temperature": 22},
    "control_tv": {"turn_on": False},
    "set_tv_source": {"source": 2},

    #system commands
    "get_time": {},
    "get_date": {},
    "get_day_of_week": {},
    "restart_ziggy": {},
    "shutdown_ziggy": {},
    "get_system_status": {},
    "get_ip_address": {},
    "get_disk_usage": {},
    "get_wifi_status": {},
    "get_network_adapters": {},
    "ping_test": {"domain": "google.com"},

    #ziggy commands
    "ziggy_status": {},
    "ziggy_identity": {},
    "ziggy_help": {},
    "ziggy_chat": {},
    "chat_with_gpt": {"text": "What's the weather like on Mars?"},

    # memory management
    "remember_memory": {"key": "favorite_drink", "value": "whiskey"},
    "recall_memory": {"key": "favorite_drink"},
    "delete_memory": {"key": "favorite_drink"},

    # Media
    "media_stream_youtube": {"input_text": "https://youtu.be/dQw4w9WgXcQ", "device_hint": "living room tv"},
    "media_spotify_playlist": {"target": "Deep Focus", "device_hint": "living room speaker"},
    "media_start_movie_in_app": {"title": "Inception", "app": "Netflix", "device_hint": "living room tv"},
    "media_cast_camera_live": {"camera_name": "Entry", "device_hint": "living room tv"},
    "media_play_podcast_episode": {"podcast_name": "Lex Fridman", "episode_hint": "Elon", "device_hint": "speaker"},

    # Web
    "web_recipe_read": {"input_text": "https://example.com/best-shakshuka", "device_hint": "kitchen display"},
    "web_news_brief": {"device_hint": "speaker", "voice": True},
    "web_trip_updates": {"city_or_route": "Tel Aviv"},
    "web_stocks_update": {"tickers": "AAPL, MSFT", "device_hint": "dashboard"},
    "web_search_summary": {"query": "how to prune olive trees", "device_hint": "tv"},

    # Communication
    "comm_read_emails": {"limit": 5},
    "comm_send_email": {"name": "maya", "subject": "Dinner plans", "body": "Shall we meet at 7?"},
    "comm_quick_message": {"contact_name": "maya", "text": "On my way", "channel": "telegram"},
    "comm_broadcast_announcement": {"text": "Dinner is ready", "rooms_or_all": "all"},
    "comm_read_sms": {"limit": 5},

    # Visual
    "visual_cast_album": {"source": "google_photos", "album_name": "Family 2025", "device_hint": "living room tv"},
    "visual_cast_calendar": {"device_hint": "living room tv"},
    "visual_cast_camera": {"camera_name": "Front Door", "device_hint": "living room tv"},
    "visual_image_slideshow": {"criteria_or_folder": "C:/Photos/Favorites", "device_hint": "living room tv", "duration": 5.0},

    # Reference
    "ref_read_note_or_file": {"query": "wifi password", "device_hint": "dashboard"},
    "ref_show_grocery": {"device_hint": "kitchen display"},
    "ref_search_history_or_memory": {"keyword": "router"},
    "ref_read_saved_recipe": {"meal_name": "shakshuka", "device_hint": "kitchen display"},

}

supported_intents = list(INTENT_PARAM_FORMATS.keys())

def _quick_params_for_web_query(text: str) -> dict | None:
    s = (text or "").strip()
    if not s:
        return None
    return {"query": s}

def _quick_params_for_tv_source(text: str) -> dict | None:
    """
    Extract the source value only when the user *says the phrase* (set tv source ...).
    Supports: number (3), hdmi2, app names (netflix, youtube, etc.).
    """
    s = (text or "").strip().lower()

    # explicit "... source to VALUE"
    m = re.search(r"(source|input)\s*(to|=)?\s*(hdmi[\s\-]*\d+|\d+|netflix|netfilx|youtube|yt|prime(?: video)?|disney(?:\+| plus)?|apple tv|hbo|max|hulu|paramount\+?|peacock|youtube tv)\b", s)
    if m:
        return {"source": m.group(3)}

    # fallback: "... tv ... to VALUE" (still requires set/change/etc. + tv phrase)
    m2 = re.search(r"\btv|television|screen|display\b.*\bto\b\s*(hdmi[\s\-]*\d+|\d+|netflix|netfilx|youtube|yt|prime(?: video)?|disney(?:\+| plus)?|apple tv|hbo|max|hulu|paramount\+?|peacock|youtube tv)\b", s)
    if m2:
        return {"source": m2.group(1)}

    return None

def quick_parse(text):
    if not isinstance(text, str) or not text.strip():
        print("[Intent Parser] ⚠️ Ignored empty or invalid input.")
        return {"intent": "chat_with_gpt", "params": {"text": ""}, "source": "noop"}

    original_text = text.strip()          # keep original casing for params (e.g., web queries)
    text = original_text.lower()          # use lowercased for regex matching

    if text.startswith(TRIGGER_PHRASE):
        text = text[len(TRIGGER_PHRASE):].strip()
        original_text = original_text[len(TRIGGER_PHRASE):].strip()
        print(f"[Intent Parser] 🚨 Trigger phrase detected, re-running regex: {text}")

    for pattern, intent in INTENT_PATTERNS:
        if re.search(pattern, text):
            print(f"[Intent Parser] ✅ Regex match: {intent}")

            # Fast path for TV source so "set tv source to 3/hdmi2/netflix" doesn't rely on GPT
            if intent == "set_tv_source":
                fast_tv = _quick_params_for_tv_source(original_text)
                if fast_tv:
                    return {"intent": "set_tv_source", "params": fast_tv, "source": "regex"}

            # Fast path for general web Q&A/news → pass full original query
            if intent in ("web_search_summary", "web_news_brief"):
                fast_web = _quick_params_for_web_query(original_text)
                if fast_web:
                    return {"intent": intent, "params": fast_web, "source": "regex"}

            # Otherwise, let GPT fill params with the intent hint
            return gpt_parse_intent(original_text, prefill_intent=intent)

    print(f"[Intent Parser] ❗ No regex match. Falling back to GPT.")
    return gpt_parse_intent(original_text)

def gpt_parse_intent(text, prefill_intent=None):
    try:
        example_json = json.dumps({
            "intent": prefill_intent or "add_task",
            "params": INTENT_PARAM_FORMATS.get(prefill_intent or "add_task", {})
        }, indent=2)

        memory = list_memory()
        tasks = load_task_json()
        context_block = f"User memory:\n{json.dumps(memory)}\n\nTask list:\n{json.dumps(tasks)}"

        system_prompt = (
            "You are Ziggy's intent parser. Extract the intent and parameters from user input.\n"
            f"Supported intents: {supported_intents}\n"
            f"Context:\n{context_block}\n\n"
            "Only return valid JSON in this format:\n"
            f"{example_json}\n\n"
            "If unsure, use: {\"intent\": \"chat_with_gpt\", \"params\": {\"text\": \"...\"}}"
        )

        messages = [{"role": "system", "content": system_prompt},
                    {"role": "user", "content": text if not prefill_intent else f"{text}\nIntent hint: {prefill_intent}"}]

        response = openai.ChatCompletion.create(
            model="gpt-4",
            messages=messages,
            temperature=0.2,
            max_tokens=200
        )

        reply = response.choices[0].message["content"].strip()
        parsed = json.loads(reply)
        parsed["params"] = normalize_room(parsed.get("params", {}))
        parsed["source"] = "gpt"
        print(f"[Intent Parser] ✅ GPT parsed intent: {parsed}")
        return parsed

    except Exception as e:
        print(f"[Intent Parser] ⚠️ GPT fallback error: {e}")
        return {"intent": "chat_with_gpt", "params": {"text": text}, "source": "gpt"}
