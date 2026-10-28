# -*- coding: utf-8 -*-
"""Pure helpers for camera gesture/expression signals (no MediaPipe import here).

Landmarks are objects with normalized ``x``/``y`` attributes; blendshape scores are
the MediaPipe face landmarker categories (0..1). Kept dependency-free so tests can
construct synthetic hands and faces.
"""
from __future__ import annotations

import math
from collections import deque

FINGERS = ("index", "middle", "ring", "pinky")


def _distance(a, b) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


def finger_states(hand) -> dict:
    wrist = hand[0]
    states = {}
    for name, tip, pip in (("index", 8, 6), ("middle", 12, 10), ("ring", 16, 14), ("pinky", 20, 18)):
        states[name] = _distance(hand[tip], wrist) > _distance(hand[pip], wrist) * 1.15
    states["thumb"] = _distance(hand[4], wrist) > _distance(hand[2], wrist) * 1.25
    return states


def classify_gesture(hand) -> str:
    states = finger_states(hand)
    extended = sum(1 for name in FINGERS if states[name])
    if extended >= 4:
        return "open_palm"
    if extended == 0 and not states["thumb"]:
        return "fist"
    if extended == 0 and states["thumb"] and hand[4].y < hand[2].y and hand[4].y < hand[0].y:
        return "thumbs_up"
    if states["index"] and extended == 1:
        return "point"
    return "unknown"


class GestureStabilizer:
    """Emit a gesture only after it repeats for a few analysed frames."""

    def __init__(self, need: int = 3):
        self.need = need
        self.last = "unknown"
        self.count = 0

    def update(self, label: str) -> str | None:
        if label == self.last:
            self.count += 1
        else:
            self.last = label
            self.count = 1
        if self.count == self.need and label not in ("unknown", ""):
            return label
        return None


class WaveDetector:
    """Detect a hand waving: an open palm whose wrist x reverses direction twice."""

    def __init__(self, window: float = 1.4, min_dx: float = 0.02, reversals: int = 2):
        self.window = window
        self.min_dx = min_dx
        self.reversals = reversals
        self.samples: deque[tuple[float, float]] = deque()

    def update(self, timestamp: float, wrist_x: float, open_palm: bool) -> bool:
        if not open_palm:
            self.samples.clear()
            return False
        self.samples.append((timestamp, wrist_x))
        while self.samples and timestamp - self.samples[0][0] > self.window:
            self.samples.popleft()
        directions: list[int] = []
        previous = None
        for _t, x in self.samples:
            if previous is not None and abs(x - previous) >= self.min_dx:
                directions.append(1 if x > previous else -1)
            previous = x
        flips = sum(1 for a, b in zip(directions, directions[1:]) if a != b)
        if flips >= self.reversals:
            self.samples.clear()
            return True
        return False


def face_metrics(blendshapes) -> dict:
    scores = {category.category_name: float(category.score) for category in blendshapes}
    smile = (scores.get("mouthSmileLeft", 0.0) + scores.get("mouthSmileRight", 0.0)) / 2
    brow = (scores.get("browDownLeft", 0.0) + scores.get("browDownRight", 0.0)) / 2
    blink = (scores.get("eyeBlinkLeft", 0.0) + scores.get("eyeBlinkRight", 0.0)) / 2
    return {
        "smile": round(smile, 3),
        "brow": round(brow, 3),
        "blink": round(blink, 3),
        "jaw": round(scores.get("jawOpen", 0.0), 3),
    }


def classify_expression(metrics: dict, thresholds: dict) -> str:
    if metrics.get("smile", 0.0) >= thresholds.get("smile", 0.22):
        return "smile"
    if metrics.get("brow", 0.0) >= thresholds.get("brow", 0.35):
        return "brow_down"
    if metrics.get("blink", 0.0) >= thresholds.get("blink", 0.7):
        return "eyes_closed"
    return "neutral"


def baseline_delta(metrics: dict, baseline: dict) -> dict:
    return {
        key: round(float(metrics.get(key, 0.0)) - float(baseline.get(key, 0.0)), 3)
        for key in ("smile", "brow")
    }


# Pose landmark indices (MediaPipe Pose, 33 points).
NOSE = 0
LEFT_SHOULDER, RIGHT_SHOULDER = 11, 12
LEFT_ELBOW, RIGHT_ELBOW = 13, 14
LEFT_WRIST, RIGHT_WRIST = 15, 16
LEFT_HIP, RIGHT_HIP = 23, 24


def _visible(landmark) -> bool:
    return float(getattr(landmark, "visibility", 1.0)) >= 0.5


def classify_pose(landmarks) -> str | None:
    """Simple body actions from one pose: both_hands_up / arms_crossed / hands_on_hips."""
    if not landmarks or len(landmarks) < 25:
        return None
    left_wrist, right_wrist = landmarks[LEFT_WRIST], landmarks[RIGHT_WRIST]
    left_shoulder, right_shoulder = landmarks[LEFT_SHOULDER], landmarks[RIGHT_SHOULDER]
    left_elbow, right_elbow = landmarks[LEFT_ELBOW], landmarks[RIGHT_ELBOW]
    left_hip, right_hip = landmarks[LEFT_HIP], landmarks[RIGHT_HIP]
    if not all(_visible(point) for point in
               (left_wrist, right_wrist, left_shoulder, right_shoulder, left_elbow, right_elbow)):
        return None

    shoulders_top = min(left_shoulder.y, right_shoulder.y)
    if (left_wrist.y < shoulders_top - 0.05 and right_wrist.y < shoulders_top - 0.05
            and left_wrist.y < left_elbow.y and right_wrist.y < right_elbow.y):
        return "both_hands_up"

    if (_distance(left_wrist, right_shoulder) < 0.18
            and _distance(right_wrist, left_shoulder) < 0.18
            and _distance(left_wrist, right_wrist) < 0.18):
        return "arms_crossed"

    if (_visible(left_hip) and _visible(right_hip)
            and _distance(left_wrist, left_hip) < 0.12
            and _distance(right_wrist, right_hip) < 0.12):
        return "hands_on_hips"
    return None
