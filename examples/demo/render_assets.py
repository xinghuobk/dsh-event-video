# -*- coding: utf-8 -*-
"""Render README assets from examples/demo/out/event.json.

Produces assets/output-timeline.png and assets/demo-timeline.gif (no private data).
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
EVENT = ROOT / "examples" / "demo" / "out" / "event.json"
ASSETS = ROOT / "assets"

FONT_BOLD = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", 30)
FONT = ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", 17)
FONT_SMALL = ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", 13)

BG = (14, 16, 26)
CARD = (24, 27, 40)
TEXT = (226, 230, 240)
MUTED = (140, 148, 170)
ACCENT = (124, 140, 255)
TEAL = (82, 199, 189)


def clock(seconds: float) -> str:
    total = max(0, int(round(seconds)))
    return f"{total // 60:02d}:{total % 60:02d}"


def draw(playhead: float | None = None) -> Image.Image:
    event = json.loads(EVENT.read_text(encoding="utf-8"))
    width, height = 900, 280
    image = Image.new("RGB", (width, height), BG)
    panel = ImageDraw.Draw(image)
    panel.rounded_rectangle([18, 16, width - 18, height - 16], radius=16, fill=CARD)

    panel.text((40, 32), "synthetic demo · verified event record", font=FONT_BOLD, fill=TEXT)
    panel.text((40, 72), "every second covered by a state, transitions anchored, review flags raised",
               font=FONT, fill=MUTED)

    left, top, bar_w, bar_h = 40, 112, width - 80, 46
    span = max(1.0, float(event.get("span_s") or 1))
    states = event.get("states") or []
    chapters = event.get("chapters") or []

    for chapter in chapters:
        x0 = left + chapter["t0"] / span * bar_w
        x1 = left + chapter["t1"] / span * bar_w
        panel.rectangle([x0, top, x1, top + bar_h], outline=(60, 66, 92))

    peak = max((s.get("attention", {}).get("emphasis", 0) for s in states), default=1) or 1
    for state in states:
        x0 = left + state["t0"] / span * bar_w
        x1 = left + state["t1"] / span * bar_w
        strength = min(1.0, state.get("attention", {}).get("emphasis", 0) / peak)
        color = (int(60 + 64 * strength), int(70 + 60 * strength), int(160 + 80 * strength))
        panel.rectangle([x0 + 1, top + 4, max(x0 + 2, x1 - 1), top + bar_h - 4], fill=color)
        panel.text((x0 + 4, top + bar_h + 8), clock(state["t0"]), font=FONT_SMALL, fill=MUTED)

    for transition in event.get("transitions") or []:
        x = left + transition["t0"] / span * bar_w
        panel.line([x, top - 8, x, top + bar_h + 4], fill=TEAL, width=2)

    if playhead is not None:
        x = left + min(span, playhead) / span * bar_w
        panel.line([x, top - 14, x, top + bar_h + 14], fill=(255, 255, 255, 255), width=2)
        panel.ellipse([x - 5, top - 19, x + 5, top - 9], fill=(255, 255, 255))

    gates = event.get("gates") or {}
    flags = (event.get("review") or {}).get("flags") or []
    panel.text((40, top + bar_h + 34),
               f"{len(states)} states · {len(event.get('transitions') or [])} transitions · "
               f"{len(event.get('units') or [])} speech units · gates "
               f"{'PASS' if gates.get('all_ok') else 'FAIL'} · review flags {len(flags)}",
               font=FONT, fill=TEXT)
    snippet = ("review flag: " + str(flags[0].get("code"))) if flags else "no review flags"
    panel.text((40, top + bar_h + 62), snippet[:120], font=FONT_SMALL, fill=MUTED)
    panel.text((40, height - 40), "DSH Event Video · every second, accounted for", font=FONT_SMALL, fill=MUTED)
    return image


def main() -> None:
    ASSETS.mkdir(exist_ok=True)
    draw().save(ASSETS / "output-timeline.png")

    event = json.loads(EVENT.read_text(encoding="utf-8"))
    span = max(1.0, float(event.get("span_s") or 1))
    frames = []
    for index in range(50):
        frames.append(draw(playhead=span * index / 49).convert("P", palette=Image.ADAPTIVE, colors=64))
    frames[0].save(ASSETS / "demo-timeline.gif", save_all=True, append_images=frames[1:],
                   duration=90, loop=0)
    print("assets/output-timeline.png + assets/demo-timeline.gif written")


if __name__ == "__main__":
    main()
