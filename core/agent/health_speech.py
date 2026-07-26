"""Health/repair → warm human speech, jargon-free.

Maps ha_health snapshots, self-heal outcomes, and manual-action codes into short,
dugri, gender-free Hebrew+English the agent can say to a user. NEVER emits
"Home Assistant", entity_ids, "Zigbee", "coordinator", "integration", "MQTT" —
those are engine internals the user must never see (feedback_ziggy_product_surface).
"""
from __future__ import annotations

from services import ha_health as _H


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


_SELF_HEAL_LINES: dict[str, tuple[str, str]] = {
    "synced": (
        "ה{label} כבר במצב הנכון.",
        "The {label} is already in the right state.",
    ),
    "recovered": (
        "היה עקשן רגע — החזרתי את ה{label} למצב הנכון.",
        "It was being stubborn — I got the {label} back to the right state.",
    ),
    "failed": (
        "לא הצלחתי להחזיר את ה{label} מרחוק. כבו אותו מהמפסק בקיר לכ-20 שניות ואז הדליקו "
        "שוב — זה בדרך כלל מסדר תאורה שנתקעה. אם זה חוזר, אולי שווה להחליף.",
        "I couldn't recover the {label} from here. Switch it off at the wall for ~20 seconds, "
        "then back on — that usually clears a stuck light. If it keeps happening, it may need replacing.",
    ),
    "healing": (
        "אני עוד עובד על ה{label}, שנייה…",
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
