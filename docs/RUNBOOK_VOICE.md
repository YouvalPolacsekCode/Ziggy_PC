# Voice Pipeline Runbook

## What ships in v1

Push-to-talk, Hebrew + English STT, local intent routing, cloud LLM fallback for free-form Q&A, response delivered as **push notification + on-screen text**. No spoken response.

```
mic → PTT → Whisper STT → intent parser → handler → text response
                                                       │
                                                       ├── push notification
                                                       └── in-app text (PWA / mobile)
```

## What does NOT ship in v1

- **TTS** — no spoken responses. The Azure key, Piper binary, and gTTS fallback remain in the codebase under the `voice.tts_enabled` flag.
- **Wake word** — push-to-talk only. See [`oww_data/README.md`](../oww_data/README.md).

Both will return in v1.1 as cloud-gated paid features.

## Configuration

| Key | v1 default | v1.1 plan |
|---|---|---|
| `voice.tts_enabled` | `false` | `true` for paying users (gated server-side) |
| `voice.tts_engine` | `azure` | unchanged — Azure stays the engine until Piper Hebrew is compiled |
| `voice.wakeword_enabled` | `false` | opt-in toggle per home |

`voice.tts_engine` remains set to `azure` because the v1.1 re-enable should be a single-flag flip (`tts_enabled: true`) with the engine choice and credentials already in place.

## How the kill switch works

`interfaces/voice_interface.py:speak()` returns immediately when `TTS_ENABLED` is false. Every call site (~6 in the voice loop) goes through `speak()`, so no other code change is needed.

No HTTP / web TTS endpoint exists; the PWA and mobile app render the text response on-screen and rely on the OS push notification for audible cue. There is no client-side `speechSynthesis` usage.

## Re-enabling for v1.1

1. Server-side entitlement check writes `voice.tts_enabled: true` per home (or gates on a request header that `speak()` consults).
2. Confirm Hebrew Piper voice is compiled and present at `piper_voices/he_IL-sivri-medium.onnx` if you want a local-only path; otherwise Azure continues to handle Hebrew TTS.
3. No code changes in `voice_interface.py` are required — the existing engine dispatch (Azure → Piper → gTTS fallback) is preserved.

## Acceptance test

Run on a home unit with `voice.tts_enabled: false`:

- 10 Hebrew commands (lights, AC, status, "Hey Ziggy" via PTT in chat mode) → verify text response appears in app, no audio plays.
- 10 English commands (same shape) → same expectation.

Report any UX regression. Expected: zero — push + text path was already the primary surface; TTS was supplementary.

---

## ElevenLabs TTS (v1.1 primary engine, Hebrew-first)

ElevenLabs is the new top-priority engine in [`interfaces/voice_interface.py`](../interfaces/voice_interface.py)'s `speak()` chain:

```
ElevenLabs → Azure → Piper → gTTS
```

It is opt-in via `voice.tts_engine: elevenlabs`. When unset (or set to another engine), prior behavior is preserved. The chain falls through cleanly on any failure (no SDK, no key, invalid voice, quota, network) — silence is never the result of a single engine misbehaving.

### One-time setup

1. **Create the account.** Sign up at https://elevenlabs.io → grab an API key from the profile menu → *API Keys*. Budget guidance: **Pro tier ($99/mo)** for a household running ~500 replies/day; Creator ($11) gets exhausted in under a week of normal use.
2. **Install the SDK on the mini PC:**

   ```sh
   pip install -r requirements.txt   # picks up elevenlabs>=2.0
   ```

3. **Drop the key into `config/secrets.yaml`** (untracked, operator-owned):

   ```yaml
   voice:
     elevenlabs:
       api_key: sk_xxx_your_key
   ```

   `ELEVENLABS_API_KEY` env var also works and takes precedence. `voice.elevenlabs.api_key` is in `_SECRET_PATHS` — even if someone pastes it into `settings.yaml`, `save_settings()` strips it from disk on the next save.

### Auditioning + picking voices

Use the discovery script — it queries `/v2/voices`, filters to voices ElevenLabs has verified for Hebrew, and prints audition URLs:

```sh
python scripts/discover_elevenlabs_voices.py                    # premade Hebrew voices
python scripts/discover_elevenlabs_voices.py --category community
python scripts/discover_elevenlabs_voices.py --lang en           # English voices
python scripts/discover_elevenlabs_voices.py --audition <voice_id>   # render a Ziggy sample to /tmp
```

Once you've heard a few candidates and picked your favorites, paste them into `config/settings.yaml`:

```yaml
voice:
  tts_engine: elevenlabs
  tts_enabled: true                # flip this when ready to ship audio replies
  elevenlabs:
    selected_voice_he: <voice_id>
    selected_voice_en: <voice_id>
    available_voices:              # the picker list — user can switch among these
      - id: <voice_id>
        name: "Yael"
        languages: [he, en]
      - id: <voice_id>
        name: "Roi"
        languages: [he, en]
```

A single voice_id renders both Hebrew and English on Multilingual v2 — you don't need separate IDs per language, but you can if a voice sounds better in one than the other.

**Important model gotcha (verified Jun 2026 against the live API, not from docs):**

| Model | Hebrew support | Verdict |
|---|---|---|
| `eleven_flash_v2_5`     | ❌ rejects `language_code='he'` with HTTP 400 `unsupported_language` | English-only |
| `eleven_multilingual_v2` | ✅ works **when `language_code` is omitted** (model auto-detects from Hebrew text). Returns 400 if `'he'` is sent. | **Default for Ziggy** |
| `eleven_v3`             | ✅ explicit `language_code='he'` works | Slower (~2s), reserve for content not assistant replies |

The engine in `interfaces/tts/elevenlabs_tts.py` handles this automatically via `_send_language_code(model_id, lang)`: it sends `language_code='he'` only on `eleven_v3`, and suppresses it on v2/Flash so the request doesn't 400.

### Runtime API (for a future picker UI / mobile app)

All under `/api/voice/tts`:

| Method | Path | Purpose |
|---|---|---|
| GET  | `/voices`            | Curated `available_voices` + current `active` per language |
| GET  | `/voices/discover?lang=he` | Live search against ElevenLabs (filtered by verified language) |
| POST | `/preview`           | Body `{voice_id, text, lang}` → audio/mpeg bytes (bypasses cache) |
| PATCH | `/active`           | Body `{he?: voice_id, en?: voice_id}` → persists selection |

### Caching

Rendered audio is cached under `cache/tts/elevenlabs/<sha256>.mp3` keyed on `(text, voice, model, voice_settings, lang, format)`. Hebrew instant-replies (the ~15 pre-translated patterns in `voice_interface._he_instant_reply`) repeat heavily, so the cache typically cuts credit consumption ~50%. LRU eviction beyond `cache.max_entries` (default 200). Disable with `cache.enabled: false`.

### Cost guardrails

- Default model is `eleven_flash_v2_5` (~half the credits/char of Multilingual v2 and ~3x faster).
- Keep `output_format: mp3_44100_128` (default). Higher bitrates / hi-rate PCM are tier-gated to Pro+.
- The cache is the biggest cost lever — keep it enabled.

### Failure modes worth knowing

| Symptom | Likely cause | Fix |
|---|---|---|
| Silent fallback to Azure/gTTS | SDK missing OR `api_key` blank OR `selected_voice_*` blank | `pip install elevenlabs`, set key, set voice_ids |
| Hebrew audio sounds English-accented | `language_code` not being sent (shouldn't happen — module always sends it) | Confirm via verbose logs `voice.debug.verbose: true` |
| `Render failed: 401`           | Bad / rotated API key                           | Update `config/secrets.yaml` and restart |
| `Render failed: 402` or quota  | Tier exhausted                                   | Upgrade tier or wait for monthly reset; chain falls through to Azure |
| `Render failed: voice_not_found` | `selected_voice_*` points to a deleted voice | Rerun discovery, pick a current voice_id |

### Acceptance test for v1.1

With `tts_enabled: true` and `tts_engine: elevenlabs` and at least `selected_voice_he` set:

- 10 Hebrew commands across rooms/devices → audio plays via ElevenLabs every time, no Azure/Piper fallback visible in logs (look for `[Voice] ElevenLabs TTS used.` with `verbose: true`).
- Repeat the same 5 commands twice → second pass shows `Cache hit` log lines and zero ElevenLabs traffic.
- Pull the network cable mid-reply → next reply falls through to Piper/gTTS, no crash, no silence.
- Set `selected_voice_he: ""` → next Hebrew reply falls through to Piper/gTTS, no crash.

Treat as "passing" only after listening on the actual mini PC speakers — synthetic checks don't validate voice quality.
