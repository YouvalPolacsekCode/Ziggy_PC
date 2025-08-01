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

INTENT_PATTERNS = [
    (r"(remember|save|store|note|log|record) (that )?.*", "remember_memory"),
    (r"(what did i say|what have i said|do you remember|recall|remind me) (about|regarding|concerning) .*", "recall_memory"),
    (r"(delete|remove|clear|forget|discard|wipe) (memory|fact|note|info|entry)? (for|about)? .*", "delete_memory"),

    (r"(add|set|schedule|insert|create|plan|log|record) (a )?task", "add_task"),
    (r"(remove|delete|cancel|discard|erase|clear|eliminate|forget) (a )?task", "remove_task"),
    (r"(delete|remove|clear|wipe) (all )?tasks?", "remove_tasks"),
    (r"(delete|remove|clear|wipe) (the )?last task", "remove_last_task"),
    (r"(list|show|display|view|see|get|check|read) (my )?tasks", "list_tasks"),
    (r"(mark|complete|finish|check off|resolve|end|close|finalize) task", "mark_task_done"),

    (r"(turn|switch|activate|deactivate|power|toggle|start|stop).*light", "toggle_light"),
    (r"(set|change|make|adjust|modify|tune|select|define).*light.*(color|to|shade|hue|tone|style|look)", "set_light_color"),
    (r"(dim|brighten|increase|decrease|raise|lower|adjust|tweak|modify).*light", "adjust_light_brightness"),

    (r"(turn|switch|start|power|activate|enable|boot|launch).*ac", "control_ac"),
    (r"(set|put|adjust|change|define|tune|program|configure).*ac.*(?P<temperature>\d+)", "set_ac_temperature"),

    (r"(turn|switch|start|stop|power|activate|enable|launch).*tv", "control_tv"),
    (r"(set|change|adjust|switch|select|define|update|modify).*tv.*source", "set_tv_source"),

    (r"(restart|reboot|reload|reset|refresh|reinitialize|cycle|relaunch).*ziggy", "restart_ziggy"),
    (r"(shutdown|power down|turn off|kill|halt|deactivate|stop|exit).*ziggy", "shutdown_ziggy"),

    (r"(what day is it|tell me the day|which day is it|day of the week|what weekday is it|current day)", "get_day_of_week"),
    (r"(what(\\'?s| is|\\u2019s|s the|time is|does the clock say|tell me the time|current time|time now|clock time))", "get_time"),
    (r"(what(\\'?s| is|\\u2019s|s the|date is|calendar date|current date|what date))", "get_date"),

    (r"(how are you|how do you feel|what’s up|how’s it going|status|are you ok|mood check|your mood)", "ziggy_status"),
    (r"(who are you|what are you|identify yourself|your name|introduce yourself|what is ziggy|who is ziggy)", "ziggy_identity"),
    (r"(what can you do|what do you support|what are your abilities|your features|available commands|capabilities|help options)", "ziggy_help"),
    (r"(tell|say|show|share|give|suggest|read|speak).*fun", "ziggy_chat"),

    (r"(what('|’)?s|show|status|how is).*system", "get_system_status"),
    (r"(ip address|what('|’)?s my ip|my network|my ip address|ip info)", "get_ip_address"),
    (r"(disk usage|space left|storage left|available disk|free disk|how much space)", "get_disk_usage"),
    (r"(wifi status|check wifi|is wifi up|wifi info|my wifi|internet status)", "get_wifi_status"),
    (r"(network adapters|list adapters|show interfaces|network interfaces|my adapters|ethernet info)", "get_network_adapters"),
    (r"(ping|check|test|lookup) (?P<domain>\S+)", "ping_test"),
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
}

supported_intents = list(INTENT_PARAM_FORMATS.keys())

def quick_parse(text):
    if not isinstance(text, str) or not text.strip():
        print("[Intent Parser] ⚠️ Ignored empty or invalid input.")
        return {"intent": "chat_with_gpt", "params": {"text": ""}, "source": "noop"}

    text = text.strip().lower()

    if text.startswith(TRIGGER_PHRASE):
        text = text[len(TRIGGER_PHRASE):].strip()
        print(f"[Intent Parser] 🚨 Trigger phrase detected, re-running regex: {text}")

    for pattern, intent in INTENT_PATTERNS:
        if re.search(pattern, text):
            print(f"[Intent Parser] ✅ Regex match: {intent}")
            return gpt_parse_intent(text, prefill_intent=intent)

    print(f"[Intent Parser] ❗ No regex match. Falling back to GPT.")
    return gpt_parse_intent(text)

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
