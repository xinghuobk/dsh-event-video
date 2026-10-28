> **Every second, accounted for. 每一秒，都有据可查。** See the [project README](../README.md) for the full introduction.

# dsh-event-video（DSH 插件）

把 `event-build` 注册成一个模型可调用的工具：`build_video_event`。

## 注册内容

- 工具名：`build_video_event`
- 参数：`video`（必填）、`out`、`transcript`、`asr`、`asr_device`、`language`、`duration`、`mode`、`hi_labels`
- 返回 JSON 摘要：`out / mode / frames / states / transitions / units / chapters / gaps / attention_top / alignment / gates`
  - `chapters`：按 URL 切换 + 话题低谷切出的章节数
  - `attention_top`：注意力最高的状态（`t0/t1/emphasis/url`）
- 呈现：走通用工具卡片（未实现自定义客户端卡片）
- 版本：0.4.0（无依赖，仅 Node 内置模块）

## Config

| 字段 | 默认 | 说明 |
|---|---|---|
| `pythonPath` | `python` | 装了 event-build 的解释器 |
| `modelPath` | 空 | 本地 faster-whisper 模型目录（用 `asr` 时必填） |
| `asrDevice` | `cpu` | ASR 设备；默认 CPU，避免 GPU 长任务触发整机硬复位 |
| `language` | `zh` | ASR 语言 |
| `defaultOutDir` | 空 | 未传 `out` 时的输出根目录 |
| `timeoutMs` | 1800000 | 单次构建硬超时 |
| `fps` | 1 | 抽帧频率 |
| `sceneTh` | 9 | pHash 变化阈值 |
| `maxDurationSec` | 0 | 超长拒绝（0=不限） |

## 安装

```powershell
cd D:\DSHHome\profiles\desktop
npm install --install-links --legacy-peer-deps "file:D:\agent\event-tool\plugin"
```

`--install-links` 必须加：默认的符号链接会按真实路径解析，导致依赖找不到。

然后在 `cordis.patch.yml` 追**insert 行**（新条目必须放在 `insert:` 列表里；顶层的普通行只按 id 覆盖已有条目，找不到就静默跳过）：

```yaml
- insert:
    - id: event-video
      name: ./node_modules/dsh-event-video/lib/index.js
      config:
        pythonPath: D:\agent\event-tool\.venv\Scripts\python.exe
        modelPath: D:\agent\video-run\whisper-large-v3
        defaultOutDir: D:\agent\video-events
```

两个必须遵守的约束：

1. **名字用相对路径**：裸包名（`dsh-event-video`）不会加载——loader 从应用安装目录（app.asar）解析裸名，profile 的 `node_modules` 不参与；相对路径按 `cordis.yml` 所在目录解析。
2. **必须用 `insert:`**：patch 层的普通行是"按 id 覆盖"，不会新增条目。

插件不导入任何 `@deepseek-ai/*` 包（只用 Node 内置模块），因为 profile 的共享依赖回退指向旧版 Harness API；工具定义以普通对象交给 `ctx.tools.register`。

## 激活

loaders 只在**启动时**读取 `cordis.patch.yml`；改完需要重启 DSH 才会出现 `build_video_event` 工具。运行中的会话不会热加载。

## 验证

```powershell
node D:\agent\event-tool\plugin\tests\smoke.mjs        # 注册 + 40 秒构建 + gates
node D:\agent\event-tool\plugin\tests\integration.mjs  # 附加：chapters / attention / schema 断言
```

冒烟会：校验 Config 默认值 → 用桩 ctx 调 `apply` 确认注册 → 真实执行 40 秒切片 → 断言 `gates == PASS`。

集成测试额外断言：摘要带 `chapters` 与 `attention_top`；`event.json` 的 `chapters_partition.ok=true`；每个状态都有 `attention`；`schema_version=1`。

## 已知边界

- 没有自定义客户端卡片/面板，模型看到的是文本摘要；
- 没有额外的 session 事件类型：工具调用与结果由 tools/session 日志天然记录，但"事件记录"本身是文件产物，不进对话日志；
- 重启前不可用（无热加载）。
