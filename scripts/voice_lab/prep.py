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
_ADJECTIVES = {"מחוברים", "פעילים", "דולקים", "כבויים", "פתוחים", "סגורים", "שקטים", "שקט",
               "דולקות", "כבויות", "פתוחות", "סגורות"}

_TIME_RE = re.compile(r"(?<!\d)(\d{1,2}):(\d{2})(?!\d)")
_TEMP_RE = re.compile(r"(?<![\d.])(-?\d{1,2}(?:\.\d)?)\s*°\s*C?", re.IGNORECASE)
_PCT_RE = re.compile(r"(?<![\d.])(\d{1,3}(?:\.\d)?)\s*%")
_DECIMAL_RE = re.compile(r"(?<![\d.])(\d{1,3})\.(\d)(?!\d)")
# A digit run that is not part of a time/decimal/percent/degree token. A
# trailing sentence period ("(5).") must NOT count as a decimal point.
_COUNT_RE = re.compile(r"(?<![\d.:])(\d{1,3})(?![\d:%°])(?!\.\d)\s+([א-ת]+)")
_LONE_NUM_RE = re.compile(r"(?<![\d.:])(\d{1,3})(?![\d:%°])(?!\.\d)")
_PREFIX_RE = re.compile(r"([בלמכשוה])-(?=\d)")


def _hour12(h: int) -> int:
    h = h % 12
    return 12 if h == 0 else h


def _hour_words(h: int, m: int) -> str:
    # Spoken Israeli clock (sitting A verdict): the UI writes 23:00 but people
    # SAY "אחת עשרה"; hours are feminine; :15 = "ורבע", :30 = "וחצי",
    # :45 = "רבע ל<next hour>". Day-part words (בבוקר/בערב) stay as the reply
    # text already carries them.
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


_COLON_LIST_RE = re.compile(r":\s+(?=[א-תA-Za-z\"״'])")
_PAREN_RE = re.compile(r"\s*\(([^)]*)\)")


def pauses(text: str) -> str:
    """Sitting A: the voice runs straight through ':' before a list and into
    '(…)'. A period is the strongest pause Cartesia honours; parentheses
    become a comma clause ("(חיישן תנועה)" → ", חיישן תנועה")."""
    out = _COLON_LIST_RE.sub(". ", text)
    out = _PAREN_RE.sub(r", \1", out)
    return out


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
        # "1 X" → "X אחד/אחת" (Hebrew puts 'one' after a NOUN) but "1 שקט"
        # (adjective standing for a device) keeps 'one' first: "אחד שקט".
        if n == 1:
            one = "אחד" if g == "m" else "אחת"
            return f"{one} {noun}" if bare in _ADJECTIVES else f"{noun} {one}"
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


# Words phonikud points wrong for Ziggy's domain (sitting A, 2026-09-05).
# Keyed by the UNVOCALIZED word; value is the pointed form. This is Ziggy's
# pronunciation dictionary in Hebrew script — it survives model swaps.
NIKUD_FIXUPS: dict[str, str] = {
    "הדוד":    "הַדּוּד",       # water heater (dud), not uncle (dod)
    "דוד":     "דּוּד",
    "במטבח":   "בַּמִּטְבָּח",  # definite: ba-, not be-
    "בחצר":    "בַּחָצֵר",
    "השלט":    "הַשָּׁלָט",     # remote control: shalat
    "שלט":     "שָׁלָט",
    "שקט":     "שָׁקֵט",        # adjective (a quiet device), not the noun
    "כיוונתי": "כִּיוַּנְתִּי", # kivanti
    "כוונתי":  "כִּוַּנְתִּי",
    "ומאיה":   "וְמַאיָה",
    "מאיה":    "מַאיָה",
    "יכבו":    "יְכַבּוּ",       # "the lights will go off": yechabu (sitting A)
}
_NIKUD_ALL = re.compile(r"[֑-ׇ]")
_TOKEN_RE = re.compile(r"([^\s]+)")
# lead punctuation / word core (letters + nikud) / trailing punctuation
_EDGE_PUNCT = re.compile(r"^([^\wא-ת֑-ׇ]*)(.*?)([^\wא-ת֑-ׇ]*)$", re.UNICODE)


def strip_nikud(s: str) -> str:
    return _NIKUD_ALL.sub("", s)


def _apply_fixups(vocalized: str) -> str:
    def _tok(m: re.Match) -> str:
        lead, core, tail = _EDGE_PUNCT.match(m.group(1)).groups()
        fixed = NIKUD_FIXUPS.get(strip_nikud(core))
        return f"{lead}{fixed}{tail}" if fixed else m.group(0)
    return _TOKEN_RE.sub(_tok, vocalized)


def nikud(text: str) -> str:
    """Vowel-point Hebrew words; leave Latin/digits untouched; apply fixups."""
    v = _phonikud().add_diacritics(text)
    v = _PHONIKUD_MARKS.sub("", v)
    return _apply_fixups(v)


# ---------------------------------------------------------------------------
# ipa — every Hebrew word as an inline Cartesia phoneme override <<a|b|c>>
# ---------------------------------------------------------------------------
# Insurance in case the engine ignores nikud: phonikud's G2P output (χ ʁ ʔ ʃ
# ts, ˈ stress) was accepted by the API for sonic-3.5/3.6 (probe_ipa.py).
# Only Hebrew-script tokens are converted; Latin words, punctuation and
# already-normalized text pass through. Run AFTER normalize (no digits).
_HEBREW_CORE = re.compile(r"^[א-ת֑-ׇ'\"״׳־-]+$")


_IPA_VOWELS = set("aeiouəɛɔ")


def _to_cartesia_ipa(phones: str) -> str:
    """phonikud puts ˈ right before the stressed VOWEL ("hadˈud"); Cartesia's
    examples put it before the stressed SYLLABLE's onset ("s|ə|ˈ|p|i|n|ə").
    Move each stress mark left over the consonant cluster, then pipe-join."""
    chars = [c for c in phones if not c.isspace()]
    out: list[str] = []
    for c in chars:
        if c == "ˈ":
            j = len(out)
            while j > 0 and out[j - 1] not in _IPA_VOWELS and out[j - 1] != "ˈ":
                j -= 1
            out.insert(j, "ˈ")
        else:
            out.append(c)
    return "|".join(out)


def ipa(text: str) -> str:
    from phonikud import phonemize
    vocalized = nikud(text)

    def _tok(m: re.Match) -> str:
        lead, core, tail = _EDGE_PUNCT.match(m.group(1)).groups()
        if not core or not _HEBREW_CORE.match(core):
            return m.group(0)
        ph = phonemize(core).strip()
        if not ph:
            return m.group(0)
        return f"{lead}<<{_to_cartesia_ipa(ph)}>>{tail}"
    return _TOKEN_RE.sub(_tok, vocalized)


# ---------------------------------------------------------------------------
# wordfix — per-word pronunciation dictionary, NO global nikud
# ---------------------------------------------------------------------------
# Sitting B (2026-09-05): whole-sentence nikud fixed דוד/כיוונתי but made the
# engine read בּ as v and swallow vowels elsewhere (מכבה→mechave, יבשה→yevsha,
# כרגע→karaga). Whole-sentence IPA sounded bad. So: leave the sentence plain
# and touch only the words the operator flagged, each with the mechanism
# that worked for it — nikud when the word has no בגדכפת ambiguity, inline
# IPA when it does.
WORDFIX: dict[str, str] = {
    "הדוד":    "הַדּוּד",             # water heater (nikud worked in fix1)
    "דוד":     "דּוּד",
    "כוונתי":  "כִּוַּנְתִּי",       # kivanti (nikud worked in fix1)
    "כיוונתי": "כִּיוַּנְתִּי",
    "ירדו":    "יֵרְדוּ",             # future: yerdu (schedules), not past yardu
    # sitting C: these were right under nikud in fix1 and rolled wrong plain
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
# Candidates still being auditioned (not yet copied to services/speech_text).
# sitting D: nikud gave "achve", stressed IPA gave "achave" — trying again.
WORDFIX_OPEN: dict[str, str] = {
    "אכבה":    "אֲכַבֶּה",
    "שאכבה":   "שֶׁאֲכַבֶּה",
}


def wordfix(text: str, include_open: bool = True) -> str:
    table = {**WORDFIX, **(WORDFIX_OPEN if include_open else {})}

    def _tok(m: re.Match) -> str:
        lead, core, tail = _EDGE_PUNCT.match(m.group(1)).groups()
        rep = table.get(strip_nikud(core))
        return f"{lead}{rep}{tail}" if rep else m.group(0)
    return _TOKEN_RE.sub(_tok, text)


STEPS = {"sanitize": sanitize, "pauses": pauses, "normalize": normalize, "lexicon": lexicon,
         "nikud": nikud, "ipa": ipa, "wordfix": wordfix}


def run(text: str, steps: list[str]) -> str:
    out = text
    for s in steps:
        out = STEPS[s](out)
    return out
