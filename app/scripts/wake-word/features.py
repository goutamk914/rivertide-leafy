"""Builds classifier training data: 16 x 96 openWakeWord embedding windows.

Positives: each TTS "Hey Leafy" clip is placed so it ends 0–250 ms before the end of a 2 s window,
then reverb, mic colouring, background (speech / music / noise) and level changes are applied.
Adversarial negatives (confusable phrases, TTS sentences) get the same treatment, so the model
cannot key on TTS artifacts. Background negatives are whole embedding streams of real recordings.

Splits: MUSAN files whose md5(name) % 5 == 0 and LibriSpeech test-* are held out for evaluate.py.

Example:
  python -I features.py --clips clips --librispeech data/LibriSpeech --musan data/musan \
      --models models --out features
"""
from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
from scipy.signal import butter, fftconvolve, sosfilt  # noqa: E402

from common import (CLIP_SAMPLES, SAMPLE_RATE, FeatureExtractor, batched, load_audio,  # noqa: E402
                    read_manifest, to_int16)

BACKGROUND_POOL_SECONDS = 30
MAX_END_GAP = SAMPLE_RATE // 4          # phrase ends 0–250 ms before the window ends
CLEAN_PROBABILITY = 0.15
TRAINING_ENGINES = ("piper", "kokoro")
PARTS = ("positives", "adversarial", "excerpts", "background")


def is_held_out(path: Path) -> bool:
    return int(hashlib.md5(path.name.encode()).hexdigest(), 16) % 5 == 0


def musan_files(root: Path, kind: str, held_out: bool) -> list[Path]:
    return sorted(p for p in (root / kind).rglob("*.wav") if is_held_out(p) == held_out)


def librispeech_files(root: Path, subsets: list[str]) -> list[Path]:
    return sorted(p for subset in subsets for p in (root / subset).rglob("*.flac"))


class BackgroundPool:
    """Random crops from a few hundred files held in memory for fast mixing."""

    def __init__(self, files: list[Path], rng: np.random.Generator, max_files: int):
        chosen = rng.choice(len(files), size=min(max_files, len(files)), replace=False)
        self.rng = rng
        crops = [self._crop(load_audio(files[i])) for i in chosen]
        self.items = [x for x in crops if len(x) >= CLIP_SAMPLES]

    def _crop(self, audio: np.ndarray) -> np.ndarray:
        limit = BACKGROUND_POOL_SECONDS * SAMPLE_RATE
        if len(audio) <= limit:
            return audio
        start = self.rng.integers(0, len(audio) - limit)
        return audio[start:start + limit]

    def sample(self, n: int) -> np.ndarray:
        item = self.items[self.rng.integers(0, len(self.items))]
        start = self.rng.integers(0, len(item) - n + 1)
        return item[start:start + n]


def synthetic_rir(rng: np.random.Generator) -> np.ndarray:
    rt60 = rng.uniform(0.15, 0.7)
    t = np.arange(int(rt60 * SAMPLE_RATE)) / SAMPLE_RATE
    tail = rng.standard_normal(len(t)) * np.exp(-6.9 * t / rt60)
    tail[0] = 0.0
    rir = np.concatenate([[1.0], tail * rng.uniform(0.05, 0.4)])
    return (rir / np.sqrt((rir ** 2).sum())).astype(np.float32)


def colour(audio: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    if rng.random() < 0.3:
        audio = sosfilt(butter(4, rng.uniform(3400, 7500), "lowpass", fs=SAMPLE_RATE, output="sos"), audio)
    if rng.random() < 0.3:
        audio = sosfilt(butter(2, rng.uniform(60, 300), "highpass", fs=SAMPLE_RATE, output="sos"), audio)
    return audio.astype(np.float32)


def rms(audio: np.ndarray) -> float:
    return float(np.sqrt((audio ** 2).mean()) + 1e-9)


def place(clip: np.ndarray, rng: np.random.Generator, at_end: bool) -> np.ndarray:
    """Puts `clip` in a 2 s window: ending near the window end, or anywhere (negatives)."""
    if len(clip) > CLIP_SAMPLES:
        start = rng.integers(0, len(clip) - CLIP_SAMPLES + 1)
        return clip[start:start + CLIP_SAMPLES].copy()
    window = np.zeros(CLIP_SAMPLES, dtype=np.float32)
    if at_end:
        end = CLIP_SAMPLES - rng.integers(0, MAX_END_GAP + 1)
        start = max(0, end - len(clip))
        window[start:end] = clip[len(clip) - (end - start):]
    else:
        start = rng.integers(0, CLIP_SAMPLES - len(clip) + 1)
        window[start:start + len(clip)] = clip
    return window


def augment(clip: np.ndarray, rng: np.random.Generator, pools: list[BackgroundPool], at_end: bool) -> np.ndarray:
    speech = place(clip, rng, at_end)
    if rng.random() < 0.4:
        speech = fftconvolve(speech, synthetic_rir(rng))[:CLIP_SAMPLES].astype(np.float32)
    speech = colour(speech, rng)
    loud = np.abs(speech) > 0.02 * (np.abs(speech).max() + 1e-9)
    level = rms(speech[loud]) if loud.any() else rms(speech)
    speech = speech * (10 ** (rng.uniform(-30, -12) / 20) / level)
    level = rms(speech[loud]) if loud.any() else rms(speech)
    if rng.random() < CLEAN_PROBABILITY:
        mix = speech + rng.standard_normal(CLIP_SAMPLES).astype(np.float32) * 10 ** (-75 / 20)
    else:
        noise = pools[rng.integers(0, len(pools))].sample(CLIP_SAMPLES)
        mix = speech + noise * (level / rms(noise)) * 10 ** (-rng.uniform(0, 25) / 20)
    peak = np.abs(mix).max()
    return mix / peak * 0.99 if peak > 0.99 else mix


def speech_excerpts(files: list[Path], rng: np.random.Generator, count: int) -> list[np.ndarray]:
    """Short real-speech snippets (0.3–1.5 s, starting on a loud frame): the "a few words just
    ended" shape every positive has, so the model must learn the words instead of the shape."""
    out: list[np.ndarray] = []
    while len(out) < count:
        audio = load_audio(files[rng.integers(0, len(files))])
        for _ in range(20):
            n = int(rng.uniform(0.3, 1.5) * SAMPLE_RATE)
            if len(audio) <= n:
                break
            start = int(rng.integers(0, len(audio) - n))
            snippet = audio[start:start + n]
            if np.sqrt((snippet ** 2).mean()) > 0.01:
                out.append(snippet)
    return out[:count]


def clip_windows(features: FeatureExtractor, clip_dirs: list[Path], copies: int, at_end: bool,
                 rng: np.random.Generator, pools: list[BackgroundPool], clips: list[np.ndarray] | None = None) -> np.ndarray:
    if clips is None:
        clips = [load_audio(d / row["file"]) for d in clip_dirs for row in read_manifest(d / "manifest.jsonl")]
    out = []
    for n, group in enumerate(batched([(c, k) for c in clips for k in range(copies)], 512)):
        batch = np.stack([to_int16(augment(c, rng, pools, at_end or k % 2 == 0)) for c, k in group])
        out.append(features.clip_windows(batch).astype(np.float16))
        if n % 10 == 0:
            print(f"    {sum(len(o) for o in out)} windows", flush=True)
    print(f"  {sum(len(o) for o in out)} windows from {len(clips)} clips in {[d.name for d in clip_dirs]}", flush=True)
    return np.concatenate(out)


def stream_features(features: FeatureExtractor, files: list[Path], rng: np.random.Generator,
                    max_hours: float) -> tuple[np.ndarray, np.ndarray]:
    """Concatenated embedding streams and the start index of each stream."""
    streams, starts, total, seconds = [], [], 0, 0.0
    for i in rng.permutation(len(files)):
        audio = load_audio(files[i])
        if len(audio) < CLIP_SAMPLES:
            continue
        audio = audio * (10 ** (rng.uniform(-30, 0) / 20) / max(float(np.abs(audio).max()), 1e-6))
        emb = features.stream_embeddings(to_int16(audio)).astype(np.float16)
        streams.append(emb)
        starts.append(total)
        total += len(emb)
        seconds += len(audio) / SAMPLE_RATE
        if seconds >= max_hours * 3600:
            break
    print(f"  {seconds / 3600:.2f} h of background from {len(streams)} files", flush=True)
    return np.concatenate(streams), np.asarray(starts, dtype=np.int64)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--clips", type=Path, required=True)
    parser.add_argument("--librispeech", type=Path, required=True)
    parser.add_argument("--musan", type=Path, required=True)
    parser.add_argument("--models", type=Path, required=True, help="melspectrogram.onnx + embedding_model.onnx")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--positive-copies", type=int, default=3)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--parts", nargs="+", choices=PARTS, default=list(PARTS),
                        help="build only some outputs (e.g. run 'background' in a second process)")
    parser.add_argument("--excerpts", type=int, default=40000, help="short real-speech negatives")
    parser.add_argument("--background", nargs="+", default=["speech:40", "music:30", "noise:6"],
                        help="KIND:HOURS of real background audio to embed (kinds: speech, music, noise)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    rng = np.random.default_rng(args.seed)
    args.out.mkdir(parents=True, exist_ok=True)
    # One caller thread: onnxruntime parallelizes internally, and openWakeWord's thread pool over a
    # shared session crashed natively on macOS during long runs.
    features = FeatureExtractor(args.models, ncpu=1)
    train_bg = {
        "speech": librispeech_files(args.librispeech, ["dev-clean"]) + musan_files(args.musan, "speech", False),
        "music": musan_files(args.musan, "music", False),
        "noise": musan_files(args.musan, "noise", False),
    }
    pools = [BackgroundPool(files, rng, 250) for files in train_bg.values()]

    def dirs(kind: str, split: str) -> list[Path]:
        # Only the TTS engines used for training; other test sets (e.g. other voices) stay unseen
        # until evaluate.py, so checkpoint selection cannot leak into the reported numbers.
        return sorted(p for p in args.clips.glob(f"*-{kind}-{split}") if p.is_dir() and p.name.split("-")[0] in TRAINING_ENGINES)

    if "positives" in args.parts:
        print("positives", flush=True)
        np.save(args.out / "positive_train.npy", clip_windows(features, dirs("positive", "train"), args.positive_copies, True, rng, pools))
        np.save(args.out / "positive_test.npy", clip_windows(features, dirs("positive", "test"), 1, True, rng, pools))
    if "adversarial" in args.parts:
        print("adversarial negatives", flush=True)
        adversarial = dirs("confusable", "train") + dirs("sentence", "train")
        np.save(args.out / "adversarial_train.npy", clip_windows(features, adversarial, 2, False, rng, pools))
        np.save(args.out / "adversarial_test.npy", clip_windows(features, dirs("confusable", "test"), 1, True, rng, pools))
    if "excerpts" in args.parts:
        print("real speech excerpts", flush=True)
        snippets = speech_excerpts(train_bg["speech"], rng, args.excerpts)
        np.save(args.out / "excerpts_train.npy", clip_windows(features, [], 1, True, rng, pools, snippets))
    if "background" not in args.parts:
        return
    print("background streams", flush=True)
    for name, hours in ((k, float(h)) for k, h in (item.split(":") for item in args.background)):
        stream, starts = stream_features(features, train_bg[name], rng, hours)
        np.save(args.out / f"background_{name}.npy", stream)
        np.save(args.out / f"background_{name}_starts.npy", starts)


if __name__ == "__main__":
    main()
