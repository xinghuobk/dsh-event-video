# -*- coding: utf-8 -*-
"""UI-TARS-7B grounding adapter.

Calls a llama.cpp OpenAI-compatible server hosting UI-TARS and asks for the point
coordinate of a described UI element.

    python scripts/uitars_ground.py --image frame.jpg --instruction "商品价格" \
        --endpoint http://127.0.0.1:8081/v1/chat/completions --alias ui-tars

Output JSON:
    {"engine":"UI-TARS-7B","instruction":"...","point":[x,y],"box":[...],
     "normalized":[nx,ny],"raw":"..."}
Coordinates in UI-TARS output are normalized to 0-1000; this adapter converts them to
pixels of the given screenshot.
"""
from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import urllib.request

SYSTEM_PROMPT = (
    "You are a GUI grounding model. Given a screenshot and a target description, "
    "output the point coordinate of the target element. "
    "Answer with exactly: click(point='<|box_start|>(x,y)<|box_end|>') "
    "where x and y are integers in [0,1000] relative to the image size. "
    "If the target is not visible, answer: not_found."
)


def image_size(path: str) -> tuple[int, int]:
    try:
        from PIL import Image
        with Image.open(path) as image:
            return image.size
    except Exception:
        pass
    try:
        import cv2
        image = cv2.imread(path)
        height, width = image.shape[:2]
        return width, height
    except Exception:
        return 0, 0


def parse_point(text: str) -> tuple[list[float] | None, str | None]:
    raw = text.strip()
    match = re.search(r"box_start\|>\s*\((\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\)\s*<\|box_end", raw)
    if not match:
        match = re.search(r"\((\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\)", raw)
    if match:
        return [float(match.group(1)), float(match.group(2))], raw
    return None, raw


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--instruction", required=True)
    parser.add_argument("--endpoint", default="http://127.0.0.1:8081/v1/chat/completions")
    parser.add_argument("--alias", default="ui-tars")
    parser.add_argument("--timeout", type=int, default=300)
    args = parser.parse_args()
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    image_b64 = base64.b64encode(open(args.image, "rb").read()).decode("ascii")
    body = {
        "model": args.alias,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": f"Instruction: {args.instruction}"},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                ],
            },
        ],
        "temperature": 0,
        "max_tokens": 64,
        "stream": False,
    }
    request = urllib.request.Request(
        args.endpoint, data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=args.timeout) as response:
        data = json.loads(response.read().decode("utf-8"))
    text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
    point, raw = parse_point(text)
    width, height = image_size(args.image)
    result = {"engine": "UI-TARS-7B", "instruction": args.instruction, "raw": raw,
              "point": None, "normalized": point, "box": None, "image": [width, height]}
    if point and width and height:
        x = round(point[0] / 1000.0 * width)
        y = round(point[1] / 1000.0 * height)
        result["point"] = [max(0, min(width, x)), max(0, min(height, y))]
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
