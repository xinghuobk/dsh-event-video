#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Download optional models and check the local toolchain.

    python scripts/setup_models.py --with-vlm
    python scripts/setup_models.py --dry-run
    python scripts/setup_models.py --offline --home D:\\data\\event-video

Stdlib only: safe to run with any Python 3.10+.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

MODELS = {
    "hand_landmarker.task": (
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        7_819_105,
    ),
    "face_landmarker.task": (
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        3_758_596,
    ),
    "pose_landmarker.task": (
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
        5_777_746,
    ),
}


def data_home(value: str | None) -> Path:
    return Path(value or os.environ.get("DSH_EVENT_VIDEO_HOME") or (Path.home() / "event-video")).expanduser()


def find_ollama() -> str | None:
    found = shutil.which("ollama")
    if found:
        return found
    candidates = [
        Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Ollama" / "ollama.exe",
        Path("C:/Program Files/Ollama/ollama.exe"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)
    return None


def download_model(name: str, url: str, expected: int, target: Path, dry_run: bool, offline: bool) -> bool:
    path = target / name
    if path.exists() and path.stat().st_size > 0:
        print(f"  [skip] {name} already present ({path.stat().st_size} bytes)")
        return True
    if dry_run or offline:
        print(f"  [plan] download {name} ({expected / 1_048_576:.1f} MB) -> {path}")
        return not offline
    print(f"  [get ] {name} ({expected / 1_048_576:.1f} MB) ...")
    part = path.with_suffix(path.suffix + ".part")
    try:
        urllib.request.urlretrieve(url, part)
        if part.stat().st_size < expected * 0.5:
            raise RuntimeError(f"download too small: {part.stat().st_size}")
        part.replace(path)
        print(f"  [ ok ] {name}")
        return True
    except Exception as error:  # noqa: BLE001
        part.unlink(missing_ok=True)
        print(f"  [fail] {name}: {error}")
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Download optional models and check the toolchain")
    parser.add_argument("--home", default=None, help="data home (default: DSH_EVENT_VIDEO_HOME or ~/event-video)")
    parser.add_argument("--with-vlm", action="store_true", help="check Ollama and pull the vision model")
    parser.add_argument("--vlm-model", default="minicpm-v:8b", help="Ollama vision model to pull")
    parser.add_argument("--offline", action="store_true", help="do not download; only verify what exists")
    parser.add_argument("--dry-run", action="store_true", help="print the plan without changing anything")
    args = parser.parse_args()

    home = data_home(args.home)
    model_dir = home / "models" / "mediapipe"
    print(f"data home: {home}")
    print(f"models:    {model_dir}")

    failures = 0

    print("\n[1/3] MediaPipe task models")
    if not args.offline and not args.dry_run:
        model_dir.mkdir(parents=True, exist_ok=True)
    for name, (url, expected) in MODELS.items():
        if not download_model(name, url, expected, model_dir, args.dry_run, args.offline):
            failures += 1

    print("\n[2/3] Toolchain")
    ffmpeg = shutil.which("ffmpeg")
    print(f"  ffmpeg: {ffmpeg or 'MISSING (required for video/camera)'}")
    if not ffmpeg:
        failures += 1
    print(f"  python: {sys.version.split()[0]} ({sys.executable})")
    ollama = find_ollama()
    print(f"  ollama: {ollama or 'not found'}")

    print("\n[3/3] Local VLM")
    if args.with_vlm:
        if not ollama:
            print("  ollama is missing. Install it first: winget install -e --id Ollama.Ollama")
            failures += 1
        elif args.dry_run or args.offline:
            print(f"  [plan] {ollama} pull {args.vlm_model}")
        else:
            print(f"  pulling {args.vlm_model} (several GB, one time) ...")
            pulled = subprocess.run([ollama, "pull", args.vlm_model], check=False)
            if pulled.returncode != 0:
                print("  [fail] ollama pull failed")
                failures += 1
            else:
                print(f"  [ ok ] {args.vlm_model}")
    else:
        print("  skipped (pass --with-vlm to enable describe_video_frames)")

    config = {
        "id": "event-video-card",
        "config": {
            "dataHome": str(home),
            "mediapipeDir": str(model_dir),
            **({"vlmEndpoint": "http://127.0.0.1:11434/api/chat", "vlmModel": args.vlm_model} if args.with_vlm else {}),
        },
    }
    print("\nDSH profile config (cordis.patch.yml):")
    print(json.dumps([config], ensure_ascii=False, indent=2))
    print("\nNext: install the plugin + bundle, then restart DSH (see README).")
    if failures:
        print(f"\n{failures} step(s) need attention.")
        return 1
    print("\nAll requested components are ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
