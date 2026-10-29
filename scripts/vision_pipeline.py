# -*- coding: utf-8 -*-
"""Limited-memory multi-model vision pipeline prototype.

Runs a DAG of unit tasks where each task names the model it needs. Only one model is
resident at a time: before switching, the previous model is unloaded through Ollama's
keep_alive=0. Results are cached and checkpointed, so an interrupted run resumes.

    python scripts/vision_pipeline.py --record D:\\agent\\video-events\\review-test --spec specs/review.json

Spec format:
{
  "record": "D:/agent/video-events/review-test",
  "stages": [
    {"id": "describe", "kind": "describe", "model": "gemma3:12b",
     "frames": [0, 10], "prompt": "...", "think": false},
    {"id": "think", "kind": "describe", "model": "qwen3-vl:8b", "depends_on": ["describe"],
     "frames": [10], "prompt": "...", "think": true}
  ]
}

Memory guard: before a stage, free physical memory is measured; if it is below
--min-free-mb the stage is skipped with an explicit error instead of thrashing.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
import time
import urllib.request
from pathlib import Path

OLLAMA = "http://127.0.0.1:11434"


def api(path: str, body: dict | None = None, method: str = "GET", timeout: int = 600):
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        OLLAMA + path, data=data, method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
        return json.loads(raw) if raw else {}


def loaded_models() -> list[dict]:
    try:
        return api("/api/ps").get("models", [])
    except Exception:
        return []


def unload(model: str) -> None:
    try:
        api("/api/generate", {"model": model, "keep_alive": 0}, method="POST", timeout=120)
    except Exception:
        pass


def ensure_only(model: str) -> None:
    """Keep exactly one VLM resident to stay inside limited memory."""
    for item in loaded_models():
        name = item.get("name") or item.get("model")
        if name and name != model:
            unload(name)


def free_mb() -> float:
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", wintypes.DWORD), ("dwMemoryLoad", wintypes.DWORD),
                ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        status = MEMORYSTATUSEX()
        status.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status))
        return status.ullAvailPhys / 1_048_576
    with open("/proc/meminfo", encoding="utf-8") as handle:
        for line in handle:
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) / 1024
    return 0.0


def frame_path(record: Path, t: int) -> Path:
    event = json.loads((record / "event.json").read_text(encoding="utf-8"))
    fps = float(event.get("fps") or 1)
    start = float(event.get("start") or 0)
    index = max(1, round((t - start) * fps) + 1)
    name = f"f_{index:06d}.jpg"
    for candidate in (record / "frames" / name, record / "frames-on-demand" / name):
        if candidate.exists():
            return candidate
    raise FileNotFoundError(name)


def call_model(model: str, prompt: str, image_path: Path, think: bool) -> tuple[str, float]:
    body = {
        "model": model,
        "messages": [{
            "role": "user", "content": prompt,
            "images": [base64.b64encode(image_path.read_bytes()).decode("ascii")],
        }],
        "stream": False,
        "think": think,
        "options": {"temperature": 0, "num_predict": 4096 if think else 1024},
    }
    started = time.time()
    data = api("/api/chat", body, method="POST")
    return (data.get("message", {}).get("content") or ""), time.time() - started


def post_json(url: str, body: dict, timeout: int = 900) -> dict:
    request = urllib.request.Request(
        url, data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def cache_key(record: Path, frame: Path, model: str, prompt: str, think: bool) -> str:
    digest = hashlib.sha1()
    digest.update(frame.read_bytes())
    digest.update(f"{model}|{think}|{prompt}".encode("utf-8"))
    return digest.hexdigest()[:16]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--record", required=True)
    parser.add_argument("--spec", required=True)
    parser.add_argument("--min-free-mb", type=float, default=1500)
    parser.add_argument("--base-url", default="http://127.0.0.1:61945",
                        help="DSH web base URL for fusion/ticket stages")
    parser.add_argument("--no-cache", action="store_true")
    args = parser.parse_args()

    record = Path(args.record).expanduser().resolve()
    spec = json.loads(Path(args.spec).read_text(encoding="utf-8"))
    cache_dir = record / "pipeline-cache"
    cache_dir.mkdir(exist_ok=True)
    out_path = record / "pipeline.json"
    state = json.loads(out_path.read_text(encoding="utf-8")) if out_path.exists() else {"stages": {}}
    order = [stage["id"] for stage in spec["stages"]]

    for stage in spec["stages"]:
        stage_id = stage["id"]
        for dependency in stage.get("depends_on", []):
            if dependency not in order:
                raise SystemExit(f"unknown dependency {dependency}")
            if dependency not in state["stages"]:
                raise SystemExit(f"stage {stage_id} depends on incomplete {dependency}")

        if stage["kind"] == "fuse_tickets":
            base = stage.get("baseUrl") or args.base_url
            frames = stage.get("frames") or [0]
            instructions = stage.get("instructions") or []
            if not instructions:
                raise SystemExit(f"stage {stage_id} needs instructions")
            samples = int(stage.get("samples") or 3)
            print(f"\n=== stage {stage_id} [fuse_tickets] samples={samples} instructions={len(instructions)} ===")
            results = []
            for t in frames:
                for instruction in instructions:
                    try:
                        res = post_json(base.rstrip("/") + "/event-video/fuse-ticket", {
                            "out": str(record), "t": t, "instruction": instruction,
                            "samples": samples, "title": stage.get("title"),
                        })
                        fused = res.get("fused") or {}
                        results.append({
                            "t": t, "instruction": instruction,
                            "confidence": fused.get("confidence"),
                            "point": fused.get("point"),
                            "box": fused.get("box"),
                            "conflicts": fused.get("conflicts") or [],
                            "ticket": res.get("item"),
                            "exportDir": (res.get("export") or {}).get("dir"),
                        })
                        print(f"  t={t} {instruction}: confidence={results[-1]['confidence']} "
                              f"conflicts={results[-1]['conflicts']} export={results[-1]['exportDir']}")
                    except Exception as error:  # noqa: BLE001 - one item must not stop the stage
                        results.append({"t": t, "instruction": instruction, "error": str(error)})
                        print(f"  t={t} {instruction}: ERROR {error}")
            state["stages"][stage_id] = {"status": "done", "kind": "fuse_tickets", "results": results}
            out_path.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
            continue

        model = stage["model"]
        prompt = stage.get("prompt", "请用中文客观描述这张截图。")
        think = bool(stage.get("think"))
        print(f"\n=== stage {stage_id} [{stage['kind']}] model={model} think={think} ===")
        ensure_only(model)
        start_free = free_mb()
        print(f"free RAM before: {start_free:.0f} MB; resident: {[m.get('name') for m in loaded_models()]}")
        if start_free < args.min_free_mb:
            print(f"SKIP {stage_id}: free RAM {start_free:.0f} MB < {args.min_free_mb} MB")
            state["stages"][stage_id] = {"status": "skipped", "reason": "low memory"}
            out_path.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
            continue

        results = []
        for t in stage.get("frames", []):
            frame = frame_path(record, t)
            key = cache_key(record, frame, model, prompt, think)
            cache_file = cache_dir / f"{key}.json"
            if cache_file.exists() and not args.no_cache:
                entry = json.loads(cache_file.read_text(encoding="utf-8"))
                entry["cached"] = True
            else:
                text, seconds = call_model(model, prompt, frame, think)
                entry = {"t": t, "frame": frame.name, "model": model, "think": think,
                         "text": text, "seconds": round(seconds, 1), "cached": False}
                cache_file.write_text(json.dumps(entry, ensure_ascii=False, indent=1), encoding="utf-8")
            results.append(entry)
            print(f"  t={t:>5}s {entry['frame']} cached={entry['cached']} {entry.get('seconds', '-')}s "
                  f"{entry['text'][:80]}")
        state["stages"][stage_id] = {"status": "done", "model": model, "think": think,
                                     "results": results}
        out_path.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"free RAM after: {free_mb():.0f} MB")

    ensure_only("__none__")
    print(f"\nwritten {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
