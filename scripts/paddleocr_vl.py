# -*- coding: utf-8 -*-
"""PaddleOCR-VL adapter: read one screenshot and print JSON lines with boxes.

Runs in the dedicated OCR environment (PaddlePaddle + PaddleOCR 3.x):
    python scripts/paddleocr_vl.py --image frame.jpg

Output:
    {"engine": "PaddleOCR-VL|PaddleOCR", "text": "...", "lines": [...],
     "boxes": [[x1,y1,x2,y2], ...]}   # boxes align with lines
"""
from __future__ import annotations

import argparse
import json
import re
import sys


def _bbox(value) -> list[int] | None:
    if not isinstance(value, (list, tuple)) or len(value) < 4:
        return None
    try:
        if isinstance(value[0], (list, tuple)):
            points = [(float(p[0]), float(p[1])) for p in value if isinstance(p, (list, tuple)) and len(p) >= 2]
            if not points:
                return None
            xs = [p[0] for p in points]
            ys = [p[1] for p in points]
            return [round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))]
        return [round(float(v)) for v in value[:4]]
    except Exception:
        return None


def _lines_from_vl_result(result) -> tuple[list[str], list[list[int] | None]]:
    lines: list[str] = []
    boxes: list[list[int] | None] = []
    data = getattr(result, "json", None)
    if isinstance(data, dict):
        payload = data.get("res", data)
        if isinstance(payload, dict):
            for block in payload.get("parsing_res_list", []) or []:
                content = (block or {}).get("block_content")
                if isinstance(content, str) and content.strip():
                    lines.append(content.strip())
                    boxes.append(_bbox(block.get("block_bbox")))
    if not lines:
        markdown = getattr(result, "markdown", None)
        if isinstance(markdown, dict):
            raw = str(markdown.get("markdown_texts") or "")
            cleaned = re.sub(r"<[^>]+>", " ", raw)
            lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
            boxes = [None] * len(lines)
    return lines, boxes


def try_vl_pipeline(image: str) -> dict | None:
    try:
        from paddleocr import PaddleOCRVL
    except Exception:
        return None
    try:
        pipeline = PaddleOCRVL(enable_mkldnn=False)
        results = pipeline.predict(image)
        lines: list[str] = []
        boxes: list[list[int] | None] = []
        for result in results:
            result_lines, result_boxes = _lines_from_vl_result(result)
            lines.extend(result_lines)
            boxes.extend(result_boxes)
        text = "\n".join(line for line in lines if line.strip())
        if text.strip():
            return {"engine": "PaddleOCR-VL", "text": text, "lines": lines, "boxes": boxes}
    except Exception as error:  # noqa: BLE001 - fall back to classic OCR
        print(f"PaddleOCR-VL failed: {error}", file=sys.stderr)
    return None


def try_classic_ocr(image: str) -> dict:
    from paddleocr import PaddleOCR
    ocr = PaddleOCR(use_textline_orientation=False, lang="en", enable_mkldnn=False)
    result = ocr.predict(image)
    lines: list[str] = []
    boxes: list[list[int] | None] = []
    for item in result:
        data = getattr(item, "json", None)
        payload = data.get("res", data) if isinstance(data, dict) else {}
        if not isinstance(payload, dict):
            continue
        texts = payload.get("rec_texts") or []
        raw_boxes = payload.get("rec_boxes") or payload.get("rec_polys") or []
        for index, text in enumerate(texts):
            lines.append(str(text))
            raw = raw_boxes[index] if index < len(raw_boxes) else None
            boxes.append(_bbox(raw))
    return {"engine": "PaddleOCR", "text": "\n".join(lines), "lines": lines, "boxes": boxes}


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    parser.add_argument("--classic", action="store_true", help="skip PaddleOCR-VL and use the fast classic pipeline")
    args = parser.parse_args()
    result = None if args.classic else try_vl_pipeline(args.image)
    if result is None:
        result = try_classic_ocr(args.image)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
