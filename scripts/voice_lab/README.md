# Voice Lab — Hebrew TTS/STT review loop

Dev-only tooling. Nothing here runs on a hub. Design:
`docs/superpowers/specs/2026-09-05-hebrew-voice-lab-design.md`.

## One-time setup (Mac)

```sh
pip install phonikud phonikud-onnx            # local nikud (vowel pointing)
python3 -c "from huggingface_hub import hf_hub_download as d; d('thewh1teagle/phonikud-onnx','phonikud-1.0.int8.onnx',local_dir='models/phonikud')"
```

Cartesia key: `CARTESIA_API_KEY` env, or `voice.cartesia.api_key` in the main
checkout's `config/secrets.yaml` (worktrees find it automatically).

## Files

| File | Purpose |
|---|---|
| `corpus.yaml` | ~70 Hebrew lines Ziggy says, tagged by bucket |
| `stt_script.yaml` | 40 spoken commands for the STT bake-off |
| `prep.py` | text pre-processing steps: sanitize · normalize · lexicon · nikud |
| `render.py` | render the corpus through a variant → `voice_lab_out/<variant>/` |
| `probe_cartesia.py` | API probes (nikud input, dict, 3.6, speed) → `voice_lab_out/probe/` |
| `serve.py` + `review.html` | local review page (rate / pairs / A/B / record) |
| `report.py` | verdicts → bucket histogram + per-line table |
| `stt_bakeoff.py` | run STT candidates on the recordings, score WER |

## Operator flow

```sh
python scripts/voice_lab/probe_cartesia.py        # once
python scripts/voice_lab/render.py baseline       # ~70 s, ~4k chars
python scripts/voice_lab/serve.py                 # open http://127.0.0.1:8765/?sitting=A
```

Sitting A: **דירוג** (rate the baseline; space / 1 / 2 / click the bad word),
then **זוגות בדיקה** (blind probe pairs; Q W then A / B / S), then **הקלטה**
(read the 40 STT lines; R to start/stop). Verdicts append to
`voice_lab_out/verdicts/A.jsonl` and the page resumes where you stopped.

Sitting B: `serve.py` then open `/?sitting=B&ab=baseline,full36` (any two
variants from `render.py --list`) → **A/B** tab.

## Outputs (gitignored)

`voice_lab_out/<variant>/<id>.mp3` + `manifest.json` (text as sent, hash,
duration), `voice_lab_out/verdicts/<sitting>.jsonl`,
`voice_lab_out/stt_audio/<id>.webm`.
