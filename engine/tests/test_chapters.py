from event_build.chapters import build_chapters, dominant_url


def test_dominant_url_is_deterministic_on_ties():
    assert dominant_url([]) is None
    assert dominant_url(["a", "b", "a", "b"]) == "a"
    assert dominant_url(["b", "b", "a"]) == "b"
    assert dominant_url(["a", "b", "b", "a"]) == "a"


def _states(n, step=40.0, url_at=None):
    out = []
    for i in range(n):
        url = "a" if url_at is None or i < url_at else "b"
        out.append({"t0": i * step, "t1": (i + 1) * step, "url_hint": url})
    return out


def test_chapters_partition_and_url_boundary():
    states = _states(6, 40.0, url_at=3)
    units = [{"t0": i * 40.0, "t1": i * 40.0 + 5, "text": "主题一" if i < 3 else "主题二"} for i in range(6)]
    ch = build_chapters(states, units)
    assert ch[0]["t0"] == 0
    assert ch[-1]["t1"] == states[-1]["t1"]
    assert sum(c["to"] - c["from"] + 1 for c in ch) == len(states)
    assert all(ch[i]["to"] + 1 == ch[i + 1]["from"] for i in range(len(ch) - 1))
    assert any(c["reason"] == "url" for c in ch)


def test_single_short_video_is_one_chapter():
    states = _states(2, 20.0)  # 40 seconds total
    units = [{"t0": 0, "t1": 10, "text": "短片段"}]
    ch = build_chapters(states, units)
    assert len(ch) == 1
    assert ch[0]["t0"] == 0 and ch[0]["t1"] == 40.0


def test_chapters_respect_max_length():
    states = _states(24, 20.0)
    units = [{"t0": i * 20.0, "t1": i * 20.0 + 15, "text": "讨论"} for i in range(24)]
    ch = build_chapters(states, units, max_len=240)
    assert len(ch) >= 2
    assert all(c["dwell"] <= 240 * 1.3 for c in ch)
