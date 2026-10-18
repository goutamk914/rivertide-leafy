# "Hey Leafy" model files

Rivertide runs these models on your computer only. They are never updated or downloaded at run time.

| File | What it is | Source | License |
|---|---|---|---|
| `hey_leafy.onnx` | The "Hey Leafy" classifier | Trained by Code the Cure for Rivertide from synthetic speech (`app/scripts/wake-word/`) | MIT (same as Rivertide) |
| `melspectrogram.onnx` | Audio → mel spectrogram (fixed math, no learned weights) | openWakeWord v0.5.1, David Scripka | Apache-2.0 |
| `embedding_model.onnx` | Speech embedding: a re-implementation of Google's `speech_embedding` TF Hub module | openWakeWord v0.5.1; Google | Apache-2.0 |
| `moonshine-encoder.onnx`, `moonshine-decoder.onnx`, `moonshine-vocab.json` | Moonshine Tiny (English), int8 ONNX export | Useful Sensors via `onnx-community/moonshine-tiny-ONNX` @ a6da124 | MIT |

None of openWakeWord's pre-trained wake word models (CC BY-NC-SA 4.0) are used.

## Training data for `hey_leafy.onnx`

| Data | Use | License |
|---|---|---|
| Piper `en_US-libritts_r-medium` voice (904 speakers) | Synthetic "Hey Leafy", near-miss phrases and sentences | piper-voices repository MIT; voice trained on LibriTTS-R (CC BY 4.0) |
| Kokoro-82M v1.0 (via `kokoro-onnx`) | Synthetic speech from more voices | Apache-2.0 |
| LibriSpeech `dev-clean` transcripts and audio | Sentences for synthesis; real speech as background and negatives | CC BY 4.0 |
| MUSAN (music, speech, noise; 80% of files) | Background and negatives | CC BY / CC BY-SA / CC0 / public domain (no non-commercial content) |

Attribution: LibriSpeech (Panayotov et al., 2015); LibriTTS-R (Koizumi et al., 2023); MUSAN (Snyder, Chen and Povey, 2015).
