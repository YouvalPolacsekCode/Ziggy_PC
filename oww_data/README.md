# Wake-word training assets — **EXPERIMENTAL, NOT SHIPPING IN v1**

This directory contains training data for a custom "Hey Ziggy" wake-word model:

```
hey_ziggy/
├── positives/         # 152 captured WAVs of the target phrase
└── near_negatives/    #  62 captured WAVs of acoustically similar phrases
TRAIN_HEY_ZIGGY.md     # training notes / process
```

The repo-root scripts `generate_hey_ziggy_dataset.py`, `record_hey_ziggy.py`, and `train_hey_ziggy.py` produce / extend the dataset and train OpenWakeWord on it.

## Status

- **v1 ships push-to-talk only.** No wake word.
- No compiled `hey_ziggy.onnx` exists yet.
- The OpenWakeWord runtime IS imported and gated by `voice.wakeword_enabled` in `config/settings.yaml`. The default is `false`. The voice loop falls back to PTT when wake-word init fails or the flag is off.

## Do not enable in production

- Do **NOT** flip `voice.wakeword_enabled: true` in any shipped settings.yaml.
- The voice pipeline (`interfaces/voice_interface.py`) refuses to honor `wakeword_enabled: true` if `wakeword_model` points to a non-existent file (custom models only — the bundled `hey_mycroft` is allowed).
- Do **NOT** invoke the training scripts from the runtime voice pipeline. They are operator tools, run by hand when iterating on the model.

## v1.1 plan

Wake word returns in v1.1 as an opt-in toggle per home. The trained `hey_ziggy.onnx` will live alongside the training data here. The flow:

1. Train the model (`train_hey_ziggy.py` produces `hey_ziggy.onnx`).
2. Drop the `.onnx` into `oww_data/hey_ziggy/` (or wherever fits the final layout).
3. Update `voice.wakeword_model` to the absolute path of the `.onnx`.
4. Operator opt-in flips `voice.wakeword_enabled: true`. The boot-time guard verifies the file exists before activating wake-word inference.

## Notes for future work

- "Hey Ziggy" is the intended replacement for the placeholder `hey_mycroft` keyword referenced in current settings.
- The training scripts live at repo root for historical reasons. Don't move them without verifying no downstream tooling expects those paths.
- Founder memory: `oww_data/` survives across v1 → v1.1 transitions. Treat the dataset as long-lived training corpus, not throw-away.
