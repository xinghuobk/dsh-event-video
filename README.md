# DSH Event Video

把长视频变成**可验证的事件记录**，并在 DeepSeek Harness（DSH）里提供审阅工作台和本地反射式摄像头监控。

核心思路：视频不是"抽几帧给模型看"，而是被拆成连续的**画面状态 / 状态转移 / 语义词元 / 语义章节**，每一段都有时间戳、页面 URL、注意力代理和完整性校验；模型读的是结构化事件，不是视频或截图。

## 组成

| 目录 | 内容 |
|---|---|
| `engine/` | Python 包 `event-build`：抽帧、pHash 状态机、OCR、ASR、语元对齐、章节、注意力、四门校验 |
| `plugin/` | DSH 工具插件 `dsh-event-video`：注册模型工具 `build_video_event` |
| `bundle/` | DSH Web 插件 `@local/dsh-event-video-card`：唯一入口「视频审阅」，含审阅 / 总览 / 库 / 摄像头四个标签 |
| `camera/` | 本地反射式摄像头监控 worker：5Hz 感知，事件驱动唤醒模型 |
| `scripts/` | 多视频库索引（标题、来源、缩略图、标签） |

## 默认工作流：构建 → 自动审阅

一次构建就会在 `event.json` 里写入确定性的 `review` 块：校验是否通过、OCR URL 是否缺 `=`/`&`、是否有状态无标签、语音缺口、对齐异常、章节长度异常，并附注意力 Top 状态与长缺口样本。模型拿到构建结果后应**先读 review、再汇报**；面板头部也会显示「审阅 N」标记。

`review_video_event` 工具可对已有记录重跑审阅（旧记录没有内嵌 review 时由 Host 侧计算）。

## 能力

- **完整覆盖**：状态 + 转移连续覆盖全片；每个状态带语音标签、OCR 标签、URL；>3 秒语音缺口单独标注。
- **语义章节**：按页面切换 + 话题低谷切章，替代固定时间窗。
- **注意力代理**：停留 + 指代词 + 动作词 + 微交互，给每段排序。
- **审阅工作台**：视频播放器（拖动/倍速/章节跳转/快捷键）与转写、状态、章节同步；Gantt 总览；视频库（缩略图、搜索、标签、对比、回收站）；构建队列（并发 2、原子写入、自动索引）。
- **反射式监控**：本地 5Hz 计算运动/亮度/画面变化/主体，事件落盘并保留关键帧；模型工具 `camera_state` / `camera_wait` / `camera_snapshot`，只在事件发生时唤醒模型。

## 配置（去掉本地路径依赖）

数据目录默认为 `~/event-video`，可用环境变量或 bundle 行配置覆盖：

| 变量 / 配置 | 说明 |
|---|---|
| `DSH_EVENT_VIDEO_HOME` / `dataHome` | 数据根目录（records / cache / camera 都在其下） |
| `DSH_EVENT_VIDEO_PYTHON` / `pythonPath` | 装了 `event-build` 的解释器（默认 `python` / `python3`） |
| `DSH_EVENT_VIDEO_WHISPER` / `whisperModel` | 本地 faster-whisper 模型目录（可选） |
| `DSH_EVENT_VIDEO_CAMERA_DEVICE` / `cameraDevice` | ffmpeg dshow 设备，如 `video=HD Webcam` |
| `DSH_EVENT_VIDEO_ROOTS` / `extraRoots` | 额外允许的媒体根目录（`;` 分隔） |

bundle 行配置示例（profile 的 `cordis.patch.yml` 覆盖行）：

```yaml
- id: event-video-card
  config:
    dataHome: D:\data\event-video
    pythonPath: D:\python\python.exe
```

插件行的 `config` 同样可配 `pythonPath` / `modelPath` / `defaultOutDir`。

## 环境

- Windows（DirectShow 摄像头、GPU/CPU ASR）
- Python 3.11+，`ffmpeg` 在 PATH
- Node.js 22 / 24，DSH（DeepSeek Harness）
- 可选：faster-whisper + 本地模型（ASR）、OpenCV（摄像头反射层）

## 快速开始（引擎）

```powershell
cd engine
python -m venv .venv
.\.venv\Scripts\pip install -e ".[dev]"          # 仅抽帧/OCR/对齐
.\.venv\Scripts\pip install -e ".[asr,dev]"       # 追加本地 ASR（faster-whisper）
event-build video.mp4 --out out --transcript transcript.txt
event-build video.mp4 --out out --asr --whisper-model D:\models\whisper-large-v3 --mode talk
```

产出 `event.json`：`states / transitions / units / chapters / gaps / alignment / gates`。

## 安装 DSH 插件

1. 工具插件（模型侧）：

```powershell
cd $env:DSH_PROFILE_DIR
npm install --install-links --legacy-peer-deps "file:D:\path\to\repo\plugin"
```

在 profile 的 `cordis.patch.yml` 追加（必须用 `insert` + 相对路径，裸包名不会被解析）：

```yaml
- insert:
    - id: event-video
      name: ./node_modules/dsh-event-video/lib/index.js
      config:
        pythonPath: D:\path\to\engine\.venv\Scripts\python.exe
        modelPath: D:\models\whisper-large-v3
        defaultOutDir: D:\agent\video-events
```

2. 界面插件（bundle）：用 DSH 的 `plugin_manager` 以 `install_bundle` 安装 `bundle/` 目录，不要手写 profile 配置。

## 摄像头

```powershell
pip install opencv-python numpy
python camera\camera-monitor.py     # 或由 bundle 的 /camera/start 路由拉起
```

面板「摄像头」标签提供开始/停止、抓拍、1fps 预览和事件流；模型工具：

| 工具 | 用途 |
|---|---|
| `camera_state` | 即时读取结构化状态（毫秒级，不耗图片 token） |
| `camera_wait` | 阻塞等待指定事件后返回事件 + 关键帧路径 + 状态 |
| `camera_snapshot` | 按需抓一帧，配合 `read_image` 让模型看到画面 |

## 隐私

- 摄像头只在显式启动或工具调用时采集；画面在本地处理，不上传。
- 抓拍与事件关键帧保存在 `D:\agent\camera`；事件记录保存在 `D:\agent\video-events`。
- 删除默认进回收站（`_trash`），可恢复。

## 已知限制

- 仅 mp4；章节切分基于字符 bigram 相似度，属粗粒度代理。
- 注意力是排序启发式，不是概率。
- 构建队列在内存中：进程重启后队列状态丢失（记录仍在磁盘）。
- 摄像头主体检测为肤色启发式，不是人脸识别。
- 本地 ASR 长任务建议 `--asr-device cpu`；GPU 连续推理在部分笔电上可能触发硬件保护。

## License

MIT
