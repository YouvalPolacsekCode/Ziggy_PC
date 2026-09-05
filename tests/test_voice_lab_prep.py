"""Voice Lab text-prep chain (scripts/voice_lab/prep.py).

These lock the *deterministic* steps (sanitize, normalize, lexicon). The
nikud step needs the phonikud ONNX model and is skipped when it's absent.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "voice_lab"))
import prep  # noqa: E402


# ---- sanitize: must stay byte-identical to tts_router._sanitize_for_tts ----
def test_sanitize_matches_router():
    from backend.routers.tts_router import _sanitize_for_tts
    for t in ["- הדלקתי **את** האור | בסלון", "  רגע…  בודק ", "# כותרת\n* פריט", ""]:
        assert prep.sanitize(t) == _sanitize_for_tts(t)


# ---- numbers ----
@pytest.mark.parametrize("n,g,exp", [
    (0, "f", "אפס"), (1, "f", "אחת"), (1, "m", "אחד"), (2, "f", "שתיים"), (2, "m", "שניים"),
    (3, "f", "שלוש"), (3, "m", "שלושה"), (10, "f", "עשר"), (10, "m", "עשרה"),
    (11, "f", "אחת עשרה"), (12, "m", "שנים עשר"), (15, "f", "חמש עשרה"),
    (20, "f", "עשרים"), (24, "f", "עשרים וארבע"), (24, "m", "עשרים וארבעה"),
    (45, "f", "ארבעים וחמש"), (99, "m", "תשעים ותשעה"), (100, "f", "מאה"), (128, "f", "מאה ועשרים ושמונה"),
])
def test_number_words(n, g, exp):
    assert prep.number_words(n, g) == exp


def test_construct_forms_before_noun():
    assert prep.normalize("2 מכשירים פעילים") == "שני מכשירים פעילים"
    assert prep.normalize("2 מנורות דולקות") == "שתי מנורות דולקות"
    assert prep.normalize("3 מנורות דולקות") == "שלוש מנורות דולקות"
    assert prep.normalize("4 חלונות פתוחים") == "ארבעה חלונות פתוחים"


def test_one_goes_after_the_noun():
    assert prep.normalize("1 מכשיר שקט") == "מכשיר אחד שקט"
    assert prep.normalize("1 מנורה דולקת") == "מנורה אחת דולקת"


def test_prefixed_noun_keeps_prefix():
    assert prep.normalize("בעוד 2 דקות") == "בעוד שתי דקות"
    assert prep.normalize("לפני 45 שניות") == "לפני ארבעים וחמש שניות"


def test_unknown_noun_leaves_digits_alone():
    # engine rule: never guess gender for a noun we don't know
    assert prep.normalize("יש 3 בננות") == "יש 3 בננות"


# ---- time ----
@pytest.mark.parametrize("src,exp", [
    ("ב-23:00", "באחת עשרה"),            # sitting A: 23:00 is SAID as 11
    ("ב-6:30 בבוקר", "בשש וחצי בבוקר"),
    ("עכשיו 12:15", "עכשיו שתים עשרה ורבע"),
    ("ב-08:00", "בשמונה"),
    ("ב-17:45", "ברבע לשש"),
    ("ב-00:30", "בשתים עשרה וחצי"),
    ("ב-14:20", "בשתיים עשרים"),
])
def test_clock_times(src, exp):
    assert prep.normalize(src) == exp


# ---- pauses ----
def test_colon_before_list_becomes_period():
    assert prep.pauses("אפשר לנסות: הדלק את האור") == "אפשר לנסות. הדלק את האור"
    assert prep.pauses("ב-23:00") == "ב-23:00"          # clock colon untouched


def test_parentheses_become_comma_clause():
    assert prep.pauses("החדר ריק (חיישן תנועה).") == "החדר ריק, חיישן תנועה."
    assert prep.run("לא מגיבים כרגע (5).", ["pauses", "normalize"]) == "לא מגיבים כרגע, חמש."


# ---- units ----
@pytest.mark.parametrize("src,exp", [
    ("על 24 מעלות", "על עשרים וארבע מעלות"),
    ("24°C ושמש", "עשרים וארבע מעלות ושמש"),
    ("ל-45%", "לארבעים וחמישה אחוז"),
    ("62 אחוז", "שישים ושניים אחוז"),
    ("21.5 מעלות", "עשרים ואחת נקודה חמש מעלות"),
    ("3.2 וואט", "שלוש נקודה שתיים וואט"),
    ("(5)", "(חמש)"),
])
def test_units(src, exp):
    assert prep.normalize(src) == exp


# ---- lexicon ----
def test_lexicon_brands_to_hebrew_spelling():
    assert prep.lexicon("הפעלתי Netflix בסלון") == "הפעלתי נטפליקס בסלון"
    assert prep.lexicon("ה-WiFi חזר") == "הוויי-פיי חזר"
    assert prep.lexicon("ה-MIBOX כבוי") == "המי-בוקס כבוי"


def test_lexicon_leaves_unknown_latin():
    assert prep.lexicon("המכשיר Foobar כבוי") == "המכשיר Foobar כבוי"


# ---- nikud (optional) ----
_HAS_MODEL = any(p.exists() for p in prep._MODEL_CANDIDATES)


@pytest.mark.skipif(not _HAS_MODEL, reason="phonikud model not downloaded")
def test_nikud_fixups_win_over_model():
    # sitting A: the model said "dod" (uncle) for the water heater
    assert "הַדּוּד" in prep.nikud("הדוד דולק כבר חצי שעה.")
    assert "בַּמִּטְבָּח" in prep.nikud("החלון במטבח פתוח.")
    assert "הַשָּׁלָט" in prep.nikud("השלט של הטלוויזיה בסלון.")
    out = prep.nikud("ריק (חיישן).")
    assert out.startswith("רֵיק (") and out.endswith(").")   # punctuation kept around tokens


def test_one_before_adjective_after_noun():
    assert prep.normalize("11 מחוברים ו-1 שקט") == "אחד עשר מחוברים ואחד שקט"


def test_wordfix_touches_only_dictionary_words():
    out = prep.wordfix("הדוד דולק כבר חצי שעה, רוצה שאכבה אותו?")
    assert out == "הדוּד דולק כבר חצי שעה, רוצה שֶׁאֲכַבֶּה אותו?"
    assert prep.wordfix("מכבה את האור בחדר שינה.") == "מכבה את האור בחדר שינה."


def test_wordfix_after_normalize():
    assert prep.run("כוונתי את המזגן ל-22 מעלות.", ["normalize", "wordfix"]) == \
        "כִּוַּנְתִּי את המזגן לעשרים ושתיים מעלות."


@pytest.mark.parametrize("src,exp", [
    ("hadˈud", "h|a|ˈ|d|u|d"),
    ("basalˈon", "b|a|s|a|ˈ|l|o|n"),
    ("χatsˈi", "χ|a|ˈ|t|s|i"),
    ("ʔˈet", "ˈ|ʔ|e|t"),
    ("ʃel", "ʃ|e|l"),
])
def test_ipa_stress_moves_to_syllable_onset(src, exp):
    assert prep._to_cartesia_ipa(src) == exp


@pytest.mark.skipif(not _HAS_MODEL, reason="phonikud model not downloaded")
def test_ipa_wraps_only_hebrew_tokens():
    out = prep.ipa("ה-MIBOX בסלון כבוי.")
    assert "MIBOX" in out and "<<" in out and out.endswith(">>.")
    assert "|" in out and "ˈ" in out


@pytest.mark.skipif(not _HAS_MODEL, reason="phonikud model not downloaded")
def test_nikud_strips_phonikud_private_marks():
    out = prep.nikud("הספר של רוני נמצא על השולחן בסלון.")
    assert "|" not in out and "֫" not in out and "ֽ" not in out
    assert "ֵ" in out or "ֶ" in out  # has real vowel points
    assert out.startswith("הַ")
