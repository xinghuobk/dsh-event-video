# DSH Event Video

![banner](assets/banner.svg)

**Every second, accounted for.**
Turn hour-long recordings into **verifiable event records** — visual states, speech units, semantic chapters, attention, and deterministic review flags, every one anchored to a timestamp.

[![License: MIT](https://img.shields.io/badge/License-MIT-7c8cff.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.10%2B-52c7bd.svg)](engine/pyproject.toml)
[![Node](https://img.shields.io/badge/node-22%20%7C%2024-52c7bd.svg)](bundle/package.json)
[![CI](https://github.com/xinghuobk/dsh-event-video/actions/workflows/ci.yml/badge.svg)](https://github.com/xinghuobk/dsh-event-video/actions)

*[中文说明](README.zh.md)*

![event record timeline](assets/demo-timeline.gif)

*A 50-second synthetic review built by the engine: states (blue), transitions (teal), time ruler, gates and review flags — rendered from the real `event.json`.*

## Why

A 55-minute design review contains hundreds of decisions, but an LLM cannot watch a video, and sampling "a few key frames" silently drops details. Summaries lose the exact words, the page that was open, and the moment something changed.

This project treats a video as an **event stream** instead:

- visual states and transitions cover the whole timeline with no gaps;
- speech is split into timestamped units and aligned to what changed on screen;
- chapters follow page switches and topic shifts, not a fixed clock;
- every build carries a **deterministic review block** that flags what a human should double-check.

The result is a JSON event record an agent can reason over, plus a review workbench where a human can watch, seek, and verify the same timeline.

| | Frame sampling + summary | DSH Event Video |
|---|---|---|
| Coverage | a handful of frames (often ~1%) | every state + transition, partitioned with gates |
| Evidence | "it said something about pricing" | timestamped speech unit + the page open at that moment |
| Navigation | trust the summary | chapters tied to page switches and topic shifts |
| Trust | read and hope | deterministic review flags name what to double-check |
| Output | a paragraph | `event.json` + Markdown / CSV / Word / Excel |

## Try the 50-second demo

```bash
cd engine
pip install -e ".[dev,office]"

cd ..
python examples/demo/make_demo.py          # synthetic video, no private footage
event-build examples/demo/demo.mp4 \
  --out examples/demo/out \
  --transcript examples/demo/transcript.txt
cat examples/demo/out/report.md
```

Expected: 4 states, 3 transitions, gates PASS, and one review flag about a 49-second chapter. The demo video is generated locally with ffmpeg and PIL.

## What you get

```
event.json
├─ states[]        126 visual states: t0/t1, speech label, OCR label, URL, attention
├─ transitions[]   125 state changes with magnitude and type
├─ units[]         380 speech units aligned to transitions (timestamped)
├─ chapters[]      21 semantic chapters (URL switch / topic shift, dwell, attention)
├─ gaps[]          speech gaps ≥3s, so missing narration is visible
├─ gates           partition / labels / gaps / units / chapter checks
└─ review          flags: OCR URL anomalies, unlabeled states, weak alignment, outliers
```

## How it works

```text
ffmpeg frames ──► pHash state machine ──► states + transitions
      │                    │
      │                    ├──► OCR representative frames ──► page labels
      │                    ├──► high-res OCR at state starts ──► URL / tab hints
      │                    └──► speech (transcript or local ASR) ──► units
      │
      └──► alignment: which words describe which change (lag statistics)
                         │
                         ├──► chapters: page switch + topic minima
                         ├──► attention: dwell + deictic/action language + micro-interactions
                         └──► review: deterministic self-check flags
```

## Repository layout

| Path | What it is |
|---|---|
| `engine/` | Python package `event-build` — the pipeline and its tests |
| `plugin/` | DSH tool plugin `dsh-event-video` (registers `build_video_event`) |
| `bundle/` | DSH Web plugin: one sidebar entry **Video Review** with Review / Overview / Library / Camera tabs |
| `camera/` | Reflex camera monitor (local 5 Hz perception, event-driven wakeups) |
| `scripts/` | Optional library index builder for standalone use |
| `docs/architecture.md` | Data model and pipeline details |

## Models (optional, one command)

The core only needs **ffmpeg + Python**. Camera signals, local VLM descriptions and ASR are optional tiers:

```bash
python scripts/setup_models.py              # MediaPipe hand/face/pose (~17 MB)
python scripts/setup_models.py --with-vlm   # + Ollama vision model (qwen2.5vl:3b, ~3.2 GB)
```

Windows wrapper: `powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -WithVlm`.

Full table (size, purpose, where it goes, how to disable) and license notes: [docs/MODELS.md](docs/MODELS.md). The layered vision design (OCR / geometry / batch VLM / key-frame thinking / GUI grounding) and how models are evaluated: [docs/VISION.md](docs/VISION.md). Nothing is committed to the repo: model weights are downloaded on demand.
## Quick start (engine only)

Requires Python 3.10+, `ffmpeg` on PATH.

```bash
cd engine
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e ".[dev]"

event-build input.mp4 --out out --transcript transcript.txt
```

`transcript.txt` is one `[mm:ss] text` line per utterance. Or let the engine transcribe locally:

```bash
pip install -e ".[asr,dev]"
event-build input.mp4 --out out --asr --whisper-model /path/to/whisper-large-v3
```

You get `out/event.json`, `out/report.md` (gates + review flags), and `out/coverage.json`.

## Use it inside DSH

**1. Install the tool plugin**

```bash
cd "$DSH_PROFILE_DIR"
npm install --install-links --legacy-peer-deps "file:/path/to/dsh-event-video/plugin"
```

Add to the profile's `cordis.patch.yml` (a new row **must** live in `insert`, and the name must be a relative path — bare package names resolve from the DSH install, not the profile):

```yaml
- insert:
    - id: event-video
      name: ./node_modules/dsh-event-video/lib/index.js
      config:
        pythonPath: /path/to/engine/.venv/bin/python
        modelPath: /path/to/whisper-large-v3
        defaultOutDir: /path/to/data/video-events
```

**2. Install the UI bundle**

Use DSH's plugin manager with `install_bundle` and the `bundle/` directory as target. Restart DSH.

**3. Use it**

- Agent tool: `build_video_event(video, transcript | asr, mode?, hi_labels?)`, then `review_video_event(out)` and report the flags.
- Key-frame thinking: `describe_video_frames(out, keyFrames=true, think=true)` samples chapter starts, annotations and top-attention states, then asks a reasoning VLM (`vlmThinkModel`, default `qwen3-vl:8b`) with a larger budget; the player has a **关键帧思考** button. Local compute only, no API tokens.`n- Voice: `speak_text(text)` speaks locally (Windows SAPI by default, or `ttsCommand` / OpenAI-compatible `ttsEndpoint`); `camera_voice_react(kinds, timeoutS, template)` waits for a camera event and responds aloud in one call (`{kind}` / `{time}` / `{gesture}` / `{smile}`).`n- VLM descriptions: `describe_video_frames(out, limit?)` samples states and asks a configured VLM (Ollama `/api/chat` or OpenAI-compatible, `vlmEndpoint`/`vlmModel`) for factual descriptions, stored in `vision.json`.`n- Work items: `export_work_items(out, kind)` writes tickets.md/csv/json (from annotations + review flags, each with time/frame/acceptance) or an ordered SOP from chapters; player has **工单** / **SOP** buttons.`n- Annotations: `annotate_video_record(out, t0, text)` / `list_video_annotations(out)` write a timestamped note with a frame anchor to `annotations.json` (event.json is never modified); the player shows notes and a **标注** button.`n- Library search: `search_video_library(query)` returns ranked timestamped hits (record, mm:ss, frame, quote) across every analyzed video; `ask_video_library(question)` returns an evidence pack with citation guidance. Refresh page for the 汇总 search box.`n- Frame check: `read_video_frame(out, t)` returns the frame at a timestamp plus scene label, chapter and nearby speech; the model then calls `read_image` on the path to actually see it (also wired to the **看帧** button in the player).`n- Export: `export_video_analysis(out)` writes `analysis.md`, `chapters.csv`, `analysis.docx`, `analysis.xlsx` and raw `event.json` under the data home's `exports/`; `summarize_video_analyses()` returns a one-shot overview of every record (totals, review-flag counts, cross-record attention leaders).
- UI: sidebar **Video Review** → Review (player + synced transcript), Overview (Gantt + chapters), Library (thumbnails, search, tags, compare, queue, trash), Summary (all analyses at a glance + export all), Camera.

## Camera (Windows, opt-in)

```bash
pip install -r camera/requirements.txt`n# once: fetch the MediaPipe hand/face models (~11 MB) into the data home`npython camera/download_models.py
python camera/camera-monitor.py --device "video=Your Camera"
```

The monitor also loads local MediaPipe models (`hand_landmarker.task`, `face_landmarker.task`) to emit **gesture / wave / smile / brow_down / face_present / face_absent** events with a personal neutral baseline (`camera_calibrate`) and threshold feedback (`camera_feedback`). The bundle registers: `camera_state` (instant structured state), `camera_wait` (block until a motion/scene/subject event), `camera_snapshot` (single frame path for `read_image`). Capture only starts on explicit user action; frames stay local. The panel preview is a local MJPEG stream (`/camera/stream`); capture runs 640x480@15fps (analysis downscaled to 320x240) and `latest.jpg` refreshes on every frame. Pose actions `both_hands_up` / `arms_crossed` / `hands_on_hips` are emitted as `pose_action` events.

## Configuration

| Env / bundle config | Meaning |
|---|---|
| `DSH_EVENT_VIDEO_HOME` / `dataHome` | data root (records, cache, camera) — default `~/event-video` |
| `DSH_EVENT_VIDEO_PYTHON` / `pythonPath` | interpreter with `event-build` installed |
| `DSH_EVENT_VIDEO_WHISPER` / `whisperModel` | local faster-whisper model dir |
| `DSH_EVENT_VIDEO_CAMERA_DEVICE` / `cameraDevice` | ffmpeg dshow spec |
| `DSH_EVENT_VIDEO_ROOTS` / `extraRoots` | extra allowed media roots (`;`-separated) |`n| `DSH_EVENT_VIDEO_VLM_ENDPOINT` / `vlmEndpoint` | Ollama `/api/chat` or OpenAI-compatible chat-completions URL |`n| `DSH_EVENT_VIDEO_VLM_MODEL` / `vlmModel` | VLM model name (e.g. qwen2.5vl) |`n| `DSH_EVENT_VIDEO_MEDIAPIPE_DIR` / `mediapipeDir` | dir with hand/face `.task` models (default `<home>/models/mediapipe`) |`n| `DSH_EVENT_VIDEO_CAMERA_SIGNALS` / `enableCameraSignals` | `0`/false disables gesture+expression events |`n| `DSH_EVENT_VIDEO_CAMERA_SIZE` | capture resolution, default `640x480` |`n| `DSH_EVENT_VIDEO_VOICE` / `enableVoice` | `0`/false disables TTS and voice reactions |`n| `DSH_EVENT_VIDEO_TTS_COMMAND` / `ttsCommand` (+`ttsArgs`) / `ttsEndpoint` | local TTS executable or OpenAI-compatible speech URL |

## Review flags

`review` is deterministic, so it runs on every build without an LLM call. It flags:

- failing completeness gates;
- OCR URLs that lost `=` / `&` (a real failure mode of address-bar OCR);
- states with no speech or OCR label;
- speech gaps ≥60 s;
- weak action alignment or large speech lag;
- chapters shorter than 30 s or longer than 300 s.

The build tool's summary carries the same block, so an agent reports the review in the same turn.

## Known limitations

- mp4 only; chapter boundaries are a character-bigram heuristic (coarse but stable).
- Attention is a ranking proxy, not a calibrated probability.
- Camera capture is Windows/DirectShow only.
- Build queue is in memory: restarting DSH clears queue state (records stay on disk).
- OCR can misread punctuation inside URLs; review flags it but does not auto-correct.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Run `pytest -q engine/tests` and the Node syntax checks before sending a PR.

## License

MIT © 2026 xinghuobk
