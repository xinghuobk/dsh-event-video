# DSH Event Video

![banner](assets/banner.svg)

给 DeepSeek Harness 用的本地视频审阅工具。

丢一个录屏或会议视频进来，它会写一份带时间戳的记录：画面里是什么、说了什么、页面或话题什么时候变的。同一份记录驱动审阅面板：看片、跳到某一刻、写标注、导出工单。

[![License: MIT](https://img.shields.io/badge/License-MIT-7c8cff.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.10%2B-52c7bd.svg)](engine/pyproject.toml)
[![Node](https://img.shields.io/badge/node-22%20%7C%2024-52c7bd.svg)](bundle/package.json)
[![CI](https://github.com/xinghuobk/dsh-event-video/actions/workflows/ci.yml/badge.svg)](https://github.com/xinghuobk/dsh-event-video/actions)

*[English README](README.md)*

![事件记录时间线](assets/demo-timeline.gif)

*50 秒演示记录：画面状态、转移、时间尺、校验和审阅标记，直接由真实的 `event.json` 渲染。*

## 用来做什么

一小时的录屏审起来很慢。快进会漏掉原话和当时打开的页面，直接让模型总结又拿不出证据。

这个工具把证据留下：

- 画面状态和转移覆盖整条时间线；
- 语音切成带时间戳的小段，和画面变化对上；
- 章节按页面切换和话题变化切分；
- 每次构建都会列出需要人工确认的地方。

产物是 `event.json`，以及一个边看边核对的面板。

## 产物

```
event.json
├─ states[]        126 个画面状态：时间、语音标签、OCR 标签、URL、注意力
├─ transitions[]   125 次状态转移
├─ units[]         380 条与转移对齐的语音语元
├─ chapters[]      21 个语义章节（页面切换/话题转折、停留、注意力）
├─ gaps[]          ≥3 秒的语音缺口，缺失叙述可见
├─ gates           分区/标签/缺口/语元/章节 校验
└─ review          审阅标记：OCR URL 异常、无标签状态、弱对齐、长度异常
```

## 工作原理

```text
ffmpeg 抽帧 ──► pHash 状态机 ──► 画面状态 + 转移
      │                 │
      │                 ├──► 代表帧 OCR ──► 页面标签
      │                 ├──► 状态起点高分辨率 OCR ──► URL / 标签页提示
      │                 └──► 语音（转写或本地 ASR）──► 语元
      │
      └──► 对齐：哪些话在描述哪次变化（滞后统计）
                         │
                         ├──► 章节：页面切换 + 话题低谷
                         ├──► 注意力：停留 + 指代/动作语言 + 微交互
                         └──► 审阅：确定性自检标记
```

## 试试 50 秒 demo

```bash
cd engine
pip install -e ".[dev,office]"
cd ..
python examples/demo/make_demo.py
event-build examples/demo/demo.mp4 --out examples/demo/out --transcript examples/demo/transcript.txt
```

预期：4 个状态、3 次转移、校验 PASS、1 条审阅标记（章节 49 秒）。

## 仓库结构

| 目录 | 说明 |
|---|---|
| `engine/` | Python 包 `event-build`：流水线与测试 |
| `plugin/` | DSH 工具插件，注册 `build_video_event` |
| `bundle/` | DSH Web 插件：侧栏唯一入口「视频审阅」，含 审阅/总览/库/摄像头 四个标签 |
| `camera/` | 反射式摄像头监控（本地 5Hz 感知，事件才唤醒模型） |
| `scripts/` | 独立使用的库索引脚本 |
| `docs/architecture.md` | 数据模型与流水线细节 |

## 模型（可选，一条命令）

核心只需要 **ffmpeg + Python**；摄像头信号、本地 VLM 描述、本地 ASR 都是可选层：

```bash
python scripts/setup_models.py              # MediaPipe 手/脸/姿态模型（约 17 MB）
python scripts/setup_models.py --with-vlm   # + Ollama 视觉模型（qwen2.5vl:3b，约 3.2 GB）
```

Windows 封装：`powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -WithVlm`。

完整表格（大小、用途、存放位置、关闭方式）与许可证说明：[docs/MODELS.zh.md](docs/MODELS.zh.md)。视觉分层设计（OCR / 几何 / 批量 VLM / 关键帧思考 / GUI 定位）与模型评测方式：[docs/VISION.md](docs/VISION.md)。受限内存下的多模型任务编排（单元任务、模型换入换出、缓存、断点）：[docs/ORCHESTRATION.md](docs/ORCHESTRATION.md)。模型权重不进仓库，按需下载。
## 快速开始（只用引擎）

需要 Python 3.10+ 与 PATH 上的 `ffmpeg`。

```bash
cd engine
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e ".[dev,office]"

event-build input.mp4 --out out --transcript transcript.txt
```

转写文件每行一句 `[mm:ss] 文本`；也可以本地转写：

```bash
pip install -e ".[asr,dev]"
event-build input.mp4 --out out --asr --whisper-model /path/to/whisper-large-v3
```

得到 `out/event.json`、`out/report.md`（校验 + 审阅标记）、`out/coverage.json`。

## 接入 DSH

**1. 安装工具插件**

```bash
cd "$DSH_PROFILE_DIR"
npm install --install-links --legacy-peer-deps "file:/path/to/dsh-event-video/plugin"
```

在 profile 的 `cordis.patch.yml` 追加（**必须写在 `insert` 里，且用相对路径**——裸包名从 DSH 安装目录解析，profile 里的包不会被看到）：

```yaml
- insert:
    - id: event-video
      name: ./node_modules/dsh-event-video/lib/index.js
      config:
        pythonPath: /path/to/engine/.venv/bin/python
        modelPath: /path/to/whisper-large-v3
        defaultOutDir: /path/to/data/video-events
```

**2. 安装界面插件**

用 DSH 的 plugin manager `install_bundle`，target 指向 `bundle/` 目录；重启 DSH。

**3. 使用**

主要工具：

- `build_video_event(...)` 生成记录；`review_video_event(out)` 返回审阅标记。
- `read_video_frame(out, t)` / `ocr_video_frame(out, t)` 取某一刻的画面或精确文字。
- `describe_video_frames(out, keyFrames?, think?)` 让配置的 VLM 写简短描述（Ollama 或任意 OpenAI 兼容接口）。
- `annotate_video_record` / `list_video_annotations` / `reply_video_annotation` 记录带时间码的标注和回复；`fuse_vision_evidence` 用 OCR 交叉校验 UI-TARS 定位，`fuse_to_work_item` 直接写成工单。
- `export_work_items(out, kind)` 导出工单或 SOP；`export_video_analysis(out)` 导出 Markdown、CSV、Word、Excel。
- `run_vision_batch(records, ...)`、`run_vision_pipeline(out, ...)` 批量跑同一套流程。

界面上是一个侧栏入口：首页、视频库、查看、设置。布局规则见 [docs/DESIGN.md](docs/DESIGN.md)，模型栈见 [docs/VISION.md](docs/VISION.md)。

## 摄像头（Windows，显式开启）

```bash
pip install -r camera/requirements.txt
# 首次：下载 MediaPipe 手/脸模型（约 11MB）到数据目录
python camera/download_models.py
python camera/camera-monitor.py --device "video=Your Camera"
```

监控还会加载本地 MediaPipe 模型（`hand_landmarker.task`、`face_landmarker.task`），产出 **手势/挥手/微笑/皱眉/人脸出现/离开** 事件，并支持个人中性基线校准（`camera_calibrate`）与阈值反馈（`camera_feedback`）。bundle 注册：`camera_state`（即时结构化状态）、`camera_wait`（阻塞等待运动/画面/主体事件）、`camera_snapshot`（抓帧路径，配合 `read_image`）。只有用户显式开启才采集，画面留在本地。面板预览走本地 MJPEG 流（`/camera/stream`）；采集 640x480@15fps（分析降到 320x240），`latest.jpg` 每帧刷新。新增身体动作事件：`both_hands_up` / `arms_crossed` / `hands_on_hips`（`pose_action`）。

## 配置

| 环境变量 / bundle 配置 | 含义 |
|---|---|
| `DSH_EVENT_VIDEO_HOME` / `dataHome` | 数据根目录（记录、缓存、摄像头），默认 `~/event-video` |
| `DSH_EVENT_VIDEO_PYTHON` / `pythonPath` | 装了 `event-build` 的解释器 |
| `DSH_EVENT_VIDEO_WHISPER` / `whisperModel` | 本地 faster-whisper 模型目录 |
| `DSH_EVENT_VIDEO_CAMERA_DEVICE` / `cameraDevice` | ffmpeg dshow 设备 |
| `DSH_EVENT_VIDEO_ROOTS` / `extraRoots` | 额外允许的媒体根目录（`;` 分隔） |
| `DSH_EVENT_VIDEO_VLM_ENDPOINT` / `vlmEndpoint` | Ollama `/api/chat` 或 OpenAI 兼容 URL |
| `DSH_EVENT_VIDEO_VLM_MODEL` / `vlmModel` | VLM 模型名（如 qwen2.5vl） |
| `DSH_EVENT_VIDEO_MEDIAPIPE_DIR` / `mediapipeDir` | 手/脸 `.task` 模型目录（默认 `<home>/models/mediapipe`） |
| `DSH_EVENT_VIDEO_CAMERA_SIGNALS` / `enableCameraSignals` | `0`/false 关闭手势与表情事件 |
| `DSH_EVENT_VIDEO_CAMERA_SIZE` | 采集分辨率，默认 `640x480` |
| `DSH_EVENT_VIDEO_VOICE` / `enableVoice` | `0`/false 关闭语音与语音反应 |
| `DSH_EVENT_VIDEO_TTS_COMMAND` / `ttsCommand`（+`ttsArgs`）/ `ttsEndpoint` | 本地 TTS 可执行文件或 OpenAI 兼容语音 URL |

## 审阅标记

`review` 是确定性的，每次构建都会跑，不额外调用模型。它会标记：

- 完整性校验未通过；
- OCR 把 URL 里的 `=` / `&` 读丢（地址栏识别真实存在的失败模式）；
- 完全没有标签的状态；
- ≥60 秒的语音缺口；
- 动作对齐弱、语音滞后过大；
- 章节短于 30 秒或长于 300 秒。

构建工具的摘要会带上同一块内容，模型可以在同一轮回答里汇报。

## 已知限制

- 只支持 mp4；章节边界是字符 bigram 启发式（粗但稳定）。
- 注意力是排序代理，不是校准过的概率。
- 摄像头采集仅限 Windows/DirectShow。
- 构建队列在内存中：重启 DSH 会丢队列（记录仍在磁盘）。
- OCR 可能读错 URL 标点；审阅会标记，但不会自动纠正。

## 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。提交 PR 前跑 `pytest -q engine/tests` 和 Node 语法检查。

## License

MIT © 2026 xinghuobk
