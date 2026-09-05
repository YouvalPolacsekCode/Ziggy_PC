"""Spoken-text preparation for Hebrew TTS.

Sits between a reply and the synthesizer (backend/routers/tts_router.py).
Built from the Voice Lab sittings of 2026-09-05 (see
docs/superpowers/specs/2026-09-05-hebrew-voice-lab-design.md and
scripts/voice_lab/): on the operator's 22 mispronounced lines, these text
rules alone fixed 17. Whole-sentence vowel pointing made things WORSE
(the engine reads a pointed בּ as v and drops vowels), so pointing is
applied only to a small dictionary of words verified one by one.

Pipeline (all pure functions, all deterministic):

    sanitize  → strip markdown/structural symbols (unchanged legacy step)
    pauses    → ":" before a list becomes a period; "(…)" becomes a comma clause
    normalize → clock times to the 12-hour spoken form, °/% to words, decimals,
                counted numbers in the noun's gender ("שני מכשירים", "שתי דקות")
    wordfix   → per-word pronunciation dictionary (nikud or inline phonemes)

Gated by settings `voice.speech_text.enabled` (default ON for Hebrew). With
the flag off, `prepare_for_speech` returns exactly what the legacy sanitizer
returned, byte for byte. English text only gets `sanitize`.

No model, no network, no third-party dependency — safe on every hub.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# ---------------------------------------------------------------------------
# sanitize — the legacy step (kept identical to the old tts_router regexes)
# ---------------------------------------------------------------------------
_STRIP = re.compile(r"[|*_`#]+")
_BULLET = re.compile(r"^\s*[-•·]\s+", re.MULTILINE)
_WS = re.compile(r"\s+")


def sanitize(text: str) -> str:
    """Strip characters some voices read aloud by name (pipe, asterisk…)."""
    if not text:
        return text
    out = _BULLET.sub("", text)
    out = _STRIP.sub(" ", out)
    out = _WS.sub(" ", out).strip()
    return out or text


# ---------------------------------------------------------------------------
# pauses
# ---------------------------------------------------------------------------
_COLON_LIST_RE = re.compile(r":\s+(?=[א-תA-Za-z\"״'])")
_PAREN_RE = re.compile(r"\s*\(([^)]*)\)")


def pauses(text: str) -> str:
    """The voice ran straight through ':' before a list and into '(…)'."""
    out = _COLON_LIST_RE.sub(". ", text)
    return _PAREN_RE.sub(r", \1", out)


# ---------------------------------------------------------------------------
# normalize — numbers, times, units in spoken Hebrew
# ---------------------------------------------------------------------------
_F_UNITS = ["אפס", "אחת", "שתיים", "שלוש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע"]
_M_UNITS = ["אפס", "אחד", "שניים", "שלושה", "ארבעה", "חמישה", "שישה", "שבעה", "שמונה", "תשעה"]
_F_TEENS = ["עשר", "אחת עשרה", "שתים עשרה", "שלוש עשרה", "ארבע עשרה", "חמש עשרה",
            "שש עשרה", "שבע עשרה", "שמונה עשרה", "תשע עשרה"]
_M_TEENS = ["עשרה", "אחד עשר", "שנים עשר", "שלושה עשר", "ארבעה עשר", "חמישה עשר",
            "שישה עשר", "שבעה עשר", "שמונה עשר", "תשעה עשר"]
_TENS = ["", "", "עשרים", "שלושים", "ארבעים", "חמישים", "שישים", "שבעים", "שמונים", "תשעים"]
_F_CONSTRUCT = {2: "שתי"}
_M_CONSTRUCT = {2: "שני"}


def number_words(n: int, gender: str = "f", construct: bool = False) -> str:
    """0..999 → Hebrew words. gender 'f' (counting/abstract default) or 'm'."""
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


# Nouns Ziggy counts, with gender; plural adjectives that stand in for one.
NOUN_GENDER: dict[str, str] = {
    "מכשירים": "m", "מכשיר": "m", "חלונות": "m", "חלון": "m", "אורות": "m", "אור": "m",
    "אחוז": "m", "אחוזים": "m", "ימים": "m", "יום": "m", "חדרים": "m", "חדר": "m",
    "מזגנים": "m", "מזגן": "m", "תריסים": "m", "תריס": "m", "חיישנים": "m", "חיישן": "m",
    "וואט": "m", "ואט": "m", "מטרים": "m", "ליטר": "m", "ליטרים": "m",
    "מנורות": "f", "מנורה": "f", "דקות": "f", "דקה": "f", "שניות": "f", "שנייה": "f",
    "שעות": "f", "שעה": "f", "מעלות": "f", "מעלה": "f", "משימות": "f", "משימה": "f",
    "דלתות": "f", "דלת": "f", "פעמים": "f", "פעם": "f", "טלוויזיות": "f",
    "מחוברים": "m", "פעילים": "m", "דולקים": "m", "כבויים": "m", "פתוחים": "m",
    "סגורים": "m", "שקטים": "m", "שקט": "m",
    "דולקות": "f", "כבויות": "f", "פתוחות": "f", "סגורות": "f",
}
_ADJECTIVES = {"מחוברים", "פעילים", "דולקים", "כבויים", "פתוחים", "סגורים", "שקטים", "שקט",
               "דולקות", "כבויות", "פתוחות", "סגורות"}

_TIME_RE = re.compile(r"(?<!\d)(\d{1,2}):(\d{2})(?!\d)")
_TEMP_RE = re.compile(r"(?<![\d.])(-?\d{1,2}(?:\.\d)?)\s*°\s*C?", re.IGNORECASE)
_PCT_RE = re.compile(r"(?<![\d.])(\d{1,3}(?:\.\d)?)\s*%")
_DECIMAL_RE = re.compile(r"(?<![\d.])(\d{1,3})\.(\d)(?!\d)")
_COUNT_RE = re.compile(r"(?<![\d.:])(\d{1,3})(?![\d:%°])(?!\.\d)\s+([א-ת]+)")
_LONE_NUM_RE = re.compile(r"(?<![\d.:])(\d{1,3})(?![\d:%°])(?!\.\d)")
_PREFIX_RE = re.compile(r"([בלמכשוה])-(?=\d)")


def _hour12(h: int) -> int:
    h = h % 12
    return 12 if h == 0 else h


def _hour_words(h: int, m: int) -> str:
    # Israelis WRITE 23:00 and SAY "אחת עשרה"; hours are feminine;
    # :15 = "ורבע", :30 = "וחצי", :45 = "רבע ל<next hour>".
    h_words = number_words(_hour12(h), "f")
    if m == 0:
        return h_words
    if m == 30:
        return f"{h_words} וחצי"
    if m == 15:
        return f"{h_words} ורבע"
    if m == 45:
        return f"רבע ל{number_words(_hour12(h + 1), 'f')}"
    return f"{h_words} {number_words(m, 'f')}"


def normalize(text: str) -> str:
    out = _PREFIX_RE.sub(r"\1", text)                     # "ב-23:00" → "ב23:00"
    out = _TIME_RE.sub(lambda m: _hour_words(int(m.group(1)), int(m.group(2))), out)
    out = _TEMP_RE.sub(lambda m: f"{m.group(1)} מעלות", out)
    out = _PCT_RE.sub(lambda m: f"{m.group(1)} אחוז", out)
    out = _DECIMAL_RE.sub(lambda m: f"{number_words(int(m.group(1)), 'f')} נקודה "
                                    f"{number_words(int(m.group(2)), 'f')}", out)

    def _count(m: re.Match) -> str:
        n, noun = int(m.group(1)), m.group(2)
        bare = noun
        g = NOUN_GENDER.get(bare)
        if g is None and len(bare) > 2 and bare[0] in "והבלמכש":
            bare = bare[1:]
            g = NOUN_GENDER.get(bare)
        if g is None:
            return m.group(0)                             # unknown noun: never guess gender
        if n == 1:
            one = "אחד" if g == "m" else "אחת"
            return f"{one} {noun}" if bare in _ADJECTIVES else f"{noun} {one}"
        return f"{number_words(n, g, construct=True)} {noun}"

    out = _COUNT_RE.sub(_count, out)
    out = _LONE_NUM_RE.sub(
        lambda m: m.group(0) if re.match(r"\s+[א-ת]", out[m.end():m.end() + 2])
        else number_words(int(m.group(1)), "f"), out)
    return _WS.sub(" ", out).strip()


# ---------------------------------------------------------------------------
# wordfix — per-word pronunciation dictionary
# ---------------------------------------------------------------------------
# Keyed by the plain word as it appears in replies; value is what the engine
# gets instead. Each entry was heard and approved by the operator in the lab;
# see scripts/voice_lab/prep.py WORDFIX for provenance. Add entries there
# first, prove them in a sitting, then copy here.
WORDFIX: dict[str, str] = {
    "הדוד":    "הַדּוּד",       # water heater, not uncle
    "דוד":     "דּוּד",
    "כוונתי":  "כִּוַּנְתִּי",
    "כיוונתי": "כִּיוַּנְתִּי",
    "ירדו":    "יֵרְדוּ",       # future tense in schedules
    "השלט":    "הַשָּׁלָט",
    "שלט":     "שָׁלָט",
    "מאיה":    "מַאיָה",
    "ומאיה":   "וְמַאיָה",
    "ריק":     "רֵיק",
    "יכבו":    "יְכַבּוּ",
    "בסלון":   "בַּסָּלוֹן",
    "במטבח":   "בַּמִּטְבָּח",
    "בחצר":    "בַּחָצֵר",
}
_NIKUD_ALL = re.compile(r"[֑-ׇ]")
_TOKEN_RE = re.compile(r"([^\s]+)")
_EDGE_PUNCT = re.compile(r"^([^\wא-ת֑-ׇ]*)(.*?)([^\wא-ת֑-ׇ]*)$", re.UNICODE)


def strip_nikud(s: str) -> str:
    return _NIKUD_ALL.sub("", s)


def wordfix(text: str, extra: dict[str, str] | None = None) -> str:
    table = {**WORDFIX, **(extra or {})}

    def _tok(m: re.Match) -> str:
        lead, core, tail = _EDGE_PUNCT.match(m.group(1)).groups()
        rep = table.get(strip_nikud(core))
        return f"{lead}{rep}{tail}" if rep else m.group(0)
    return _TOKEN_RE.sub(_tok, text)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
STEPS = {"sanitize": sanitize, "pauses": pauses, "normalize": normalize, "wordfix": wordfix}
HE_CHAIN = ("sanitize", "pauses", "normalize", "wordfix")
EN_CHAIN = ("sanitize",)


@dataclass
class SpeechText:
    original: str
    spoken: str
    lang: str
    steps: tuple[str, ...] = field(default_factory=tuple)

    @property
    def changed(self) -> bool:
        return self.spoken != self.original


def _enabled() -> bool:
    try:
        from core.settings_loader import settings
        cfg = ((settings.get("voice") or {}).get("speech_text") or {})
        return bool(cfg.get("enabled", True))
    except Exception:
        return True


def _home_words() -> dict[str, str]:
    """Per-home dictionary additions: voice.speech_text.words {plain: spoken}."""
    try:
        from core.settings_loader import settings
        words = ((settings.get("voice") or {}).get("speech_text") or {}).get("words") or {}
        return {str(k): str(v) for k, v in words.items()}
    except Exception:
        return {}


def prepare_for_speech(text: str, lang: str = "he", *, enabled: bool | None = None) -> SpeechText:
    """Return the text the synthesizer should receive for `text` in `lang`."""
    on = _enabled() if enabled is None else enabled
    if not on or lang != "he":
        return SpeechText(text, sanitize(text), lang, ("sanitize",))
    out = text
    for step in HE_CHAIN:
        out = wordfix(out, _home_words()) if step == "wordfix" else STEPS[step](out)
    return SpeechText(text, out, lang, HE_CHAIN)
