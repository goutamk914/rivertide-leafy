"""Measures the full two-stage detector on audio never used in training.

False accepts: hours of held-out speech, music and noise (LibriSpeech test-clean/test-other and
the held-out fifth of MUSAN). Every stage-1 fire is passed to the Moonshine verifier on the 1.5 s
of audio before it, exactly like the app. Recall: held-out TTS voices (and any extra recordings,
e.g. other speakers) mixed into held-out backgrounds at several signal-to-noise ratios.

Example:
  python -I evaluate.py --classifier hey_leafy.onnx --models models --clips clips \
      --librispeech data/LibriSpeech --musan data/musan --out report.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402

from common import (FRAME_SAMPLES, SAMPLE_RATE, FeatureExtractor, fire_frames, load_audio,  # noqa: E402
                    read_manifest, to_int16, windows)
from features import librispeech_files, musan_files  # noqa: E402
from verifier import Moonshine, verify  # noqa: E402

THRESHOLDS = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]
RING_SAMPLES = int(1.5 * SAMPLE_RATE)
SNRS = [None, 20, 10, 5]
DETECT_BEFORE, DETECT_AFTER = 4, 12     # frames around the phrase end that count as a hit
MIX_SECONDS = 6


class Detector:
    def __init__(self, classifier: Path, features: FeatureExtractor, moonshine: Moonshine, margin: float, delay: int):
        import onnxruntime as ort

        self.session = ort.InferenceSession(str(classifier))
        self.features = features
        self.moonshine = moonshine
        self.margin = margin
        self.delay = delay
        self.offset = self._end_offset()

    def _end_offset(self) -> int:
        """Audio sample index (exclusive) that batch embedding row 0 ends at, found by streaming."""
        audio = to_int16(np.random.default_rng(0).uniform(-0.3, 0.3, SAMPLE_RATE * 4))
        batch = self.features.stream_embeddings(audio)
        stream = self.features.streaming()
        for k in range(len(audio) // FRAME_SAMPLES):
            stream(audio[k * FRAME_SAMPLES:(k + 1) * FRAME_SAMPLES])
        row = stream.get_features(1)[0, 0]
        j = int(np.argmin(((batch - row) ** 2).sum(axis=1)))
        return len(audio) // FRAME_SAMPLES * FRAME_SAMPLES - j * FRAME_SAMPLES

    def scores(self, audio: np.ndarray) -> np.ndarray:
        emb = self.features.stream_embeddings(to_int16(audio))
        if len(emb) < 16:
            return np.zeros(0, dtype=np.float32)
        x = np.ascontiguousarray(windows(emb), dtype=np.float32)
        out = np.concatenate([self.session.run(None, {"x": x[i:i + 4096]})[0][:, 0] for i in range(0, len(x), 4096)])
        return np.concatenate([np.zeros(15, dtype=np.float32), out])  # score i ↔ embedding row i

    def ring(self, audio: np.ndarray, frame: int) -> np.ndarray:
        end = min(len(audio), self.offset + (frame + self.delay) * FRAME_SAMPLES)
        return audio[max(0, end - RING_SAMPLES):end]

    def verified(self, audio: np.ndarray, frame: int) -> dict:
        return verify(self.moonshine, self.ring(audio, frame), self.margin)


def negative_sets(args) -> dict[str, list[Path]]:
    return {
        "librispeech-test": librispeech_files(args.librispeech, ["test-clean", "test-other"]),
        "musan-speech": musan_files(args.musan, "speech", True),
        "musan-music": musan_files(args.musan, "music", True),
        "musan-noise": musan_files(args.musan, "noise", True),
    }


def evaluate_negatives(detector: Detector, sets: dict[str, list[Path]], max_hours: float) -> dict:
    out = {}
    for name, files in sets.items():
        hours, fires = 0.0, {t: [] for t in THRESHOLDS}
        for path in files:
            audio = load_audio(path)
            scores = detector.scores(audio)
            hours += len(audio) / SAMPLE_RATE / 3600
            checked: dict[int, dict] = {}
            for t in THRESHOLDS:
                for frame in fire_frames(scores, t):
                    if frame not in checked:
                        checked[frame] = detector.verified(audio, frame)
                    fires[t].append({"file": path.name, "frame": frame, "score": float(scores[frame]), **checked[frame]})
            if hours >= max_hours:
                break
        out[name] = {"hours": hours, "fires": fires}
        print(f"  {name}: {hours:.2f} h, stage-1 fires at 0.5 = {len(fires[0.5])}", flush=True)
    return out


def mix(clip: np.ndarray, background: np.ndarray, snr: float | None, rng: np.random.Generator) -> tuple[np.ndarray, int]:
    """Places `clip` 2–4 s into a 6 s window over `background`; returns audio and the clip end."""
    total = MIX_SECONDS * SAMPLE_RATE
    start = int(rng.integers(SAMPLE_RATE * 2, total - len(clip) - SAMPLE_RATE))
    clip = clip / (np.abs(clip).max() + 1e-9) * 0.3
    audio = np.zeros(total, dtype=np.float32)
    audio[start:start + len(clip)] = clip
    if snr is not None:
        noise = background[:total]
        gain = np.sqrt((clip ** 2).mean()) / (np.sqrt((noise ** 2).mean()) + 1e-9) * 10 ** (-snr / 20)
        audio = np.clip(audio + noise * gain, -1, 1).astype(np.float32)
    return audio, start + len(clip)


def evaluate_positives(detector: Detector, clip_dirs: list[Path], backgrounds: list[np.ndarray], rng: np.random.Generator) -> list[dict]:
    rows = []
    for directory in clip_dirs:
        manifest = read_manifest(directory / "manifest.jsonl")
        for i, row in enumerate(manifest):
            snr = SNRS[i % len(SNRS)]
            background = backgrounds[rng.integers(0, len(backgrounds))]
            offset = int(rng.integers(0, len(background) - MIX_SECONDS * SAMPLE_RATE + 1))
            audio, end = mix(load_audio(directory / row["file"]), background[offset:], snr, rng)
            scores = detector.scores(audio)
            end_frame = (end - detector.offset) // FRAME_SAMPLES
            result = {"source": directory.name, "snr": snr, "file": row["file"], "text": row.get("text")}
            for t in THRESHOLDS:
                hits = [f for f in fire_frames(scores, t) if end_frame - DETECT_BEFORE <= f <= end_frame + DETECT_AFTER]
                verdict = detector.verified(audio, hits[0]) if hits else None
                result[str(t)] = {"stage1": bool(hits), "stage2": bool(verdict and verdict["accepted"]),
                                  "latency_ms": (hits[0] - end_frame) * 80 if hits else None,
                                  "transcript": verdict["transcript"] if verdict else None,
                                  "margin": verdict["margin"] if verdict else None,
                                  "named": verdict["named"] if verdict else None}
            rows.append(result)
        print(f"  {directory.name}: {len(manifest)} clips", flush=True)
    return rows


def summarize(negatives: dict, positives: list[dict]) -> list[dict]:
    hours = sum(n["hours"] for n in negatives.values())
    table = []
    for t in THRESHOLDS:
        fires = [f for n in negatives.values() for f in n["fires"][t]]
        accepted = sum(f["accepted"] for f in fires)
        table.append({
            "threshold": t,
            "negative_hours": round(hours, 2),
            "stage1_fa_per_hour": round(len(fires) / hours, 3),
            "two_stage_false_accepts": accepted,
            "two_stage_fa_per_hour": round(accepted / hours, 3),
            "stage1_recall": round(float(np.mean([p[str(t)]["stage1"] for p in positives])), 3),
            "two_stage_recall": round(float(np.mean([p[str(t)]["stage2"] for p in positives])), 3),
        })
    return table


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--classifier", type=Path, required=True)
    parser.add_argument("--models", type=Path, required=True, help="feature models + Moonshine files")
    parser.add_argument("--clips", type=Path, required=True)
    parser.add_argument("--librispeech", type=Path, required=True)
    parser.add_argument("--musan", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--hours-per-set", type=float, default=6.0)
    parser.add_argument("--margin", type=float, default=8.0)
    parser.add_argument("--delay-frames", type=int, default=0)
    parser.add_argument("--seed", type=int, default=11)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    rng = np.random.default_rng(args.seed)
    detector = Detector(args.classifier, FeatureExtractor(args.models, ncpu=8), Moonshine(args.models, threads=4),
                        args.margin, args.delay_frames)
    print(f"embedding end offset: {detector.offset} samples", flush=True)
    started = time.time()
    print("negatives", flush=True)
    negatives = evaluate_negatives(detector, negative_sets(args), args.hours_per_set)
    print("positives", flush=True)
    files = musan_files(args.musan, "noise", True) + musan_files(args.musan, "music", True)
    backgrounds = [b for b in (load_audio(p) for p in files) if len(b) >= MIX_SECONDS * SAMPLE_RATE]
    clip_dirs = sorted(p for p in args.clips.glob("*-positive-test") if p.is_dir())
    positives = evaluate_positives(detector, clip_dirs, backgrounds, rng)
    table = summarize(negatives, positives)
    report = {"table": table, "margin": args.margin, "delay_frames": args.delay_frames,
              "seconds": round(time.time() - started), "negatives": negatives, "positives": positives}
    args.out.write_text(json.dumps(report, indent=1), encoding="utf-8")
    for row in table:
        print(row)


if __name__ == "__main__":
    main()
