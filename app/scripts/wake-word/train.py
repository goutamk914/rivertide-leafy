"""Trains the "Hey Leafy" classifier on openWakeWord embeddings and exports it to ONNX.

Architecture follows openWakeWord's small DNN head (16 x 96 embeddings → 64 → 64 → 1, LayerNorm +
ReLU). Negatives are weighted more heavily as training goes on, and the checkpoint kept is the one
with the best held-out recall at a threshold whose false-accept rate on openWakeWord's 11 h
validation set stays under --target-fa-per-hour.

Example:
  python -I train.py --features features --validation validation_set_features.npy --out hey_leafy.onnx
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
import torch  # noqa: E402
from torch import nn  # noqa: E402

from common import EMBEDDING_DIM, WINDOW_EMBEDDINGS, fire_frames, windows  # noqa: E402

THRESHOLDS = np.round(np.arange(0.30, 1.0, 0.025), 3)
FRAME_SECONDS = 0.08
BATCH = {"positive": 256, "adversarial": 256, "background": 768}


class Head(nn.Module):
    def __init__(self, dim: int = 64):
        super().__init__()
        self.net = nn.Sequential(
            nn.Flatten(),
            nn.Linear(WINDOW_EMBEDDINGS * EMBEDDING_DIM, dim), nn.LayerNorm(dim), nn.ReLU(),
            nn.Linear(dim, dim), nn.LayerNorm(dim), nn.ReLU(),
            nn.Linear(dim, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class Scored(nn.Module):
    """Export wrapper: probabilities instead of logits."""

    def __init__(self, head: Head):
        super().__init__()
        self.head = head

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return torch.sigmoid(self.head(x))


def load(features: Path) -> dict:
    def f32(name: str) -> torch.Tensor:
        return torch.from_numpy(np.load(features / name).astype(np.float32))

    background, starts, offset = [], [], 0
    for kind in ("speech", "music", "noise"):
        stream = np.load(features / f"background_{kind}.npy")
        bounds = list(np.load(features / f"background_{kind}_starts.npy")) + [len(stream)]
        for a, b in zip(bounds[:-1], bounds[1:]):
            starts.append(np.arange(offset + a, offset + b - WINDOW_EMBEDDINGS + 1))
        background.append(stream)
        offset += len(stream)
    # Short real-speech excerpts (features.py --parts excerpts) are adversarial negatives too.
    excerpts = [f32(p.name) for p in sorted(features.glob("excerpts_train*.npy"))]
    return {
        "positive": f32("positive_train.npy"),
        "adversarial": torch.cat([f32("adversarial_train.npy"), *excerpts]),
        "positive_test": f32("positive_test.npy"),
        "adversarial_test": f32("adversarial_test.npy"),
        "background": torch.from_numpy(np.concatenate(background).astype(np.float32)),
        "background_starts": torch.from_numpy(np.concatenate(starts)),
    }


def sample_batch(data: dict, gen: torch.Generator, hard: torch.Tensor | None) -> tuple[torch.Tensor, torch.Tensor]:
    def pick(t: torch.Tensor, n: int) -> torch.Tensor:
        return t[torch.randint(len(t), (n,), generator=gen)]

    n_hard = BATCH["background"] // 2 if hard is not None and len(hard) > 0 else 0
    starts = pick(data["background_starts"], BATCH["background"] - n_hard)
    if n_hard:
        starts = torch.cat([starts, pick(hard, n_hard)])
    background = data["background"][starts[:, None] + torch.arange(WINDOW_EMBEDDINGS)]
    x = torch.cat([pick(data["positive"], BATCH["positive"]), pick(data["adversarial"], BATCH["adversarial"]), background])
    y = torch.cat([torch.ones(BATCH["positive"]), torch.zeros(BATCH["adversarial"] + BATCH["background"])])
    return x, y[:, None]


@torch.no_grad()
def scores(model: nn.Module, x: np.ndarray | torch.Tensor, batch: int = 16384) -> np.ndarray:
    model.eval()
    out = []
    for i in range(0, len(x), batch):
        chunk = torch.as_tensor(np.ascontiguousarray(x[i:i + batch]), dtype=torch.float32)
        out.append(torch.sigmoid(model(chunk)).squeeze(1).numpy())
    model.train()
    return np.concatenate(out)


@torch.no_grad()
def mine_hard(model: nn.Module, data: dict, keep: int) -> torch.Tensor:
    """Start indices of the background windows the model currently scores highest."""
    model.eval()
    starts = data["background_starts"]
    best = torch.empty(0)
    best_starts = torch.empty(0, dtype=torch.long)
    for i in range(0, len(starts), 65536):
        chunk = starts[i:i + 65536]
        logits = model(data["background"][chunk[:, None] + torch.arange(WINDOW_EMBEDDINGS)]).squeeze(1)
        merged = torch.cat([best, logits])
        top = torch.topk(merged, min(keep, len(merged))).indices
        best, best_starts = merged[top], torch.cat([best_starts, chunk])[top]
    model.train()
    return best_starts


def evaluate(model: nn.Module, data: dict, validation: np.ndarray) -> dict:
    val_scores = scores(model, windows(validation))
    hours = len(validation) * FRAME_SECONDS / 3600
    pos, adv = scores(model, data["positive_test"]), scores(model, data["adversarial_test"])
    rows = [{
        "threshold": float(t),
        "fa_per_hour": len(fire_frames(val_scores, t)) / hours,
        "recall": float((pos >= t).mean()),
        "confusable_accept": float((adv >= t).mean()),
    } for t in THRESHOLDS]
    return {"hours": hours, "rows": rows}


def best_operating_point(report: dict, target: float) -> dict | None:
    ok = [r for r in report["rows"] if r["fa_per_hour"] <= target]
    return max(ok, key=lambda r: (r["recall"], -r["threshold"])) if ok else None


def learning_rate(step: int, steps: int, peak: float) -> float:
    warmup = steps // 20
    if step < warmup:
        return peak * step / warmup
    return 1e-5 + 0.5 * (peak - 1e-5) * (1 + np.cos(np.pi * (step - warmup) / (steps - warmup)))


def train(data: dict, validation: np.ndarray, args) -> tuple[nn.Module, dict]:
    torch.manual_seed(args.seed)
    gen = torch.Generator().manual_seed(args.seed)
    model = Head(args.dim)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)
    best = {"score": -1.0, "state": None, "point": None, "step": 0}
    hard: torch.Tensor | None = None
    for step in range(1, args.steps + 1):
        for group in optimizer.param_groups:
            group["lr"] = learning_rate(step, args.steps, args.lr)
        if args.mine_every and step % args.mine_every == 0:
            hard = mine_hard(model, data, args.hard_negatives)
        x, y = sample_batch(data, gen, hard)
        weight = torch.where(y > 0, 1.0, 1.0 + (args.max_negative_weight - 1) * step / args.steps)
        loss = nn.functional.binary_cross_entropy_with_logits(model(x), y, weight=weight)
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        if step % args.eval_every and step != args.steps:
            continue
        report = evaluate(model, data, validation)
        point = best_operating_point(report, args.target_fa_per_hour)
        summary = " ".join(f"{r['threshold']}:{r['fa_per_hour']:.2f}/{r['recall']:.2f}" for r in report["rows"][::4])
        print(f"step {step} loss {loss.item():.4f} [threshold:fa/h/recall] {summary} best {point}", flush=True)
        if point and step >= args.steps // 3 and point["recall"] > best["score"]:
            best = {"score": point["recall"], "state": {k: v.clone() for k, v in model.state_dict().items()},
                    "point": point, "step": step}
    if best["state"] is None:
        print(f"WARNING: no checkpoint reached {args.target_fa_per_hour} false accepts per hour; keeping the final weights", flush=True)
        return model, best
    model.load_state_dict(best["state"])
    return model, best


def export(model: nn.Module, path: Path) -> None:
    wrapper = Scored(model).eval()
    example = torch.zeros(1, WINDOW_EMBEDDINGS, EMBEDDING_DIM)
    torch.onnx.export(wrapper, (example,), str(path), input_names=["x"], output_names=["score"],
                      dynamic_axes={"x": {0: "n"}, "score": {0: "n"}}, opset_version=17, dynamo=False)
    import onnxruntime as ort

    probe = np.random.default_rng(0).standard_normal((8, WINDOW_EMBEDDINGS, EMBEDDING_DIM)).astype(np.float32)
    got = ort.InferenceSession(str(path)).run(None, {"x": probe})[0]
    want = wrapper(torch.from_numpy(probe)).detach().numpy()
    if not np.allclose(got, want, atol=1e-5):
        raise SystemExit("ONNX export does not match the PyTorch model")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--validation", type=Path, required=True, help="openWakeWord validation_set_features.npy")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--steps", type=int, default=30000)
    parser.add_argument("--eval-every", type=int, default=1000)
    parser.add_argument("--dim", type=int, default=64)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--max-negative-weight", type=float, default=30.0)
    parser.add_argument("--target-fa-per-hour", type=float, default=0.25)
    parser.add_argument("--mine-every", type=int, default=1000, help="hard-negative mining interval (0 = off)")
    parser.add_argument("--hard-negatives", type=int, default=20000, help="background windows kept as hard negatives")
    parser.add_argument("--seed", type=int, default=3)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    data = load(args.features)
    validation = np.load(args.validation).astype(np.float32)
    print({k: tuple(v.shape) for k, v in data.items()}, flush=True)
    model, best = train(data, validation, args)
    export(model, args.out)
    torch.save(model.state_dict(), args.out.with_suffix(".pt"))
    report = evaluate(model, data, validation)
    summary = {"step": best["step"], "operating_point": best["point"], "validation_hours": report["hours"],
               "thresholds": report["rows"], "args": {k: str(v) for k, v in vars(args).items()}}
    args.out.with_suffix(".metrics.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("best", best["step"], best["point"])


if __name__ == "__main__":
    main()
