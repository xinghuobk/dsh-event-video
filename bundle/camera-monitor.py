# -*- coding: utf-8 -*-
"""Reflex camera monitor: local perception loop, event log, low-latency state file.

Runs at ~5 fps analysis on a 15 fps DirectShow stream (Windows). Writes under
``--home`` (default ``$DSH_EVENT_VIDEO_HOME`` or ``~/event-video``):
  camera/state.json, camera/events.jsonl, camera/events/*.jpg, camera/latest.jpg
"""
import argparse
import atexit
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np

_parser = argparse.ArgumentParser(description="Reflex camera monitor")
_parser.add_argument("--home", default=os.environ.get("DSH_EVENT_VIDEO_HOME", str(Path.home() / "event-video")),
                     help="data home directory (camera dir defaults to <home>/camera)")
_parser.add_argument("--camera-dir", default=os.environ.get("DSH_EVENT_VIDEO_CAMERA_DIR", ""),
                     help="absolute camera directory; overrides <home>/camera")
_parser.add_argument("--device", default=os.environ.get("DSH_EVENT_VIDEO_CAMERA_DEVICE", "video=Default"),
                     help="ffmpeg dshow device spec, e.g. 'video=HD Webcam'")
_args = _parser.parse_args()

ROOT = Path(_args.camera_dir).expanduser() if _args.camera_dir else Path(_args.home).expanduser() / "camera"
EVENTS_DIR = ROOT / "events"
ROOT.mkdir(parents=True, exist_ok=True)
EVENTS_DIR.mkdir(parents=True, exist_ok=True)

PID_FILE = ROOT / "monitor.pid"
LOG_FILE = ROOT / "monitor.log"


def log(message: str) -> None:
    try:
        with LOG_FILE.open("a", encoding="utf-8") as handle:
            handle.write(f"{time.strftime('%H:%M:%S')} {message}\n")
    except OSError:
        pass


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


try:
    _existing = int(PID_FILE.read_text(encoding="utf-8").strip())
except (OSError, ValueError):
    _existing = None
if _existing and _existing != os.getpid() and _pid_alive(_existing):
    print(f"camera monitor already running (pid {_existing})", file=sys.stderr)
    sys.exit(1)
PID_FILE.write_text(str(os.getpid()), encoding="utf-8")
log(f"pid ok {os.getpid()} cwd={os.getcwd()} path_has_ffmpeg={any((Path(p) / 'ffmpeg.exe').exists() for p in os.environ.get('PATH', '').split(os.pathsep) if p)}")
atexit.register(lambda: PID_FILE.unlink(missing_ok=True))

DEVICE = _args.device
W, H, FPS = 320, 240, 15
PROCESS_EVERY = 3
PROC_FPS = FPS // PROCESS_EVERY
FRAME_BYTES = W * H * 3
COOLDOWN = 1.2
MOTION_ON_RATIO = 0.012
MOTION_OFF_SECONDS = 1.4

state = {
    "running": True,
    "startedAt": time.time(),
    "ts": time.time(),
    "fps": PROC_FPS,
    "frames": 0,
    "motion": False,
    "motionRatio": 0.0,
    "bbox": None,
    "brightness": 0.0,
    "subject": False,
    "subjectRatio": 0.0,
    "lastEvent": None,
    "events": 0,
    "latestFrame": str(ROOT / "latest.jpg"),
}

events_log = ROOT / "events.jsonl"
state_file = ROOT / "state.json"
stop_file = ROOT / "stop.flag"
stop_file.unlink(missing_ok=True)
try:
    state["events"] = sum(1 for _ in events_log.open(encoding="utf-8")) if events_log.exists() else 0
except OSError:
    state["events"] = 0


def write_state() -> None:
    tmp = ROOT / "state.json.tmp"
    tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    tmp.replace(state_file)


def emit(kind: str, frame: np.ndarray, detail: dict) -> None:
    state["events"] += 1
    ts = time.time()
    name = f"{int(ts * 1000)}-{kind}.jpg"
    path = EVENTS_DIR / name
    cv2.imwrite(str(path), frame)
    row = {"seq": state["events"], "ts": ts, "kind": kind, "frame": str(path), **detail}
    with events_log.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    state["lastEvent"] = row


def main() -> None:
    log(f"ffmpeg start device={DEVICE}")
    try:
        proc = subprocess.Popen(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "dshow",
             "-framerate", str(FPS), "-video_size", f"{W}x{H}", "-i", DEVICE,
             "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            bufsize=FRAME_BYTES * 4,
        )
    except Exception as error:  # noqa: BLE001 - surface startup failure
        log(f"ffmpeg spawn failed: {error}")
        raise
    log(f"ffmpeg pid={proc.pid}")
    prev_gray = None
    hist_ref = None
    motion_since = 0.0
    last_motion = 0.0
    last_emit = 0.0
    subject_on = False
    frame_no = 0
    raw_no = 0
    latest_saved = 0.0
    try:
        while not stop_file.exists():
            buf = proc.stdout.read(FRAME_BYTES)
            if not buf or len(buf) < FRAME_BYTES:
                log("ffmpeg stream ended")
                state["running"] = False
                break
            frame = np.frombuffer(buf, dtype=np.uint8).reshape(H, W, 3)
            if raw_no == 0:
                log("first frame")
            raw_no += 1
            now = time.time()
            if now - latest_saved > 1.0:
                cv2.imwrite(str(ROOT / "latest.jpg"), frame)
                latest_saved = now
            if raw_no % PROCESS_EVERY != 0:
                continue
            gray = cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY)
            brightness = float(gray.mean())
            frame_no += 1

            bbox = None
            ratio = 0.0
            if prev_gray is not None:
                mask = cv2.absdiff(gray, prev_gray) > 25
                ratio = float(mask.mean())
                if ratio > 0.002:
                    ys, xs = np.nonzero(mask)
                    if len(xs) > 0:
                        bbox = [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]
            prev_gray = gray

            hist = cv2.calcHist([gray], [0], None, [32], [0, 256])
            cv2.normalize(hist, hist)
            scene_score = 1.0 if hist_ref is None else float(cv2.compareHist(hist_ref, hist, cv2.HISTCMP_CORREL))
            if hist_ref is None or scene_score > 0.6:
                hist_ref = hist

            if ratio > MOTION_ON_RATIO:
                last_motion = now
                if not state["motion"]:
                    motion_since = now
            start_motion = ratio > MOTION_ON_RATIO and not state["motion"] and now - last_emit > 0.4
            stop_motion = state["motion"] and now - last_motion > MOTION_OFF_SECONDS
            if start_motion:
                state["motion"] = True
                emit("motion_start", frame, {"motionRatio": round(ratio, 4), "bbox": bbox})
                last_emit = now
            elif stop_motion:
                state["motion"] = False
                emit("motion_stop", frame, {"duration": round(now - motion_since, 2)})
                last_emit = now

            if scene_score < 0.5 and ratio > 0.08 and now - last_emit > COOLDOWN:
                emit("scene_change", frame, {"score": round(scene_score, 3)})
                last_emit = now

            if now - latest_saved > 1.0 and frame_no % 2 == 0:
                cv2.imwrite(str(ROOT / "latest.jpg"), frame)
                latest_saved = now

            if frame_no % PROC_FPS == 0:
                red = frame[:, :, 0].astype(np.float32)
                green = frame[:, :, 1].astype(np.float32)
                blue = frame[:, :, 2].astype(np.float32)
                luma = 0.299 * red + 0.587 * green + 0.114 * blue
                cr = (red - luma) * 0.713 + 128.0
                cb = (blue - luma) * 0.564 + 128.0
                skin = ((cr > 133) & (cr < 175) & (cb > 76) & (cb < 128)).mean()
                has_subject = float(skin) > 0.03
                if has_subject and not subject_on:
                    subject_on = True
                    emit("subject_appear", frame, {"skinRatio": round(float(skin), 4)})
                    last_emit = now
                elif not has_subject and subject_on:
                    subject_on = False
                    emit("subject_disappear", frame, {"skinRatio": round(float(skin), 4)})
                    last_emit = now
                state["subject"] = bool(subject_on)
                state["subjectRatio"] = round(float(skin), 4)

            state["ts"] = now
            state["frames"] = frame_no
            state["motionRatio"] = round(ratio, 4)
            state["bbox"] = bbox
            state["brightness"] = round(brightness, 1)
            write_state()
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=2)
        except Exception:
            pass
        state["running"] = False
        write_state()


if __name__ == "__main__":
    main()
