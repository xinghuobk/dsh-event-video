from pathlib import Path

from event_build import actions


def test_classify_known_types():
    lib = actions.load()
    scroll = {"pixdiff": 30.0, "dy": -20, "dx": 0, "text_overlap": 0.2, "text_delta": 0,
              "duration": 3.0, "dx_gt_dy": 0, "abs_dy": 20, "abs_dx": 0, "max_shift": 20}
    assert actions.classify(scroll, lib, "screen") == "scroll_vertical"

    page = {"pixdiff": 50.0, "dy": 0, "dx": 0, "text_overlap": 0.05, "text_delta": -1,
            "duration": 5.0, "dx_gt_dy": 0, "abs_dy": 0, "abs_dx": 0, "max_shift": 0}
    assert actions.classify(page, lib, "screen") == "page_nav"

    still = {"pixdiff": 0.2, "dy": 0, "dx": 0, "text_overlap": 1.0, "text_delta": 0,
             "duration": 1.0, "dx_gt_dy": 0, "abs_dy": 0, "abs_dx": 0, "max_shift": 0}
    assert actions.classify(still, lib, "screen") == "no_change"


def test_learn_adds_clusters():
    lib = actions.load()
    feats = [{"pixdiff": 9.0, "dy": 0, "dx": 0, "text_overlap": 0.5, "text_delta": 0,
              "duration": 2.0, "dx_gt_dy": 0, "abs_dy": 0, "abs_dx": 0, "max_shift": 0} for _ in range(4)]
    actions.learn(lib, "screen", feats, k=2)
    bucket = actions.bucket(lib, "screen")
    assert len(bucket["clusters"]) == 2
    assert bucket["sampler" if False else "scaler"] is not None
