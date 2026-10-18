"""Second-stage check: does the last ~1.5 s of audio actually say "Hey Leafy"?

Python reference for app/src/main/wake/verify.ts and moonshine.ts. Moonshine Tiny (MIT, English)
transcribes the ring buffer greedily; then the same decoder scores "Hey, Leafy." variants as a
forced continuation of each prefix of that transcript. The detection is confirmed when the
transcript names Leafy outright, or when the wake phrase is nearly as likely as what the model
heard (log-probability margin ≥ -MARGIN). Small ASR models rarely spell "Leafy" right ("Lacy",
"Lisi"), which is why the likelihood check exists.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np

BOS, EOS = 1, 2
MAX_TOKENS = 10
MAX_PREFIX = 6
# "Hey, Leafy." / "Hey Leafy." / "Hey, leafy." / "Hey leafy." / "Hey, Leafy!" / "Hey Leafy!"
CANDIDATES = [
    [18637, 29892, 951, 2142, 29891, 29889],
    [18637, 951, 2142, 29891, 29889],
    [18637, 29892, 20447, 29891, 29889],
    [18637, 20447, 29891, 29889],
    [18637, 29892, 951, 2142, 29891, 29991],
    [18637, 951, 2142, 29891, 29991],
]
# Not "a": "a leafy street" must not count. A "Hey" heard as "A" is left to the likelihood check.
GREETING = re.compile(r"^(hey|hay|hei|heh|hej|eh)$")
LEAFY = re.compile(r"^l(e|ee|ea|ie|i)f+(y|ie|ey|i|ee)$")


def log_softmax(x: np.ndarray) -> np.ndarray:
    m = x.max(axis=-1, keepdims=True)
    return x - m - np.log(np.exp(x - m).sum(axis=-1, keepdims=True))


def names_leafy(transcript: str) -> bool:
    """True when the words contain a greeting followed by "Leafy" (or "heyleafy")."""
    words = re.sub(r"[^a-z\s]", " ", transcript.lower()).split()
    if any(w.startswith("hey") and LEAFY.match(w[3:]) for w in words):
        return True
    return any(GREETING.match(a) and LEAFY.match(b) for a, b in zip(words, words[1:]))


class Moonshine:
    def __init__(self, model_dir: str | Path, threads: int = 1):
        import onnxruntime as ort

        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        model_dir = Path(model_dir)
        self.encoder = ort.InferenceSession(str(model_dir / "encoder_model_quantized.onnx"), options)
        self.decoder = ort.InferenceSession(str(model_dir / "decoder_model_quantized.onnx"), options)
        vocab = json.loads((model_dir / "tokenizer.json").read_text(encoding="utf-8"))["model"]["vocab"]
        self.tokens = {i: t for t, i in vocab.items()}

    def encode(self, audio: np.ndarray) -> np.ndarray:
        return self.encoder.run(None, {"input_values": audio[None].astype(np.float32)})[0]

    def logits(self, hidden: np.ndarray, ids: list[int]) -> np.ndarray:
        feed = {"input_ids": np.array([ids], dtype=np.int64), "encoder_hidden_states": hidden}
        return self.decoder.run(["logits"], feed)[0][0]

    def greedy(self, hidden: np.ndarray) -> tuple[list[int], float]:
        ids, total = [BOS], 0.0
        for _ in range(MAX_TOKENS):
            row = log_softmax(self.logits(hidden, ids)[-1])
            token = int(row.argmax())
            total += float(row[token])
            if token == EOS:
                return ids[1:], total
            ids.append(token)
        return ids[1:], total

    def forced(self, hidden: np.ndarray, sequences: list[list[int]]) -> list[float]:
        """Log-probability of each token sequence (+ EOS) in one batched, right-padded decoder call.

        The decoder is causal, so padding after a sequence never changes the logits it is scored on.
        """
        width = max(len(s) for s in sequences) + 1
        ids = np.full((len(sequences), width), EOS, dtype=np.int64)
        for row, tokens in enumerate(sequences):
            ids[row, :len(tokens) + 1] = [BOS] + tokens
        feed = {"input_ids": ids, "encoder_hidden_states": np.repeat(hidden, len(sequences), axis=0)}
        rows = log_softmax(self.decoder.run(["logits"], feed)[0])
        return [float(sum(rows[r, i, t] for i, t in enumerate(tokens + [EOS]))) for r, tokens in enumerate(sequences)]

    def text(self, tokens: list[int]) -> str:
        return "".join(self.tokens.get(t, "") for t in tokens).replace("▁", " ").strip()


def verify(model: Moonshine, audio: np.ndarray, margin: float) -> dict:
    peak = float(np.abs(audio).max())
    audio = audio * (0.5 / peak) if peak > 1e-4 else audio
    hidden = model.encode(audio)
    tokens, greedy_lp = model.greedy(hidden)
    transcript = model.text(tokens)
    sequences = [tokens[:k] + c for k in range(min(len(tokens), MAX_PREFIX) + 1) for c in CANDIDATES]
    gap = max(model.forced(hidden, sequences)) - greedy_lp
    named = names_leafy(transcript)
    return {"transcript": transcript, "margin": gap, "named": named, "accepted": named or gap >= -margin}
