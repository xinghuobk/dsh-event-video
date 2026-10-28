# event-build

把一段视频变成**可校验的事件记录**：画面切成状态与转移，语音合并成语义词元，两边按时间戳对齐，输出带锚点的事件 JSON 与四道校验。

结构层**不消耗 LLM token**：抽帧、差分、OCR、ASR、对齐全部本地完成。需要中文改写/汇总时再调模型，输入是几 KB 的事件 JSON，不是视频或图片。

## 安装

```powershell
uv venv .venv
uv pip install --python .venv\Scripts\python.exe -e ".[dev,asr]"
```

依赖：`ffmpeg` 在 PATH 上；`asr` 是可选组（faster-whisper + Windows 的 cuBLAS）。只用现成转写的话可以不装 `asr`。

## 快速开始

有转写：

```powershell
event-build video.mp4 --out run1 --transcript transcript.txt
```

没有转写，本地转写（需要 `asr` 组和 Whisper 模型）：

```powershell
event-build video.mp4 --out run1 --asr --whisper-model D:\models\whisper-large-v3
```

转写格式：每行 `[mm:ss] 文本`。

复用已算过的帧/OCR（改参数、重出报告）：

```powershell
event-build video.mp4 --out run2 --transcript transcript.txt --reuse run1
```

对已有事件记录做动作分类：

```powershell
event-build actions run1\event.json --frames run1\frames
```

## 参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `--out` | 必填 | 输出目录 |
| `--transcript` | — | 与 `--asr` 二选一 |
| `--asr` / `--whisper-model` / `--language` | 关 / auto / zh | 本地转写 |
| `--asr-device` | 自动（先 cuda 后 cpu） | 强制 ASR 设备；GPU 长时间任务可能整机断电，CPU 上用 `--asr-device cpu` 更稳 |
| `--fps` | 1 | 抽帧频率 |
| `--width` | 1024 | 帧宽 |
| `--scene-th` | 9 | pHash 变化阈值 |
| `--start` / `--duration` | 0 / 全片 | 只处理片段 |
| `--reuse` | 无 | 复用已有 frames/phash/ocr |
| `--no-ocr` | 关 | 跳过 OCR |
| `--hi-labels` | 关 | 状态起点帧 1536px 重跑 OCR |
| `--label-width` | 1536 | 高分辨率标签帧宽 |
| `--chrome-crop` | 0.07 | 状态标签丢弃画面顶部比例（浏览器 UI） |
| `--mode` | auto | screen / action / talk（talk 仅显式） |

## 产物

```
run1/
  frames/          1 fps 帧
  phash.json       帧哈希
  ocr.jsonl        选中帧 OCR
  hi-labels.jsonl  --hi-labels 时的高分辨率标签
  transcript.txt   --asr 时的转写
  event.json       事件记录（schema_version=1）
  coverage.json    四道校验
  report.md        人读摘要
```

`event.json` 顶层：`schema_version / mode / states / transitions / units / segments / chapters / gaps / alignment / gates`。
每个状态可带四层定位：`label_speech`（那句话）、`label_hi`（页面内容）、`url_hint`（地址栏 URL）、`tab_hint`（标签页标题）。

每个状态另带 `attention`：`dwell_s / deictic_hits / action_hits / micro_interactions / emphasis`（停留 + 指代/动作语言 + 微交互的启发式权重）。光标像素轨迹在本类录屏中不可靠，暂不采集；注意力用代理信号。

按条目打分用 `local_attention(t, units, transitions, window=30)`：取该时间点 ±30 秒窗口内的指代/动作词与微交互，再加上所在页面停留，避免同一条长状态里的多个条目并列同分。

锚点设计：**时间区间 + 语义词元 id** 是主锚点，状态 id 只是派生字段；重新切分画面不会破坏已有清单。

## 四道校验（不过则退出码 2）

1. `visual_partition`：状态 + 转移覆盖整段，误差 < 0.05 秒；
2. `states_labeled`：每个状态都有语音/OCR/高分辨率标签；
3. `speech_gaps_labeled`：>3 秒的语音缺口进 `gaps[]`；
4. `units`：语义词元可统计、可回查；
5. `attention_reported`：每个状态都有注意力代理（只报告，不参与通过/失败）。
6. `chapters_partition`：章节恰好覆盖全部状态、首尾相接（语义章节按 URL 切换 + 话题低谷生成）。

## 内容类型

| 模式 | 判据 | 语义骨架 |
|---|---|---|
| `screen`（auto 默认） | 变化占比 <40% | 视觉状态机为主，语音打标签 |
| `action`（auto 切） | 变化占比 ≥40% | 语音切语义步骤，画面状态当证据 |
| `talk`（仅显式） | — | 只做语义词元，跳过 OCR |

## 动作类型库

`src/event_build/data/action-library.json` + `event-build actions`：特征（像素差、位移、文本重合）→ 规则匹配 → 未命中按模式聚类 → 命名后写回库。两支测试视频的分布与人工抽检见 `legacy/action-summary.md`。

## 测试

```powershell
.venv\Scripts\python.exe -m pytest -q
```

7 个用例：golden 回归（126 状态 / 125 转移 / 380 语元、四道校验、schema 版本）、切分分区与确定性、语元跨停顿合并、对齐缺口、转写窗口、动作分类与聚类。

## DSH 插件

`plugin/` 是把它注册成模型工具的 cordis 插件：工具 `build_video_event`，Config 暴露 pythonPath / modelPath / defaultOutDir / timeoutMs / fps / sceneTh。

```powershell
cd D:\DSHHome\profiles\desktop
npm install --install-links --legacy-peer-deps "file:D:\agent\event-tool\plugin"
```

再在 `cordis.patch.yml` 加 `event-video` 条目；**loaders 只在启动时读取配置，重启 DSH 后才生效**。细节与验证见 `plugin/README.md` 与 `day2-report.md`。

## 已知局限

- OCR 标签在艺术字上会错（ORIMODO→ORMO0O），靠语音标签兜底；
- 1 fps 会漏掉小于 1 秒的操作；
- `url_hint` 依赖地址栏可见，全屏/加载中为空；
- 动作库目前只有 screen/action 两套规则，长尾动作靠聚类+命名积累；
- 多人会议没做说话人分离；
- 还没做成 DSH 插件（Day 2）：无 tool 注册、无 Config schema、无卡片、无 session 事件。

## 目录

```
pyproject.toml
src/event_build/   cli.py / pipeline.py / asr.py / actions.py / data/
tests/             test_pipeline.py / test_actions.py / golden/
legacy/            原型脚本与手工验证报告（保留追溯）
```
