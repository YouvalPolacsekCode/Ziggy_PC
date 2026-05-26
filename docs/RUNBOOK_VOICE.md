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
