from services.home_automation import (
    toggle_light,
    set_light_color,
    set_light_brightness,
    get_sensor_state,
    set_ac_temperature,
    set_tv_source
)
from core.settings_loader import settings
from services.media_manager import set_tv_power, set_tv_source
from services import media_manager, web_manager, communication_manager, visual_manager, reference_manager
from dateparser import parse as parse_date
from dateparser.search import search_dates
from services.task_manager import add_task, list_tasks, remove_task, mark_done
from services.file_manager import create_note, read_notes
from services.system_tools import (
    get_time,
    get_date,
    get_day_of_week,
    restart_ziggy,
    shutdown_ziggy,
    get_system_status,
    get_ip_address,
    get_disk_usage,
    get_wifi_status,
    get_network_adapters,
    ping_test
)
from core.logger_module import log_info, log_error
from core.memory import remember, recall, list_memory, delete_memory, append_chat, get_chat_history
from core.task_file import load_task_json
import asyncio
import json
import openai
import re

chat_history = []  # in-memory history for now

TV_APP_MAP = {
    "netflix": "Netflix", "netfilx": "Netflix",
    "youtube": "YouTube", "yt": "YouTube",
    "prime": "Prime Video", "prime video": "Prime Video",
    "disney": "Disney+", "disney+": "Disney+",
    "apple tv": "Apple TV",
    "hbo": "HBO Max", "max": "Max",
    "hulu": "Hulu",
    "paramount": "Paramount+", "paramount+": "Paramount+",
    "peacock": "Peacock",
    "youtube tv": "YouTube TV",
}

def _looks_webby(q: str) -> bool:
    ql = (q or "").strip().lower()
    if not ql:
        return False
    return (
        ql.endswith("?")
        or re.search(r"\b(who|what|when|where|which|whom|whose|how)\b", ql)
        or re.search(r"\b(current|latest|today|now)\b", ql)
    )

def _normalize_tv_source(val: object) -> str:
    s = str(val or "").strip().lower()
    if s in TV_APP_MAP:
        return TV_APP_MAP[s]
    m = re.match(r"^hdmi[\s\-_]*([0-9]+)$", s)
    if m:
        return f"HDMI {int(m.group(1))}"
    if re.match(r"^[0-9]+$", s):
        return f"HDMI {int(s)}"
    return " ".join(part.capitalize() for part in s.split())

def normalize_room(params: dict) -> str:
    room = params.get("room") or params.get("area") or params.get("location")
    if not room:
        log_error(f"[Intent Handler] ❗Missing room/location in params: {params}")
        return "unknown"
    return room.replace(" ", "_").lower()

async def handle_intent(intent_result, **kwargs):
    # ---- local helpers for uniform results ----
    def _ok(message: str, data: dict | None = None) -> dict:
        return {"ok": True, "message": message, "data": data or {}}

    def _err(message: str, details: str | None = None, data: dict | None = None) -> dict:
        out = {"ok": False, "message": message, "data": data or {}}
        if details:
            out["data"]["details"] = details
        return out

    def _wrap(res) -> dict:
        # Normalize any plain string result to an OK dict
        if isinstance(res, dict):
            return res
        return _ok(str(res))

    intent = intent_result.get("intent")
    params = intent_result.get("params", {})
    source = kwargs.get("source", "unknown")

    log_info(f"[Intent Handler] Received intent: {intent} from {source} with params: {params}")

    try:
        # ---------- Lights ----------
        if intent == "toggle_light":
            room = normalize_room(params)
            if room == "unknown":
                return _err("Missing room name.")
            entity_id = f"light.{room}_light"

            if "turn_on" not in params:
                status = params.get("status", "").lower()
                if status == "on":
                    params["turn_on"] = True
                elif status == "off":
                    params["turn_on"] = False
                else:
                    params["turn_on"] = True

            toggle_light(entity_id, params["turn_on"])
            return _ok(f"{'Turning on' if params['turn_on'] else 'Turning off'} {room.replace('_', ' ')} light")

        if intent == "set_light_color":
            room = normalize_room(params)
            color = params.get("color", "white").lower()
            if room == "unknown":
                return _err("Missing room name.")
            entity_id = f"light.{room}_light"
            color_map = {
                "red": (255, 0, 0), "green": (0, 255, 0), "blue": (0, 0, 255),
                "yellow": (255, 223, 160), "white": (255, 255, 255),
                "orange": (255, 165, 0), "purple": (128, 0, 128),
                "pink": (255, 105, 180)
            }
            rgb = color_map.get(color, (255, 255, 255))
            toggle_light(entity_id, True)
            set_light_color(entity_id, rgb_color=rgb)
            return _ok(f"{room.capitalize()} light color set to {color}.")

        if intent == "set_light_brightness":
            room = normalize_room(params)
            try:
                brightness = int(params.get("brightness", 100))
            except Exception:
                return _err("Please provide a valid brightness number (0-100).")
            entity_id = f"light.{room}_light"
            toggle_light(entity_id, True)
            set_light_brightness(entity_id, brightness)
            return _ok(f"{room.capitalize()} light brightness set to {brightness}%.")

        if intent == "adjust_light_brightness":
            return _ok("Brightness adjustment is not yet implemented. Try 'set light brightness to 70' instead.")

        # ---------- Sensors ----------
        if intent == "get_temperature":
            room = normalize_room(params)
            return _wrap(get_sensor_state(room, "temperature"))

        if intent == "get_humidity":
            room = normalize_room(params)
            return _wrap(get_sensor_state(room, "humidity"))

        # ---------- AC ----------
        if intent == "control_ac":
            toggle_light("switch.ac_main", params.get("turn_on", True))
            return _ok(f"{'Turning on' if params.get('turn_on') else 'Turning off'} the AC.")

        if intent == "set_ac_temperature":
            try:
                temp = int(params.get("temperature", 24))
            except Exception:
                return _err("Please provide a valid temperature number.")
            try:
                set_ac_temperature("climate.ac_main", temp)
                return _ok(f"Setting AC temperature to {temp}°C.")
            except Exception as e:
                log_error(f"[set_ac_temperature] Exception: {e}")
                return _err("Couldn't set the AC right now. Check Home Assistant connection.", details=str(e))

        # ---------- TV ----------
        if intent == "control_tv":
            action = params.get("turn_on")
            if action is None:
                action_text = (params.get("action") or "").lower()
                if "off" in action_text:
                    action = False
                elif "on" in action_text:
                    action = True
                else:
                    return _err("Please specify whether to turn the TV on or off.")

            status, text = set_tv_power(turn_on=action, alias=params.get("device"))  # <-- no settings here
            return _ok("Turning {} the TV.".format("on" if action else "off")) if status == 200 else _err(text)

            # Use alias from voice command if available, or fall back to settings.media.default_cast_device
            alias = params.get("device")  # e.g., "living room tv"
            status, text = set_tv_power(settings, turn_on=action, alias=alias)

            if status == 200:
                return _ok(f"{'Turning on' if action else 'Turning off'} the TV.")
            else:
                return _err("Couldn't control the TV.", details=text)
            
        if intent == "set_tv_source":
            raw = params.get("source") or ""
            if not raw.strip():
                return _err("Please specify a TV source (e.g., HDMI 2 or Netflix).")

            normalized = _normalize_tv_source(raw)
            alias = params.get("device")  # e.g., "living room tv"
            status, text = set_tv_source(settings, source=normalized, alias=alias)

            if status == 200:
                return _ok(f"Switching TV to {normalized}.")
            else:
                return _err(f"Couldn't switch TV to {normalized}. Check Home Assistant connection.", details=text)
       
        # ---------- Time/Date ----------
        if intent == "get_time":
            return _wrap(get_time())

        if intent == "get_date":
            return _wrap(get_date())
        
        if intent == "get_day_of_week":
            return _wrap(get_day_of_week())

        # ---------- Ziggy lifecycle ----------
        if intent == "shutdown_ziggy":
            return _wrap(shutdown_ziggy())
        
        if intent == "restart_ziggy":
            return _wrap(restart_ziggy())

        # ---------- System info ----------
        if intent == "get_system_status":
            return _wrap(get_system_status())

        if intent == "get_ip_address":
            return _wrap(get_ip_address())

        if intent == "get_disk_usage":
            return _wrap(get_disk_usage())

        if intent == "get_wifi_status":
            return _wrap(get_wifi_status())

        if intent == "get_network_adapters":
            return _wrap(get_network_adapters())

        if intent == "ping_test":
            domain = params.get("domain", "google.com")
            return _wrap(ping_test(domain))

        # ---------- Tasks ----------
        if intent == "add_task":
            task_text = params.get("task", "Unnamed task")
            reminder = params.get("reminder")
            due = params.get("due")
            priority = params.get("priority")
            notes = params.get("notes")
            repeat = params.get("repeat")
            time_str = params.get("time")
            source = kwargs.get("source", "unknown")

            # Extract priority from text if not explicitly provided
            if not priority:
                if "high priority" in task_text.lower():
                    priority = "high"
                    task_text = task_text.replace("high priority", "").strip()
                elif "low priority" in task_text.lower():
                    priority = "low"
                    task_text = task_text.replace("low priority", "").strip()

            # Extract date/time from task text if due/reminder/time missing
            if not due and not reminder and not time_str:
                results = search_dates(task_text, settings={"PREFER_DATES_FROM": "future"})
                if results:
                    text_to_remove, dt = results[-1]
                    time_str = dt.strftime("%Y-%m-%d %H:%M")
                    task_text = task_text.replace(text_to_remove, "").strip()

            return _wrap(add_task(
                task=task_text,
                due=due,
                priority=priority,
                reminder=reminder or due or time_str,
                notes=notes,
                repeat=repeat,
                source=source,
                time=time_str
            ))

        if intent == "list_tasks":
            return _wrap(list_tasks(formatted=True))

        if intent == "remove_task":
            return _wrap(remove_task(params.get("task", "")))
        
        if intent == "remove_tasks":
            return _wrap(remove_task("all"))

        if intent == "remove_last_task":
            return _wrap(remove_task("last"))

        if intent == "mark_task_done":
            task_ref = params.get("task") or params.get("task_name") or params.get("index")
            if not task_ref:
                return _err("Please specify a task name or index to mark as done.")
            return _wrap(mark_done(task_ref))

        # ---------- Ziggy info ----------
        if intent == "ziggy_status":
            status = get_system_status()
            return _ok("I'm Ziggy, your home assistant. Feeling sharp and ready!\n\nHere's how I'm doing:\n" + str(status))

        if intent == "ziggy_identity":
            return _ok("I'm Ziggy, built by Youval to make your home smarter and life easier.")

        if intent == "ziggy_help":
            return _ok(
                "I can help you with lights, AC, TV, tasks, notes, sensors, and system actions. "
                "Try saying 'Turn on the living room light', 'What's the temperature in Roni's room?', or 'Add task feed the cat'."
            )

        if intent == "ziggy_chat":
            return _ok("Here’s something interesting: Did you know octopuses have three hearts?")

        # ---------- Memory ----------
        if intent == "remember_memory":
            key = params.get("key")
            value = params.get("value")
            if key and value:
                remember(key, value)
                return _ok(f"✅ Remembered: {key} → {value}")
            return _err("Missing key or value.")

        if intent == "recall_memory":
            key = params.get("key")
            if key:
                value = recall(key)
                return _ok(f"🧠 {key}: {value}") if value else _ok(f"🤔 I have no memory of '{key}'.")
            return _err("Missing key.")

        if intent == "delete_memory":
            key = params.get("key")
            if key:
                success = delete_memory(key)
                return _ok(f"🗑️ Deleted memory for '{key}'.") if success else _ok(f"🤷 Nothing found for '{key}'.")
            return _err("Missing key.")

        # ---------- Chat ----------
        if intent == "chat_with_gpt":
            log_info(f"[chat_with_gpt] Raw params: {params}")
            text = str(params.get("text") or params.get("message") or params or "").strip()

            # Try web first for general knowledge/current-events questions
            if _looks_webby(text):
                try:
                    web_result = web_manager.web_search_and_summary(query=text, device_hint=None)
                    if isinstance(web_result, dict) and web_result.get("ok"):
                        return web_result
                    log_error(f"[chat_with_gpt -> web] Non-OK web_result: {web_result}")
                except Exception as e:
                    log_error(f"[chat_with_gpt -> web] Exception: {e}")
                # fall through to GPT fallback

            memory_context = list_memory()
            task_context = load_task_json()
            append_chat("user", text)
            chat_history = get_chat_history()

            system_prompt = (
                "You are Ziggy, the smart home assistant. Use the user's memory and tasks to answer contextually.\n\n"
                f"User memory:\n{json.dumps(memory_context)}\n\n"
                f"Task list:\n{json.dumps(task_context)}"
            )

            messages = [
                {"role": "system", "content": system_prompt},
                *chat_history
            ]

            try:
                response = openai.ChatCompletion.create(
                    model="gpt-4",
                    messages=messages,
                    temperature=0.6,
                    max_tokens=250
                )
                reply = response.choices[0].message["content"].strip()
                append_chat("assistant", reply)
                return _ok(reply)
            except Exception as e:
                log_error(f"[chat_with_gpt] GPT error: {e}")
                return _err("GPT error while chatting.", details=str(e))

        # ---------- New Media ----------
        if intent == "media_stream_youtube":
            return media_manager.stream_youtube_to_chromecast_hd(
                input_text=params.get("input_text", ""),
                device_hint=params.get("device_hint"),
            )
        if intent == "media_spotify_playlist":
            return media_manager.play_spotify_playlist(
                target=params.get("target", ""),
                device_hint=params.get("device_hint"),
            )
        if intent == "media_start_movie_in_app":
            return media_manager.start_movie_in_app(
                title=params.get("title", ""),
                app=params.get("app", ""),
                device_hint=params.get("device_hint"),
            )
        if intent == "media_cast_camera_live":
            return media_manager.cast_camera_live(
                camera_name=params.get("camera_name", ""),
                device_hint=params.get("device_hint"),
            )
        if intent == "media_play_podcast_episode":
            return media_manager.play_podcast_episode(
                podcast_name=params.get("podcast_name", ""),
                episode_hint=params.get("episode_hint"),
                device_hint=params.get("device_hint"),
            )

        # ---------- New Web ----------
        if intent == "web_recipe_read":
            return web_manager.read_recipe_from_url(
                input_text=params.get("input_text", ""),
                device_hint=params.get("device_hint"),
            )
        if intent == "web_news_brief":
            return web_manager.show_news_brief(
                device_hint=params.get("device_hint"),
                voice=bool(params.get("voice", True)),
            )
        if intent == "web_trip_updates":
            return web_manager.trip_updates(
                city_or_route=params.get("city_or_route", ""),
            )
        if intent == "web_stocks_update":
            return web_manager.stocks_update(
                tickers=params.get("tickers", ""),
                device_hint=params.get("device_hint"),
            )
        if intent == "web_search_summary":
            return web_manager.web_search_and_summary(
                query=params.get("query", ""),
                device_hint=params.get("device_hint"),
            )

        # ---------- New Communication ----------
        if intent == "comm_read_emails":
            return communication_manager.read_latest_emails(
                limit=int(params.get("limit", 5)),
            )
        if intent == "comm_send_email":
            return communication_manager.send_email_to_contact(
                name=params.get("name", ""),
                subject=params.get("subject", ""),
                body=params.get("body", ""),
            )
        if intent == "comm_quick_message":
            return communication_manager.quick_message(
                contact_name=params.get("contact_name", ""),
                text=params.get("text", ""),
                channel=params.get("channel", "telegram"),
            )
        if intent == "comm_broadcast_announcement":
            return communication_manager.broadcast_announcement(
                text=params.get("text", ""),
                rooms_or_all=params.get("rooms_or_all", "all"),
            )
        if intent == "comm_read_sms":
            return communication_manager.read_latest_sms(
                limit=int(params.get("limit", 5)),
            )

        # ---------- New Visual ----------
        if intent == "visual_cast_album":
            return visual_manager.cast_photo_album(
                source=params.get("source", ""),
                album_name=params.get("album_name", ""),
                device_hint=params.get("device_hint", ""),
            )
        if intent == "visual_cast_calendar":
            return visual_manager.cast_today_calendar(
                device_hint=params.get("device_hint", ""),
            )
        if intent == "visual_cast_camera":
            return visual_manager.cast_security_camera(
                camera_name=params.get("camera_name", ""),
                device_hint=params.get("device_hint", ""),
            )
        if intent == "visual_image_slideshow":
            return visual_manager.cast_image_slideshow(
                criteria_or_folder=params.get("criteria_or_folder", ""),
                device_hint=params.get("device_hint", ""),
                duration=params.get("duration"),
            )

        # ---------- New Reference ----------
        if intent == "ref_read_note_or_file":
            return reference_manager.read_note_or_file(
                query=params.get("query", ""),
                device_hint=params.get("device_hint"),
            )
        if intent == "ref_show_grocery":
            return reference_manager.show_grocery_list(
                device_hint=params.get("device_hint"),
            )
        if intent == "ref_search_history_or_memory":
            return reference_manager.search_history_or_memory(
                keyword=params.get("keyword", ""),
                device_hint=params.get("device_hint"),
            )
        if intent == "ref_read_saved_recipe":
            return reference_manager.read_saved_recipe(
                meal_name=params.get("meal_name", ""),
                device_hint=params.get("device_hint"),
            )

    except Exception as e:
        log_error(f"[Intent Handler] Exception: {e}")
        return _err("Something went wrong while handling your request.", details=str(e))

    log_info(f"[Intent Handler] Unrecognized intent: {intent}")
    return _err("I'm not sure how to help with that yet.")
