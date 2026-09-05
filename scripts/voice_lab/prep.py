"""Text pre-processing chain for the Voice Lab renders.

Each step is a pure function str -> str. `run(text, ["sanitize", "nikud"])`
applies them in order. The lab uses these to render variants; the product
version lives in services/speech_text.py once a variant wins sitting B, and
that module's tests import THIS file's expectations for the approved lines.

Steps
  sanitize   exactly what backend/routers/tts_router._sanitize_for_tts does
             today (markdown symbols, bullets, whitespace) — the baseline.
  normalize  clock times, temperatures, percents, decimals and counted
             numbers → Hebrew words with correct gender for Ziggy's nouns.
  lexicon    room / device / brand / person names → the spoken form.
  nikud      full vowel pointing with phonikud (local ONNX), then strip the
             marks Cartesia must not see (prefix bar, stress, meteg).
"""
from __future__ import annotations

import re
from pathlib import Path

# ---------------------------------------------------------------------------
# sanitize — mirror of tts_router (kept identical on purpose)
# ---------------------------------------------------------------------------
_STRIP = re.compile(r"[|*_`#]+")
_BULLET = re.compile(r"^\s*[-•·]\s+", re.MULTILINE)
_WS = re.compile(r"\s+")


def sanitize(text: str) -> str:
    if not text:
        return text
    out = _BULLET.sub("", text)
    out = _STRIP.sub(" ", out)
    out = _WS.sub(" ", out).strip()
    return out or text


# ---------------------------------------------------------------------------
# normalize — numbers in Hebrew
# ---------------------------------------------------------------------------
# Cardinal numbers 0-59 in both genders (Modern Hebrew, spoken register).
_F_UNITS = ["אפס", "אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע"]
_M_UNITS = ["אפס", "אחד", "שניים", "שלושה", "ארבעה", "חמישה", "שישה", "שבעה", "שמונה", "תשעה"]
_F_TEENS = ["עשר", "אחת עשרה", "שתים עשרה", "שלוש עשרה", "ארבע עשרה", "חמש עשרה",
            "שש עשרה", "שבע עשרה", "שמונה עשרה", "תשע עשרה"]
_M_TEENS = ["עשרה", "אחד עשר", "שנים עשר", "שלושה עשר", "ארבעה עשר", "חמישה עשר",
            "שישה עשר", "שבעה עשר", "שמונה עשר", "תשעה עשר"]
_TENS = ["", "", "עשרים", "שלושים", "ארבעים", "חמישים", "שישים", "שבעים", "שמונים", "תשעים"]
# Construct forms used directly before a noun (שני מכשירים, שתי מנורות).
_F_CONSTRUCT = {2: "שתי"}
_M_CONSTRUCT = {2: "שני"}


def number_words(n: int, gender: str = "f", construct: bool = False) -> str:
    """0..999 → Hebrew words. gender 'f' (default for counting/abstract) or 'm'."""
    if n < 0:
        return "מינוס " + number_words(-n, gender, construct)
    units, teens = (_M_UNITS, _M_TEENS) if gender == "m" else (_F_UNITS, _F_TEENS)
    cons = _M_CONSTRUCT if gender == "m" else _F_CONSTRUCT
    if construct and n in cons:
        return cons[n]
    if n < 10:
        return units[n]
    if n < 20:
        return teens[n - 10]
    if n < 100:
        t, u = divmod(n, 10)
        return _TENS[t] if u == 0 else f"{_TENS[t]} ו{units[u]}"
    h, rest = divmod(n, 100)
    hundreds = {1: "מאה", 2: "מאתיים"}.get(h, f"{_F_UNITS[h]} מאות")
    return hundreds if rest == 0 else f"{hundreds} ו{number_words(rest, gender)}"


# Nouns Ziggy counts, with gender. Plural forms as they appear in replies.
_NOUN_GENDER = {
    # masculine
    "מכשירים": "m", "מכשיר": "m", "חלונות": "m", "חלון": "m", "אורות": "m", "אור": "m",
    "אחוז": "m", "אחוזים": "m", "ימים": "m", "יום": "m", "חדרים": "m", "חדר": "m",
    "מזגנים": "m", "מזגן": "m", "תריסים": "m", "תריס": "m", "חיישנים": "m", "חיישן": "m",
    "וואט": "m", "ואט": "m", "מטרים": "m", "ליטר": "m", "ליטרים": "m",
    # feminine
    "מנורות": "f", "מנורה": "f", "דקות": "f", "דקה": "f", "שניות": "f", "שנייה": "f",
    "שעות": "f", "שעה": "f", "מעלות": "f", "מעלה": "f", "משימות": "f", "משימה": "f",
    "דלתות": "f", "דלת": "f", "פעמים": "f", "פעם": "f", "טלוויזיות": "f",
    # plural adjectives standing in for a masculine noun ("11 מחוברים")
    "מחוברים": "m", "פעילים": "m", "דולקים": "m", "כבויים": "m", "פתוחים": "m",
    "סגורים": "m", "שקטים": "m", "שקט": "m",
    "דולקות": "f", "כבויות": "f", "פתוחות": "f", "סגורות": "f",
}

_TIME_RE = re.compile(r"(?<!\d)(\d{1,2}):(\d{2})(?!\d)")
_TEMP_RE = re.compile(r"(?<![\d.])(-?\d{1,2}(?:\.\d)?)\s*°\s*C?", re.IGNORECASE)
_PCT_RE = re.compile(r"(?<![\d.])(\d{1,3}(?:\.\d)?)\s*%")
_DECIMAL_RE = re.compile(r"(?<![\d.])(\d{1,3})\.(\d)(?!\d)")
_COUNT_RE = re.compile(r"(?<![\d.:])(\d{1,3})(?![\d.:%°])\s+([א-ת]+)")
_LONE_NUM_RE = re.compile(r"(?<![\d.:])(\d{1,3})(?![\d.:%°])")
_PREFIX_RE = re.compile(r"([בלמכשוה])-(?=\d)")


def _hour_words(h: int, m: int) -> str:
    # Spoken Israeli clock: 24h is what the UI shows; say it as-is in feminine
    # (hours are feminine: "עשרים ושלוש", "שש וחצי", "שבע ורבע").
    h_words = number_words(h, "f")
    if m == 0:
        return h_words
    if m == 30:
        return f"{h_words} וחצי"
    if m == 15:
        return f"{h_words} ורבע"
    if m == 45:
        return f"{h_words} ארבעים וחמש"
    return f"{h_words} {number_words(m, 'f')}"


def normalize(text: str) -> str:
    out = text
    # "ב-23:00" → "ב 23:00" so the prefix survives; then words.
    out = _PREFIX_RE.sub(r"\1", out)
    out = _TIME_RE.sub(lambda m: _hour_words(int(m.group(1)), int(m.group(2))), out)
    # temperature: "24°C" / "24°" → "24 מעלות" (then count rule makes it feminine)
    out = _TEMP_RE.sub(lambda m: f"{m.group(1)} מעלות", out)
    # percent: "45%" → "45 אחוז" (masculine, singular form as Israelis say it)
    out = _PCT_RE.sub(lambda m: f"{m.group(1)} אחוז", out)
    # decimals: 21.5 → "עשרים ואחת נקודה חמש"
    out = _DECIMAL_RE.sub(lambda m: f"{number_words(int(m.group(1)), 'f')} נקודה "
                                    f"{number_words(int(m.group(2)), 'f')}", out)

    def _count(m: re.Match) -> str:
        n, noun = int(m.group(1)), m.group(2)
        # strip a prefixed conjunction/preposition when looking up the noun
        bare = noun
        g = _NOUN_GENDER.get(bare)
        if g is None and len(bare) > 2 and bare[0] in "והבלמכש":
            g = _NOUN_GENDER.get(bare[1:])
        if g is None:
            return m.group(0)  # unknown noun: leave digits alone (engine rule)
        # "1 X" → "X אחד/אחת" (Hebrew puts 'one' after the noun)
        if n == 1:
            return f"{noun} {'אחד' if g == 'm' else 'אחת'}"
        return f"{number_words(n, g, construct=True)} {noun}"

    out = _COUNT_RE.sub(_count, out)
    # A digit NOT followed by a Hebrew word (e.g. "(5)", "ו-1", end of
    # sentence) is a bare count → feminine counting form. A digit followed
    # by an unknown noun stays a digit (engine rule: never guess gender).
    out = _LONE_NUM_RE.sub(
        lambda m: m.group(0) if re.match(r"\s+[א-ת]", out[m.end():m.end() + 2])
        else number_words(int(m.group(1)), "f"), out)
    return _WS.sub(" ", out).strip()


# ---------------------------------------------------------------------------
# lexicon — names and brands → spoken form
# ---------------------------------------------------------------------------
# Latin brand/device names → how Israelis say them (Hebrew spelling wins over
# IPA: it survives every model and the nikud pass can vowel it).
LEXICON: dict[str, str] = {
    "netflix": "נטפליקס",
    "youtube": "יוטיוב",
    "wifi": "וויי-פיי", "wi-fi": "וויי-פיי",
    "mibox": "מי-בוקס", "mibox4": "מי-בוקס",
    "switcher": "סוויצ'ר",
    "spotify": "ספוטיפיי",
    "lg": "אל-ג'י",
    "tv": "טי-וי",
    "ziggy": "זיגי",
    "ok": "אוקיי",
}
_LATIN_WORD = re.compile(r"[A-Za-z][A-Za-z0-9\-']*")


def lexicon(text: str) -> str:
    def _sub(m: re.Match) -> str:
        w = m.group(0)
        return LEXICON.get(w.lower(), w)
    out = _LATIN_WORD.sub(_sub, text)
    # "ה-נטפליקס" → "הנטפליקס": the maqaf was only there for the Latin word
    out = re.sub(r"([בלמכשוה])-(?=[א-ת])", r"\1", out)
    return out


# ---------------------------------------------------------------------------
# nikud — phonikud
# ---------------------------------------------------------------------------
_PHONIKUD = None
_MODEL_CANDIDATES = [
    Path(__file__).resolve().parents[2] / "models" / "phonikud" / "phonikud-1.0.int8.onnx",
    Path.home() / ".ziggy" / "models" / "phonikud-1.0.int8.onnx",
]
# phonikud adds: '|' prefix separator, U+05AB (stress), U+05BD (meteg = vocal shva).
# Cartesia reads '|' aloud; the two marks are not part of standard nikud.
_PHONIKUD_MARKS = re.compile("[|ֽ֫]")


def _phonikud():
    global _PHONIKUD
    if _PHONIKUD is None:
        from phonikud_onnx import Phonikud
        for p in _MODEL_CANDIDATES:
            if p.exists():
                _PHONIKUD = Phonikud(str(p))
                break
        else:
            raise RuntimeError("phonikud model not found; see scripts/voice_lab/README.md")
    return _PHONIKUD


def nikud(text: str) -> str:
    """Vowel-point Hebrew words; leave Latin/digits untouched."""
    v = _phonikud().add_diacritics(text)
    return _PHONIKUD_MARKS.sub("", v)


STEPS = {"sanitize": sanitize, "normalize": normalize, "lexicon": lexicon, "nikud": nikud}


def run(text: str, steps: list[str]) -> str:
    out = text
    for s in steps:
        out = STEPS[s](out)
    return out
