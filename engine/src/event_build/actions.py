"""Action library: classify visual transitions; learn new types per content mode."""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
from PIL import Image

DEFAULT_LIBRARY = Path(__file__).parent / "data" / "action-library.json"


def load(path: Path | None = None) -> dict:
    p = Path(path) if path else DEFAULT_LIBRARY
    lib = json.loads(p.read_text(encoding="utf-8"))
    learned = lib.setdefault("learned", {})
    if "clusters" in learned:
        flat = learned
        lib["learned"] = {
            "screen": {"clusters": flat.get("clusters", []), "labels": flat.get("labels", {}),
                       "samples": flat.get("samples", 0), "scaler": flat.get("scaler")},
            "action": {"clusters": [], "labels": {}, "samples": 0, "scaler": None},
        }
    return lib


def save(lib: dict, path: Path | None = None) -> None:
    p = Path(path) if path else DEFAULT_LIBRARY
    p.write_text(json.dumps(lib, ensure_ascii=False, indent=2), encoding="utf-8")


def frame_gray(frames_dir: Path, idx: int, w: int = 256, h: int = 144) -> np.ndarray:
    with Image.open(frames_dir / f"f_{idx + 1:06d}.jpg") as im:
        return np.asarray(im.convert("L").resize((w, h)), dtype=np.float32)


def profile_shift(a: np.ndarray, b: np.ndarray, axis: int, limit: int = 40) -> int:
    pa = a.sum(axis=1) if axis == 0 else a.sum(axis=0)
    pb = b.sum(axis=1) if axis == 0 else b.sum(axis=0)
    base = float(np.abs(pa - pb)[limit:-limit].mean())
    best, best_s = 0, base
    for s in range(-limit, limit + 1):
        score = float(np.abs(np.roll(pa, s) - pb)[limit:-limit].mean())
        if score < best_s:
            best, best_s = s, score
    if base <= 0 or (base - best_s) / base < 0.2:
        return 0
    return best


def tokens(label: str | None) -> set[str]:
    if not label:
        return set()
    return {p.strip().lower() for p in re.split(r"[\s/／|、,，。;；:：]+", label) if len(p.strip()) >= 2}


def collect(event_path: str, frames_dir: str) -> tuple[dict, list[dict]]:
    event = json.loads(Path(event_path).read_text(encoding="utf-8"))
    fps, start = event.get("fps", 1), event.get("start", 0)
    fdir = Path(frames_dir)
    rows = []
    for tr in event["transitions"]:
        i0 = int(round((tr["t0"] - start) * fps))
        i1 = int(round((tr["t1"] - start) * fps))
        a, b = frame_gray(fdir, i0), frame_gray(fdir, i1)
        ta, tb = tokens(tr.get("label_before")), tokens(tr.get("label_after"))
        union = len(ta | tb)
        feats = {
            "pixdiff": round(float(np.abs(a - b).mean()), 2),
            "dy": int(profile_shift(a, b, 0)),
            "dx": int(profile_shift(a, b, 1)),
            "text_overlap": round(len(ta & tb) / union, 3) if union else 1.0,
            "text_delta": len(tb) - len(ta),
            "duration": tr["duration"],
        }
        feats["dx_gt_dy"] = 1 if abs(feats["dx"]) > abs(feats["dy"]) else 0
        feats["abs_dy"] = abs(feats["dy"])
        feats["abs_dx"] = abs(feats["dx"])
        feats["max_shift"] = max(feats["abs_dy"], feats["abs_dx"])
        rows.append({"t0": tr["t0"], "t1": tr["t1"], "feats": feats,
                     "speech": (tr.get("label_speech") or "")[:60]})
    return event, rows


def match(rules: list[dict], feats: dict) -> bool:
    ops = {"<": np.less, ">": np.greater, "<=": np.less_equal, ">=": np.greater_equal}
    return all(bool(ops[r["op"]](feats[r["feature"]], r["value"])) for r in rules)


def bucket(lib: dict, mode: str) -> dict:
    return lib["learned"].setdefault(mode, {"clusters": [], "labels": {}, "samples": 0, "scaler": None})


def classify(feats: dict, lib: dict, mode: str) -> str:
    for cat in lib["categories"]:
        if mode in cat.get("mode", []) and match(cat["rules"], feats):
            return cat["id"]
    b = bucket(lib, mode)
    if b.get("clusters"):
        names = lib["features"]
        x = np.array([feats[n] for n in names], dtype=np.float32)
        z = (x - np.array(b["scaler"]["mean"])) / np.array(b["scaler"]["std"])
        idx = int(np.argmin([float(np.linalg.norm(z - np.array(c))) for c in b["clusters"]]))
        return b["labels"].get(str(idx)) or f"{mode}_cluster_{idx}"
    return "unclassified"


def learn(lib: dict, mode: str, feats_list: list[dict], k: int = 3) -> None:
    names = lib["features"]
    X = np.array([[f[n] for n in names] for f in feats_list], dtype=np.float32)
    if len(X) < k:
        return
    mu, sd = X.mean(axis=0), X.std(axis=0)
    sd[sd == 0] = 1.0
    Z = (X - mu) / sd
    rng = np.random.default_rng(7)
    centers = Z[rng.choice(len(Z), k, replace=False)]
    for _ in range(60):
        d = ((Z[:, None, :] - centers[None, :, :]) ** 2).sum(axis=2)
        lab = d.argmin(axis=1)
        new = np.array([Z[lab == j].mean(axis=0) if np.any(lab == j) else centers[j] for j in range(k)])
        if np.allclose(new, centers):
            break
        centers = new
    bucket(lib, mode).update({"clusters": centers.tolist(), "samples": len(X),
                              "scaler": {"mean": mu.tolist(), "std": sd.tolist()}})


def run(event_path: str, frames_dir: str, library: Path | None = None,
        learn_new: bool = True) -> dict:
    lib = load(library)
    event, rows = collect(event_path, frames_dir)
    mode = event.get("mode", "screen")
    for r in rows:
        r["type"] = classify(r["feats"], lib, mode)
    if learn_new:
        pool = [r["feats"] for r in rows if r["type"] == "unclassified"]
        if pool:
            learn(lib, mode, pool)
            save(lib, library)
            for r in rows:
                r["type"] = classify(r["feats"], lib, mode)
    dist: dict[str, int] = {}
    for r in rows:
        dist[r["type"]] = dist.get(r["type"], 0) + 1
    return {"mode": mode, "transitions": len(rows), "distribution": dict(sorted(dist.items())),
            "rows": rows}
