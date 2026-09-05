# Hebrew Voice Lab — design

Date: 2026-09-05. Status: approved by Youval ("ok lets do it").
Plan page: https://claude.ai/code/artifact/930b12f3-4163-42f4-9404-cabca8599996

## Goal

Fix Hebrew TTS pronunciation (primary) and measure Hebrew STT options
(secondary) with the least possible listening time from the operator.
Youval must be the judge; Claude cannot hear. Every verdict Youval gives
must become a fix that is tested, shipped by release tag, and locked
against regression.

## Current state (verified 2026-09-05)

- TTS: Cartesia `sonic-3.5`, voice Yardena (`c5bc902c…`), called directly
  from the hub (`interfaces/tts/cartesia_tts.py`). Mobile/web path is
  `POST /api/voice/tts/speak` → `_sanitize_for_tts` (regex strip of
  `| * _ \` #` and bullets) → `synthesize_stream`. No lexicon, no nikud,
  no number/time normalization, no pronunciation dictionary, no speed.
- Canary settings: `tts_engine: cartesia`, `model_id: sonic-3.5`,
  `tts_enabled: false` (host playback only; the /speak endpoint ignores it).
- STT (web PTT): OpenAI `whisper-1`, two-pass (auto-detect, then Hebrew
  with a 20-word prompt). Native Android SpeechRecognition runs first on
  the phone. `ivrit-ai/whisper-large-v3-turbo-ct2` is configured but only
  used by the standalone `transcribe()` path that never runs in production.
- Cartesia SDK 3.2.0 exposes `pronunciation_dict_id`, `speed`,
  `generation_config` on `tts.bytes`, and `client.pronunciation_dicts`.
  Sonic 3.6 GA 2026-08-27 as an update to 3.5. Docs are behind a login;
  Hebrew behaviour of dictionaries and nikud input must be probed live.

## Architecture

### Lab tooling (`scripts/voice_lab/`, dev-only, never runs on hubs)

- `corpus.yaml` — ~70 Hebrew lines, each with `id`, `text`, `bucket_hint`
  (what it is designed to test), `source` (template / health / agent /
  canary-name / number / time / mixed).
- `render.py` — renders a corpus through a named *variant* (model, voice,
  speed, pre-processing chain, dict id) into `voice_lab_out/<variant>/<id>.mp3`
  plus `manifest.json` (text as sent, timing, bytes). Idempotent by hash.
- `probe_cartesia.py` — the four API probes (nikud input, dictionary with
  Hebrew/IPA, sonic-3.6, speed), written as a mini corpus so Youval hears
  them in sitting A.
- `serve.py` — local HTTP server (127.0.0.1) serving the review page,
  audio, corpus and manifests; `POST /verdict` appends to
  `voice_lab_out/verdicts/<session>.jsonl`.
- `review.html` — keyboard-driven review page. Modes: `rate` (one clip
  per line, keys: space play, 1 fine, 2 wrong, click a word to mark it,
  optional "should sound like" text), `ab` (two clips per line, shuffled,
  keys: a / b / same), `record` (STT script: shows a line, records via
  MediaRecorder on localhost, saves `stt_audio/<id>.webm`).
- `stt_bakeoff.py` — runs every STT candidate on `stt_audio/*` and
  reports WER per engine against the script (Hebrew-normalised: strip
  nikud, punctuation, final-letter and prefix-clitic tolerant).
- `report.py` — turns verdicts into a bucket histogram and a per-line
  table for the next build.

### Product code (additive, flag-gated)

- `services/speech_text.py` — a pure function
  `prepare_for_speech(text, lang, *, profile) -> SpeechText` that runs the
  chain: sanitize (existing) → normalize numbers/times/units into
  gender-correct Hebrew words → lexicon lookup (room/device/brand names →
  spoken form or inline IPA) → optional nikud pass (phonikud ONNX, local,
  time-boxed) → returns text + metadata. With `voice.speech_text.enabled`
  false, output equals today's `_sanitize_for_tts` byte for byte.
- `tts_router.speak_reply` and `cartesia_tts` gain: `pronunciation_dict_id`,
  `speed`, model id from settings (date-pinned when 3.6 wins).
- `POST /api/voice/tts/flag` — captures {text as spoken, variant, note}
  into `user_files/tts_flags.jsonl`; a small "flag this reply" control in
  AIChat next to the speaking orb.
- `tests/test_speech_text.py` — one test per bucket, plus the frozen
  corpus as a fixture: any change to the prepared text of a line Youval
  approved fails the test until the fixture is deliberately re-approved.

## Error buckets and their fixes

| Bucket | Symptom | Fix |
|---|---|---|
| vowels/stress | wrong vowel or syllable stress on a plain word | nikud pre-pass; dictionary entry for stubborn words |
| number gender | 2/3/… read in wrong gender for the noun | normalizer with noun-gender table for Ziggy's units |
| time/temp/units | 23:00, 24°, 45% read oddly | normalizer to words |
| foreign word | English word in Hebrew script/Latin read wrong | lexicon → spoken Hebrew spelling or IPA |
| name | room/device/person names | lexicon from nameDict + per-home overrides |
| punctuation/pause | symbols read aloud, missing pause at ־ or — | sanitizer additions |
| prosody | flat/rushed/odd intonation | speed, model 3.6, voice change |

## Sittings

A: rate 70-line baseline + ~12 probe lines, then record the 40-line STT
script (~40 min total). B: blind A/B on flagged lines + 3 voice candidates
on 5 lines (~20 min). C: live use on Canary for a day with the flag button.

## Non-goals

No change to chat, agent, HA flows, or the reply text itself. No cloud
service in the lab; audio and verdicts stay on the Mac. ElevenLabs is not
part of this pass.

## Risks

Nikud latency on the hub (measure; fall back per length). Sonic 3.6
recency (pin by date). Cartesia doc gating (probe live, record findings
in `docs/RUNBOOK_VOICE.md`).
