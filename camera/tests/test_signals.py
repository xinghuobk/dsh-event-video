# -*- coding: utf-8 -*-
"""Unit tests for the camera signal helpers (no camera or MediaPipe required)."""
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from signals import (  # noqa: E402
    GestureStabilizer,
    WaveDetector,
    baseline_delta,
    classify_expression,
    classify_gesture,
    classify_pose,
    face_metrics,
    finger_states,
)


def point(x, y):
    return SimpleNamespace(x=x, y=y)


def make_hand(extended, thumb_up=False):
    """Build 21 landmarks: extended fingers reach far from the wrist."""
    wrist = point(0.5, 0.8)
    hand = [wrist] + [point(0.5, 0.8) for _ in range(20)]
    for name, (tip, pip) in {"index": (8, 6), "middle": (12, 10), "ring": (16, 14), "pinky": (20, 18)}.items():
        hand[pip] = point(0.5, 0.6)
        hand[tip] = point(0.5, 0.35) if name in extended else point(0.5, 0.75)
    if thumb_up:
        hand[2] = point(0.45, 0.75)
        hand[4] = point(0.45, 0.55)
    else:
        hand[2] = point(0.45, 0.75)
        hand[4] = point(0.48, 0.78)
    return hand


def test_finger_states_and_gestures():
    open_hand = make_hand({"index", "middle", "ring", "pinky"})
    states = finger_states(open_hand)
    assert states["index"] and states["pinky"]
    assert classify_gesture(open_hand) == "open_palm"

    fist = make_hand(set())
    assert classify_gesture(fist) == "fist"

    thumbs = make_hand(set(), thumb_up=True)
    assert classify_gesture(thumbs) == "thumbs_up"

    point_hand = make_hand({"index"})
    assert classify_gesture(point_hand) == "point"


def test_gesture_stabilizer_needs_repeats():
    stabilizer = GestureStabilizer(need=3)
    assert stabilizer.update("open_palm") is None
    assert stabilizer.update("open_palm") is None
    assert stabilizer.update("open_palm") == "open_palm"
    assert stabilizer.update("open_palm") is None


def test_wave_detector_counts_reversals():
    detector = WaveDetector(window=2.0, min_dx=0.02, reversals=2)
    sequence = [0.2, 0.3, 0.4, 0.3, 0.2, 0.3, 0.4]
    fired = False
    for index, x in enumerate(sequence):
        fired = fired or detector.update(index * 0.1, x, True)
    assert fired
    assert not detector.update(5.0, 0.2, False)


def test_face_metrics_and_expression():
    blendshapes = [
        SimpleNamespace(category_name="mouthSmileLeft", score=0.8),
        SimpleNamespace(category_name="mouthSmileRight", score=0.6),
        SimpleNamespace(category_name="browDownLeft", score=0.1),
        SimpleNamespace(category_name="browDownRight", score=0.1),
        SimpleNamespace(category_name="eyeBlinkLeft", score=0.0),
        SimpleNamespace(category_name="eyeBlinkRight", score=0.0),
        SimpleNamespace(category_name="jawOpen", score=0.2),
    ]
    metrics = face_metrics(blendshapes)
    assert metrics["smile"] == 0.7
    assert classify_expression(metrics, {"smile": 0.35}) == "smile"
    assert classify_expression(metrics, {"smile": 0.9}) == "neutral"

    delta = baseline_delta(metrics, {"smile": 0.2, "brow": 0.1})
    assert delta["smile"] == 0.5
    assert delta["brow"] == 0.0

def make_pose(overrides=None):
    points = [SimpleNamespace(x=0.5, y=0.6, visibility=1.0) for _ in range(33)]
    points[11] = SimpleNamespace(x=0.4, y=0.4, visibility=1.0)
    points[12] = SimpleNamespace(x=0.6, y=0.4, visibility=1.0)
    points[13] = SimpleNamespace(x=0.3, y=0.52, visibility=1.0)
    points[14] = SimpleNamespace(x=0.7, y=0.52, visibility=1.0)
    points[15] = SimpleNamespace(x=0.25, y=0.55, visibility=1.0)
    points[16] = SimpleNamespace(x=0.75, y=0.55, visibility=1.0)
    points[23] = SimpleNamespace(x=0.42, y=0.75, visibility=1.0)
    points[24] = SimpleNamespace(x=0.58, y=0.75, visibility=1.0)
    for index, value in (overrides or {}).items():
        points[index] = value
    return points


def test_classify_pose_actions():
    neutral = make_pose()
    assert classify_pose(neutral) is None

    both_up = make_pose({
        15: SimpleNamespace(x=0.35, y=0.2, visibility=1.0),
        16: SimpleNamespace(x=0.65, y=0.2, visibility=1.0),
    })
    assert classify_pose(both_up) == "both_hands_up"

    crossed = make_pose({
        15: SimpleNamespace(x=0.55, y=0.5, visibility=1.0),
        16: SimpleNamespace(x=0.45, y=0.5, visibility=1.0),
    })
    assert classify_pose(crossed) == "arms_crossed"

    hips = make_pose({
        15: SimpleNamespace(x=0.42, y=0.74, visibility=1.0),
        16: SimpleNamespace(x=0.58, y=0.74, visibility=1.0),
    })
    assert classify_pose(hips) == "hands_on_hips"

    hidden = make_pose({
        15: SimpleNamespace(x=0.35, y=0.2, visibility=0.0),
        16: SimpleNamespace(x=0.65, y=0.2, visibility=0.0),
    })
    assert classify_pose(hidden) is None