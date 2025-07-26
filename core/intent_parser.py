import re
import openai
import json
from core.settings_loader import settings

openai.api_key = settings["openai"]["api_key"]

def quick_parse(text):
    text = text.lower().strip()

    patterns = [
        # Light toggle
        (r"(turn|switch) on (the )?(?P<room>\w+) light", "toggle_light", {"turn_on": True}),
        (r"(turn|switch) off (the )?(?P<room>\w+) light", "toggle_light", {"turn_on": False}),

        # Light color (strict)
        (r"^(set|change|make) (the )?(?P<room>\w+) light (color )?(to )?(?P<color>\w+)$", "set_light_color", {}),
        (r"^(set|change|make) (the )?(?P<room>\w+) (color )?(to )?(?P<color>\w+)$", "set_light_color", {}),
        (r"^(turn|switch) (the )?(?P<room>\w+) light to (?P<color>\w+)$", "set_light_color", {}),
        (r"^(turn|switch) (the )?(?P<room>\w+) to (?P<color>\w+)$", "set_light_color", {}),

        # Sensors
        (r"what('?s| is) the temperature in (?P<room>\w+)", "get_temperature", {}),
        (r"what('?s| is) the humidity in (?P<room>\w+)", "get_humidity", {}),

        # AC & TV
        (r"(turn|switch) on the ac", "control_ac", {"turn_on": True}),
        (r"(turn|switch) off the ac", "control_ac", {"turn_on": False}),
        (r"(turn|switch) on the tv", "control_tv", {"turn_on": True}),
        (r"(turn|switch) off the tv", "control_tv", {"turn_on": False}),

        # System
        (r"restart ziggy", "restart_ziggy", {}),
        (r"shutdown ziggy", "shutdown_ziggy", {}),
        (r"what('?s| is) the time", "get_time", {}),
        (r"what day is it", "get_date", {}),

        # Tasks
        (r"add (a )?task (?P<task>.+)", "add_task", {}),
        (r"list tasks", "list_tasks", {}),
        (r"remove task (?P<task>.+)", "remove_task", {}),

        # Notes
        (r"create (a )?note (?P<note>.+)", "create_note", {}),
        (r"read my notes", "read_notes", {}),

        # Ziggy personality
        (r"how are you", "ziggy_status", {}),
        (r"who (are|r) you", "ziggy_identity", {}),
    ]

    for pattern, intent, static_params in patterns:
        match = re.fullmatch(pattern, text)
        if match:
            result = {
                "intent": intent,
                "params": {**static_params, **match.groupdict()},
                "source": "regex"
            }
            print(f"[Intent Parser] Matched intent: {intent}, params: {result['params']}")
            return result

    # Fallback to GPT
    print(f"[Intent Parser] Fallback to GPT: {text}")
    return gpt_parse_intent(text)

def gpt_parse_intent(text):
    try:
        system_prompt = (
            "You are Ziggy's intent parser. Extract the intent and parameters from user commands. "
            "Respond ONLY in JSON like this: {\"intent\": ..., \"params\": {...}}. "
            "Supported intents: toggle_light, set_light_color, get_temperature, get_humidity, control_ac, "
            "control_tv, get_time, get_date, restart_ziggy, shutdown_ziggy, add_task, list_tasks, remove_task, "
            "create_note, read_notes, ziggy_status, ziggy_identity"
        )

        response = openai.ChatCompletion.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": text}
            ],
            temperature=0.2,
            max_tokens=150
        )

        reply = response.choices[0].message["content"].strip()

        try:
            parsed = json.loads(reply)
            parsed["source"] = "gpt"
            print(f"[Intent Parser] GPT intent: {parsed}")
            return parsed
        except json.JSONDecodeError:
            print(f"[Intent Parser] GPT response not JSON: {reply}")
            return {"intent": "chat_with_gpt", "params": {"text": text}, "source": "gpt"}

    except Exception as e:
        print(f"[Intent Parser] GPT fallback failed: {e}")
        return {"intent": "chat_with_gpt", "params": {"text": text}, "source": "gpt"}
