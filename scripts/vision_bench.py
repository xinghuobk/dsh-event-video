# -*- coding: utf-8 -*-
"""Systematic vision-model benchmark for the event-video plugin.

Runs the same screenshot frames through several local Ollama models with two prompts
(Chinese description, verbatim OCR) and reports OCR keyword hits, latency and size.

    python scripts/vision_bench.py --models minicpm-v:8b qwen3-vl:8b gemma3:12b
    python scripts/vision_bench.py --frames 3 --models minicpm-v:8b
"""
from __future__ import annotations

import argparse
import base64
import json
import time
import urllib.request
from pathlib import Path

# Frames with character-level ground truth (keys we expect OCR to recover).
CASES = [
    {
        "name": "product-page",
        "path": r"D:\agent\video-events\orimodo-analyze\frames\f_002787.jpg",
        "keys": ["THE UNSPOKEN", "Cup & Saucer", "My Sekimori", "Beeswax Candle",
                 "Brass Candle Holder", "Romie Table Mat", "$220.00"],
    },
    {
        "name": "footer-nav",
        "path": r"D:\agent\video-events\orimodo-analyze\frames\f_002425.jpg",
        "keys": ["STAY CONNECTED", "Email address", "ABOUT", "FAQ", "CONTACT",
                 "ORIMODO LIMITED", "Membership"],
    },
    {
        "name": "login-page",
        "path": r"D:\agent\video-events\orimodo-analyze\frames\f_003117.jpg",
        "keys": ["Sign in", "ORIMODO", "shopify"],
    },
    {
        "name": "hero-text",
        "path": r"D:\agent\video-events\orimodo-analyze\frames\f_000011.jpg",
        "keys": ["You always gave me a piece of caramel", "ORIMODO"],
    },
]
DESCRIBE_PROMPT = "请用中文客观描述这张截图（1-2 句）：可见的页面区块、可读文字、明显的界面状态或变化。不要猜测。"
OCR_PROMPT = "逐字读出图中所有可见文字，按行输出，不要解释。"
OUT = Path(r"D:\agent\video-run\vision-bench")


def call(model: str, prompt: str, image_b64: str, timeout: int = 600) -> tuple[str, float]:
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt, "images": [image_b64]}],
        "stream": False,
        "think": False,
        "options": {"temperature": 0, "num_predict": 4096},
    }
    request = urllib.request.Request(
        "http://127.0.0.1:11434/api/chat",
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    started = time.time()
    with urllib.request.urlopen(request, timeout=timeout) as response:
        data = json.loads(response.read().decode("utf-8"))
    elapsed = time.time() - started
    message = data.get("message", {})
    content = message.get("content") or ""
    return content, elapsed


def keyword_hits(text: str, keys: list[str]) -> tuple[int, list[str]]:
    lower = text.lower()
    hits = [key for key in keys if key.lower() in lower]
    return len(hits), hits


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", nargs="+", required=True)
    parser.add_argument("--frames", type=int, default=len(CASES))
    parser.add_argument("--only", choices=["ocr", "describe", "both"], default="both")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    cases = CASES[: max(1, args.frames)]
    results = []
    for model in args.models:
        print(f"\n=== {model} ===")
        per_case = []
        total_hits = total_keys = 0
        describe_seconds = ocr_seconds = 0.0
        for case in cases:
            image_b64 = base64.b64encode(Path(case["path"]).read_bytes()).decode("ascii")
            entry = {"case": case["name"], "keys": case["keys"], "hits": 0, "examples": []}
            if args.only in ("describe", "both"):
                text, elapsed = call(model, DESCRIBE_PROMPT, image_b64)
                entry["describe"] = {"seconds": round(elapsed, 1), "chars": len(text), "text": text[:400]}
                describe_seconds += elapsed
            if args.only in ("ocr", "both"):
                text, elapsed = call(model, OCR_PROMPT, image_b64)
                hits, examples = keyword_hits(text, case["keys"])
                entry["ocr"] = {"seconds": round(elapsed, 1), "chars": len(text),
                                "hits": hits, "of": len(case["keys"]), "examples": examples,
                                "text": text[:600]}
                total_hits += hits
                total_keys += len(case["keys"])
                ocr_seconds += elapsed
            entry["unique_hits"] = len(set(entry.get("ocr", {}).get("examples", [])))
            per_case.append(entry)
            print(f"  {case['name']}: describe={entry.get('describe', {}).get('seconds', '-')}s "
                  f"ocr={entry.get('ocr', {}).get('seconds', '-')}s "
                  f"hits={entry.get('ocr', {}).get('hits', '-')}/{entry.get('ocr', {}).get('of', '-')}")
        summary = {
            "model": model,
            "cases": len(cases),
            "ocr_hit_rate": round(total_hits / total_keys, 3) if total_keys else None,
            "describe_seconds_avg": round(describe_seconds / max(1, len(cases)), 1),
            "ocr_seconds_avg": round(ocr_seconds / max(1, len(cases)), 1),
        }
        results.append({"summary": summary, "cases": per_case})
        print(f"  summary: {json.dumps(summary, ensure_ascii=False)}")
    (OUT / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    lines = ["# Vision benchmark", "", "| model | cases | OCR hit rate | describe avg (s) | OCR avg (s) |", "|---|---|---|---|---|"]
    for item in results:
        s = item["summary"]
        lines.append(f"| {s['model']} | {s['cases']} | {s['ocr_hit_rate']} | {s['describe_seconds_avg']} | {s['ocr_seconds_avg']} |")
    (OUT / "report.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"\nwritten {OUT / 'report.md'}")


if __name__ == "__main__":
    main()
