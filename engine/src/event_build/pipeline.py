"""Pipeline: frames -> states/transitions -> labels -> units -> alignment -> gates."""
from __future__ import annotations

import json
import re
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

import imagehash
from PIL import Image

from event_build.chapters import build_chapters

ACTIONS = ["滑", "点", "打开", "返回", "刷新", "放大", "缩小", "缩", "拉", "顶",
           "切", "换", "拖", "滚", "进入", "跳", "点开", "看一", "拉上来", "放上去"]
DEICTIC = ["这个", "这里", "这块", "这边", "这不", "那儿", "下面", "上面", "左边", "右边", "底下"]


def local_attention(t: float, units: list[dict], transitions: list[dict],
                    window: float = 30.0) -> dict:
    """Attention around one timestamp: speech density and interactions inside ±window."""
    lo, hi = t - window, t + window
    overlap = [u for u in units if min(u["t1"], hi) - max(u["t0"], lo) > 0]
    text = "".join(u["text"] for u in overlap)
    deictic = sum(text.count(w) for w in DEICTIC)
    action = sum(text.count(w) for w in ACTIONS)
    micro = sum(1 for tr in transitions
                if lo <= tr["t0"] <= hi and tr.get("duration", 1) <= 2)
    return {"window_s": window, "deictic_hits": deictic, "action_hits": action,
            "micro_interactions": micro, "score": round(3 * deictic + 2 * action + 1.5 * micro, 2)}


def attention_of(state: dict, units: list[dict], transitions: list[dict]) -> dict:
    """Attention proxy for one state: dwell, pointing language, interaction density."""
    overlap = [u for u in units if min(u["t1"], state["t1"]) - max(u["t0"], state["t0"]) > 0]
    text = "".join(u["text"] for u in overlap)
    deictic = sum(text.count(w) for w in DEICTIC)
    action = sum(text.count(w) for w in ACTIONS)
    micro = sum(1 for tr in transitions
                if state["t0"] <= tr["t0"] <= state["t1"] and tr.get("duration", 1) <= 2)
    dwell = state["t1"] - state["t0"]
    return {"dwell_s": round(dwell, 1), "deictic_hits": deictic, "action_hits": action,
            "micro_interactions": micro,
            "emphasis": round(dwell / 10 + 3 * deictic + 2 * action + 1.5 * micro, 2)}


def log(msg: str) -> None:
    print(f"[event-build] {msg}", flush=True)


@dataclass
class BuildConfig:
    video: str
    out: Path
    transcript: Path
    fps: float = 1.0
    width: int = 1024
    scene_th: int = 9
    start: float = 0.0
    duration: float | None = None
    reuse: Path | None = None
    no_ocr: bool = False
    hi_labels: bool = False
    label_width: int = 1536
    chrome_crop: float = 0.07
    mode: str = "auto"


def _run(cmd: list[str]) -> None:
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"command failed ({proc.returncode}): {' '.join(cmd)}\n{proc.stderr[-800:]}")


def hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def extract_frames(cfg: BuildConfig, frames_dir: Path) -> list[str]:
    frames_dir.mkdir(parents=True, exist_ok=True)
    for old in frames_dir.glob("f_*.jpg"):
        old.unlink()
    cmd = ["ffmpeg", "-y", "-v", "error"]
    if cfg.start:
        cmd += ["-ss", str(cfg.start)]
    if cfg.duration:
        cmd += ["-t", str(cfg.duration)]
    cmd += ["-i", cfg.video, "-vf", f"fps={cfg.fps},scale={cfg.width}:-2", "-q:v", "4",
            str(frames_dir / "f_%06d.jpg")]
    _run(cmd)
    return sorted(str(p) for p in frames_dir.glob("f_*.jpg"))


def hash_frames(files: list[str], out: Path) -> list[str]:
    hashes = []
    for i, f in enumerate(files):
        with Image.open(f) as im:
            hashes.append(str(imagehash.phash(im.convert("L"))))
        if (i + 1) % 1000 == 0:
            log(f"hash {i + 1}/{len(files)}")
    out.write_text(json.dumps({"files": files, "phash": hashes}), encoding="utf-8")
    return hashes


def smooth3(raw: list[int]) -> list[int]:
    out = []
    for i in range(len(raw)):
        lo, hi = max(0, i - 1), min(len(raw), i + 2)
        out.append(sorted(raw[lo:hi])[(hi - lo) // 2])
    return out


def segment(hashes: list[str], scene_th: int, start_off: float, fps: float):
    raw = [hamming(hashes[i - 1], hashes[i]) for i in range(1, len(hashes))]
    sm = smooth3(raw)
    change = [i + 1 for i, d in enumerate(sm) if d >= scene_th]
    groups: list[list[int]] = []
    for idx in change:
        if groups and idx - groups[-1][-1] <= 2:
            groups[-1].append(idx)
        else:
            groups.append([idx])

    def t(idx: int) -> float:
        return round(start_off + idx / fps, 3)

    transitions = [{"t0": t(g[0] - 1), "t1": t(g[-1]),
                    "duration": round((g[-1] - (g[0] - 1)) / fps, 3)} for g in groups]
    states = []
    n = len(hashes)
    prev = 0
    for tr in transitions:
        st0 = int(round((tr["t0"] - start_off) * fps))
        if st0 > prev:
            states.append({"t0": t(prev), "t1": t(st0)})
        prev = int(round((tr["t1"] - start_off) * fps))
    if prev < n - 1:
        states.append({"t0": t(prev), "t1": t(n - 1)})
    for s in states:
        s["dur"] = round(s["t1"] - s["t0"], 3)
    for tr in transitions:
        tr["type"] = "instant" if tr["duration"] <= 2 else "continuous"
    return raw, sm, states, transitions


def ocr_frames(files: list[str], indices: list[int], out: Path, cache_path: Path | None):
    cache: dict[int, list[str]] = {}
    if cache_path and cache_path.exists():
        for line in cache_path.read_text(encoding="utf-8").splitlines():
            rec = json.loads(line)
            cache[int(rec["i"])] = [t for t in rec["txts"] if t.strip()]
        log(f"reused OCR for {len(cache)} frames")
    from rapidocr import RapidOCR
    engine = RapidOCR()
    store: dict[int, list[str]] = {}
    miss = [i for i in indices if i not in cache]
    log(f"OCR {len(indices)} frames ({len(indices) - len(miss)} reused)")
    for k, i in enumerate(miss):
        with Image.open(files[i]) as im:
            im = im.convert("RGB")
            im = im.resize((640, int(im.height * 640 / im.width)))
            try:
                r = engine(im)
                store[i] = [t for t in (getattr(r, "txts", None) or []) if t.strip()]
            except Exception:
                store[i] = []
        if (k + 1) % 50 == 0:
            log(f"ocr {k + 1}/{len(miss)}")
    merged = {**cache, **store}
    with out.open("w", encoding="utf-8") as f:
        for i in sorted(merged):
            f.write(json.dumps({"i": i, "txts": merged[i]}, ensure_ascii=False) + "\n")
    return merged


URL_RE = re.compile(r"(https?://[^\s/]+|[\w-]+\.(?:com|cn|net|org|io|cc|me|shop)\b\S*)")
TRANSLATE_UI = re.compile(r"^(中文（简体）|中文\(简体\)|中文|翻译|翻泽|翻洋|翻洋为|翻译为|更多|英语|热|页面\?)$|翻译.*页面|翻洋.*页面")


def ocr_hi(files: list[str], indices: list[int], out: Path, width: int, chrome_ratio: float) -> dict[int, dict]:
    from rapidocr import RapidOCR
    engine = RapidOCR()
    store: dict[int, dict] = {}
    log(f"hi-label OCR {len(indices)} frames at {width}px (drop top {chrome_ratio:.0%})")
    for k, i in enumerate(indices):
        with Image.open(files[i]) as im:
            im = im.convert("RGB")
            im = im.resize((width, int(im.height * width / im.width)))
            height = im.height
            try:
                r = engine(im)
            except Exception:
                store[i] = {"text": "", "score": 0.0, "url_hint": None, "tab_hint": None}
                continue
        txts = list(getattr(r, "txts", None) or [])
        scores = [float(x) for x in (getattr(r, "scores", None) or [])]
        boxes = getattr(r, "boxes", None)
        page, top = [], []
        for j, t in enumerate(txts):
            t = t.strip()
            if not t:
                continue
            y = min(p[1] for p in boxes[j]) / height if boxes is not None else 1.0
            if y < chrome_ratio:
                top.append((t, y))
            else:
                page.append((t, scores[j] if j < len(scores) else 0.0, y))
        page = [(t, s) for t, s, y in page if not (y < 0.28 and TRANSLATE_UI.search(t))]
        text = " / ".join(t for t, _ in page[:3])[:140]
        score = round(sum(s for _, s in page) / len(page), 3) if page else 0.0
        url_hint = next((t for t, _ in top if URL_RE.search(t)), None)
        if url_hint:
            url_hint = re.sub(r"^https?:?/{0,3}", "https://", url_hint).rstrip("，,。.；;")
        root = ""
        if url_hint:
            m = re.search(r"(?:https?://)?([\w-]+)\.", url_hint)
            root = m.group(1).lower() if m else ""
        tabs = [t for t, y in top if y < chrome_ratio * 0.55 and any(ch.isalnum() for ch in t)
                and t not in ("×", "+", "0")]
        tab_hint = next((t for t in tabs if root and root in t.lower()), tabs[0] if tabs else None)
        store[i] = {"text": text, "score": score, "url_hint": url_hint, "tab_hint": tab_hint}
        if (k + 1) % 40 == 0:
            log(f"hi-label {k + 1}/{len(indices)}")
    with out.open("w", encoding="utf-8") as f:
        for i in sorted(store):
            f.write(json.dumps({"i": i, **store[i]}, ensure_ascii=False) + "\n")
    return store


def label_at(ocr: dict[int, list[str]], idx: int, look: int = 6) -> str | None:
    for i in range(idx, idx + look):
        if i in ocr and ocr[i]:
            return (" / ".join(ocr[i][:3]))[:110]
    return None


def parse_transcript(path: Path, start_off: float, duration: float | None) -> list[dict]:
    segs = []
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"\[(\d{2}):(\d{2})\] (.*)", line)
        if not m:
            continue
        t = int(m.group(1)) * 60 + int(m.group(2))
        if t < start_off or (duration is not None and t > start_off + duration):
            continue
        segs.append({"start": t, "text": m.group(3).strip()})
    for i, s in enumerate(segs):
        nxt = segs[i + 1]["start"] if i + 1 < len(segs) else s["start"] + 4
        s["end"] = min(nxt, s["start"] + 8) if nxt - s["start"] <= 8 else s["start"] + 6
    return segs


def merge_units(segs: list[dict]) -> list[dict]:
    units: list[dict] = []
    cur = None
    for s in segs:
        if cur is None:
            cur = {"t0": s["start"], "t1": s["end"], "text": s["text"]}
            continue
        gap = s["start"] - cur["t1"]
        if gap <= 1.0 and len(cur["text"]) + len(s["text"]) <= 45:
            cur["t1"] = s["end"]
            cur["text"] += s["text"]
        else:
            units.append(cur)
            cur = {"t0": s["start"], "t1": s["end"], "text": s["text"]}
    if cur:
        units.append(cur)
    for i, u in enumerate(units):
        u["id"] = f"u{i:04d}"
    return units


def speech_label(units: list[dict], t0: float, t1: float) -> str | None:
    hits = [u for u in units if min(u["t1"], t1) - max(u["t0"], t0) > 0]
    hits.sort(key=lambda u: -(u["t1"] - u["t0"]))
    txt = " ".join(u["text"] for u in hits[:2]).strip()
    return txt[:120] if txt else None


def align(units: list[dict], transitions: list[dict]) -> dict:
    for u in units:
        u["action"] = [w for w in ACTIONS if w in u["text"]]
        u["deictic"] = [w for w in DEICTIC if w in u["text"]]
    linked = 0
    lags = []
    for tr in transitions:
        cand = [u for u in units if u["t0"] <= tr["t1"] + 15 and u["t1"] >= tr["t0"] - 15]
        scored = []
        for u in cand:
            sc = 2 * len(u["action"]) + len(u["deictic"])
            sc += 1 if min(u["t1"], tr["t1"]) - max(u["t0"], tr["t0"]) > 0 else 0
            if sc:
                scored.append((sc, u))
        scored.sort(key=lambda x: -x[0])
        tr["links"] = [u["id"] for _, u in scored[:3]]
        if scored:
            linked += 1
            lags.append(scored[0][1]["t0"] - tr["t0"])
    action_units = [u for u in units if u["action"]]
    with_near = sum(1 for u in action_units
                    if any(tr["t0"] - 10 <= u["t0"] <= tr["t1"] + 10 for tr in transitions))
    lags_sorted = sorted(lags)

    def pct(p: float):
        if not lags_sorted:
            return None
        return round(lags_sorted[min(len(lags_sorted) - 1, int(len(lags_sorted) * p))], 1)

    return {
        "action_units": len(action_units),
        "action_units_with_transition": with_near,
        "action_match_rate": round(with_near / max(1, len(action_units)), 3),
        "action_units_without_transition": len(action_units) - with_near,
        "transitions_with_narration": linked,
        "transitions_without_narration": len(transitions) - linked,
        "narration_rate": round(linked / max(1, len(transitions)), 3),
        "lag_median_s": round(lags_sorted[len(lags_sorted) // 2], 1) if lags else None,
        "lag_p25_s": pct(0.25),
        "lag_p75_s": pct(0.75),
    }


def gaps_from(segs: list[dict], span_end: float) -> list[dict]:
    gaps = []
    for a, b in zip(segs, segs[1:]):
        if b["start"] - a["start"] > 3:
            gaps.append({"t0": a["start"], "t1": b["start"],
                         "reason": "silence / no speech (ASR VAD gap)"})
    if segs and span_end - segs[-1]["start"] > 3:
        gaps.append({"t0": segs[-1]["start"], "t1": span_end, "reason": "tail silence"})
    return gaps


def fmt(sec: float) -> str:
    s = int(sec)
    return f"{s // 60:02d}:{s % 60:02d}"


def build(cfg: BuildConfig) -> tuple[dict, dict]:
    import time as _time
    from event_build import SCHEMA_VERSION

    t_begin = _time.time()
    out = cfg.out
    out.mkdir(parents=True, exist_ok=True)
    frames_dir = out / "frames"
    phash_file = out / "phash.json"
    if cfg.reuse and (cfg.reuse / "frames").is_dir() and (cfg.reuse / "phash.json").exists():
        frames_dir = cfg.reuse / "frames"
        files = sorted(str(p) for p in frames_dir.glob("f_*.jpg"))
        hashes = json.loads((cfg.reuse / "phash.json").read_text(encoding="utf-8"))["phash"]
        log(f"reused {len(files)} frames")
    else:
        log("extracting frames")
        files = extract_frames(cfg, frames_dir)
        log(f"extracted {len(files)} frames")
        hashes = hash_frames(files, phash_file)

    n = len(hashes)
    raw, sm, states, transitions = segment(hashes, cfg.scene_th, cfg.start, cfg.fps)
    active_ratio = sum(1 for d in sm if d >= cfg.scene_th) / max(1, len(sm))
    median_state = sorted(s["t1"] - s["t0"] for s in states)[len(states) // 2] if states else 0.0
    mode = cfg.mode
    if mode == "auto":
        mode = "action" if active_ratio >= 0.40 else "screen"  # talk is explicit only: it skips OCR
    log(f"states={len(states)} transitions={len(transitions)} active={active_ratio:.2f} mode={mode}")

    indices = sorted({int(round((s['t0'] - cfg.start) * cfg.fps)) for s in states}
                     | {int(round((t['t0'] - cfg.start) * cfg.fps)) for t in transitions}
                     | set(range(0, n, 30)))
    indices = [i for i in indices if 0 <= i < n]
    ocr = {} if (cfg.no_ocr or mode == "talk") else ocr_frames(
        files, indices, out / "ocr.jsonl", (cfg.reuse / "ocr.jsonl") if cfg.reuse else None)

    if cfg.hi_labels and mode != "talk":
        state_idx = sorted({int(round((s["t0"] - cfg.start) * cfg.fps)) for s in states})
        state_idx = [i for i in state_idx if 0 <= i < n]
        hi = ocr_hi(files, state_idx, out / "hi-labels.jsonl", cfg.label_width, cfg.chrome_crop)
        for s in states:
            i = int(round((s["t0"] - cfg.start) * cfg.fps))
            if i in hi:
                s["label_hi"] = hi[i]["text"]
                s["label_hi_score"] = hi[i]["score"]
                s["url_hint"] = hi[i].get("url_hint")
                s["tab_hint"] = hi[i].get("tab_hint")

    for s in states:
        s["label"] = label_at(ocr, int(round((s["t0"] - cfg.start) * cfg.fps)))
        s["label_speech"] = None
    for tr in transitions:
        tr["label_before"] = label_at(ocr, int(round((tr["t0"] - cfg.start) * cfg.fps)))
        tr["label_after"] = label_at(ocr, max(0, int(round((tr["t1"] - cfg.start) * cfg.fps)) - 1))

    segs = parse_transcript(cfg.transcript, cfg.start, cfg.duration)
    units = merge_units(segs)
    for s in states:
        s["label_speech"] = speech_label(units, s["t0"], s["t1"])
    for tr in transitions:
        tr["label_speech"] = speech_label(units, tr["t0"], tr["t1"])
    log(f"units={len(units)}")

    segments: list[dict] = []
    if mode == "action":
        cur = None
        for u in units:
            if cur is None:
                cur = {"t0": u["t0"], "t1": u["t1"], "text": u["text"]}
                continue
            gap = u["t0"] - cur["t1"]
            if gap >= 1.5 or (u["t1"] - cur["t0"]) >= 60 or len(cur["text"]) + len(u["text"]) > 120:
                segments.append(cur)
                cur = {"t0": u["t0"], "t1": u["t1"], "text": u["text"]}
            else:
                cur["t1"] = u["t1"]
                cur["text"] += u["text"]
        if cur:
            segments.append(cur)
        for i, sg in enumerate(segments):
            sg["id"] = f"seg{i:03d}"
        log(f"segments={len(segments)}")

    alignment = align(units, transitions)
    for st in states:
        st["attention"] = attention_of(st, units, transitions)
    chapters = build_chapters(states, units)
    span_end = cfg.start + (n - 1) / cfg.fps
    gaps = gaps_from(segs, span_end)

    covered = round(sum(s["t1"] - s["t0"] for s in states)
                    + sum(t["t1"] - t["t0"] for t in transitions), 3)
    span = round((n - 1) / cfg.fps, 3)
    gates = {
        "visual_partition": {"ok": abs(covered - span) < 0.05, "covered_s": covered, "span_s": span,
                             "states": len(states), "transitions": len(transitions)},
        "states_labeled": {"ok": all(s.get("label_speech") or s.get("label") or s.get("label_hi") for s in states),
                           "labeled": sum(1 for s in states if s.get("label_speech") or s.get("label") or s.get("label_hi")),
                           "total": len(states)},
        "speech_gaps_labeled": {"ok": True, "gaps": len(gaps),
                                "gap_s": round(sum(g["t1"] - g["t0"] for g in gaps), 1)},
        "units": {"count": len(units), "speech_s": round(sum(u["t1"] - u["t0"] for u in units), 1)},
        "attention_reported": {"ok": True, "states": len(states),
                               "max_emphasis": max((s["attention"]["emphasis"] for s in states), default=0)},
        "chapters_partition": {"ok": sum(c["to"] - c["from"] + 1 for c in chapters) == len(states)
                               and all(chapters[i]["to"] + 1 == chapters[i + 1]["from"]
                                       for i in range(len(chapters) - 1)),
                               "chapters": len(chapters)},
    }
    if mode == "action":
        speech_s = sum(u["t1"] - u["t0"] for u in units)
        seg_s = sum(sg["t1"] - sg["t0"] for sg in segments)
        gates["action_segments"] = {"ok": seg_s >= 0.95 * max(1.0, speech_s),
                                    "segments": len(segments),
                                    "covered_s": round(seg_s, 1), "speech_s": round(speech_s, 1)}
    gates["all_ok"] = all(g["ok"] for g in gates.values() if isinstance(g, dict) and "ok" in g)

    event = {"schema_version": SCHEMA_VERSION, "video": cfg.video, "mode": mode,
             "active_ratio": round(active_ratio, 3), "median_state_s": median_state,
             "fps": cfg.fps, "start": cfg.start, "span_s": span, "frames": n,
             "states": states, "transitions": transitions, "units": units,
             "segments": segments, "chapters": chapters, "gaps": gaps, "alignment": alignment,
             "gates": gates, "elapsed_s": round(_time.time() - t_begin, 1)}
    (out / "event.json").write_text(json.dumps(event, ensure_ascii=False), encoding="utf-8")
    (out / "coverage.json").write_text(json.dumps(gates, ensure_ascii=False, indent=1), encoding="utf-8")
    md = [f"# Event record · {Path(cfg.video).name}", "",
          f"- mode: **{mode}** (active {active_ratio:.0%}, median state {median_state:.1f}s)",
          f"- duration: {span:.0f}s · frames: {n} · states: {len(states)} · transitions: {len(transitions)}",
          f"- units: {len(units)} · chapters: {len(chapters)} · gaps: {len(gaps)} · action match: {alignment['action_match_rate']}",
          f"- gates: {'PASS' if gates['all_ok'] else 'FAIL'}", "", "| gate | value |", "|---|---|"]
    for k, v in gates.items():
        if isinstance(v, dict):
            md.append(f"| {k} | {v.get('ok')} |")
    (out / "report.md").write_text("\n".join(md), encoding="utf-8")
    log(f"gates={'PASS' if gates['all_ok'] else 'FAIL'} elapsed={event['elapsed_s']}s")
    return event, gates
