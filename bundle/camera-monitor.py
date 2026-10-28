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
_parser.add_argument("--model-dir", default=os.environ.get("DSH_EVENT_VIDEO_MEDIAPIPE_DIR", ""),
                     help="directory holding hand_landmarker.task and face_landmarker.task")
_parser.add_argument("--signals", default="1", help="1/0: enable gesture and face signals")
_parser.add_argument("--calibrate", type=float, default=0.0,
                     help="seconds of neutral-face calibration before signal events")
_args = _parser.parse_args()

ROOT = Path(_args.camera_dir).expanduser() if _args.camera_dir else Path(_args.home).expanduser() / "camera"
EVENTS_DIR = ROOT / "events"
ROOT.mkdir(parents=True, exist_ok=True)
EVENTS_DIR.mkdir(parents=True, exist_ok=True)

SIGNALS_ENABLED = str(_args.signals).lower() not in ("0", "false", "no", "off")
MODEL_DIR = Path(_args.model_dir) if _args.model_dir else Path(_args.home).expanduser() / "models" / "mediapipe"
PROFILE_FILE = ROOT / "profile.json"
CALIBRATE_SECONDS = max(0.0, float(_args.calibrate or 0.0))

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from signals import (  # noqa: E402
        GestureStabilizer,
        WaveDetector,
        baseline_delta,
        classify_expression,
        classify_gesture,
        face_metrics,
    )
except Exception as _signals_error:  # noqa: BLE001 - signals are optional
    SIGNALS_ENABLED = False
    GESTURE_HELPERS = None
    print(f"signals helpers unavailable: {_signals_error}", file=sys.stderr)

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

HAND_LANDMARKER = None
FACE_LANDMARKER = None
MP_IMAGE = None
if SIGNALS_ENABLED:
    try:
        from mediapipe import Image as _MPImage, ImageFormat as _MPImageFormat
        from mediapipe.tasks import python as _mp_python
        from mediapipe.tasks.python import vision as _mp_vision

        _hand_model = MODEL_DIR / "hand_landmarker.task"
        _face_model = MODEL_DIR / "face_landmarker.task"
        if _hand_model.exists() and _face_model.exists():
            HAND_LANDMARKER = _mp_vision.HandLandmarker.create_from_options(
                _mp_vision.HandLandmarkerOptions(
                    base_options=_mp_python.BaseOptions(model_asset_path=str(_hand_model)),
                    running_mode=_mp_vision.RunningMode.VIDEO, num_hands=2))
            FACE_LANDMARKER = _mp_vision.FaceLandmarker.create_from_options(
                _mp_vision.FaceLandmarkerOptions(
                    base_options=_mp_python.BaseOptions(model_asset_path=str(_face_model)),
                    running_mode=_mp_vision.RunningMode.VIDEO, num_faces=1,
                    output_face_blendshapes=True))
            MP_IMAGE = (_MPImage, _MPImageFormat)
            log("signals enabled")
        else:
            log(f"signals models missing in {MODEL_DIR}")
    except Exception as _signals_init_error:  # noqa: BLE001 - optional capability
        log(f"signals init failed: {_signals_init_error}")
state["signals"] = {"enabled": bool(HAND_LANDMARKER and FACE_LANDMARKER)}


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
            ["ffmpeg", "-hide_banner", "-loglevel", "error",
             "-fflags", "nobuffer", "-flags", "low_delay",
             "-probesize", "32", "-analyzeduration", "0",
             "-f", "dshow",
             "-framerate", str(FPS), "-video_size", f"{W}x{H}", "-rtbufsize", "1M",
             "-i", DEVICE,
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
    gesture_stabilizer = GestureStabilizer(need=3) if SIGNALS_ENABLED else None
    wave_detector = WaveDetector() if SIGNALS_ENABLED else None
    baseline = {}
    thresholds = {}
    try:
        _profile = json.loads(PROFILE_FILE.read_text(encoding="utf-8"))
        baseline = _profile.get("baseline") or {}
        thresholds = _profile.get("thresholds") or {}
    except (OSError, ValueError):
        pass
    calibrate_left = CALIBRATE_SECONDS
    calibrate_samples: list[dict] = []
    last_face = 0.0
    last_expression = 0.0
    last_gesture = 0.0
    last_wave = 0.0
    last_profile_check = 0.0
    face_on = False
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
            if now - latest_saved > 0.2:
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

            if HAND_LANDMARKER is not None and FACE_LANDMARKER is not None:
                now_ms = int(now * 1000)
                signals = {"enabled": True, "face": False, "hand": False, "gesture": None,
                           "smile": None, "brow": None, "expression": None, "wave": False,
                           "calibrating": calibrate_left > 0}
                try:
                    mp_image = MP_IMAGE[0](image_format=MP_IMAGE[1].SRGB, data=np.ascontiguousarray(frame))
                    hand_result = HAND_LANDMARKER.detect_for_video(mp_image, now_ms)
                    face_result = FACE_LANDMARKER.detect_for_video(mp_image, now_ms)
                except Exception as signal_error:  # noqa: BLE001 - keep the monitor alive
                    log(f"signal inference failed: {signal_error}")
                    hand_result = face_result = None

                if now - last_profile_check > 2.0:
                    last_profile_check = now
                    try:
                        profile = json.loads(PROFILE_FILE.read_text(encoding="utf-8"))
                        baseline = profile.get("baseline") or baseline
                        thresholds = profile.get("thresholds") or thresholds
                    except (OSError, ValueError):
                        pass

                if face_result is not None and face_result.face_landmarks:
                    signals["face"] = True
                    if not face_on:
                        face_on = True
                        emit("face_present", frame, {"faces": len(face_result.face_landmarks)})
                        last_face = now
                    if face_result.face_blendshapes:
                        metrics = face_metrics(face_result.face_blendshapes[0])
                        signals["smile"] = metrics["smile"]
                        signals["brow"] = metrics["brow"]
                        if baseline:
                            signals["delta"] = baseline_delta(metrics, baseline)
                        if calibrate_left > 0:
                            calibrate_samples.append(metrics)
                            calibrate_left -= 1.0 / PROC_FPS
                            if calibrate_left <= 0 and calibrate_samples:
                                count = len(calibrate_samples)
                                base = {
                                    key: round(sum(sample[key] for sample in calibrate_samples) / count, 3)
                                    for key in ("smile", "brow")
                                }
                                thresholds = {
                                    "smile": round(min(0.9, max(0.2, base["smile"] + 0.15)), 3),
                                    "brow": round(min(0.9, max(0.2, base["brow"] + 0.2)), 3),
                                    "blink": 0.7,
                                }
                                baseline = base
                                PROFILE_FILE.write_text(json.dumps({
                                    "version": 1,
                                    "baseline": base,
                                    "thresholds": thresholds,
                                    "samples": count,
                                    "calibratedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
                                }, ensure_ascii=False, indent=1), encoding="utf-8")
                                log(f"calibration saved samples={count}")
                                calibrate_samples.clear()
                        else:
                            expression = classify_expression(metrics, thresholds)
                            signals["expression"] = expression
                            if expression in ("smile", "brow_down") and now - last_expression > COOLDOWN * 2:
                                emit(expression, frame, {"smile": metrics["smile"], "brow": metrics["brow"]})
                                last_expression = now
                elif face_on and now - last_face > 1.0:
                    face_on = False
                    emit("face_absent", frame, {})

                if hand_result is not None and hand_result.hand_landmarks:
                    signals["hand"] = True
                    labels = [classify_gesture(hand) for hand in hand_result.hand_landmarks]
                    stable = gesture_stabilizer.update(labels[0]) if gesture_stabilizer else None
                    signals["gesture"] = labels[0]
                    signals["hands"] = len(labels)
                    if stable and now - last_gesture > COOLDOWN * 2:
                        emit("gesture", frame, {"gesture": stable, "hands": len(labels)})
                        last_gesture = now
                    if labels[0] == "open_palm" and wave_detector is not None:
                        wrist_x = hand_result.hand_landmarks[0][0].x
                        if wave_detector.update(now, wrist_x, True) and now - last_wave > COOLDOWN * 3:
                            emit("wave", frame, {"hands": 1})
                            last_wave = now
                state["signals"] = signals

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
