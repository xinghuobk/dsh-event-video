# -*- coding: utf-8 -*-
"""Generate a synthetic screen-review demo video and transcript (no private footage).

Run from the repo root:
    python examples/demo/make_demo.py
Then build the record:
    event-build examples/demo/demo.mp4 --out examples/demo/out --transcript examples/demo/transcript.txt

Slides use distinct layouts and 1s cross-fades, so the engine's median filter sees
real transitions instead of single-frame cuts. Windows fonts are read, never copied
into the repository.
"""
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent
W, H = 960, 540
FPS = 10
SECONDS_PER_SLIDE = 10
FADE_SECONDS = 1.0

FONT_BOLD = ImageFont.truetype(r"C:\Windows\Fonts\arialbd.ttf", 46)
FONT_TEXT = ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", 24)
FONT_SMALL = ImageFont.truetype(r"C:\Windows\Fonts\arial.ttf", 17)

SLIDES = [
    ("home", "#0b0d14", "HOMEPAGE", "Keep the top bar transparent while scrolling",
     "The top bar should stay transparent and fixed while the page scrolls"),
    ("products", "#3b3b3b", "PRODUCTS", "Price must update when the variant changes",
     "When I switch the variant the price does not change, please fix that"),
    ("checkout", "#6f6f6f", "CHECKOUT", "Primary button contrast is too light",
     "The primary button is too light, we need more contrast on checkout"),
    ("home", "#0d2414", "HOMEPAGE", "Headline font weight looks too light",
     "The headline font weight is too light, try the semibold version"),
    ("about", "#421b1b", "ABOUT", "Add the team section below the story",
     "On the about page we should add a team section below the story"),
]


def draw_slide(index: int, slug: str, color: str, title: str, subtitle: str) -> Image.Image:
    background = tuple(int(color.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))
    image = Image.new("RGB", (W, H), background)
    draw = ImageDraw.Draw(image)

    draw.rectangle([0, 0, W, 64], fill=(22, 24, 34))
    for offset, dot in enumerate(((215, 88, 88), (215, 180, 88), (110, 190, 120))):
        draw.ellipse([22 + offset * 22, 24, 36 + offset * 22, 38], fill=dot)
    draw.rounded_rectangle([110, 16, W - 30, 50], radius=9, fill=(42, 46, 62))
    draw.text((124, 23), f"app.example.com/{slug}", font=FONT_SMALL, fill=(170, 178, 200))

    accent = (124, 140, 255)
    if index % 3 == 0:
        draw.text(((W - draw.textlength(title, font=FONT_BOLD)) / 2, 120), title, font=FONT_BOLD, fill="white")
        draw.text(((W - draw.textlength(subtitle, font=FONT_TEXT)) / 2, 185), subtitle, font=FONT_TEXT, fill=(190, 196, 214))
        draw.rounded_rectangle([120, 260, W - 120, 440], radius=14, fill=(30, 33, 46))
    elif index % 3 == 1:
        draw.text((60, 110), title, font=FONT_BOLD, fill="white")
        draw.text((60, 170), subtitle, font=FONT_TEXT, fill=(190, 196, 214))
        draw.rounded_rectangle([520, 240, 900, 470], radius=14, fill=accent)
    else:
        draw.text((W - 60 - draw.textlength(title, font=FONT_BOLD), 330), title, font=FONT_BOLD, fill="white")
        draw.text((60, 120), subtitle, font=FONT_TEXT, fill=(190, 196, 214))
        draw.rounded_rectangle([60, 200, 420, 300], radius=14, fill=(240, 163, 94))
        draw.rounded_rectangle([520, 340, 900, 470], radius=14, fill=(82, 199, 189))

    cx, cy = 300 + index * 90, 360 - index * 35
    draw.polygon([(cx, cy), (cx + 20, cy + 8), (cx + 9, cy + 13)], fill="white")
    return image


def run(args):
    result = subprocess.run(args, cwd=OUT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        raise RuntimeError("command failed:\n" + " ".join(args) + "\n" + result.stderr[-2000:])


def main() -> None:
    images = [draw_slide(index, slug, color, title, subtitle)
              for index, (slug, color, title, subtitle, _line) in enumerate(SLIDES)]
    total_seconds = SECONDS_PER_SLIDE * len(images)
    frames_dir = OUT / "frames-tmp"
    frames_dir.mkdir(exist_ok=True)
    total_frames = int(total_seconds * FPS)
    for frame_index in range(total_frames):
        seconds = frame_index / FPS
        slide = int(seconds // SECONDS_PER_SLIDE)
        local = seconds - slide * SECONDS_PER_SLIDE
        if slide > 0 and local < FADE_SECONDS:
            image = Image.blend(images[slide - 1], images[slide], local / FADE_SECONDS)
        else:
            image = images[min(slide, len(images) - 1)]
        image.save(frames_dir / f"frame-{frame_index:05d}.jpg", quality=90)

    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-framerate", str(FPS),
         "-i", "frames-tmp/frame-%05d.jpg", "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-crf", "23", "demo.mp4"])
    for frame in frames_dir.glob("*.jpg"):
        frame.unlink()
    frames_dir.rmdir()

    lines = []
    for index, (_slug, _color, _title, _subtitle, line) in enumerate(SLIDES):
        start = index * SECONDS_PER_SLIDE
        lines.append(f"[{start // 60:02d}:{start % 60:02d}] {line}")
    (OUT / "transcript.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("demo.mp4 + transcript.txt generated")


if __name__ == "__main__":
    main()
