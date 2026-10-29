# Models and optional components

The plugin is designed to work in **tiers**. The core (video → event record) needs only Python + ffmpeg. Camera signals, local VLM descriptions and ASR are optional and can be enabled later.

| Component | Size | Needed for | Required? | Where it goes | Disable with |
|---|---|---|---|---|---|
| `ffmpeg` | ~80 MB | frame extraction, camera capture | **yes** | system PATH | — |
| Python 3.10+ with `event-build` | ~200 MB | build/export engine | **yes** | venv | — |
| MediaPipe `hand_landmarker.task` | 7.8 MB | hand gestures, wave | optional (camera) | `<dataHome>/models/mediapipe/` | `enableCameraSignals: false` |
| MediaPipe `face_landmarker.task` | 3.8 MB | face present, smile/brow | optional (camera) | same | same |
| MediaPipe `pose_landmarker.task` | 5.8 MB | `both_hands_up` etc. | optional (camera) | same | same |
| Ollama + a vision model (e.g. `minicpm-v:8b` or `qwen3-vl:8b`) | Ollama ~1 GB, model 5.5-6.2 GB | `describe_video_frames` | optional | Ollama store (`OLLAMA_MODELS`, put it on a large disk) | `enableVlm: false` |
| faster-whisper + model (e.g. `whisper-small`) | 0.5–3 GB | local ASR instead of a transcript file | optional | any local dir | pass `--transcript` instead |
| Python `python-docx`, `openpyxl` | ~10 MB | Word/Excel export | optional | engine venv | `formats` without docx/xlsx |

Nothing above is committed to this repository: model files are large and have their own licenses.

## One-command setup (recommended)

```bash
python scripts/setup_models.py --with-vlm
```

The script:

1. downloads the three MediaPipe `.task` models into `<dataHome>/models/mediapipe`;
2. checks `ffmpeg`, Python and (with `--with-vlm`) Ollama, then runs `ollama pull <model>`;
3. prints the `event-video-card` config snippet and the remaining manual steps.

Useful flags:

```bash
python scripts/setup_models.py --dry-run            # show what would happen
python scripts/setup_models.py --offline --home D:\data\event-video
python scripts/setup_models.py --with-vlm --vlm-model minicpm-v:8b
```

Windows users can run the wrapper:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -WithVlm
```

## Minimal install (no models)

```bash
cd engine
python -m venv .venv
pip install -e ".[dev,office]"
event-build input.mp4 --out out --transcript transcript.txt
```

The panel works for review, search, annotations, tickets and export; camera signal tools are registered but return an explicit "not configured" error instead of failing silently.

## Licenses

- MediaPipe tasks models: Apache-2.0 (Google).
- Ollama models: license depends on the model (check the model card; Qwen2.5-VL is Apache-2.0 for the 3B/7B sizes).
- Whisper models: MIT (OpenAI weights); faster-whisper is MIT.

## Why not bundle an installer with the models?

- GitHub refuses multi-GB binaries and model licenses differ;
- the VLM choice is a user decision (size vs quality);
- `scripts/install.ps1` is the packaging boundary: it installs Ollama if missing, pulls the chosen model and downloads the MediaPipe tasks, without storing weights in git.

## Optional: PaddleOCR-VL (highest text accuracy)

PaddleOCR-VL reads screen text and URLs much more reliably than any of the general VLMs above, but needs its own Python 3.12 environment:

```bash
uv venv --python 3.12 D:\agent\ocr-venv
uv pip install --python D:\agent\ocr-venv\Scripts\python.exe paddlepaddle paddleocr "paddlex[ocr]"
```

Then point the bundle at the adapter (one-time model download goes to `~/.paddlex`):

```yaml
- id: event-video-card
  config:
    ocrCommand: D:\agent\ocr-venv\Scripts\python.exe
    ocrScript: D:\agent\dsh-event-video\scripts\paddleocr_vl.py
```

The tool `ocr_video_frame(out, t)` returns `{engine, text, lines, frame}` and caches results in `<record>/ocr-cache/`. On CPU the first call takes minutes (model load + layout + VLM); cached frames are instant. Use it for key frames and exact URLs, not for every frame.