# Orchestration: many models, limited memory

The vision stack in [VISION.md](VISION.md) says *which layers* exist. This document covers the layer above it: **how a large task is decomposed into indivisible unit tasks, each routed to a different model, and executed under a hard memory budget.**

## 1. Unit task

A unit task is the smallest piece that cannot be split without losing meaning:

```json
{
  "id": "describe-keyframes",
  "kind": "describe",
  "model": "qwen3-vl:8b",
  "think": true,
  "frames": [2640, 2837],
  "prompt": "...",
  "depends_on": ["extract", "ocr"],
  "outputs": "descriptions[]"
}
```

Properties that make it schedulable:

- **typed inputs/outputs** (frames, OCR text, landmarks, descriptions, answers, tickets);
- **resource class** (RAM/VRAM, GPU or CPU, load time, throughput);
- **cache key** = hash(input bytes + model + prompt + think) so re-runs are free;
- **anchors** (t / frame / quote) on every output, so the fusion stage can verify;
- **idempotent**: rerunning a unit task never mutates `event.json`.

## 2. Unit task catalog

| Kind | Needs | Model class | Can be split? |
|---|---|---|---|
| `extract` | ffmpeg | none | yes (per second) |
| `ocr` | RapidOCR | CPU, no VLM | yes (per frame) |
| `landmarks` | MediaPipe | CPU, small | yes (per frame) |
| `describe-batch` | VLM | 5–9 GB resident | **no** (per frame it is atomic, but a run covers many frames) |
| `describe-key` | reasoning VLM | 6–9 GB resident | **no** |
| `verify` | OCR + VLM diff | both | per claim |
| `ground` | GUI model (future) | 7 GB+ | per element |
| `fuse` | none | CPU | per record |
| `render/export` | Python | CPU | per record |

"Indivisible" matters for scheduling: you cannot pause a model load halfway; you either have the memory or you do not.

## 3. Model residency under a memory budget

On this machine (31 GB RAM, one 8–12 GB model can stay resident next to the OS + browser + DSH), the scheduler enforces **one VLM resident at a time**:

1. before a stage, ask Ollama `/api/ps` which models are loaded;
2. unload every other model with `keep_alive: 0`;
3. load the stage's model on first request;
4. process **all frames for that model** before switching (amortise load time);
5. unload when the stage ends.

This is why a pipeline is **grouped by model**, not by frame:

```
ocr (CPU) → describe[gemma3:12b] all frames → unload
          → think[qwen3-vl:8b] key frames   → unload
          → fuse (CPU) → export
```

A memory guard (`minFreeMb`, default 1500 MB) skips a stage with an explicit status instead of thrashing or OOM-killing the app. Fallback: request a smaller model (`minicpm-v:8b`) or reduce frames.

## 4. Execution semantics

- **DAG**: topological order, `depends_on` validated before running;
- **checkpoints**: after every stage, `pipeline.json` is written; an interrupted run resumes;
- **cache**: per-frame results in `pipeline-cache/<hash>.json`, reused across runs and models;
- **failure policy**: a failed unit task is recorded with its error, downstream stages are skipped, and the rest of the graph still runs;
- **provenance**: every result records model, think flag, seconds and whether it was cached.

## 5. Worked example: one-hour video review

```
extract → ocr → align → chapters
        → describe-batch[gemma3:12b] 24 frames   (≈ 2–5 min, one resident)
        → describe-key[qwen3-vl:8b] 5 keyframes  (≈ 1–2 min, swapped in)
        → fuse(descriptions + OCR + attention)
        → review → export tickets / SOP
```

Memory: OCR/MediaPipe are CPU-only and do not need a VLM slot. The two VLM stages never overlap, so peak resident = 8.9 GB, not 15 GB.

## 6. Worked example: screenshot → element → fix ticket

```
ocr (RapidOCR) → layout (VLM batch) → ground(UI-TARS-7B) → fuse → ticket
```

Same scheduler: load the batch model, describe, unload, load the grounding model, ground, unload. If the grounding model is unavailable, the stage is marked skipped and the ticket falls back to "needs manual element selection" instead of failing silently.

## 7. Prototype

`scripts/vision_pipeline.py` implements the scheduling core (single-resident, DAG, cache, checkpoints, memory guard):

```bash
python scripts/vision_pipeline.py \
  --record D:/agent/video-events/review-test \
  --spec specs/review.json
```

Measured on `review-test`:

| stage | model | frames | time | resident after |
|---|---|---|---|---|
| describe | gemma3:12b | 2 | 6.3s + 6.6s | gemma |
| think | qwen3-vl:8b | 1 | 20.7s | none (unloaded) |

At the end `ollama ps` is empty; results land in `pipeline.json` and are reusable.

## 8. What is still missing

- plugin tool `run_vision_pipeline` + `/event-video/pipeline` route (prototype is a CLI);
- progress events per stage in the UI;
- HF provider adapter (PaddleOCR-VL, UI-TARS) behind the same stage interface;
- model registry/config (`models.json`) instead of hard-coded names in specs;
- scheduler policies for multiple records (fairness, deadlines, preemption between stages).

The design keeps each layer independent: adding a new unit task means adding a stage kind, not rewriting the pipeline.
