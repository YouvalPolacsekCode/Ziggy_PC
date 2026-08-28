"""Health/repair → warm human speech, jargon-free.

Maps ha_health snapshots, self-heal outcomes, and manual-action codes into short,
dugri, gender-free Hebrew+English the agent can say to a user. NEVER emits
"Home Assistant", entity_ids, "Zigbee", "coordinator", "integration", "MQTT" —
those are engine internals the user must never see (feedback_ziggy_product_surface).
"""
from __future__ import annotations

import datetime

from services import ha_health as _H


def _hhmm(when: str | None) -> str | None:
    if not when:
        return None
    try:
        dt = datetime.datetime.fromisoformat(str(when).replace("Z", "+00:00"))
        return dt.astimezone().strftime("%H:%M")
    except Exception:
        return None


# primary issue code → (Hebrew, English). Warm, dugri, gender-free; no engine
# terms. {offline} is filled from the snapshot's offline device count.
_HEALTH_LINES: dict[str, tuple[str, str]] = {
    _H.ISSUE_OK: (
        "הכול תקין בבית 🙂",
        "Everything's running fine at home.",
    ),
    _H.ISSUE_HA_UNREACHABLE: (
        "הבית לא מחובר כרגע — אני לא מצליח להגיע למערכת הבית.",
        "The home system is offline right now — I can't reach it.",
    ),
    _H.ISSUE_COORDINATOR_LOADING: (
        "הבית מתחבר מחדש למכשירים, רגע…",
        "The home is reconnecting to your devices, one moment…",
    ),
    _H.ISSUE_COORDINATOR_FAILED: (
        "הבית איבד קשר עם המכשירים האלחוטיים — אני מנסה לחבר מחדש.",
        "The home lost contact with your wireless devices — I'm reconnecting them.",
    ),
    _H.ISSUE_COORDINATOR_DEVS_GONE: (
        "רוב המכשירים נעלמו מהבית בבת אחת — נראה שיש תקלת חיבור, אני מטפל בזה.",
        "Most devices dropped off at once — looks like a connection glitch, I'm on it.",
    ),
    _H.ISSUE_DEVICES_OFFLINE_MANY: (
        "כמה מכשירים לא מגיבים כרגע ({offline}).",
        "A few devices aren't responding right now ({offline}).",
    ),
    _H.ISSUE_DEVICES_OFFLINE: (
        "מכשיר אחד או שניים לא מגיבים כרגע.",
        "A device or two isn't responding right now.",
    ),
}

_FALLBACK = (
    "משהו בבית לא לגמרי תקין — אני בודק.",
    "Something at home isn't quite right — I'm looking into it.",
)


def summarize_health(snapshot: dict, lang: str = "en") -> str:
    """One-line, jargon-free summary of a compute_system_health() payload."""
    primary = (snapshot or {}).get("primary", _H.ISSUE_OK)
    he, en = _HEALTH_LINES.get(primary, _FALLBACK)
    line = he if lang == "he" else en
    offline = ((snapshot or {}).get("devices") or {}).get("offline", 0)
    return line.format(offline=offline)


# NOTE: {label} already carries the Hebrew definite article (he_noun → "המנורה"),
# so Hebrew templates must NOT prepend another ה (avoids "ההמנורה").
_SELF_HEAL_LINES: dict[str, tuple[str, str]] = {
    "synced": (
        "{label} כבר במצב הנכון.",
        "The {label} is already in the right state.",
    ),
    "recovered": (
        "היה עקשן רגע — החזרתי את {label} למצב הנכון.",
        "It was being stubborn — I got the {label} back to the right state.",
    ),
    "failed": (
        "לא הצלחתי להחזיר את {label} מרחוק. כבו אותו מהמפסק בקיר לכ-20 שניות ואז הדליקו "
        "שוב — זה בדרך כלל מסדר תאורה שנתקעה. אם זה חוזר, אולי שווה להחליף.",
        "I couldn't recover the {label} from here. Switch it off at the wall for ~20 seconds, "
        "then back on — that usually clears a stuck bulb. If it keeps happening, it may need replacing.",
    ),
    "healing": (
        "אני עוד עובד על {label}, שנייה…",
        "I'm still working on the {label}, one sec…",
    ),
}

_MANUAL_ACTION_LINES: dict[str, tuple[str, str]] = {
    _H.MANUAL_REPLUG_DONGLE: (
        "יש התקן קטן שמחבר את הבית למכשירים האלחוטיים. תנתק אותו מהחשמל, "
        "חכה חמש שניות, וחבר אותו חזרה — זה בדרך כלל פותר את זה.",
        "There's a small adapter that links your home to its wireless devices. "
        "Unplug it, wait five seconds, and plug it back in — that usually fixes it.",
    ),
}


def describe_self_heal_outcome(outcome: str, device_label: str, lang: str = "en") -> str:
    """Warm, jargon-free line for a manual_refresh_heal() outcome, naming the device."""
    he, en = _SELF_HEAL_LINES.get(outcome, _SELF_HEAL_LINES["healing"])
    line = he if lang == "he" else en
    return line.format(label=device_label)


def describe_manual_action(code: str, lang: str = "en") -> str:
    """Plain-language physical step when auto-recovery is exhausted (no engine terms)."""
    pair = _MANUAL_ACTION_LINES.get(code)
    if not pair:
        return ""
    return pair[0] if lang == "he" else pair[1]


# recover_connectivity outcomes → jargon-free lines (no "reload"/"coordinator").
_RECOVERY_LINES: dict[str, tuple[str, str]] = {
    "in_progress":  ("אני כבר על זה, שנייה.", "I'm already on it, one sec."),
    "nothing_to_do": ("אין כרגע מה לחבר מחדש.", "There's nothing to reconnect right now."),
    "healthy":      ("הכול מחובר ותקין 🙂", "Everything's connected and healthy."),
    "reconnected":  (
        "חיברתי מחדש את המכשירים — אמור להיות בסדר עכשיו.",
        "I reconnected your devices — should be good now.",
    ),
}


def describe_recovery(outcome: str, lang: str = "en") -> str:
    """Translate a connectivity-recovery outcome. 'needs_replug' reuses the replug step."""
    if outcome == "needs_replug":
        return describe_manual_action(_H.MANUAL_REPLUG_DONGLE, lang)
    he, en = _RECOVERY_LINES.get(outcome, _RECOVERY_LINES["in_progress"])
    return he if lang == "he" else en


# A fix the agent may offer but not take on its own (this home's autonomy
# setting says ask first). Stated as a plain hold-off, NOT as "should I?" — a
# yes typed in chat isn't an approval channel yet, so promising to act on one
# would be a dead end. Gender-free by construction.
_APPROVAL_LINES: dict[str, tuple[str, str]] = {
    "refresh_device": (
        "ההגדרות בבית לא נותנות לי לטפל ב{label} לבד, אז לא נגעתי.",
        "This home's settings don't let me touch the {label} on my own, so I've left it alone.",
    ),
    "recover_connectivity": (
        "ההגדרות בבית לא נותנות לי לחבר מחדש את המכשירים לבד, אז לא עשיתי את זה.",
        "This home's settings don't let me reconnect your devices on my own, so I haven't.",
    ),
}

_APPROVAL_FALLBACK = (
    "ההגדרות בבית לא נותנות לי לעשות את זה לבד, אז לא נגעתי.",
    "This home's settings don't let me do that on my own, so I've left it alone.",
)


def describe_needs_approval(fix: str, lang: str = "en", device_label: str = "") -> str:
    """Say — warmly, without jargon — that a fix is out of the agent's own hands."""
    he, en = _APPROVAL_LINES.get(fix, _APPROVAL_FALLBACK)
    line = he if lang == "he" else en
    return line.format(label=device_label)


# "Why won't my new device connect?" — one line per verdict from
# services.pairing_doctor. Hebrew keeps the device out of the subject slot
# ("החיבור של X…") so we never guess a device's grammatical gender.
_PAIRING_LINES: dict[str, tuple[str, str]] = {
    "radio_starting": (
        "הבית עוד מתעורר ומתחבר למכשירים — כדאי לחכות דקה ואז לנסות שוב.",
        "The home is still waking up and finding your devices — give it a minute, then try again.",
    ),
    "stalled": (
        "החיבור של {stalled} התחיל אבל לא הסתיים. כדאי להחזיר אותו למצב חיבור "
        "(בדרך כלל לחיצה ארוכה על הכפתור שלו), לקרב אותו לזיגי, ולנסות שוב.",
        "{stalled} started connecting but never finished. Put it back into pairing mode "
        "(usually a long press on its button), keep it close to Ziggy, and try again.",
    ),
    "awaiting_setup": (
        "אני כבר רואה את {pending} — נשאר רק לסיים את ההוספה באפליקציה.",
        "I can already see {pending} — all that's left is finishing it in the app.",
    ),
    "pairing_closed": (
        "מצב החיבור לא פתוח כרגע. צריך לפתוח הוספת מכשיר באפליקציה, "
        "ורק אז להפעיל את המכשיר החדש.",
        "The home isn't open to new devices right now. Start Add device in the app first, "
        "then wake the new one.",
    ),
    "ready": (
        "מהצד שלי הכול מוכן — הבית פתוח ומקשיב. כדאי להחזיר את המכשיר החדש "
        "למצב חיבור ולהחזיק אותו קרוב לזיגי.",
        "Everything's ready on my side — the home is open and listening. Put the new device "
        "back into pairing mode and keep it close to Ziggy.",
    ),
}

_RADIO_DOWN_PREFIX = (
    "המכשירים האלחוטיים בבית לא מגיבים כרגע, אז שום מכשיר חדש לא יצליח להתחבר. ",
    "Your wireless devices aren't reachable right now, so nothing new can join yet. ",
)


def describe_pairing(assessment: dict, lang: str = "en") -> str:
    """Explain why a new device isn't connecting — jargon-free, with the next step."""
    a = assessment or {}
    verdict = a.get("verdict", "ready")
    if verdict == "radio_down":
        prefix = _RADIO_DOWN_PREFIX[0] if lang == "he" else _RADIO_DOWN_PREFIX[1]
        return prefix + describe_manual_action(_H.MANUAL_REPLUG_DONGLE, lang)
    he, en = _PAIRING_LINES.get(verdict, _PAIRING_LINES["ready"])
    line = he if lang == "he" else en
    return line.format(
        stalled=", ".join(str(n) for n in (a.get("stalled_names") or [])),
        pending=", ".join(str(n) for n in (a.get("pending_names") or [])),
    )


def describe_ack(count: int, lang: str = "en") -> str:
    """Confirm the user's 'these are fine, stop flagging them'."""
    if lang == "he":
        return "סבבה, לא אטריד אותך על אלה יותר."
    return "Got it — I won't flag those again."


def describe_down_devices(items: list[dict], lang: str = "en") -> str:
    """Summarize the proactive down-device scan, naming the quiet devices."""
    if not items:
        return ("כל המכשירים מדברים עם הבית — הכול טוב 🙂" if lang == "he"
                else "All your devices are talking to the home — all good.")
    names = ", ".join(str(i.get("name", "?")) for i in items)
    n = len(items)
    if lang == "he":
        what = "מכשיר אחד ששקט" if n == 1 else f"{n} מכשירים ששקטים"
        return (f"מצאתי {what} כבר זמן מה: {names}. כדאי לכבות ולהדליק אותם מהמפסק "
                f"בקיר, ואבדוק אם חזרו לדבר.")
    what = "one device that's been quiet" if n == 1 else f"{n} devices that have been quiet"
    return (f"I found {what} for a while: {names}. Worth switching them off and on at "
            f"the wall — I'll check if they come back.")


def describe_cause(result: dict | None, device_label: str, lang: str = "en") -> str:
    """Explain what caused a device to change — naming the routine/person/device.

    Hebrew keeps the device as the OBJECT of the action (e.g. 'X כיבתה את המנורה')
    so we never have to guess the device's grammatical gender.
    """
    if not result:
        return ("לא מצאתי שינוי כזה לאחרונה." if lang == "he"
                else "I couldn't find a recent change like that.")
    state = str(result.get("state") or "").lower()
    kind = result.get("cause_kind")
    name = result.get("cause_name")
    t = _hhmm(result.get("when"))
    if lang == "he":
        at = f" ב-{t}" if t else ""
        did = "כיבתה" if state == "off" else ("הדליקה" if state == "on" else "שינתה")
        did_m = "כיבה" if state == "off" else ("הדליק" if state == "on" else "שינה")
        if kind == "automation" and name:
            return f'מצאתי — השגרה "{name}" {did} את {device_label}{at}.'
        if kind == "person":
            return f"מישהו {did_m} את {device_label} מהאפליקציה{at}."
        if kind == "device" and name:
            return f"משהו {did_m} את {device_label}{at} — בעקבות {name}."
        return f"לא הצלחתי לזהות מה {did_m} את {device_label}{at}."
    at = f" at {t}" if t else ""
    verb = "turned off" if state == "off" else ("turned on" if state == "on" else "changed")
    if kind == "automation" and name:
        return f'Found it — the routine "{name}" {verb} {device_label}{at}.'
    if kind == "person":
        return f"{device_label} was {verb}{at} by someone from the app."
    if kind == "device" and name:
        return f"{device_label} was {verb}{at}, triggered by {name}."
    return f"{device_label} {verb}{at}, but I couldn't tell what caused it."


def describe_diagnosis(device_label: str, is_on: bool, last_intended: str | None,
                       lang: str = "en") -> str:
    """One-line jargon-free read on a single device (label already carries Hebrew ה)."""
    on_he = "דולק" if is_on else "כבוי"
    on_en = "on" if is_on else "off"
    mismatch = bool(last_intended) and ((last_intended == "on") != bool(is_on))
    if mismatch:
        want_en = "on" if last_intended == "on" else "off"
        if lang == "he":
            return f"ביקשו מ{device_label} להשתנות, אבל הוא {on_he} כרגע — משהו לא מתעדכן."
        return f"The {device_label} was asked to turn {want_en}, but it's {on_en} right now."
    if lang == "he":
        return f"{device_label} נראה תקין — הוא {on_he} כרגע."
    return f"The {device_label} looks fine — it's {on_en} right now."
