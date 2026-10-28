# -*- coding: utf-8 -*-
"""Download the MediaPipe task models used for gesture/expression signals.

Usage:
    python camera/download_models.py [--dir <models dir>]

Defaults to <DSH_EVENT_VIDEO_HOME or ~/event-video>/models/mediapipe, which is the
directory the monitor and bundle read (``mediapipeDir``).
"""
from __future__ import annotations

import argparse
import os
import urllib.request
from pathlib import Path

MODELS = {
    "hand_landmarker.task":
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    "face_landmarker.task":
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    "pose_landmarker.task":
        "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
}


def main() -> None:
    default_dir = Path(os.environ.get("DSH_EVENT_VIDEO_HOME", str(Path.home() / "event-video"))) / "models" / "mediapipe"
    parser = argparse.ArgumentParser(description="Download MediaPipe hand/face task models")
    parser.add_argument("--dir", default=str(default_dir), help="target model directory")
    args = parser.parse_args()
    target = Path(args.dir).expanduser()
    target.mkdir(parents=True, exist_ok=True)
    for name, url in MODELS.items():
        path = target / name
        if path.exists() and path.stat().st_size > 0:
            print(f"skip {name} (exists)")
            continue
        print(f"download {name} ...")
        urllib.request.urlretrieve(url, path)
        print(f"  -> {path} ({path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
