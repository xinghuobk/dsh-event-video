import json
from pathlib import Path

from event_build.pipeline import (BuildConfig, align, merge_units, parse_transcript,
                                  segment, gaps_from)

GOLDEN = Path(__file__).parent / "golden" / "full-event.json"


def test_golden_schema_and_gates():
    ev = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert ev["schema_version"] == 1
    assert ev["gates"]["all_ok"] is True
    assert len(ev["states"]) == 126
    assert len(ev["transitions"]) == 125
    assert len(ev["units"]) == 380
    covered = sum(s["t1"] - s["t0"] for s in ev["states"]) + sum(t["t1"] - t["t0"] for t in ev["transitions"])
    assert abs(covered - 3351) < 0.05
    assert all(s.get("label_speech") for s in ev["states"])
    assert len(ev["gaps"]) == 143
    for key in ("action_units_without_transition", "lag_median_s", "lag_p25_s", "lag_p75_s"):
        assert key in ev["alignment"]


def test_segment_is_partition_and_deterministic():
    hashes = ["0" * 16] * 60
    # two sustained-change windows (alternating hashes keep every diff high)
    for i in range(20, 26):
        hashes[i] = "f" * 16 if i % 2 == 0 else "0" * 16
    for i in range(40, 46):
        hashes[i] = "f" * 16 if i % 2 == 0 else "0" * 16
    raw, sm, states, transitions = segment(hashes, scene_th=9, start_off=0.0, fps=1.0)
    covered = sum(s["t1"] - s["t0"] for s in states) + sum(t["t1"] - t["t0"] for t in transitions)
    assert abs(covered - (len(hashes) - 1)) < 1e-6
    assert len(transitions) == 2
    assert transitions[0]["t0"] < transitions[1]["t0"]
    again = segment(hashes, 9, 0.0, 1.0)
    assert again[2] == states and again[3] == transitions


def test_merge_units_crosses_short_pauses():
    segs = [
        {"start": 0, "end": 2, "text": "第一段"},
        {"start": 2.5, "end": 5, "text": "接着"},
        {"start": 30, "end": 32, "text": "另一段"},
    ]
    units = merge_units(segs)
    assert len(units) == 2
    assert units[0]["text"] == "第一段接着"
    assert units[1]["id"] == "u0001"


def test_align_flags_untouched_action_words():
    units = [
        {"id": "u0", "t0": 1, "t1": 3, "text": "这里往上滑"},
        {"id": "u1", "t0": 100, "t1": 102, "text": "然后点这个按钮"},
    ]
    transitions = [{"t0": 0, "t1": 1, "duration": 1, "label_speech": ""}]
    a = align(units, transitions)
    assert a["action_units"] == 2
    assert a["action_units_with_transition"] == 1
    assert a["action_units_without_transition"] == 1
    assert a["lag_median_s"] is not None


def test_local_attention_window():
    from event_build.pipeline import local_attention
    units = [
        {"t0": 100, "t1": 110, "text": "这个按钮往上滑"},
        {"t0": 200, "t1": 210, "text": "这里滑一下"},
    ]
    transitions = [{"t0": 105, "t1": 106, "duration": 1}, {"t0": 300, "t1": 301, "duration": 1}]
    near = local_attention(105, units, transitions, window=30)
    assert near["deictic_hits"] == 1 and near["action_hits"] == 1
    assert near["micro_interactions"] == 1
    far = local_attention(400, units, transitions, window=30)
    assert far["score"] == 0


def test_attention_proxy():
    from event_build.pipeline import attention_of
    state = {"t0": 0.0, "t1": 10.0}
    units = [{"t0": 0, "t1": 5, "text": "这个按钮往上滑"}]
    transitions = [{"t0": 3, "t1": 4, "duration": 1}]
    att = attention_of(state, units, transitions)
    assert att["dwell_s"] == 10.0
    assert att["deictic_hits"] == 1          # 这个
    assert att["action_hits"] == 1           # 滑
    assert att["micro_interactions"] == 1    # instant transition inside the state
    assert att["emphasis"] == 7.5            # 10/10 + 3*1 + 2*1 + 1.5*1


def test_parse_transcript_window_and_gaps(tmp_path):
    p = tmp_path / "t.txt"
    p.write_text("[00:00] 甲\n[00:05] 乙\n[00:40] 丙\n", encoding="utf-8")
    segs = parse_transcript(p, 0, 60)
    assert len(segs) == 3
    assert segs[0]["end"] == 5
    gaps = gaps_from(segs, 60)
    # gap bounds are start-to-start: (0,5), (5,40), tail (40,60)
    assert len(gaps) == 3 and gaps[0]["t0"] == 0 and gaps[1]["t0"] == 5
    assert parse_transcript(p, 10, None)[0]["text"] == "丙"

def test_review_flags_catch_ocr_url_and_weak_alignment():
    from event_build.pipeline import review_of
    states = [{"t0": 0, "t1": 10, "label_hi": "Sign in", "label_speech": "登录",
               "url_hint": "https://shopify.com/login?analytics_trace_id-42313680",
               "attention": {"emphasis": 5.0}}]
    chapters = [{"t0": 0, "t1": 10, "dwell": 10, "url": "https://shopify.com"}]
    units = [{"t0": 0, "t1": 10, "text": "登录一下"}]
    gates = {"visual_partition": {"ok": True}, "all_ok": False}
    review = review_of(states, chapters, units, [], {"action_match_rate": 0.5}, gates)
    codes = [f["code"] for f in review["flags"]]
    assert review["ok"] is False
    assert "gates_failed" in codes
    assert "url_missing_separators" in codes
    assert "weak_action_alignment" in codes
    assert "chapter_length_outlier" in codes
    assert review["samples"]["top_states"][0]["t0"] == 0
