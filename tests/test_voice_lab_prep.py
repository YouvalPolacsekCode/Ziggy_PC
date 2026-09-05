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
    ("ב-23:00", "בעשרים ושלוש"),
    ("ב-6:30 בבוקר", "בשש וחצי בבוקר"),
    ("עכשיו 12:15", "עכשיו שתים עשרה ורבע"),
    ("ב-08:00", "בשמונה"),
    ("ב-17:45", "בשבע עשרה ארבעים וחמש"),
])
def test_clock_times(src, exp):
    assert prep.normalize(src) == exp


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
def test_nikud_strips_phonikud_private_marks():
    out = prep.nikud("הספר של רוני נמצא על השולחן בסלון.")
    assert "|" not in out and "֫" not in out and "ֽ" not in out
    assert "ֵ" in out or "ֶ" in out  # has real vowel points
    assert out.startswith("הַ")
