# Architecture

## 1. 视频 → 事件记录（engine/event-build）

```
ffmpeg 1fps ──► pHash 差分 ──► 画面状态 states + 转移 transitions
                    │
                    ├──► 代表帧 OCR（RapidOCR）──► label
                    ├──► 状态起点高分辨率 OCR ──► label_hi / url_hint / tab_hint
                    └──► 语音（transcript 或本地 ASR）──► units（语义句元）
                                                        │
align(units, transitions) ──► 动作/指代对齐、延迟统计
chapters(states, units)   ──► 页面切换 + 话题低谷切章
attention(states, units)  ──► 停留 + 指代 + 动作 + 微交互
```

输出 `event.json`：

| 字段 | 说明 |
|---|---|
| `states[]` | 画面状态：`t0/t1`、`label`、`label_speech`、`label_hi`、`url_hint`、`attention` |
| `transitions[]` | 状态转移：起止、变化量、类型 |
| `units[]` | 语义词元：时间、文本、对齐到的转移 |
| `chapters[]` | 语义章节：起止、`reason`（url/topic）、dwell、attention |
| `gaps[]` | >3 秒语音缺口 |
| `gates` | 视觉分区 / 状态标签 / 语音缺口 / 语元 / 章节分区 校验 |

## 2. DSH 工具插件（plugin/）

无外部依赖（只用 Node 内置模块），注册 `build_video_event`，调用 `python -m event_build.cli`，返回摘要文本 + `presentationMeta.timeline` 供界面卡片渲染。

## 3. 界面插件（bundle/）

一个侧栏入口「视频审阅」，四个标签：

- **审阅**：`<video>` + 同步章节/状态/转写；播放器时间驱动所有面板。
- **总览**：Gantt 泳道、章节表、注意力、页面分布。
- **库**：缩略图网格、搜索、标签、对比、改名/删除/回收站、构建队列。
- **摄像头**：反射监控的开始/停止、抓拍、事件流。

Host 半边注册本地 HTTP 路由（`/event-video/*`、`/camera/*`）并用 HTTP Range 提供视频流，因此浏览器可以拖动播放本地文件，不需要转码。

## 4. 反射摄像头（camera/）

15fps DirectShow 采集 → 每 3 帧分析一次（≈5Hz）：帧差运动、亮度、直方图场景变化、肤色主体；事件与关键帧写入 `events.jsonl`，状态写入 `state.json`。模型工具只在事件时被唤醒。

## 5. 存储

```
<records>/<recordId>/event.json     不可变记录
<records>/<recordId>/review.json    video / title / tags
<records>/<recordId>/thumb.jpg      封面
<records>/index.json                库索引（自动重建）
<cache>/<videoId>/cache.json        转写/帧复用
```

构建先写 `<out>.tmp-<job>`，成功后 rename（原子写）；`_trash/` 为软删除回收站，索引跳过。
