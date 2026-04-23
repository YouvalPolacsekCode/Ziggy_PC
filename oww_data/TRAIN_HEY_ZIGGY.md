# Training the "Hey Ziggy" Wake Word Model

Your dataset is already generated and ready under `oww_data/hey_ziggy/`:
- **150 positive samples** (`positives/*.wav`) — synthetic "Hey Ziggy" variations via Piper TTS
- **30 near-negative samples** (`near_negatives/*.wav`) — similar-sounding phrases for robustness

## Step 1 — Open the OWW Training Colab

OpenWakeWord's official training notebook:
https://colab.research.google.com/github/dscripka/openWakeWord/blob/main/notebooks/automatic_model_training.ipynb

## Step 2 — Upload your dataset

In the Colab, upload the contents of `oww_data/hey_ziggy/` as directed by the notebook.

## Step 3 — Train and export

The notebook will:
1. Mix your positive samples with background noise from common datasets
2. Train a small neural network
3. Export a `.onnx` file

Download the resulting `.onnx` file.

## Step 4 — Deploy in Ziggy

1. Place the file at `models/wake/hey_ziggy.onnx`
2. Update `config/settings.yaml`:
   ```yaml
   voice:
     wakeword_model: ./models/wake/hey_ziggy.onnx
   ```
3. Restart Ziggy.

## Current active wake word

While the custom model is not yet trained, Ziggy uses the built-in `hey_mycroft` model.
