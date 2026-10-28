# Vision stack (systematic design)

The plugin does not rely on a single "vision model". Visual understanding is split into layers with different jobs, models and failure modes, so a weak layer never silently poisons a conclusion.

## Layers

| Layer | Job | Current implementation | Future candidates |
|---|---|---|---|
| L0 capture | frames from video/camera | ffmpeg, 640x480@15fps camera, 1fps video sampling | higher fps for fast actions |
| L1 text | exact on-screen text, URLs | RapidOCR + hi-res address-bar crop | **PaddleOCR-VL**, dots.ocr, DeepSeek-OCR (HF, better verbatim accuracy) |
| L2 geometry | hands/face/pose landmarks | MediaPipe tasks (hand/face/pose), rule-based gestures | temporal action classifier |
| L3 batch describe | 1–2 sentence factual description for many frames | local VLM (`vlmModel`, default `gemma3:12b`; `minicpm-v:8b` for speed) | InternVL3.5, MiniCPM-V 4.5 |
| L4 key-frame thinking | conclusion-level reading of a few important frames | reasoning VLM (`vlmThinkModel`, default `qwen3-vl:8b`) with 4096-token budget | Qwen3-VL-30B-A3B, Gemma3-27B (hardware permitting) |
| L5 GUI grounding | "which element is this / where to click" | not implemented | **UI-TARS-7B**, OS-Atlas, OpenCUA |
| L6 fusion | merge OCR + VLM + geometry into anchored facts | `event.json`, `vision.json`, `annotations.json`, review flags | temporal fusion, cross-frame consistency |

## Routing

| Task | Path |
|---|---|
| "what is on screen at mm:ss" | L3 batch describe (fast) + `read_video_frame` spot-check |
| "what does this key moment mean" | L4 key-frame thinking (chapter starts / annotations / top attention) |
| "what exactly does that URL/button say" | L1 OCR, never the VLM |
| "did they smile / wave / raise hands" | L2 geometry events |
| "point me to the element to change" | L5 (future) |

## Configuration

```yaml
- id: event-video-card
  config:
    vlmEndpoint: http://127.0.0.1:11434/api/chat
    vlmModel: minicpm-v:8b        # L3 batch
    vlmThinkModel: qwen3-vl:8b    # L4 key frames
    # enableVlm: false            # disable all VLM layers
```

OCR (L1) runs locally through the engine and does not need a VLM endpoint.

## Evaluation (not vibes)

`scripts/vision_bench.py` runs the same frames through several models and reports:

- **OCR hit rate**: expected strings recovered verbatim (case-insensitive);
- **description latency / OCR latency** per frame;
- per-case evidence so a "better" claim can be checked.

Dataset: product page, footer/nav, Shopify login, hero text — chosen because they contain small text, URLs and mixed layouts.

Current measured snapshot (2 frames, local CPU/GPU split):

| model | OCR hit rate | describe avg | OCR avg |
|---|---|---|---|
| minicpm-v:8b | 0.571 | 5.6s | 1.7s |
| qwen3-vl:8b | 0.857 | 23.0s | 32.2s |
| gemma3:12b | **0.857** | **13.5s** | **14.4s** |

Interpretation: Gemma3-12B matches Qwen3-VL on OCR hit rate but is ~40% faster for descriptions and ~2x faster for OCR; MiniCPM is ~10x faster but misses product-page text. Batch default = gemma3:12b; use `model: "minicpm-v:8b"` for speed. This is why the stack separates **fast description** from **accurate text** instead of picking one model for everything.

## Failure policy

1. VLM not configured → `describe_video_frames` returns a clear error; OCR/geometry still work.
2. Model returns thinking-only content → explicit error (increase budget or use a non-thinking model).
3. Low-confidence text → review flags (`url_missing_separators` etc.) and OCR remains the source of truth.
4. Every generated description is stored with frame anchor + model name; outputs are deletable sidecars (`vision.json`), never edits to `event.json`.

## Hardware reality

This machine: 31 GB RAM, GPU layer split at ~86% for an 8B model. Practical ceiling: one 8B–12B model resident. 24B/30B/MoE models would fall back to CPU and become minute-per-frame — acceptable only for batch jobs, not interactive use.

## Roadmap

1. Add **PaddleOCR-VL** as L1 service (OpenAI-compatible endpoint) and compare OCR hit rate against RapidOCR.
2. Finish **Gemma3-12B** evaluation; pick the batch model by measured hit rate/latency.
3. Add **UI-TARS-7B** for element grounding, output "candidate element" annotations instead of clicks.
4. Temporal action classifier for complex actions (needs labelled samples).
