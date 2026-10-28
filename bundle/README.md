# @local/dsh-event-video-card

视频审阅工作台：对话卡片 + 左侧栏「视频审阅」（唯一入口），内置播放器、同步转写、总览时间线、视频库与构建队列。

## 面板结构

一个入口，三个标签：

- **审阅**：视频播放器（原生播放/拖动条 + 倍速/±5s/上一章下一章/全屏/键盘快捷键），右侧同步显示当前章节、当前画面标签、滚动转写（当前句高亮，点击跳转）。
- **总览**：Gantt 泳道时间线（按页面分道）、章节表、注意力 Top、页面分布。
- **库**：缩略图网格、搜索（标题/源文件/标签）、标签编辑、双记录对比、构建队列与新建表单。

## 数据与并发

- **身份**：`videoId`（源文件）+ `recordId`（一次构建）+ 章节/状态条目。
- **库索引**：`D:\agent\video-events\index.json`，构建完成或改标签后自动重建。
- **队列**：Host 端最多 2 个并行构建；每个任务先写 `<out>.tmp-<job>`，成功后 rename 为正式目录（原子写），失败清理临时目录；状态与进度通过 `/event-video/jobs` 暴露。
- **视频级缓存**：`D:\agent\video-cache\<videoId>\cache.json` 记录复用用的基础事件目录（`--reuse`，复用帧/OCR）与转写文件路径（避免重复 ASR）。
- **关联文件**：`review.json`（video/title/tags）、`thumb.jpg`（封面）、`event.json`（不可变记录）。

## 路由（Host 端）

| 路由 | 说明 |
|---|---|
| `GET /event-video/records` | 库索引（缩略图/标题/标签/统计） |
| `GET /event-video/data?out=` | 单条记录 event.json + review.json |
| `GET /event-video/media?path=` | 视频流（HTTP Range，可拖动） |
| `GET /event-video/thumb?path=` | 封面图 |
| `GET /event-video/jobs` | 构建队列状态 |
| `POST /event-video/enqueue` | 加入构建（video/transcript/asr/hiLabels/mode/duration） |
| `POST /event-video/tags` | 设置记录标签 |
| `POST /event-video/rename` | 改标题 |
| `POST /event-video/delete` | 删除（默认软删到 `_trash`，`hard:true` 永久删除） |
| `POST /event-video/reveal` | 在资源管理器中打开记录目录 |
| `GET /event-video/trash` | 回收站列表 |
| `POST /event-video/restore` | 从回收站恢复 |

## 安装

本目录是 workspace 源，用 `plugin_manager` 的 `install_bundle` 安装（target 为本目录），不要手写 profile 的 `package.json` / `cordis.patch.yml`。

前提：`build_video_event` 的工具输出带 `timeline` 元数据（event-video 插件 v0.5+），且构建会写 `review.json`。

## 已知限制

- 队列在内存中：进程重启后队列状态丢失（已完成的记录仍在磁盘）。
- 对比目前是统计层（时长/章节/状态/语元/校验），不是逐章差异。
- 仅 mp4；封面用 ffmpeg 抽帧；标签通过 `window.prompt` 编辑。
