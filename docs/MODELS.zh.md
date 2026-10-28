# 模型与可选组件

插件按“层”安装：**核心**（视频 → 事件记录）只需要 Python + ffmpeg；摄像头信号、本地 VLM 描述、本地 ASR 都是可选，后续再装。

| 组件 | 大小 | 用途 | 必须? | 存放位置 | 关闭方式 |
|---|---|---|---|---|---|
| `ffmpeg` | ~80 MB | 抽帧、摄像头采集 | **是** | 系统 PATH | — |
| Python 3.10+ 与 `event-build` | ~200 MB | 构建/导出引擎 | **是** | venv | — |
| MediaPipe `hand_landmarker.task` | 7.8 MB | 手势、挥手 | 可选（摄像头） | `<数据目录>/models/mediapipe/` | `enableCameraSignals: false` |
| MediaPipe `face_landmarker.task` | 3.8 MB | 人脸、微笑/皱眉 | 可选（摄像头） | 同上 | 同上 |
| MediaPipe `pose_landmarker.task` | 5.8 MB | 举手/抱臂/叉腰 | 可选（摄像头） | 同上 | 同上 |
| Ollama + 视觉模型（如 `qwen2.5vl:3b`） | Ollama ~1 GB，模型 3.2 GB | `describe_video_frames` | 可选 | Ollama 模型库（默认 `~/.ollama`） | `enableVlm: false` |
| faster-whisper + 模型（如 `whisper-small`） | 0.5–3 GB | 本地转写（替代 transcript 文件） | 可选 | 任意本地目录 | 直接传 `--transcript` |
| Python `python-docx`、`openpyxl` | ~10 MB | Word/Excel 导出 | 可选 | 引擎 venv | 导出时去掉 docx/xlsx |

以上模型都**不放进仓库**：体积大、许可证各不相同。

## 一键安装（推荐）

```bash
python scripts/setup_models.py --with-vlm
```

脚本会：

1. 下载三个 MediaPipe `.task` 模型到 `<数据目录>/models/mediapipe`；
2. 检查 `ffmpeg`、Python、Ollama（`--with-vlm` 时）；
3. 执行 `ollama pull <模型>`；
4. 打印 `event-video-card` 配置片段和剩余步骤。

常用参数：

```bash
python scripts/setup_models.py --dry-run            # 只打印计划
python scripts/setup_models.py --offline --home D:\data\event-video
python scripts/setup_models.py --with-vlm --vlm-model qwen2.5vl:7b
```

Windows 可直接用封装脚本：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install.ps1 -WithVlm
```

## 最小安装（不装任何模型）

```bash
cd engine
python -m venv .venv
pip install -e ".[dev,office]"
event-build input.mp4 --out out --transcript transcript.txt
```

审阅、检索、标注、工单、导出都能用；摄像头信号工具仍会注册，但会明确返回“未配置”，不会静默失败。

## 许可证

- MediaPipe task 模型：Apache-2.0（Google）；
- Ollama 模型：取决于具体模型（Qwen2.5-VL 的 3B/7B 为 Apache-2.0，以模型卡为准）；
- Whisper 模型：MIT（权重），faster-whisper 为 MIT。

## 为什么不把所有模型打进安装包？

- GitHub 不接受数 GB 二进制，且模型许可证各异；
- VLM 的选择（体积 vs 质量）应由用户决定；
- `scripts/install.ps1` 就是“打包边界”：缺 Ollama 就装、按需拉模型、下载 MediaPipe 任务，但**不把权重放进 git**。
