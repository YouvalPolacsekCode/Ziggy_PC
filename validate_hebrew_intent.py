"""
Day 1 gate: validate GPT-4o-mini Hebrew tool-calling accuracy.

Run from the repo root:
    python validate_hebrew_intent.py

Pass threshold: ≥85% correct (17/20).
If below 85% → use Approach C first; revisit Approach B after normalization layer is in.
"""

import sys
import os
import json

sys.path.append(os.path.dirname(__file__))

from integrations.openai_client import get_client
from core.intent_parser import TOOLS

# ── Bilingual system prompt (the proposed new _SYSTEM_PROMPT) ─────────────────
# Hebrew room names will already be normalized to English display names by the
# normalizer in production. For this test we pre-normalize manually so we're
# testing GPT tool-calling accuracy in isolation.

_ROOMS_EN = (
    "baby room, bath room, bathroom, bedroom, corridor, en suite, ensuite, "
    "entrance, entry, front door, hall, hallway, kids room, kitchen, living room, "
    "lounge, main bedroom, main room, master bathroom, master bedroom, nursery, "
    "office, our room, parents bathroom, roni room, roni's room, salon, study, "
    "toilet, wc, work room"
)

BILINGUAL_SYSTEM_PROMPT = (
    "You are Ziggy, a smart home assistant. "
    "The user is giving a voice or text command. "
    "ALWAYS prefer to use a tool to handle the request — call the most appropriate tool rather than responding conversationally. "
    "Only skip tool calls when the user is explicitly having casual small-talk or explicitly asking for general information with no actionable command. "
    "For ANY request involving home control, scheduling, automation, tasks, reminders, files, system, or media — ALWAYS call a tool. "
    "For scheduling requests like 'every day at X', 'at 12 PM', 'automatically', 'schedule' — ALWAYS use create_automation. "
    "Never instruct the user to use external apps or Home Assistant UI — use Ziggy's own tools to fulfill requests directly. "
    f"Known rooms: {_ROOMS_EN}. "
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

# ── Hebrew room normalizer (mirrors Step 3 of the design doc) ─────────────────
from core.settings_loader import settings

_ROOMS_HE_SORTED = sorted(
    settings.get("room_aliases_he", {}).items(),
    key=lambda kv: len(kv[0]),
    reverse=True,
)

def _normalize_hebrew_rooms(text: str) -> str:
    for he_name, en_slug in _ROOMS_HE_SORTED:
        if he_name in text:
            en_display = next(
                (k for k, v in settings.get("room_aliases", {}).items() if v == en_slug),
                en_slug,
            )
            text = text.replace(he_name, en_display)
    return text

# ── 20 test commands ──────────────────────────────────────────────────────────
# Format: (hebrew_input, expected_tool, expected_params_subset)
# expected_params_subset: dict of key→value pairs that MUST appear in params.
# Extra params are fine; missing required params = FAIL.
# For room params, list all acceptable aliases — GPT may return any valid alias.

TEST_CASES = [
    # Lights — turn on
    ("תדליק את האור בסלון",          "toggle_light",          {"room": ["living room", "salon", "lounge", "main room"], "turn_on": True}),
    ("הדלק אור במטבח",               "toggle_light",          {"room": "kitchen",     "turn_on": True}),
    ("תדליק את האור במשרד",          "toggle_light",          {"room": ["office", "study", "work room"], "turn_on": True}),
    ("תדליקי את האור בחדר שינה",     "toggle_light",          {"room": "bedroom",     "turn_on": True}),

    # Lights — turn off
    ("כבה את האור בסלון",            "toggle_light",          {"room": ["living room", "salon", "lounge", "main room"], "turn_on": False}),
    ("תכבה אור במטבח",               "toggle_light",          {"room": "kitchen",     "turn_on": False}),
    ("תכבה את האור בחדר רוני",       "toggle_light",          {"room": ["roni room", "roni's room", "kids room", "nursery"], "turn_on": False}),

    # Lights — all off
    ("כבה את כל האורות",             "turn_off_all_lights",   {}),
    # "כבה הכל" — GPT may reasonably pick either tool; accept both
    ("כבה הכל",                      ["turn_off_all_lights", "turn_off_everything"], {}),

    # Everything off
    ("לילה טוב",                     "turn_off_everything",   {}),

    # Temperature queries
    ("מה הטמפרטורה בסלון",           "get_temperature",       {"room": ["living room", "salon", "lounge", "main room"]}),
    ("מה הטמפרטורה בחדר שינה",       "get_temperature",       {"room": "bedroom"}),
    ("מה הטמפרטורה בחדר רוני",       "get_temperature",       {"room": ["roni room", "roni's room", "kids room"]}),

    # Humidity
    ("מה הלחות במשרד",               "get_humidity",          {"room": ["office", "study", "work room"]}),

    # AC
    ("הפעל מזגן בסלון",              "control_ac",            {"room": ["living room", "salon", "lounge"], "turn_on": True}),
    ("כבה מזגן בחדר שינה",           "control_ac",            {"room": "bedroom",     "turn_on": False}),
    ("תכוון את הטמפרטורה ל22 בסלון", "set_ac_temperature",    {"room": ["living room", "salon", "lounge"], "temperature": 22}),

    # Brightness
    ("הקטן את האור בחדר שינה ל30",   "adjust_light_brightness", {"room": "bedroom", "brightness": 30}),

    # Mixed Hebrew+English
    ("turn off the light במטבח",     "toggle_light",          {"room": "kitchen",     "turn_on": False}),
    ("תדליק את ה living room light", "toggle_light",          {"room": ["living room", "salon"], "turn_on": True}),
]

# ── Runner ────────────────────────────────────────────────────────────────────

def _normalize(val):
    """Lowercase strings for comparison; pass other types through."""
    return val.lower() if isinstance(val, str) else val


def _matches(actual_val, expected_val) -> bool:
    """Accept scalar or list of acceptable values."""
    norm_actual = _normalize(actual_val)
    if isinstance(expected_val, list):
        return norm_actual in [_normalize(v) for v in expected_val]
    return norm_actual == _normalize(expected_val)


def run_test(client, command: str, expected_tool, expected_params: dict) -> tuple[bool, str]:
    normalized_command = _normalize_hebrew_rooms(command)
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": BILINGUAL_SYSTEM_PROMPT},
                {"role": "user",   "content": normalized_command},
            ],
            tools=TOOLS,
            tool_choice="auto",
        )
        msg = resp.choices[0].message

        expected_tools = expected_tool if isinstance(expected_tool, list) else [expected_tool]

        if not msg.tool_calls:
            return False, f"no tool called (expected {expected_tools})"

        call = msg.tool_calls[0]
        actual_tool = call.function.name
        actual_params = json.loads(call.function.arguments)

        if actual_tool not in expected_tools:
            return False, f"wrong tool: got {actual_tool!r}, expected {expected_tools}"

        mismatches = []
        for key, expected_val in expected_params.items():
            actual_val = actual_params.get(key)
            if not _matches(actual_val, expected_val):
                mismatches.append(f"{key}: got {actual_val!r}, expected {expected_val!r}")

        if mismatches:
            return False, f"param mismatch: {', '.join(mismatches)}"

        note = f" [normalized: {normalized_command!r}]" if normalized_command != command else ""
        return True, f"{actual_tool}({actual_params}){note}"

    except Exception as e:
        return False, f"error: {e}"


def main():
    client = get_client()
    passed = 0
    failed = 0

    print("=" * 70)
    print("Ziggy Hebrew Intent Validation — Day 1 Gate")
    print("Target: ≥85% (17/20 correct)")
    print("=" * 70)

    for i, (command, expected_tool, expected_params) in enumerate(TEST_CASES, 1):
        ok, detail = run_test(client, command, expected_tool, expected_params)
        status = "✅ PASS" if ok else "❌ FAIL"
        if ok:
            passed += 1
        else:
            failed += 1
        print(f"{i:2d}. {status}  [{command}]")
        if not ok:
            print(f"        → {detail}")
        else:
            print(f"        → {detail}")

    total = passed + failed
    pct = passed / total * 100
    print()
    print("=" * 70)
    print(f"RESULT: {passed}/{total} correct ({pct:.0f}%)")
    if pct >= 85:
        print("✅ GATE PASSED — proceed with Approach B (Direct Hebrew Intent).")
    else:
        print("❌ GATE FAILED — build Approach C normalization layer first,")
        print("   then re-run this script after normalization is in place.")
    print("=" * 70)


if __name__ == "__main__":
    main()
