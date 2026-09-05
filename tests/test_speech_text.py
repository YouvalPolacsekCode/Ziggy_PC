"""services/speech_text — the production spoken-text stage.

Locks (1) parity with the lab chain the operator approved, (2) the OFF
path being byte-identical to the legacy sanitizer, (3) English untouched,
(4) the per-home word table, and (5) the frozen corpus: every line's
prepared text is pinned so a future edit that changes an approved line
fails loudly until the fixture is deliberately re-approved.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
import yaml

from services import speech_text as st

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "voice_lab"))
import prep  # noqa: E402  (lab chain — the reference implementation)

_FIXTURE = Path(__file__).parent / "fixtures" / "speech_text_corpus.json"
_CORPUS = yaml.safe_load((ROOT / "scripts" / "voice_lab" / "corpus.yaml").read_text())["lines"]
_PROD_LINES = [l for l in _CORPUS if l["bucket"] not in ("determinism", "mechanism")]


# ---- 1. parity with the lab chain the operator rated -------------------------
@pytest.mark.parametrize("line", _PROD_LINES, ids=[l["id"] for l in _PROD_LINES])
def test_matches_lab_chain(line):
    # verified dictionary only — lab-open candidates are not in production yet
    lab = prep.wordfix(prep.run(line["text"], ["sanitize", "pauses", "normalize"]), include_open=False)
    assert st.prepare_for_speech(line["text"], "he", enabled=True).spoken == lab


def test_production_dictionary_matches_verified_lab_dictionary():
    assert st.WORDFIX == prep.WORDFIX


# ---- 2. OFF path == legacy sanitizer ---------------------------------------
def test_disabled_is_legacy_sanitize():
    from backend.routers.tts_router import _sanitize_for_tts
    for l in _PROD_LINES:
        r = st.prepare_for_speech(l["text"], "he", enabled=False)
        assert r.spoken == _sanitize_for_tts(l["text"])
        assert r.steps == ("sanitize",)


# ---- 3. English only sanitized ----------------------------------------------
def test_english_untouched_beyond_sanitize():
    r = st.prepare_for_speech("Lights off at 23:00, 24°C, 45% (5).", "en", enabled=True)
    assert r.spoken == "Lights off at 23:00, 24°C, 45% (5)."
    assert not r.changed


# ---- 4. per-home words -------------------------------------------------------
def test_home_words_extend_dictionary(monkeypatch):
    monkeypatch.setattr(st, "_home_words", lambda: {"רוני": "רוֹנִי"})
    assert st.prepare_for_speech("המנורה של רוני דולקת.", "he", enabled=True).spoken == \
        "המנורה של רוֹנִי דולקת."


def test_wordfix_keeps_punctuation_and_unknown_words():
    assert st.wordfix("הדוד, דולק? (ריק)") == "הַדּוּד, דולק? (רֵיק)"
    assert st.wordfix("Netflix בסלון.") == "Netflix בַּסָּלוֹן."


# ---- 5. frozen corpus ---------------------------------------------------------
def test_frozen_corpus_fixture():
    """Pinned spoken forms of every corpus line. To re-approve after an
    intentional change: pytest --regen-speech-fixture (see conftest)."""
    current = {l["id"]: st.prepare_for_speech(l["text"], "he", enabled=True).spoken for l in _PROD_LINES}
    if not _FIXTURE.exists():
        _FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        _FIXTURE.write_text(json.dumps(current, ensure_ascii=False, indent=1))
        pytest.skip("fixture created; re-run")
    frozen = json.loads(_FIXTURE.read_text())
    diff = {k: (frozen.get(k), v) for k, v in current.items() if frozen.get(k) != v}
    assert not diff, f"spoken text changed for approved lines: {json.dumps(diff, ensure_ascii=False, indent=1)}"
