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
- Export: `export_video_analysis(out)` writes `analysis.md`, `chapters.csv`, `analysis.docx`, `analysis.xlsx` and raw `event.json` under the data home's `exports/`; `summarize_video_analyses()` returns a one-shot overview of every record (totals, review-flag counts, cross-record attention leaders).
- UI: sidebar **Video Review** → Review (player + synced transcript), Overview (Gantt + chapters), Library (thumbnails, search, tags, compare, queue, trash), Summary (all analyses at a glance + export all), Camera.

## Camera (Windows, opt-in)

```bash
pip install -r camera/requirements.txt
python camera/camera-monitor.py --device "video=Your Camera"
```

The bundle registers three tools: `camera_state` (instant structured state), `camera_wait` (block until a motion/scene/subject event), `camera_snapshot` (single frame path for `read_image`). Capture only starts on explicit user action; frames stay local.

## Configuration

| Env / bundle config | Meaning |
|---|---|
| `DSH_EVENT_VIDEO_HOME` / `dataHome` | data root (records, cache, camera) — default `~/event-video` |
| `DSH_EVENT_VIDEO_PYTHON` / `pythonPath` | interpreter with `event-build` installed |
| `DSH_EVENT_VIDEO_WHISPER` / `whisperModel` | local faster-whisper model dir |
| `DSH_EVENT_VIDEO_CAMERA_DEVICE` / `cameraDevice` | ffmpeg dshow spec |
| `DSH_EVENT_VIDEO_ROOTS` / `extraRoots` | extra allowed media roots (`;`-separated) |

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
