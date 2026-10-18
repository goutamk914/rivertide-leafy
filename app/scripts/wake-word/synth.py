"""Synthesizes wake-word training/test clips with open TTS engines (Piper, Kokoro).

Speakers are split so test voices are never heard in training:
  Piper en_US-libritts_r-medium: speaker_id % 10 == 0 → test, the rest → train.
  Kokoro v1.0: TEST_ONLY_KOKORO_VOICES → test; train voices are also blended pairwise for variety.

Writes <out>/<engine>-<kind>-<split>/NNNNNN.wav (16 kHz PCM16) and manifest.jsonl next to them.

Example:
  python -I synth.py --engine piper --piper-model en_US-libritts_r-medium.onnx \
      --kind positive --split train --count 6000 --out clips
"""
from __future__ import annotations

import argparse
import random
import sys
from multiprocessing import Pool
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402

from common import resample, save_wav, trim_silence, write_manifest  # noqa: E402
from phrases import CONFUSABLE_TEXTS, POSITIVE_TEXTS, TEST_ONLY_KOKORO_VOICES  # noqa: E402

MAX_POSITIVE_SECONDS = 2.2
MAX_SENTENCE_WORDS = 14
_ENGINE = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--engine", choices=["piper", "kokoro"], required=True)
    parser.add_argument("--kind", choices=["positive", "confusable", "sentence"], required=True)
    parser.add_argument("--split", choices=["train", "test"], required=True)
    parser.add_argument("--count", type=int, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--piper-model", type=Path)
    parser.add_argument("--espeak-data-dir", help="Piper's espeak-ng-data (use a short relative path on deep folders)")
    parser.add_argument("--kokoro-model", type=Path)
    parser.add_argument("--kokoro-voices", type=Path)
    parser.add_argument("--sentences", type=Path, help="one sentence per line (kind=sentence)")
    return parser.parse_args()


def load_sentences(path: Path | None) -> list[str]:
    if path is None:
        raise SystemExit("--sentences is required for kind=sentence")
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        words = line.strip().split()[:MAX_SENTENCE_WORDS]
        if words:
            text = " ".join(words).lower()
            out.append(text[:1].upper() + text[1:] + ".")
    return out


def texts_for(kind: str, sentences: list[str]) -> list[str]:
    if kind == "positive":
        return POSITIVE_TEXTS
    if kind == "confusable":
        return CONFUSABLE_TEXTS
    return sentences


def piper_jobs(args, rng: random.Random, texts: list[str]) -> list[dict]:
    import json

    config = json.loads(Path(str(args.piper_model) + ".json").read_text(encoding="utf-8"))
    speakers = [s for s in range(config["num_speakers"]) if (s % 10 == 0) == (args.split == "test")]
    return [{
        "text": rng.choice(texts),
        "voice": rng.choice(speakers),
        "length_scale": rng.uniform(0.75, 1.55),
        "noise_scale": rng.uniform(0.4, 1.0),
        "noise_w": rng.uniform(0.5, 1.1),
    } for _ in range(args.count)]


def kokoro_jobs(args, rng: random.Random, texts: list[str], voices: list[str]) -> list[dict]:
    test = set(TEST_ONLY_KOKORO_VOICES)
    pool = [v for v in voices if v[:2] in ("af", "am", "bf", "bm") and (v in test) == (args.split == "test")]
    jobs = []
    for _ in range(args.count):
        blend = args.split == "train" and rng.random() < 0.5
        jobs.append({
            "text": rng.choice(texts),
            "voice": rng.choice(pool),
            "blend": rng.choice(pool) if blend else None,
            "alpha": rng.uniform(0.2, 0.8),
            "speed": rng.uniform(0.7, 1.2),
        })
    return jobs


def init_worker(args) -> None:
    global _ENGINE
    if args.engine == "piper":
        from piper import PiperVoice

        extra = {"espeak_data_dir": args.espeak_data_dir} if args.espeak_data_dir else {}
        _ENGINE = PiperVoice.load(str(args.piper_model), **extra)
    else:
        from kokoro_onnx import Kokoro

        _ENGINE = Kokoro(str(args.kokoro_model), str(args.kokoro_voices))


def synthesize(job: dict) -> np.ndarray:
    if "length_scale" in job:
        from piper import SynthesisConfig

        config = SynthesisConfig(speaker_id=job["voice"], length_scale=job["length_scale"],
                                 noise_scale=job["noise_scale"], noise_w_scale=job["noise_w"])
        chunks = list(_ENGINE.synthesize(job["text"], syn_config=config))
        audio = np.concatenate([c.audio_int16_array for c in chunks]).astype(np.float32) / 32768.0
        return resample(audio, chunks[0].sample_rate)
    voice = job["voice"]
    if job["blend"]:
        a = job["alpha"]
        voice = a * _ENGINE.get_voice_style(job["voice"]) + (1 - a) * _ENGINE.get_voice_style(job["blend"])
    lang = "en-gb" if job["voice"].startswith("b") else "en-us"
    audio, rate = _ENGINE.create(job["text"], voice=voice, speed=job["speed"], lang=lang)
    return resample(np.asarray(audio, dtype=np.float32), rate)


def run_job(item: tuple[int, dict, str, str]) -> dict | None:
    index, job, out_dir, kind = item
    try:
        audio = trim_silence(synthesize(job))
    except Exception as error:  # one bad phrase must not stop thousands of good ones; reported below
        return {"error": f"{type(error).__name__}: {error}", **job}
    if len(audio) < 1600 or (kind == "positive" and len(audio) > MAX_POSITIVE_SECONDS * 16000):
        return None
    name = f"{index:06d}.wav"
    save_wav(Path(out_dir) / name, audio)
    return {"file": name, "seconds": round(len(audio) / 16000, 3), **job}


def main() -> None:
    args = parse_args()
    rng = random.Random(args.seed)
    texts = texts_for(args.kind, load_sentences(args.sentences) if args.kind == "sentence" else [])
    if args.engine == "piper":
        jobs = piper_jobs(args, rng, texts)
    else:
        from kokoro_onnx import Kokoro

        voices = Kokoro(str(args.kokoro_model), str(args.kokoro_voices)).get_voices()
        jobs = kokoro_jobs(args, rng, texts, voices)
    out_dir = args.out / f"{args.engine}-{args.kind}-{args.split}"
    out_dir.mkdir(parents=True, exist_ok=True)
    items = [(i, job, str(out_dir), args.kind) for i, job in enumerate(jobs)]
    with Pool(args.workers, initializer=init_worker, initargs=(args,)) as pool:
        rows = [row for row in pool.imap(run_job, items, chunksize=16) if row is not None]
    errors = [row for row in rows if "error" in row]
    write_manifest(out_dir / "manifest.jsonl", [row for row in rows if "error" not in row])
    print(f"{out_dir.name}: {len(rows) - len(errors)} clips, {len(errors)} errors")
    for row in errors[:5]:
        print("  error:", row["error"], "|", row["text"])


if __name__ == "__main__":
    main()
