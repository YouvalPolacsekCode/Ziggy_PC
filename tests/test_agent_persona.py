"""Ziggy's character + output contracts (core/agent/persona.py, output.py, context.py)."""
import re

from core.agent import persona as P
from core.agent import output as O
from core.agent import context as C

_BANNED_EN = ["one short sentence for actions", "max ~12 words", "never list your capabilities"]


def _ctx(**over):
    base = {"lang": "he", "channel": "chat", "mode": None, "house_mode": "home",
            "people_text": "Youval=home", "directory_text": "[living_room / סלון]\n  Lamp | light | on | id=light.x",
            "occupancy_text": "", "automations_text": "", "recent_text": "", "memory_text": "",
            "entitlements": {"diagnostics": True, "auto_repair": True, "explain_changes": True}}
    base.update(over)
    return base


def test_hebrew_prompt_carries_voice_rules_and_chat_contract():
    p = P.build_system_prompt(_ctx())
    assert "זיגי" in p
    assert "דוגרי" in p
    assert "OUTPUT — CHAT" in p and "OUTPUT — VOICE" not in p
    assert "explain_missing_action" in p
    assert "what_can_ziggy_do" in p
    # the muzzle is gone
    assert "one short sentence for actions" not in p.lower()
    assert "NEVER list your capabilities unasked" in p   # only when unasked


def test_voice_channel_swaps_contract():
    p = P.build_system_prompt(_ctx(channel="voice"))
    assert "OUTPUT — VOICE" in p and "OUTPUT — CHAT" not in p


def test_english_prompt_has_no_hebrew_voice_block():
    p = P.build_system_prompt(_ctx(lang="en"))
    assert "Reply in English" in p or "reply in English" in p
    assert "דוגרי" not in p


def test_diagnostic_addendum_toggles():
    assert "DIAGNOSTIC MODE IS ON" not in P.build_system_prompt(_ctx())
    assert "DIAGNOSTIC MODE IS ON" in P.build_system_prompt(_ctx(mode="diagnostic"))


def test_entitlement_addendum_lists_only_missing():
    p = P.build_system_prompt(_ctx(entitlements={"diagnostics": False, "auto_repair": True}))
    assert "אבחון מעמיק" in p and "תיקון אוטומטי" not in p
    p2 = P.build_system_prompt(_ctx(lang="en", entitlements={"diagnostics": False}))
    assert "deep diagnostics" in p2
    assert "not included" not in P.build_system_prompt(_ctx())


def test_context_sections_appear_when_present():
    p = P.build_system_prompt(_ctx(occupancy_text="  bedroom / חדר שינה: occupied — motion 2 min ago",
                                   automations_text="  Good Night | on | 8 h ago",
                                   recent_text="  21:04 Lamp (living_room) → off",
                                   memory_text="  home_city: Tel Aviv"))
    assert "ROOMS RIGHT NOW" in p and "AUTOMATIONS AND ROUTINES" in p
    assert "CHANGED IN THE LAST HOUR" in p and "WHAT YOU REMEMBER" in p


def test_rehearsal_note_when_active():
    assert "REHEARSAL MODE" in P.build_system_prompt(_ctx(rehearsal=True))
    assert "REHEARSAL MODE" not in P.build_system_prompt(_ctx())


# ── output contracts ─────────────────────────────────────────────────────────
def test_spoken_summary_takes_two_sentences_and_strips_lists():
    reply = ("כיביתי את המנורה בסלון. המזגן בחדר שינה עדיין דולק.\n"
             "- אפשר לכבות גם אותו\n- או להשאיר")
    s = O.spoken_summary(reply, "he")
    assert s.startswith("כיביתי את המנורה בסלון. המזגן בחדר שינה עדיין דולק.")
    assert "\n" not in s and "-" not in s


def test_spoken_summary_caps_length():
    long = "word " * 120
    s = O.spoken_summary(long.strip() + ".", "en")
    assert len(s) <= 222


def test_sanitizer_strips_new_leak_classes_but_keeps_line_breaks():
    txt = ("The lamp (light.living_room_lamp) is on.\nThe TV ir:ab12cd34 is off.\n"
           "Zigbee coordinator MQTT entities and the ישות.\n\n\n**bold**\n- item")
    out = O.sanitize_reply(txt, channel="chat")
    assert "light." not in out and "ir:" not in out and "()" not in out
    assert not re.search(r"zigbee|coordinator|mqtt|entities", out, re.I)
    assert "ישות" not in out
    assert "**" not in out and "- item" not in out and "item" in out
    assert "\n" in out and "\n\n\n" not in out


def test_voice_sanitizer_flattens():
    out = O.sanitize_reply("a\n\nb | c *d*", channel="voice")
    assert "\n" not in out and "|" not in out and "*" not in out


# ── context ──────────────────────────────────────────────────────────────────
def test_occupancy_text_falls_back_to_sensors():
    d = {"presence": [
        {"entity_id": "binary_sensor.a", "room": "bedroom", "state": "on", "on": True},
        {"entity_id": "binary_sensor.b", "room": "office", "state": "off", "on": False},
    ]}
    t = C.occupancy_text(d)
    assert "bedroom" in t and "occupied" in t
    assert "office" in t and "clear" in t


def test_recent_text_uses_directory_names_and_window(monkeypatch):
    import datetime as dt
    now = dt.datetime.now(dt.timezone.utc)
    cache = {
        "light.a": {"state": "off", "last_changed": (now - dt.timedelta(minutes=5)).isoformat()},
        "light.b": {"state": "on", "last_changed": (now - dt.timedelta(hours=3)).isoformat()},
        "sensor.x": {"state": "1", "last_changed": now.isoformat()},
    }
    import services.ha_subscriber as hs
    monkeypatch.setattr(hs, "state_cache", cache, raising=False)
    d = {"devices": [{"entity_id": "light.a", "name": "Lamp", "room": "living_room"},
                     {"entity_id": "light.b", "name": "Old", "room": "office"}]}
    t = C.recent_text(d)
    assert "Lamp" in t and "Old" not in t and "sensor" not in t
