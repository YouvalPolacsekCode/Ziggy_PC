from __future__ import annotations

import json
import re

from dateparser.search import search_dates

from core.logger_module import log_info, log_error
from core.memory import remember, recall, list_memory, delete_memory, append_chat, get_chat_history
from core.settings_loader import settings
from core.task_file import load_task_json
from integrations.openai_client import get_client
from services.home_automation import (
    toggle_light,
    set_light_color,
    set_light_brightness,
    get_sensor_state,
    set_ac_temperature,
    resolve_entity,
    get_global_sensor,
    add_todo_item,
    get_todo_items,
)
from services.media_manager import set_tv_power, set_tv_source
from services import media_manager, web_manager, communication_manager, visual_manager, reference_manager
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
    ping_test,
)
from services.task_manager import add_task, list_tasks, remove_task, mark_done
from services.file_manager import save_file, read_file, list_files, create_note, read_notes

# ---------------------------------------------------------------------------
# Result helpers — module-level so they are not re-created on each call
# ---------------------------------------------------------------------------

def _ok(message: str, data: dict | None = None) -> dict:
    return {"ok": True, "message": message, "data": data or {}}


def _err(message: str, details: str | None = None, data: dict | None = None) -> dict:
    out = {"ok": False, "message": message, "data": data or {}}
    if details:
        out["data"]["details"] = details
    return out


def _wrap(res) -> dict:
    if isinstance(res, dict):
        return res
    return _ok(str(res))


# ---------------------------------------------------------------------------
# TV source normalisation
# ---------------------------------------------------------------------------

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




# ---------------------------------------------------------------------------
# Room normalisation
# ---------------------------------------------------------------------------

def normalize_room(params: dict) -> str:
    room = params.get("room") or params.get("area") or params.get("location")
    if not room:
        log_error(f"[Intent Handler] ❗Missing room/location in params: {params}")
        return "unknown"
    return room.replace(" ", "_").lower()


# ---------------------------------------------------------------------------
# Main intent dispatcher
# ---------------------------------------------------------------------------

async def handle_intent(intent_result: dict, **kwargs) -> dict:
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
            entity_id = resolve_entity(room, "light")
            if not entity_id:
                return _err(f"No light configured for {room.replace('_', ' ')}.")

            if "turn_on" not in params:
                status_str = (params.get("status") or "").lower()
                params["turn_on"] = status_str != "off"

            toggle_light(entity_id, params["turn_on"])
            action_word = "Turning on" if params["turn_on"] else "Turning off"
            return _ok(f"{action_word} {room.replace('_', ' ')} light")

        if intent == "set_light_color":
            room = normalize_room(params)
            if room == "unknown":
                return _err("Missing room name.")
            entity_id = resolve_entity(room, "light")
            if not entity_id:
                return _err(f"No light configured for {room.replace('_', ' ')}.")
            color = (params.get("color") or "white").lower()
            color_map = {
                "red": (255, 0, 0), "green": (0, 255, 0), "blue": (0, 0, 255),
                "yellow": (255, 223, 160), "white": (255, 255, 255),
                "orange": (255, 165, 0), "purple": (128, 0, 128),
                "pink": (255, 105, 180),
            }
            rgb = color_map.get(color, (255, 255, 255))
            toggle_light(entity_id, True)
            set_light_color(entity_id, rgb_color=rgb)
            return _ok(f"{room.replace('_', ' ').title()} light color set to {color}.")

        if intent in ("set_light_brightness", "adjust_light_brightness"):
            room = normalize_room(params)
            entity_id = resolve_entity(room, "light")
            if not entity_id:
                return _err(f"No light configured for {room.replace('_', ' ')}.")
            try:
                brightness = int(params.get("brightness", 100))
            except Exception:
                return _err("Please provide a valid brightness number (0-100).")
            toggle_light(entity_id, True)
            set_light_brightness(entity_id, brightness)
            return _ok(f"{room.replace('_', ' ').title()} light brightness set to {brightness}%.")

        # ---------- Sensors ----------
        if intent == "get_temperature":
            room = normalize_room(params)
            return _wrap(get_sensor_state(room, "temperature"))

        if intent == "get_humidity":
            room = normalize_room(params)
            return _wrap(get_sensor_state(room, "humidity"))

        # ---------- AC ----------
        if intent == "control_ac":
            room = normalize_room(params)
            action_text = (params.get("action") or "").lower()
            # If it looks like a temperature query, route to sensor read
            if any(k in action_text for k in ["get", "status", "query", "temperature"]):
                return _wrap(get_sensor_state(room, "temperature"))
            entity_id = resolve_entity(room, "ac") if room != "unknown" else None
            if not entity_id:
                return _err(
                    f"No AC configured for {room.replace('_', ' ')}. "
                    "Add an 'ac' entity under device_map in settings.yaml, or say 'set temperature to 24'."
                )
            turn_on = params.get("turn_on")
            if turn_on is None:
                if "off" in action_text:
                    turn_on = False
                elif "on" in action_text:
                    turn_on = True
                else:
                    return _err("Say 'turn on' or 'turn off' the AC, or 'set AC to 24 degrees'.")
            from services.home_automation import call_service
            service = "turn_on" if turn_on else "turn_off"
            result = call_service("climate", service, {"entity_id": entity_id})
            if result.get("ok"):
                return _ok(f"{'Turning on' if turn_on else 'Turning off'} {room.replace('_', ' ')} AC.")
            return _err("Couldn't control the AC.", details=result.get("message"))

        if intent == "set_ac_temperature":
            room = normalize_room(params)
            entity_id = resolve_entity(room, "ac") if room != "unknown" else None
            if not entity_id:
                return _err(f"No AC configured for {room.replace('_', ' ')}. Add an 'ac' entity under device_map.{room} in settings.yaml.")
            try:
                temp = int(params.get("temperature", 24))
            except Exception:
                return _err("Please provide a valid temperature number.")
            try:
                set_ac_temperature(entity_id, temp)
                return _ok(f"Setting {room.replace('_', ' ')} AC to {temp}°C.")
            except Exception as e:
                log_error(f"[set_ac_temperature] Exception: {e}")
                return _err("Couldn't set the AC right now. Check Home Assistant connection.", details=str(e))

        # ---------- TV ----------
        if intent == "control_tv":
            alias = params.get("device")
            action = params.get("turn_on")
            if action is None:
                action_text = (params.get("action") or "").lower()
                if "off" in action_text:
                    action = False
                elif "on" in action_text:
                    action = True
                else:
                    return _err("Please specify whether to turn the TV on or off.")

            status_code, text = set_tv_power(turn_on=action, alias=alias)
            if status_code == 200:
                return _ok(f"{'Turning on' if action else 'Turning off'} the TV.")
            return _err("Couldn't control the TV.", details=text)

        if intent == "set_tv_source":
            raw = params.get("source") or ""
            if not raw.strip():
                return _err("Please specify a TV source (e.g., HDMI 2 or Netflix).")
            normalized = _normalize_tv_source(raw)
            alias = params.get("device")
            status_code, text = set_tv_source(source=normalized, alias=alias)
            if status_code == 200:
                return _ok(f"Switching TV to {normalized}.")
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

        # ---------- Files & Notes ----------
        if intent == "save_note":
            content = (params.get("content") or params.get("text") or "").strip()
            if not content:
                return _err("What should I save in the note?")
            result = create_note(content)
            return _ok(f"Note saved. ({result})")

        if intent == "read_notes":
            limit = int(params.get("limit", 3))
            return _ok(read_notes(limit))

        if intent == "save_file":
            filename = (params.get("filename") or "").strip()
            content = (params.get("content") or "").strip()
            if not filename:
                return _err("Please specify a filename.")
            if not content:
                return _err("Please specify the file content.")
            return _ok(save_file(filename, content))

        if intent == "read_file":
            filename = (params.get("filename") or "").strip()
            if not filename:
                return _err("Please specify a filename.")
            return _ok(read_file(filename))

        if intent == "list_files":
            files = list_files()
            if not files:
                return _ok("No files saved yet.")
            return _ok("Saved files: " + ", ".join(sorted(files)))

        # ---------- Countdown ----------
        if intent == "countdown":
            import dateparser
            from datetime import datetime as dt
            target = (params.get("date") or params.get("event") or "").strip()
            if not target:
                return _err("Please specify a date or event to count down to.")
            parsed = dateparser.parse(target, settings={"PREFER_DATES_FROM": "future"})
            if not parsed:
                return _err(f"I couldn't understand the date: '{target}'.")
            today = dt.now().date()
            delta = (parsed.date() - today).days
            if delta < 0:
                return _ok(f"That was {abs(delta)} day(s) ago ({parsed.strftime('%B %d, %Y')}).")
            elif delta == 0:
                return _ok(f"That's today! ({parsed.strftime('%B %d, %Y')})")
            elif delta == 1:
                return _ok(f"Tomorrow! ({parsed.strftime('%B %d, %Y')})")
            else:
                return _ok(f"{delta} days until {parsed.strftime('%B %d, %Y')}.")

        # ---------- Tasks ----------
        if intent == "add_task":
            task_text = params.get("task", "Unnamed task")
            reminder = params.get("reminder")
            due = params.get("due")
            priority = params.get("priority")
            notes = params.get("notes")
            repeat = params.get("repeat")
            time_str = params.get("time")
            task_source = kwargs.get("source", "unknown")

            if not priority:
                if "high priority" in task_text.lower():
                    priority = "high"
                    task_text = task_text.replace("high priority", "").strip()
                elif "low priority" in task_text.lower():
                    priority = "low"
                    task_text = task_text.replace("low priority", "").strip()

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
                source=task_source,
                time=time_str,
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
            sys_status = get_system_status()
            return _ok("I'm Ziggy, your home assistant. Feeling sharp and ready!\n\nHere's how I'm doing:\n" + str(sys_status))

        if intent == "ziggy_identity":
            return _ok("I'm Ziggy, built by Youval to make your home smarter and life easier.")

        if intent == "ziggy_help":
            return _ok(
                "I can help you with lights, AC, TV, tasks, notes, sensors, and system actions. "
                "Try saying 'Turn on the living room light', 'What's the temperature in Roni's room?', or 'Add task feed the cat'."
            )

        if intent == "ziggy_chat":
            return _ok("Here's something interesting: Did you know octopuses have three hearts?")

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

        # ---------- Internet / Network ----------
        if intent == "get_internet_speed":
            dl = get_global_sensor("internet_download")
            ul = get_global_sensor("internet_upload")
            if dl.get("ok") and ul.get("ok"):
                return _ok(f"Download: {dl['message']}, Upload: {ul['message']}")
            return _err("Couldn't read internet speed from Home Assistant.")

        if intent == "get_internet_status":
            status = get_global_sensor("internet_status")
            if status.get("ok"):
                state = status["data"].get("state", "unknown")
                msg = "Internet is connected." if state in ("on", "true", "connected") else "Internet appears to be down."
                ip = get_global_sensor("internet_ip")
                if ip.get("ok"):
                    msg += f" External IP: {ip['message']}."
                return _ok(msg)
            return _err("Couldn't check internet status.")

        # ---------- Sun / Daylight ----------
        if intent == "get_sun_times":
            rising = get_global_sensor("sun_rising")
            setting = get_global_sensor("sun_setting")
            parts = []
            if rising.get("ok"):
                parts.append(f"Sunrise: {rising['data'].get('state', '?')}")
            if setting.get("ok"):
                parts.append(f"Sunset: {setting['data'].get('state', '?')}")
            if parts:
                return _ok(", ".join(parts))
            return _err("Couldn't get sun times.")

        # ---------- Person / Presence ----------
        if intent == "is_someone_home":
            result = get_global_sensor("person_home")
            if result.get("ok"):
                state = result["data"].get("state", "unknown")
                home = state.lower() == "home"
                name = params.get("name", "You")
                return _ok(f"{name} {'are' if home else 'are not'} home." if name == "You" else f"{name} is {'home' if home else 'away'}.")
            return _err("Couldn't check presence.")

        # ---------- Shopping list ----------
        if intent == "add_shopping_list_item":
            item = (params.get("item") or "").strip()
            if not item:
                return _err("Please specify what to add to the shopping list.")
            return _wrap(add_todo_item(item))

        if intent == "get_shopping_list":
            return _wrap(get_todo_items())

        # ---------- Chat ----------
        if intent == "chat_with_gpt":
            log_info(f"[chat_with_gpt] Raw params: {params}")
            text = str(params.get("text") or params.get("message") or params or "").strip()

            memory_context = list_memory()
            task_context = load_task_json()
            append_chat("user", text)
            chat_history = get_chat_history()

            system_prompt = (
                "You are Ziggy, the smart home assistant. Use the user's memory and tasks to answer contextually.\n\n"
                f"User memory:\n{json.dumps(memory_context)}\n\n"
                f"Task list:\n{json.dumps(task_context)}"
            )

            try:
                response = get_client().chat.completions.create(
                    model="gpt-4o",
                    messages=[{"role": "system", "content": system_prompt}, *chat_history],
                    temperature=0.6,
                    max_tokens=250,
                )
                reply = response.choices[0].message.content.strip()
                append_chat("assistant", reply)
                return _ok(reply)
            except Exception as e:
                log_error(f"[chat_with_gpt] GPT error: {e}")
                return _err("GPT error while chatting.", details=str(e))

        # ---------- Media ----------
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

        # ---------- Web ----------
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
            return web_manager.trip_updates(city_or_route=params.get("city_or_route", ""))
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

        # ---------- Communication ----------
        if intent == "comm_read_emails":
            return communication_manager.read_latest_emails(limit=int(params.get("limit", 5)))
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
            return communication_manager.read_latest_sms(limit=int(params.get("limit", 5)))

        # ---------- Visual ----------
        if intent == "visual_cast_album":
            return visual_manager.cast_photo_album(
                source=params.get("source", ""),
                album_name=params.get("album_name", ""),
                device_hint=params.get("device_hint", ""),
            )
        if intent == "visual_cast_calendar":
            return visual_manager.cast_today_calendar(device_hint=params.get("device_hint", ""))
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

        # ---------- Reference ----------
        if intent == "ref_read_note_or_file":
            return reference_manager.read_note_or_file(
                query=params.get("query", ""),
                device_hint=params.get("device_hint"),
            )
        if intent == "ref_show_grocery":
            return reference_manager.show_grocery_list(device_hint=params.get("device_hint"))
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
