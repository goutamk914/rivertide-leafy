"""Shared audio helpers for the "Hey Leafy" training pipeline (16 kHz mono throughout)."""
from __future__ import annotations

import json
from math import gcd
from pathlib import Path
from typing import Iterable, Iterator

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

SAMPLE_RATE = 16_000
FRAME_SAMPLES = 1280            # openWakeWord's 80 ms hop
WINDOW_EMBEDDINGS = 16          # classifier input: 16 x 96 embeddings
CLIP_SAMPLES = 32_000           # 2.0 s of audio yields exactly 16 embeddings
EMBEDDING_DIM = 96


def resample(audio: np.ndarray, rate_in: int, rate_out: int = SAMPLE_RATE) -> np.ndarray:
    if rate_in == rate_out:
        return audio.astype(np.float32)
    g = gcd(rate_in, rate_out)
    return resample_poly(audio, rate_out // g, rate_in // g).astype(np.float32)


def load_audio(path: str | Path) -> np.ndarray:
    """Mono float32 in [-1, 1] at 16 kHz."""
    audio, rate = sf.read(str(path), dtype="float32", always_2d=True)
    return resample(audio.mean(axis=1), rate)


def save_wav(path: str | Path, audio: np.ndarray) -> None:
    sf.write(str(path), to_int16(audio), SAMPLE_RATE, subtype="PCM_16")


def to_int16(audio: np.ndarray) -> np.ndarray:
    if audio.dtype == np.int16:
        return audio
    return (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)


def to_float(audio: np.ndarray) -> np.ndarray:
    return audio.astype(np.float32) / 32768.0 if audio.dtype == np.int16 else audio.astype(np.float32)


def trim_silence(audio: np.ndarray, threshold_db: float = -45.0, margin_ms: int = 40) -> np.ndarray:
    """Trims leading/trailing audio quieter than `threshold_db` relative to the loudest 10 ms."""
    frame = SAMPLE_RATE // 100
    if len(audio) < frame * 2:
        return audio
    frames = audio[: len(audio) // frame * frame].reshape(-1, frame)
    level = 20 * np.log10(np.sqrt((frames ** 2).mean(axis=1)) + 1e-9)
    loud = np.nonzero(level > level.max() + threshold_db)[0]
    if len(loud) == 0:
        return audio
    margin = margin_ms * SAMPLE_RATE // 1000
    start = max(0, loud[0] * frame - margin)
    end = min(len(audio), (loud[-1] + 1) * frame + margin)
    return audio[start:end]


def read_manifest(path: str | Path) -> list[dict]:
    with open(path, encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def write_manifest(path: str | Path, rows: Iterable[dict]) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row) + "\n")


COOLDOWN_FRAMES = 25            # 2 s at 80 ms per frame, same as the app's gate


def fire_frames(scores: np.ndarray, threshold: float, patience: int = 1,
                cooldown: int = COOLDOWN_FRAMES) -> list[int]:
    """Frames where the detector fires: `patience` consecutive scores ≥ threshold, then a cooldown."""
    fires, run, blocked_until = [], 0, -1
    for i, score in enumerate(scores):
        run = run + 1 if score >= threshold else 0
        if i <= blocked_until or run < patience:
            continue
        fires.append(i)
        run, blocked_until = 0, i + cooldown
    return fires


def windows(stream: np.ndarray, size: int = WINDOW_EMBEDDINGS) -> np.ndarray:
    """Zero-copy sliding windows [T - size + 1, size, D] over a [T, D] embedding stream."""
    from numpy.lib.stride_tricks import sliding_window_view

    return sliding_window_view(stream, (size, stream.shape[1]))[:, 0]


def batched(items: list, size: int) -> Iterator[list]:
    for start in range(0, len(items), size):
        yield items[start:start + size]


class FeatureExtractor:
    """openWakeWord's frozen melspectrogram + embedding models (ONNX), batch mode."""

    def __init__(self, models_dir: str | Path, ncpu: int = 4):
        from openwakeword.utils import AudioFeatures

        models = Path(models_dir)
        self.melspec_path = str(models / "melspectrogram.onnx")
        self.embedding_path = str(models / "embedding_model.onnx")
        self._features = AudioFeatures(
            melspec_model_path=self.melspec_path,
            embedding_model_path=self.embedding_path,
            inference_framework="onnx",
            ncpu=ncpu,
        )

    def clip_windows(self, clips: np.ndarray, batch_size: int = 256) -> np.ndarray:
        """[N, CLIP_SAMPLES] int16 → [N, 16, 96] float32 (the window ending at each clip's end)."""
        out = self._features.embed_clips(clips, batch_size=batch_size)
        return out[:, -WINDOW_EMBEDDINGS:, :].astype(np.float32)

    def stream_embeddings(self, audio: np.ndarray) -> np.ndarray:
        """Embeddings for a long int16 stream at one row per 80 ms ([T, 96])."""
        return self._features._get_embeddings(audio).astype(np.float32)

    def streaming(self):
        """A fresh streaming buffer that behaves exactly like openWakeWord at runtime."""
        from openwakeword.utils import AudioFeatures

        return AudioFeatures(
            melspec_model_path=self.melspec_path,
            embedding_model_path=self.embedding_path,
            inference_framework="onnx",
            ncpu=1,
        )
