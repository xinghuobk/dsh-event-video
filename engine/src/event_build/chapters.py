"""Semantic chapters: URL switches plus speech-topic minima, bounded by length."""
from __future__ import annotations


def _bigrams(text: str) -> set[str]:
    t = "".join(text.split())
    return {t[i:i + 2] for i in range(len(t) - 1)}


def _jaccard(a: set[str], b: set[str]) -> float | None:
    if not a or not b:
        return None
    return len(a & b) / len(a | b)


def _bounds(states: list[dict], units: list[dict], window: float = 30.0) -> list[dict]:
    out = []
    for i in range(1, len(states)):
        t = states[i]["t0"]
        pre = "".join(u["text"] for u in units if u["t1"] <= t and u["t0"] >= t - window)
        post = "".join(u["text"] for u in units if u["t0"] >= t and u["t1"] <= t + window)
        url_prev, url_cur = states[i - 1].get("url_hint"), states[i].get("url_hint")
        out.append({"i": i, "t": t, "sim": _jaccard(_bigrams(pre), _bigrams(post)),
                    "url_change": bool(url_prev and url_cur and url_prev != url_cur)})
    return out


def dominant_url(urls: list[str]) -> str | None:
    """Most frequent URL; ties prefer the longer capture, then first appearance.

    OCR line-wrapping can truncate an address-bar read, so among equally common
    URLs the longer string is the more complete capture. First appearance breaks
    remaining ties, keeping the choice deterministic.
    """
    if not urls:
        return None
    counts: dict[str, int] = {}
    first: dict[str, int] = {}
    for index, url in enumerate(urls):
        counts[url] = counts.get(url, 0) + 1
        first.setdefault(url, index)
    return max(counts, key=lambda url: (counts[url], len(url), -first[url]))


def _spans(cut_set: set[int], n: int) -> list[tuple[int, int]]:
    idx = sorted(cut_set) + [n]
    out, start = [], 0
    for end in idx:
        out.append((start, end - 1))
        start = end
    return out


def build_chapters(states: list[dict], units: list[dict],
                   min_len: float = 120, max_len: float = 240,
                   merge_below: float = 60, target_max: int = 18,
                   quantile: float = 0.30) -> list[dict]:
    """Partition states into chapters cut at URL switches and topic minima.

    @param states - visual states in order, with optional ``url_hint`` and ``attention``.
    @param units - speech units with ``t0``/``t1``/``text``.
    @returns chapters with ``t0``/``t1``/``reason``/``url``/``dwell``/``attention``/``from``/``to``.
    """
    if not states:
        return []
    bounds = _bounds(states, units)
    sims = sorted(b["sim"] for b in bounds if b["sim"] is not None)
    threshold = sims[int(len(sims) * quantile)] if sims else 0.0

    forced = {b["i"] for b in bounds if b["url_change"]}
    chosen = set(forced)
    for b in sorted((b for b in bounds if b["sim"] is not None), key=lambda b: b["sim"]):
        if b["sim"] > threshold or len(chosen) >= 20:
            break
        if any(abs(b["t"] - states[c]["t0"]) < min_len for c in chosen):
            continue
        chosen.add(b["i"])

    def duration(span: tuple[int, int]) -> float:
        a, b = span
        return states[b]["t1"] - states[a]["t0"]

    def sim_of(cut: int) -> float:
        b = next((x for x in bounds if x["i"] == cut), None)
        return b["sim"] if b and b["sim"] is not None else -1.0

    for _ in range(300):
        spans = _spans(chosen, len(states))
        short = [s for s in spans if duration(s) < merge_below]
        if short:
            a, b = short[0]
            touching = [c for c in chosen if c in (a, b + 1)]
            if not touching:
                break
            chosen.discard(max(touching, key=sim_of))
            continue
        if len(spans) > target_max:
            removable = [c for c in chosen if c not in forced] or list(chosen)
            drop = max(removable, key=sim_of)
            trial = [c for c in sorted(chosen) if c != drop] + [len(states)]
            prev, ok = 0, True
            for end in trial:
                if states[end - 1]["t1"] - states[prev]["t0"] > max_len * 1.3:
                    ok = False
                    break
                prev = end
            if not ok:
                removable.remove(drop)
                if not removable:
                    break
                chosen.discard(max(removable, key=sim_of))
            else:
                chosen.discard(drop)
            continue
        break

    for _ in range(60):
        spans = _spans(chosen, len(states))
        long = [(a, b) for a, b in spans if duration((a, b)) > max_len]
        if not long:
            break
        a, b = long[0]
        window = [x for x in bounds if a < x["i"] <= b and x["sim"] is not None
                  and x["t"] - states[a]["t0"] >= 80 and states[b]["t1"] - x["t"] >= 80]
        if not window:
            break
        chosen.add(min(window, key=lambda x: x["sim"])["i"])

    chapters = []
    for a, b in _spans(chosen, len(states)):
        sts = states[a:b + 1]
        urls = [s.get("url_hint") for s in sts if s.get("url_hint")]
        chapters.append({
            "t0": sts[0]["t0"],
            "t1": sts[-1]["t1"],
            "reason": "url" if a in forced else "topic",
            "url": dominant_url(urls),
            "dwell": round(sts[-1]["t1"] - sts[0]["t0"], 1),
            "attention": round(sum(s.get("attention", {}).get("emphasis", 0) for s in sts), 1),
            "from": a,
            "to": b,
        })
    return chapters
