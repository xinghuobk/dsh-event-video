# Changelog

## 0.2.0

- deterministic `review` block embedded in every build (gates, OCR URL anomalies, unlabeled states, long gaps, alignment outliers, chapter length)
- `dominant_url`: deterministic chapter URL choice (count, then longest capture, then first appearance)
- export module: Markdown / CSV / JSON / Word / Excel (`event-build.export_office`)
- DSH bundle: review tool, export tool, cross-record summary tool and views, tag/duration filters
- portable configuration: data home, python path, whisper model, camera device and allowed roots
- JS library indexer (no Python script dependency for the UI)
- event-triggered voice: `speak_text` (SAPI / command / OpenAI-compatible TTS) and `camera_voice_react` (wait for wave/gesture/face event, speak a template, return event+tts), `enableVoice` switch, fake-TTS acceptance test
- training-free evidence fusion: `fuse_vision_evidence` (OCR box + UI-TARS point cross-check, confidence/conflicts/evidence), OCR boxes in adapter, classic fallback on native crash
- pipeline evidence tickets: `fuse_tickets` stage in `vision_pipeline.py` calls fusion for key frames and writes tickets per instruction (consensus + description check + export)
- UI clarity: chapter rows show "注意力 N%" relative to the highest-attention chapter (with tooltip) instead of an unlabeled pill+raw number; the transcript column is sticky with its own scroll so it aligns with the player column`n- UI polish: single record selector replaces duplicate title+select, dashed no-video placeholder, seek bar hidden without a source, export actions moved into AI tools, shorter control meta`n- panel progress bar: accent-fill bar + stage/index label in the review player, driven by `pipeline-progress.json` polling`n- Library batch UI: multi-select, FIFO/priority + priorities, retry/concurrency controls, batch progress bar, submit + poll`n- batch scheduling policies: priority order, per-record retries, optional 2-way concurrency, deadline with skipped records, persisted execution order/attempts`n- batch scheduling: `run_vision_batch` tool + `/event-video/batch`, `/event-video/batch-progress`, persisted `<dataHome>/batches/*.json`, per-record status/error isolation`n- UI layout: removed the duplicate in-page record sidebar, full-width workspace with record switcher in the top bar, AI actions collapsed under a toggle`n- pipeline progress: `pipeline-progress.json` written per stage/item, `GET /event-video/pipeline-progress`, player polls every 800ms and shows stage/index`n- player evidence-ticket control: instruction input + **证据工单** button with running/completed status on the review player`n- pipeline plugin tool: `run_vision_pipeline` tool + `/event-video/pipeline` route runs descriptions / key-frame thinking / fused tickets in one call and writes `pipeline.json`
- multi-sample consensus: `samples:3` paraphrased grounding instructions clustered by coordinate (agreement/spread), confidence boost when inside OCR box
- description consistency: VLM description entities checked against OCR text, contradictions flagged (`description_ocr_mismatch`)
- fused ticket: `fuse_to_work_item` exports a ticket from fused evidence (element, box, point, confidence, conflicts, acceptance) under `exports/`
- UI-TARS-7B grounding: `ground_ui_element` tool + `/event-video/ground`, llama.cpp GGUF adapter (`scripts/uitars_ground.py`), start script, per-frame+instruction cache
- PaddleOCR-VL integration: `ocr_video_frame` tool + `/event-video/ocr`, `scripts/paddleocr_vl.py` adapter (classic PaddleOCR fallback), per-frame cache, CPU latency noted in docs
- orchestration layer: `docs/ORCHESTRATION.md`, `scripts/vision_pipeline.py` (DAG stages, single-resident model swapping, cache, checkpoints, memory guard), `specs/review.json` example
- vision benchmark: `scripts/vision_bench.py` + measured report; batch default switched to `gemma3:12b` (same OCR hit rate as qwen3-vl, ~40% faster), `model` override on the describe tool
- layered vision design: `docs/VISION.md` (OCR vs geometry vs batch VLM vs key-frame thinking vs GUI grounding), `scripts/vision_bench.py` benchmark, measured model snapshot
- key-frame thinking mode: `keyFrames` + `think` on `describe_video_frames`, reasoning model via `vlmThinkModel` (default qwen3-vl:8b), larger token budget, chapter/annotation/top-attention sampling, player button
- model packaging: `docs/MODELS(.zh).md`, `scripts/setup_models.py` (downloads MediaPipe tasks, checks toolchain, pulls Ollama model) and `scripts/install.ps1` Windows wrapper
- camera preview: 640x480 capture with per-frame `latest.jpg` (~15Hz MJPEG), analysis downscaled to 320x240; pose actions (`both_hands_up`/`arms_crossed`/`hands_on_hips`) via pose landmarker
- camera signals: MediaPipe hand/face landmarkers, gesture/wave/smile/brow/face events, `camera_calibrate` baseline + `camera_feedback` personalization (`profile.json`), `enableCameraSignals` switch, Python + Node tests
- VLM frame descriptions: `describe_video_frames` + `/event-video/describe`, Ollama/OpenAI-compatible providers, `vision.json` sidecar, `enableVlm` switch, fake-provider acceptance test
- work items: `export_work_items` for tickets (annotations + review flags, time/frame/acceptance anchors) and SOP (chapter steps), `enableWorkItems` switch, acceptance test
- timeline annotations: `annotate_video_record` / `list_video_annotations` with `annotations.json` sidecar (atomic write, frame anchor, export section, `enableAnnotations` switch, acceptance test)
- library search: `search_video_library` / `ask_video_library` (local BM25-style index, CJK bigrams, videoId duplicate collapsing, `enableSearchTool` switch, acceptance tests)
- `read_video_frame` tool + `/event-video/frame` route (on-demand frame, scene context, on-demand ffmpeg extraction, `enableFrameTool` switch, acceptance test)
- synthetic demo video and README timeline assets
- CI workflow (engine pytest + Node syntax/manifest checks), issue and PR templates, roadmap

## 0.1.0

- initial engine: frame state machine, OCR labels, transcript alignment, semantic chapters, attention proxy, completeness gates
- DSH tool plugin and review workbench bundle
- reflex camera monitor
