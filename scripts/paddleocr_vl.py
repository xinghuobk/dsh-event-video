# -*- coding: utf-8 -*-
"""PaddleOCR-VL adapter: read one screenshot and print JSON lines.

Runs in the dedicated OCR environment (PaddlePaddle + PaddleOCR 3.x):
    python scripts/paddleocr_vl.py --image frame.jpg

Output:
    {"engine": "PaddleOCR-VL|PaddleOCR", "text": "...", "lines": [...]}
"""
from __future__ import annotations

import argparse
import json
import re
import sys


def _lines_from_vl_result(result) -> list[str]:
    lines: list[str] = []
    data = getattr(result, "json", None)
    if isinstance(data, dict):
        payload = data.get("res", data)
        if isinstance(payload, dict):
            for block in payload.get("parsing_res_list", []) or []:
                content = (block or {}).get("block_content")
                if isinstance(content, str) and content.strip():
                    lines.append(content.strip())
    if not lines:
        markdown = getattr(result, "markdown", None)
        if isinstance(markdown, dict):
            raw = str(markdown.get("markdown_texts") or "")
            cleaned = re.sub(r"<[^>]+>", " ", raw)
            lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
    return lines


def try_vl_pipeline(image: str) -> dict | None:
    try:
        from paddleocr import PaddleOCRVL
    except Exception:
        return None
    try:
        pipeline = PaddleOCRVL(enable_mkldnn=False)
        results = pipeline.predict(image)
        lines: list[str] = []
        for result in results:
            lines.extend(_lines_from_vl_result(result))
        text = "\n".join(line for line in lines if line.strip())
        if text.strip():
            return {"engine": "PaddleOCR-VL", "text": text, "lines": lines}
    except Exception as error:  # noqa: BLE001 - fall back to classic OCR
        print(f"PaddleOCR-VL failed: {error}", file=sys.stderr)
    return None


def try_classic_ocr(image: str) -> dict:
    from paddleocr import PaddleOCR
    ocr = PaddleOCR(use_textline_orientation=False, lang="en", enable_mkldnn=False)
    result = ocr.predict(image)
    lines: list[str] = []
    for item in result:
        data = getattr(item, "json", None)
        payload = data.get("res", data) if isinstance(data, dict) else {}
        texts = payload.get("rec_texts") if isinstance(payload, dict) else None
        if isinstance(texts, (list, tuple)):
            lines.extend(str(text) for text in texts)
    return {"engine": "PaddleOCR", "text": "\n".join(lines), "lines": lines}


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    parser = argparse.ArgumentParser()
    parser.add_argument("--image", required=True)
    args = parser.parse_args()
    result = try_vl_pipeline(args.image)
    if result is None:
        result = try_classic_ocr(args.image)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
