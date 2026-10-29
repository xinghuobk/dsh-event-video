/** Host half of the event-video-card bundle: library, media, and a bounded build queue. */
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, promises as fs } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))
const PYTHON_DEFAULT = process.platform === 'win32' ? 'python' : 'python3'
const CAMERA_SCRIPT = join(PACKAGE_DIR, 'camera-monitor.py')
const MAX_WORKERS = 2

let HOME = ''
let RECORDS_DIR = ''
let CACHE_DIR = ''
let CAMERA_DIR = ''
let PYTHON = PYTHON_DEFAULT
let DEFAULT_WHISPER = ''
let CAMERA_DEVICE = 'video=Default'
let ROOTS = []
let ANNOTATIONS_ENABLED = true
let WORK_ITEMS_ENABLED = true
let VLM_ENDPOINT = ''
let VLM_MODEL = 'qwen2.5vl'
let VLM_THINK_MODEL = 'qwen3-vl:8b'
let VLM_API_KEY = ''
let VLM_TIMEOUT_MS = 60000
let VLM_ENABLED = true
let MEDIAPIPE_DIR = ''
let CAMERA_SIGNALS = true
let VOICE_ENABLED = true
let TTS_COMMAND = ''
let TTS_ENDPOINT = ''
let TTS_MODEL = 'tts-1'
let TTS_VOICE = 'alloy'
let TTS_API_KEY = ''
let TTS_ARGS = []
let OCR_ENABLED = true
let OCR_COMMAND = ''
let OCR_SCRIPT = ''
let OCR_ARGS = []
let GROUND_ENABLED = true
let GROUND_COMMAND = ''
let GROUND_SCRIPT = ''
let GROUND_ARGS = []
let GROUND_ENDPOINT = 'http://127.0.0.1:8081/v1/chat/completions'
let GROUND_ALIAS = 'ui-tars'

function defaultHome() {
  if (process.env.DSH_EVENT_VIDEO_HOME) return resolve(process.env.DSH_EVENT_VIDEO_HOME)
  return join(os.homedir(), 'event-video')
}

function splitRoots(value) {
  if (!value) return []
  return String(value).split(/[;\n]/).map((entry) => entry.trim()).filter(Boolean)
}

function configure(config = {}) {
  HOME = resolve(config.dataHome || config.home || defaultHome())
  RECORDS_DIR = config.recordsDir ? resolve(config.recordsDir) : join(HOME, 'video-events')
  CACHE_DIR = config.cacheDir ? resolve(config.cacheDir) : join(HOME, 'video-cache')
  CAMERA_DIR = config.cameraDir ? resolve(config.cameraDir) : join(HOME, 'camera')
  PYTHON = config.pythonPath || process.env.DSH_EVENT_VIDEO_PYTHON || PYTHON_DEFAULT
  DEFAULT_WHISPER = config.whisperModel || process.env.DSH_EVENT_VIDEO_WHISPER || ''
  CAMERA_DEVICE = config.cameraDevice || process.env.DSH_EVENT_VIDEO_CAMERA_DEVICE || 'video=Default'
  ANNOTATIONS_ENABLED = config.enableAnnotations !== false && process.env.DSH_EVENT_VIDEO_ANNOTATIONS !== '0'
  WORK_ITEMS_ENABLED = config.enableWorkItems !== false && process.env.DSH_EVENT_VIDEO_WORK_ITEMS !== '0'
  VLM_ENDPOINT = config.vlmEndpoint || process.env.DSH_EVENT_VIDEO_VLM_ENDPOINT || ''
  VLM_MODEL = config.vlmModel || process.env.DSH_EVENT_VIDEO_VLM_MODEL || 'qwen2.5vl'
  VLM_THINK_MODEL = config.vlmThinkModel || process.env.DSH_EVENT_VIDEO_VLM_THINK_MODEL || 'qwen3-vl:8b'
  VLM_API_KEY = config.vlmApiKey || process.env.DSH_EVENT_VIDEO_VLM_API_KEY || ''
  VLM_TIMEOUT_MS = Number(config.vlmTimeoutMs || process.env.DSH_EVENT_VIDEO_VLM_TIMEOUT_MS || 60000)
  VLM_ENABLED = config.enableVlm !== false && process.env.DSH_EVENT_VIDEO_VLM !== '0'
  MEDIAPIPE_DIR = resolve(config.mediapipeDir || process.env.DSH_EVENT_VIDEO_MEDIAPIPE_DIR || join(HOME, 'models', 'mediapipe'))
  CAMERA_SIGNALS = config.enableCameraSignals !== false && process.env.DSH_EVENT_VIDEO_CAMERA_SIGNALS !== '0'
  VOICE_ENABLED = config.enableVoice !== false && process.env.DSH_EVENT_VIDEO_VOICE !== '0'
  TTS_COMMAND = config.ttsCommand || process.env.DSH_EVENT_VIDEO_TTS_COMMAND || ''
  TTS_ENDPOINT = config.ttsEndpoint || process.env.DSH_EVENT_VIDEO_TTS_ENDPOINT || ''
  TTS_MODEL = config.ttsModel || process.env.DSH_EVENT_VIDEO_TTS_MODEL || 'tts-1'
  TTS_VOICE = config.ttsVoice || process.env.DSH_EVENT_VIDEO_TTS_VOICE || 'alloy'
  TTS_API_KEY = config.ttsApiKey || process.env.DSH_EVENT_VIDEO_TTS_API_KEY || ''
  TTS_ARGS = Array.isArray(config.ttsArgs)
    ? config.ttsArgs.map(String)
    : String(process.env.DSH_EVENT_VIDEO_TTS_ARGS || '').split('|').filter(Boolean)
  OCR_ENABLED = config.enableOcr !== false && process.env.DSH_EVENT_VIDEO_OCR !== '0'
  OCR_COMMAND = config.ocrCommand || process.env.DSH_EVENT_VIDEO_OCR_COMMAND || ''
  OCR_SCRIPT = config.ocrScript || process.env.DSH_EVENT_VIDEO_OCR_SCRIPT || ''
  OCR_ARGS = Array.isArray(config.ocrArgs)
    ? config.ocrArgs.map(String)
    : String(process.env.DSH_EVENT_VIDEO_OCR_ARGS || '').split('|').filter(Boolean)
  GROUND_ENABLED = config.enableGround !== false && process.env.DSH_EVENT_VIDEO_GROUND !== '0'
  GROUND_COMMAND = config.groundCommand || process.env.DSH_EVENT_VIDEO_GROUND_COMMAND || ''
  GROUND_SCRIPT = config.groundScript || process.env.DSH_EVENT_VIDEO_GROUND_SCRIPT || ''
  GROUND_ARGS = Array.isArray(config.groundArgs)
    ? config.groundArgs.map(String)
    : String(process.env.DSH_EVENT_VIDEO_GROUND_ARGS || '').split('|').filter(Boolean)
  GROUND_ENDPOINT = config.groundEndpoint || process.env.DSH_EVENT_VIDEO_GROUND_ENDPOINT || 'http://127.0.0.1:8081/v1/chat/completions'
  GROUND_ALIAS = config.groundAlias || process.env.DSH_EVENT_VIDEO_GROUND_ALIAS || 'ui-tars'
  const extra = splitRoots(config.extraRoots || process.env.DSH_EVENT_VIDEO_ROOTS)
  ROOTS = [...new Set([
    HOME, RECORDS_DIR, CACHE_DIR, CAMERA_DIR,
    join(os.homedir(), 'Downloads'), join(os.homedir(), 'Videos'),
    ...extra,
  ].map((entry) => resolve(entry)))]
}

configure()

const jobs = new Map()
const pending = []
let active = 0
let cameraChild = null
let cameraDesired = false
let cameraStarting = false
let cameraRestartTimer = null
let cameraRestartAttempts = 0

function logCamera(line) {
  try {
    fs.appendFile(join(CAMERA_DIR, 'host-camera.log'), `${new Date().toISOString()} ${line}\n`).catch(() => {})
  } catch {
    /* diagnostics are best-effort */
  }
}

function insideRoots(path) {
  const full = resolve(path)
  return ROOTS.some((root) => full === root || full.startsWith(root + sep))
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
  res.end(body)
}

async function readBody(req, limit = 1_000_000) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolveBody(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || '')
  if (!match) return null
  let start = match[1] === '' ? null : Number(match[1])
  let end = match[2] === '' ? null : Number(match[2])
  if (start === null && end === null) return null
  if (start === null) {
    start = Math.max(0, size - end)
    end = size - 1
  } else if (end === null) {
    end = size - 1
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null
  return { start, end: Math.min(end, size - 1) }
}

function videoIdOf(path) {
  return createHash('sha1').update(path).digest('hex').slice(0, 12)
}

async function readCache(id) {
  try {
    return JSON.parse(await fs.readFile(join(CACHE_DIR, id, 'cache.json'), 'utf8'))
  } catch {
    return null
  }
}

async function writeCache(id, data) {
  const dir = join(CACHE_DIR, id)
  await fs.mkdir(dir, { recursive: true })
  const tmp = join(dir, 'cache.json.tmp')
  await fs.writeFile(tmp, JSON.stringify({ ...data, updated: new Date().toISOString() }, null, 2))
  await fs.rename(tmp, join(dir, 'cache.json'))
}

async function runPython(script, args, onLine) {
  return new Promise((resolveRun) => {
    const command = script ? [script, ...args] : args
    const child = spawn(PYTHON, command, { windowsHide: true })
    let tail = []
    const consume = (data) => {
      for (const line of String(data).split(/\r?\n/)) {
        if (line.trim() === '') continue
        tail.push(line)
        if (tail.length > 200) tail = tail.slice(-200)
        if (onLine) onLine(line)
      }
    }
    child.stdout.on('data', consume)
    child.stderr.on('data', consume)
    child.on('error', (error) => resolveRun({ code: -1, tail, error: String(error) }))
    child.on('close', (code) => resolveRun({ code, tail }))
  })
}

async function buildLibraryIndex() {
  const items = []
  let entries = []
  try {
    entries = await fs.readdir(RECORDS_DIR, { withFileTypes: true })
  } catch {
    entries = []
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.endsWith('.tmp')) continue
    const dir = join(RECORDS_DIR, entry.name)
    try {
      const stat = await fs.stat(join(dir, 'event.json'))
      const event = JSON.parse(await fs.readFile(join(dir, 'event.json'), 'utf8'))
      let review = {}
      try {
        review = JSON.parse(await fs.readFile(join(dir, 'review.json'), 'utf8'))
      } catch {
        /* optional sidecar */
      }
      const video = review.video || null
      const duration = Number(event.span_s || 0)
      const thumb = join(dir, 'thumb.jpg')
      let hasThumb = true
      try {
        await fs.access(thumb)
      } catch {
        hasThumb = false
      }
      if (!hasThumb && video && existsSync(video)) {
        await new Promise((resolveThumb) => {
          const seek = Math.max(1, Math.min(duration * 0.1 || 5, 90))
          const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(seek),
            '-i', video, '-frames:v', '1', '-vf', 'scale=360:-1', '-y', thumb],
          { windowsHide: true, stdio: 'ignore' })
          child.on('close', resolveThumb)
          child.on('error', resolveThumb)
        })
        try {
          await fs.access(thumb)
          hasThumb = true
        } catch {
          hasThumb = false
        }
      }
      const identity = video || entry.name
      items.push({
        id: createHash('sha1').update(dir + '|' + identity).digest('hex').slice(0, 12),
        videoId: createHash('sha1').update(identity).digest('hex').slice(0, 12),
        out: dir,
        title: review.title || entry.name,
        dir: entry.name,
        tags: Array.isArray(review.tags) ? review.tags : [],
        source: video ? video.split(/[\\/]/).pop() : '',
        video,
        duration: Math.round(duration * 10) / 10,
        mode: event.mode || '',
        states: event.states ? event.states.length : 0,
        units: event.units ? event.units.length : 0,
        chapters: event.chapters ? event.chapters.length : 0,
        gaps: event.gaps ? event.gaps.length : 0,
        gates: Boolean(event.gates && event.gates.all_ok),
        thumb: hasThumb ? thumb : null,
        created: new Date(stat.mtimeMs).toISOString(),
        updated: new Date(stat.mtimeMs).toISOString(),
      })
    } catch {
      /* not an event record */
    }
  }
  items.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''))
  await fs.mkdir(RECORDS_DIR, { recursive: true }).catch(() => {})
  await fs.writeFile(join(RECORDS_DIR, 'index.json'), JSON.stringify({ version: 1, items }, null, 1))
  return items
}

async function refreshIndex() {
  try {
    await buildLibraryIndex()
  } catch {
    /* the index is best-effort; the record still exists on disk */
  }
}

async function listRecords() {
  try {
    const index = JSON.parse(await fs.readFile(join(RECORDS_DIR, 'index.json'), 'utf8'))
    if (Array.isArray(index.items) && index.items.length > 0) return index.items
  } catch {
    /* no index yet: fall back to scanning event dirs */
  }
  const entries = await fs.readdir(RECORDS_DIR, { withFileTypes: true })
  const rows = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.endsWith('.tmp') || entry.name.startsWith('_')) continue
    const dir = join(RECORDS_DIR, entry.name)
    try {
      const stat = await fs.stat(join(dir, 'event.json'))
      const event = JSON.parse(await fs.readFile(join(dir, 'event.json'), 'utf8'))
      let video = null
      let title = entry.name
      try {
        const review = JSON.parse(await fs.readFile(join(dir, 'review.json'), 'utf8'))
        video = review.video ?? null
        title = review.title || entry.name
      } catch {
        /* older records have no review sidecar */
      }
      rows.push({
        id: createHash('sha1').update(dir).digest('hex').slice(0, 12),
        out: dir,
        name: entry.name,
        title,
        mtime: stat.mtimeMs,
        mode: event.mode ?? '',
        states: event.states?.length ?? 0,
        units: event.units?.length ?? 0,
        chapters: event.chapters?.length ?? 0,
        span: event.span_s ?? 0,
        duration: event.span_s ?? 0,
        gates: event.gates?.all_ok === true,
        video,
        thumb: null,
      })
    } catch {
      /* not an event record */
    }
  }
  return rows.sort((a, b) => b.mtime - a.mtime)
}

function frameNameFor(event, t) {
  const fps = Number(event.fps || 1)
  const start = Number(event.start || 0)
  return `f_${String(Math.max(1, Math.round((Number(t) - start) * fps) + 1)).padStart(6, '0')}.jpg`
}

function annotationsPath(out) {
  return join(out, 'annotations.json')
}

function normalizeWorkItems(items) {
  if (!Array.isArray(items)) throw new Error('items must be an array')
  return items.map((raw, index) => {
    const title = String(raw.title ?? raw.text ?? '').trim()
    if (!title) throw new Error(`item ${index + 1} is missing a title`)
    const priority = ['P0', 'P1', 'P2'].includes(raw.priority) ? raw.priority : 'P1'
    return {
      title: title.slice(0, 200),
      detail: String(raw.detail ?? '').slice(0, 1000),
      priority,
      owner: String(raw.owner ?? '').slice(0, 60),
      t0: Number.isFinite(Number(raw.t0)) ? Number(raw.t0) : null,
      t1: Number.isFinite(Number(raw.t1)) ? Number(raw.t1) : null,
      frame: raw.frame ? String(raw.frame) : null,
      quote: String(raw.quote ?? '').slice(0, 500),
      acceptance: String(raw.acceptance ?? '').slice(0, 500),
      source: String(raw.source ?? 'manual').slice(0, 40),
    }
  })
}

async function workItemsFromRecord(out) {
  const event = await eventFor(out)
  const annotations = (await readAnnotations(out)).annotations || []
  const review = event.review || reviewEventRecord(event)
  const flags = Array.isArray(review.flags) ? review.flags : []
  const items = []
  for (const annotation of annotations) {
    items.push({
      title: annotation.text,
      detail: `来自 ${fmtClock(annotation.t0)} 的标注（${annotation.author || 'user'}）`,
      priority: annotation.kind === 'label' ? 'P2' : 'P1',
      t0: annotation.t0,
      t1: annotation.t1,
      frame: annotation.frame || null,
      quote: annotation.text,
      acceptance: `回到 ${fmtClock(annotation.t0)} 核对改动`,
      source: 'annotation',
    })
  }
  for (const flag of flags) {
    let anchor = null
    if (flag.code === 'url_missing_separators') {
      anchor = (event.states || []).find((state) => state.url_hint && flag.message.includes(state.url_hint)) || null
    } else if (flag.code === 'chapter_length_outlier') {
      const seconds = Number((flag.message.match(/(\d+)\s*s/) || [])[1])
      anchor = (event.chapters || []).find((chapter) => Number.isFinite(seconds) && Math.round(chapter.dwell) === seconds) || null
    }
    if (!anchor) {
      anchor = (event.states || []).reduce((best, state) => {
        const emphasis = state.attention ? state.attention.emphasis : 0
        return emphasis > (best ? (best.attention ? best.attention.emphasis : 0) : -1) ? state : best
      }, null)
    }
    const t0 = anchor && Number.isFinite(Number(anchor.t0)) ? Number(anchor.t0) : null
    items.push({
      title: `处理审阅标记：${flag.code}`,
      detail: flag.message,
      priority: flag.level === 'error' ? 'P0' : 'P1',
      t0,
      t1: anchor && Number.isFinite(Number(anchor.t1)) ? Number(anchor.t1) : null,
      frame: t0 !== null ? frameNameFor(event, t0) : null,
      quote: flag.message,
      acceptance: t0 !== null
        ? `回到 ${fmtClock(t0)} 核对并修复；记录重新构建后不再出现该标记`
        : '审阅标记消失，记录重新构建后不再出现该标记',
      source: 'review',
    })
  }
  return items
}

async function exportWorkItems(out, kind = 'tickets', items = null, options = {}) {
  if (!out || !insideRoots(out)) throw new Error('out is missing or outside allowed roots')
  const event = await eventFor(out)
  const title = options.title || out.split(/[\\/]/).pop()
  let normalized
  if (Array.isArray(items) && items.length > 0) {
    normalized = normalizeWorkItems(items)
  } else if (kind === 'sop') {
    const chapters = event.chapters || []
    normalized = chapters.map((chapter, index) => ({
      title: chapter.url ? `页面：${chapter.url}` : `步骤 ${index + 1}`,
      detail: chapter.reason === 'url' ? '页面切换点' : '话题段落，按时间顺序复现',
      priority: 'P1',
      t0: chapter.t0,
      t1: chapter.t1,
      frame: frameNameFor(event, chapter.t0),
      quote: '',
      acceptance: `按 ${fmtClock(chapter.t0)}–${fmtClock(chapter.t1)} 复现并核对画面`,
      source: 'chapter',
    }))
  } else {
    normalized = await workItemsFromRecord(out)
  }
  if (normalized.length === 0) {
    throw new Error('no action items found: add annotations or pass items explicitly')
  }
  normalized.sort((a, b) => (a.t0 ?? Number.MAX_SAFE_INTEGER) - (b.t0 ?? Number.MAX_SAFE_INTEGER))

  const formats = Array.isArray(options.formats) && options.formats.length > 0 ? options.formats : ['md', 'csv', 'json']
  const dir = join(HOME, 'exports', `${kind}-${title.replace(/[\\/:*?"<>|]/g, '_')}-${Date.now()}`)
  await fs.mkdir(dir, { recursive: true })
  const files = []
  if (formats.includes('md')) {
    const lines = [
      `# ${kind === 'sop' ? 'SOP' : '工单'}：${title}`,
      '',
      `- 来源记录：${out}`,
      `- 生成时间：${new Date().toISOString()}`,
      `- 条目数：${normalized.length}`,
      '',
    ]
    if (kind === 'sop') {
      lines.push('| 步骤 | 时间 | 内容 | 证据帧 | 验收 |', '|---|---|---|---|---|')
      normalized.forEach((item, index) => {
        lines.push(`| ${index + 1} | ${fmtClock(item.t0)}–${fmtClock(item.t1)} | ${item.title} ${item.detail} | ${item.frame || '—'} | ${item.acceptance || '—'} |`)
      })
    } else {
      normalized.forEach((item, index) => {
        lines.push(`## ${index + 1}. [${item.priority}] ${item.title}`, '')
        if (item.t0 !== null) lines.push(`- 时间：${fmtClock(item.t0)}${item.t1 !== null ? '–' + fmtClock(item.t1) : ''}`)
        if (item.frame) lines.push(`- 证据帧：${item.frame}`)
        if (item.detail) lines.push(`- 详情：${item.detail}`)
        if (item.quote) lines.push(`- 原话：${item.quote}`)
        lines.push(`- 验收：${item.acceptance || '按证据帧核对改前/改后'}`)
        lines.push(`- 来源：${item.source}`)
        lines.push('')
      })
    }
    const target = join(dir, kind === 'sop' ? 'sop.md' : 'tickets.md')
    await fs.writeFile(target, lines.join('\n'))
    files.push(target)
  }
  if (formats.includes('csv')) {
    const header = ['title', 'priority', 'time', 'frame', 'detail', 'quote', 'acceptance', 'source']
    const rows = normalized.map((item) => [
      item.title, item.priority, item.t0 === null ? '' : fmtClock(item.t0),
      item.frame || '', item.detail, item.quote, item.acceptance, item.source,
    ].map(csvEscape).join(','))
    const target = join(dir, kind === 'sop' ? 'sop.csv' : 'tickets.csv')
    await fs.writeFile(target, [header.join(','), ...rows].join('\n'))
    files.push(target)
  }
  if (formats.includes('json')) {
    const target = join(dir, kind === 'sop' ? 'sop.json' : 'tickets.json')
    await fs.writeFile(target, JSON.stringify({ kind, title, out, generatedAt: new Date().toISOString(), items: normalized }, null, 1))
    files.push(target)
  }
  return { ok: true, kind, dir, files, count: normalized.length }
}

async function readAnnotations(out) {
  if (!insideRoots(out)) throw new Error('path outside allowed roots')
  try {
    const data = JSON.parse(await fs.readFile(annotationsPath(out), 'utf8'))
    return { version: 1, annotations: Array.isArray(data.annotations) ? data.annotations : [] }
  } catch {
    return { version: 1, annotations: [] }
  }
}

async function writeAnnotations(out, data) {
  const target = annotationsPath(out)
  const tmp = `${target}.tmp-${randomUUID().slice(0, 8)}`
  await fs.writeFile(tmp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), annotations: data.annotations }, null, 1))
  await fs.rename(tmp, target)
}

async function eventFor(out) {
  return JSON.parse(await fs.readFile(join(out, 'event.json'), 'utf8'))
}

function normalizeAnnotation(input) {
  const t0 = Number(input.t0)
  if (!Number.isFinite(t0) || t0 < 0) throw new Error('t0 must be a non-negative number of seconds')
  const t1 = input.t1 === undefined || input.t1 === null || input.t1 === '' ? t0 : Number(input.t1)
  if (!Number.isFinite(t1)) throw new Error('t1 must be a number of seconds')
  const text = String(input.text ?? '').trim()
  if (!text) throw new Error('text is required')
  if (text.length > 500) throw new Error('text is limited to 500 characters')
  const kind = input.kind === 'label' ? 'label' : 'note'
  return {
    id: randomUUID(),
    kind,
    t0,
    t1: Math.max(t0, t1),
    text,
    author: String(input.author || 'user').slice(0, 40),
    createdAt: new Date().toISOString(),
  }
}

async function addAnnotation(out, input) {
  if (!out || !insideRoots(out)) throw new Error('out is missing or outside allowed roots')
  const event = await eventFor(out)
  const data = await readAnnotations(out)
  const annotation = normalizeAnnotation(input)
  annotation.frame = frameNameFor(event, annotation.t0)
  data.annotations.push(annotation)
  await writeAnnotations(out, data)
  return { ok: true, annotation, annotations: data.annotations }
}

async function updateAnnotation(out, id, patch) {
  if (!out || !insideRoots(out)) throw new Error('out is missing or outside allowed roots')
  const data = await readAnnotations(out)
  const index = data.annotations.findIndex((item) => item.id === id)
  if (index < 0) throw new Error('annotation not found')
  const current = data.annotations[index]
  const merged = normalizeAnnotation({ ...current, ...patch, t0: patch.t0 ?? current.t0, t1: patch.t1 ?? current.t1 })
  merged.id = current.id
  merged.createdAt = current.createdAt
  merged.updatedAt = new Date().toISOString()
  merged.frame = frameNameFor(await eventFor(out), merged.t0)
  data.annotations[index] = merged
  await writeAnnotations(out, data)
  return { ok: true, annotation: merged, annotations: data.annotations }
}

async function deleteAnnotation(out, id) {
  if (!out || !insideRoots(out)) throw new Error('out is missing or outside allowed roots')
  const data = await readAnnotations(out)
  const before = data.annotations.length
  data.annotations = data.annotations.filter((item) => item.id !== id)
  if (data.annotations.length === before) throw new Error('annotation not found')
  await writeAnnotations(out, data)
  return { ok: true, annotations: data.annotations }
}

function planVisionFrames(event, limit = 24) {
  const states = [...(event.states || [])].sort((a, b) => a.t0 - b.t0)
  if (states.length === 0) return []
  const cap = Math.max(1, Math.min(120, Number(limit) || 24))
  const picked = new Map()
  const top = [...states]
    .sort((a, b) => (b.attention ? b.attention.emphasis : 0) - (a.attention ? a.attention.emphasis : 0))
    .slice(0, Math.min(3, cap))
  for (const state of top) picked.set(state.t0, state)
  const stride = Math.max(1, Math.ceil(states.length / cap))
  for (let index = 0; index < states.length && picked.size < cap; index += stride) {
    picked.set(states[index].t0, states[index])
  }
  return [...picked.values()]
    .sort((a, b) => a.t0 - b.t0)
    .map((state) => ({ t0: state.t0, frame: frameNameFor(event, state.t0) }))
}

async function callVlmDescription(imageBase64, prompt, options = {}) {
  if (!VLM_ENDPOINT) throw new Error('VLM is not configured: set vlmEndpoint / DSH_EVENT_VIDEO_VLM_ENDPOINT (Ollama or an OpenAI-compatible endpoint)')
  const ollama = /\/api\/chat\/?$/.test(VLM_ENDPOINT)
  const headers = { 'content-type': 'application/json' }
  if (VLM_API_KEY) headers.authorization = `Bearer ${VLM_API_KEY}`
  const model = options.model || VLM_MODEL
  const think = options.think === true
  const numPredict = think ? 4096 : 1024
  const body = ollama
    ? {
      model,
      messages: [{ role: 'user', content: prompt, images: [imageBase64] }],
      stream: false,
      think,
      options: { temperature: 0, num_predict: numPredict },
    }
    : {
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        ],
      }],
      max_tokens: think ? 1200 : 220,
      stream: false,
      ...(think ? { reasoning_effort: 'low' } : {}),
    }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), think ? Math.max(VLM_TIMEOUT_MS, 120000) : VLM_TIMEOUT_MS)
  try {
    const response = await fetch(VLM_ENDPOINT, {
      method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
    })
    if (!response.ok) throw new Error(`VLM HTTP ${response.status}`)
    const data = await response.json()
    let text = ollama ? data.message && data.message.content : data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content
    if (!text && ollama && data.message && data.message.thinking) {
      throw new Error('model returned thinking only; increase num_predict or use a non-thinking model')
    }
    return { text: String(text || '').trim().slice(0, 800), thinking: think }
  } finally {
    clearTimeout(timer)
  }
}

function visionPath(out) {
  return join(out, 'vision.json')
}

async function readVision(out) {
  if (!insideRoots(out)) throw new Error('path outside allowed roots')
  try {
    return JSON.parse(await fs.readFile(visionPath(out), 'utf8'))
  } catch {
    return { version: 1, descriptions: [] }
  }
}

function planKeyVisionFrames(event, limit = 6, extraTimes = []) {
  const states = [...(event.states || [])].sort((a, b) => a.t0 - b.t0)
  if (states.length === 0) return []
  const cap = Math.max(1, Math.min(40, Number(limit) || 6))
  const picked = new Map()
  const nearest = (t) => states.reduce((best, state) => {
    if (!best) return state
    return Math.abs(state.t0 - t) < Math.abs(best.t0 - t) ? state : best
  }, null)
  const addTime = (t) => {
    const state = nearest(Number(t))
    if (state) picked.set(state.t0, state)
  }
  const top = [...states]
    .sort((a, b) => (b.attention ? b.attention.emphasis : 0) - (a.attention ? a.attention.emphasis : 0))
    .slice(0, Math.min(3, cap))
  for (const state of top) addTime(state.t0)
  for (const chapter of event.chapters || []) {
    if (picked.size >= cap) break
    addTime(chapter.t0)
  }
  for (const time of extraTimes) {
    if (picked.size >= cap) break
    addTime(time)
  }
  const stride = Math.max(1, Math.ceil(states.length / cap))
  for (let index = 0; index < states.length && picked.size < cap; index += stride) {
    picked.set(states[index].t0, states[index])
  }
  return [...picked.values()]
    .sort((a, b) => a.t0 - b.t0)
    .map((state) => ({ t0: state.t0, frame: frameNameFor(event, state.t0) }))
}

async function describeRecord(out, options = {}) {
  if (!out || !insideRoots(out)) throw new Error('out is missing or outside allowed roots')
  if (!VLM_ENABLED) throw new Error('VLM descriptions are disabled')
  if (!VLM_ENDPOINT) throw new Error('VLM is not configured: set vlmEndpoint / DSH_EVENT_VIDEO_VLM_ENDPOINT (Ollama or an OpenAI-compatible endpoint)')
  const event = await eventFor(out)
  const think = options.think === true
  const keyFrames = options.keyFrames === true
  let annotationTimes = []
  try {
    annotationTimes = (await readAnnotations(out)).annotations.map((annotation) => annotation.t0)
  } catch {
    /* annotations are optional */
  }
  const frames = keyFrames
    ? planKeyVisionFrames(event, options.limit || 6, annotationTimes)
    : planVisionFrames(event, options.limit || 24)
  if (frames.length === 0) throw new Error('record has no states to describe')
  const model = options.model || (think ? VLM_THINK_MODEL : VLM_MODEL)
  const prompt = think
    ? '请仔细观察这张截图并思考：页面结构、可读文字、界面状态、以及它对用户意味着什么。然后用中文给出 2-3 句结论性描述，不要输出思考过程。'
    : '请用中文客观描述这张截图（1-2 句）：可见的页面区块、可读文字、明显的界面状态或变化。不要猜测。'
  const descriptions = []
  let failed = 0
  for (const item of frames) {
    const candidates = [join(out, 'frames', item.frame), join(out, 'frames-on-demand', item.frame)]
    let framePath = null
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        framePath = candidate
        break
      }
    }
    if (!framePath) {
      failed += 1
      continue
    }
    try {
      const base64 = (await fs.readFile(framePath)).toString('base64')
      const result = await callVlmDescription(base64, prompt, { model, think })
      if (result.text) descriptions.push({ t0: item.t0, frame: item.frame, description: result.text, thinking: result.thinking })
      else failed += 1
    } catch {
      failed += 1
    }
  }
  const data = {
    version: 1,
    model,
    think,
    keyFrames,
    createdAt: new Date().toISOString(),
    descriptions,
    failed,
  }
  const target = visionPath(out)
  const tmp = `${target}.tmp-${randomUUID().slice(0, 8)}`
  await fs.writeFile(tmp, JSON.stringify(data, null, 1))
  await fs.rename(tmp, target)
  return {
    ok: true,
    out,
    model,
    think,
    keyFrames,
    count: descriptions.length,
    failed,
    descriptions: descriptions.slice(0, 5),
  }
}

async function readRecord(out) {
  if (!insideRoots(out)) throw new Error('path outside allowed roots')
  const event = JSON.parse(await fs.readFile(join(out, 'event.json'), 'utf8'))
  let review = null
  try {
    review = JSON.parse(await fs.readFile(join(out, 'review.json'), 'utf8'))
  } catch {
    /* optional */
  }
  let annotations = []
  try {
    annotations = (await readAnnotations(out)).annotations
  } catch {
    /* optional */
  }
  let vision = { version: 1, descriptions: [] }
  try {
    vision = await readVision(out)
  } catch {
    /* optional */
  }
  return { event, review, annotations, vision }
}

async function serveMedia(req, res, url) {
  const path = url.searchParams.get('path')
  if (!path || !insideRoots(path)) {
    sendJson(res, 403, { error: 'path outside allowed roots' })
    return
  }
  const stat = await fs.stat(path)
  const range = parseRange(req.headers.range, stat.size)
  if (range === null) {
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': stat.size, 'accept-ranges': 'bytes' })
    createReadStream(path).pipe(res)
    return
  }
  res.writeHead(206, {
    'content-type': 'video/mp4',
    'content-length': range.end - range.start + 1,
    'content-range': `bytes ${range.start}-${range.end}/${stat.size}`,
    'accept-ranges': 'bytes',
  })
  createReadStream(path, { start: range.start, end: range.end }).pipe(res)
}

async function serveThumb(req, res, url) {
  const path = url.searchParams.get('path')
  if (!path || !insideRoots(path)) {
    sendJson(res, 403, { error: 'path outside allowed roots' })
    return
  }
  try {
    const bytes = await fs.readFile(path)
    res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': bytes.length, 'cache-control': 'max-age=300' })
    res.end(bytes)
  } catch {
    sendJson(res, 404, { error: 'thumbnail not found' })
  }
}

function jobSummary(job) {
  return {
    id: job.id,
    status: job.status,
    progress: job.progress,
    out: job.out,
    error: job.error,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    request: {
      video: job.request.video,
      mode: job.request.mode ?? 'auto',
      asr: job.request.asr === true,
      hiLabels: job.request.hiLabels === true,
      duration: job.request.duration ?? null,
    },
  }
}

function enqueue(request) {
  if (!request || typeof request.video !== 'string' || !insideRoots(request.video)) {
    throw new Error('video path is missing or outside allowed roots')
  }
  const job = {
    id: randomUUID(),
    status: 'queued',
    progress: '排队中',
    createdAt: Date.now(),
    startedAt: null,
    endedAt: null,
    out: null,
    error: null,
    request,
  }
  jobs.set(job.id, job)
  pending.push(job)
  pump()
  return job
}

function pump() {
  while (active < MAX_WORKERS && pending.length > 0) {
    const job = pending.shift()
    active += 1
    runJob(job).finally(() => {
      active -= 1
      pump()
    })
  }
}

async function runJob(job) {
  job.status = 'running'
  job.startedAt = Date.now()
  job.progress = '准备中'
  const req = job.request
  const vid = videoIdOf(req.video)
  const cache = await readCache(vid)
  const out = req.out && insideRoots(req.out)
    ? req.out
    : join(RECORDS_DIR, `build-${vid}-${String(job.startedAt).slice(-6)}`)
  const tmp = `${out}.tmp-${job.id.slice(0, 8)}`
  const args = ['-m', 'event_build.cli', req.video, '--out', tmp, '--fps', String(req.fps ?? 1)]
  if (req.sceneTh !== undefined) args.push('--scene-th', String(req.sceneTh))
  try {
    if (req.asr === true) {
      if (cache && cache.transcript) args.push('--transcript', cache.transcript)
      else {
        args.push('--asr', '--asr-device', 'cpu')
        args.push('--whisper-model', req.whisperModel || DEFAULT_WHISPER)
      }
    } else if (req.transcript) {
      args.push('--transcript', req.transcript)
    } else {
      throw new Error('need asr=true or a transcript path')
    }
    if (req.mode) args.push('--mode', req.mode)
    if (req.duration) args.push('--duration', String(req.duration))
    if (req.hiLabels === true) args.push('--hi-labels')
    if (cache && cache.baseEventDir && insideRoots(cache.baseEventDir)) {
      args.push('--reuse', cache.baseEventDir)
    }
    await fs.mkdir(tmp, { recursive: true })
    const result = await runPython(null, args, (line) => {
      if (line.startsWith('[event-build]')) job.progress = line.replace('[event-build] ', '')
    })
    if (result.code !== 0) {
      throw new Error(result.tail.slice(-6).join('\n') || `exit ${result.code}`)
    }
    const eventPath = join(tmp, 'event.json')
    await fs.access(eventPath)
    await fs.rm(out, { recursive: true, force: true }).catch(() => {})
    await fs.rename(tmp, out)
    await fs.writeFile(join(out, 'review.json'), JSON.stringify({
      video: req.video,
      out,
      created: new Date().toISOString(),
      title: req.title || req.video.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''),
    }, null, 2))
    const nextCache = {
      video: req.video,
      baseEventDir: out,
      transcript: null,
    }
    try {
      await fs.access(join(out, 'transcript.txt'))
      nextCache.transcript = join(out, 'transcript.txt')
    } catch {
      if (req.transcript && insideRoots(req.transcript)) nextCache.transcript = req.transcript
    }
    if (cache && cache.transcript && !nextCache.transcript) nextCache.transcript = cache.transcript
    await writeCache(vid, nextCache)
    job.out = out
    job.status = 'done'
    job.progress = '完成'
    job.endedAt = Date.now()
    await refreshIndex()
  } catch (error) {
    job.status = 'failed'
    job.error = String(error && error.message ? error.message : error)
    job.progress = '失败'
    job.endedAt = Date.now()
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
  }
}

async function handleEnqueue(req, res) {
  const body = await readBody(req)
  try {
    const job = enqueue(body)
    sendJson(res, 202, { jobId: job.id, job: jobSummary(job) })
  } catch (error) {
    sendJson(res, 400, { error: String(error.message) })
  }
}

function handleJobs(res) {
  const rows = [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map(jobSummary)
  sendJson(res, 200, { jobs: rows.slice(0, 50) })
}

async function handleTags(req, res) {
  const body = await readBody(req)
  if (!body.out || !insideRoots(body.out)) {
    sendJson(res, 400, { error: 'invalid out' })
    return
  }
  const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12) : []
  let review = {}
  try {
    review = JSON.parse(await fs.readFile(join(body.out, 'review.json'), 'utf8'))
  } catch {
    review = {}
  }
  review.tags = tags
  await fs.writeFile(join(body.out, 'review.json'), JSON.stringify(review, null, 2))
  await refreshIndex()
  sendJson(res, 200, { ok: true, tags })
}

async function handleRename(req, res) {
  const body = await readBody(req)
  if (!body.out || !insideRoots(body.out) || !body.out.startsWith(RECORDS_DIR)) {
    sendJson(res, 400, { error: 'invalid out' })
    return
  }
  const title = String(body.title ?? '').trim().slice(0, 120)
  if (title === '') {
    sendJson(res, 400, { error: 'title is empty' })
    return
  }
  let review = {}
  try {
    review = JSON.parse(await fs.readFile(join(body.out, 'review.json'), 'utf8'))
  } catch {
    review = {}
  }
  review.title = title
  await fs.writeFile(join(body.out, 'review.json'), JSON.stringify(review, null, 2))
  await refreshIndex()
  sendJson(res, 200, { ok: true, title })
}

async function handleDelete(req, res) {
  const body = await readBody(req)
  const out = body.out
  if (!out || !insideRoots(out) || !out.startsWith(RECORDS_DIR) || resolve(out) === resolve(RECORDS_DIR)) {
    sendJson(res, 400, { error: 'invalid out' })
    return
  }
  const running = [...jobs.values()].some((job) => job.out === out && job.status === 'running')
  if (running) {
    sendJson(res, 409, { error: 'record is being built right now' })
    return
  }
  if (body.hard === true) {
    await fs.rm(out, { recursive: true, force: true })
  } else {
    const trashDir = join(RECORDS_DIR, '_trash')
    await fs.mkdir(trashDir, { recursive: true })
    const target = join(trashDir, `${out.split(/[\\/]/).pop()}-${Date.now()}`)
    await fs.rename(out, target)
    await fs.writeFile(join(target, '__origin.json'), JSON.stringify({ origin: out, deletedAt: new Date().toISOString() }, null, 2))
  }
  await refreshIndex()
  sendJson(res, 200, { ok: true, hard: body.hard === true })
}

async function handleReveal(req, res) {
  const body = await readBody(req)
  if (!body.out || !insideRoots(body.out)) {
    sendJson(res, 400, { error: 'invalid out' })
    return
  }
  try {
    const child = spawn('explorer.exe', [body.out], { detached: true, stdio: 'ignore' })
    child.unref()
    sendJson(res, 200, { ok: true })
  } catch (error) {
    sendJson(res, 500, { error: String(error.message) })
  }
}

async function listTrash() {
  const trashDir = join(RECORDS_DIR, '_trash')
  const rows = []
  try {
    const entries = await fs.readdir(trashDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const dir = join(trashDir, entry.name)
      let origin = null
      try {
        origin = JSON.parse(await fs.readFile(join(dir, '__origin.json'), 'utf8')).origin ?? null
      } catch {
        origin = null
      }
      const stat = await fs.stat(join(dir, 'event.json')).catch(() => null)
      rows.push({ name: entry.name, dir, origin, deletedAt: stat ? stat.mtimeMs : null })
    }
  } catch {
    return []
  }
  return rows.sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0))
}

async function handleRestore(req, res) {
  const body = await readBody(req)
  if (!body.dir || !insideRoots(body.dir) || !body.dir.startsWith(join(RECORDS_DIR, '_trash'))) {
    sendJson(res, 400, { error: 'invalid trash dir' })
    return
  }
  let origin = null
  try {
    origin = JSON.parse(await fs.readFile(join(body.dir, '__origin.json'), 'utf8')).origin ?? null
  } catch {
    origin = null
  }
  if (!origin || !origin.startsWith(RECORDS_DIR)) {
    sendJson(res, 400, { error: 'origin unknown' })
    return
  }
  try {
    await fs.access(origin)
    sendJson(res, 409, { error: 'origin already exists' })
    return
  } catch {
    /* free slot */
  }
  await fs.rm(join(body.dir, '__origin.json'), { force: true })
  await fs.rename(body.dir, origin)
  await refreshIndex()
  sendJson(res, 200, { ok: true, out: origin })
}

async function readCameraState() {
  try {
    const raw = await fs.readFile(join(CAMERA_DIR, 'state.json'), 'utf8')
    const state = JSON.parse(raw)
    state.monitor = cameraChild !== null
    if (state.ts) state.ageMs = Math.round(Date.now() - state.ts * 1000)
    return state
  } catch {
    return { running: false, monitor: cameraChild !== null, events: 0, lastEvent: null }
  }
}

async function readCameraEvents(limit = 20) {
  try {
    const raw = await fs.readFile(join(CAMERA_DIR, 'events.jsonl'), 'utf8')
    const rows = raw.split(/\r?\n/).filter(Boolean).map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    }).filter(Boolean)
    return rows.slice(-limit)
  } catch {
    return []
  }
}

let cameraLog = ''

async function killCameraOrphans() {
  try {
    const raw = await fs.readFile(join(CAMERA_DIR, 'monitor.pid'), 'utf8')
    const pid = Number.parseInt(raw.trim(), 10)
    if (pid > 0) {
      try { process.kill(pid) } catch { /* already gone */ }
      await new Promise((resolveWait) => setTimeout(resolveWait, 400))
    }
  } catch {
    /* no pid file */
  }
  await fs.rm(join(CAMERA_DIR, 'monitor.pid'), { force: true })
  await new Promise((resolveKill) => {
    const script = "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'python.exe' -and $_.CommandLine -like '*camera-monitor.py*') -or ($_.Name -eq 'ffmpeg.exe' -and $_.CommandLine -like '*dshow*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, stdio: 'ignore' })
    child.on('close', resolveKill)
    child.on('error', resolveKill)
  })
}

async function externalCameraState() {
  try {
    const raw = await fs.readFile(join(CAMERA_DIR, 'monitor.pid'), 'utf8')
    const pid = Number.parseInt(raw.trim(), 10)
    if (!pid) return null
    try { process.kill(pid, 0) } catch { return null }
    const state = await readCameraState()
    if (typeof state.ageMs !== 'number' || state.ageMs > 5000) return null
    return { ...state, monitor: true, adopted: true }
  } catch {
    return null
  }
}

function scheduleCameraRestart(reason) {
  if (!cameraDesired || cameraStarting || cameraRestartTimer !== null) return
  cameraRestartAttempts += 1
  const delay = Math.min(30000, 1000 * 2 ** Math.min(5, cameraRestartAttempts))
  logCamera(`monitor exited (${reason}); restart #${cameraRestartAttempts} in ${delay}ms`)
  cameraRestartTimer = setTimeout(() => {
    cameraRestartTimer = null
    if (!cameraDesired || cameraChild !== null) return
    startCamera({ restart: true }).catch((error) => {
      logCamera(`restart failed: ${error.message}`)
      scheduleCameraRestart('start failed')
    })
  }, delay)
}

async function startCamera(options = {}) {
  if (cameraChild !== null) return readCameraState()
  await fs.mkdir(CAMERA_DIR, { recursive: true })
  await fs.rm(join(CAMERA_DIR, 'stop.flag'), { force: true })
  const adopted = await externalCameraState()
  if (adopted) {
    cameraDesired = true
    await fs.writeFile(join(CAMERA_DIR, 'wanted.flag'), '1')
    return adopted
  }
  cameraDesired = true
  if (cameraRestartTimer !== null) {
    clearTimeout(cameraRestartTimer)
    cameraRestartTimer = null
  }
  await fs.writeFile(join(CAMERA_DIR, 'wanted.flag'), '1')
  cameraStarting = true
  try {
  await killCameraOrphans()
  cameraLog = ''
  const args = [CAMERA_SCRIPT, '--camera-dir', CAMERA_DIR, '--device', CAMERA_DEVICE,
    '--model-dir', MEDIAPIPE_DIR, '--signals', CAMERA_SIGNALS ? '1' : '0']
  if (Number(options.calibrate) > 0) args.push('--calibrate', String(Number(options.calibrate)))
  const child = spawn(PYTHON, args,
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  cameraChild = child
  const collect = (chunk) => { cameraLog = (cameraLog + String(chunk)).slice(-4000) }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  child.on('error', (error) => {
    cameraLog += `\nspawn error: ${error.message}`
    if (cameraChild === child) cameraChild = null
    scheduleCameraRestart('spawn error')
  })
  child.on('close', (code) => {
    if (cameraChild === child) cameraChild = null
    cameraLog += `\nexit ${code}`
    scheduleCameraRestart(`exit ${code}`)
  })

  // ffmpeg can take several seconds to open the dshow device; poll for the first fresh state.
  const deadline = Date.now() + 10000
  let state = await readCameraState()
  let fresh = false
  while (Date.now() < deadline) {
    state = await readCameraState()
    fresh = typeof state.ageMs === 'number' && state.ageMs < 3000
    if (fresh && child.exitCode === null) break
    if (child.exitCode !== null) break
    await new Promise((resolveWait) => setTimeout(resolveWait, 400))
  }
  const alive = cameraChild === child && child.exitCode === null
  if (!alive || !fresh) {
    const detail = cameraLog.trim().split(/\r?\n/).filter(Boolean).slice(-8).join(' | ')
      || 'monitor did not produce a frame within 10s'
    try {
      await fs.writeFile(join(CAMERA_DIR, 'monitor-start.log'), JSON.stringify({
        when: new Date().toISOString(),
        python: PYTHON,
        script: CAMERA_SCRIPT,
        device: CAMERA_DEVICE,
        cameraDir: CAMERA_DIR,
        cwd: process.cwd(),
        path: process.env.PATH,
        exitCode: child.exitCode,
        log: cameraLog,
      }, null, 1))
    } catch {
      /* diagnostics are best-effort */
    }
    try { child.kill() } catch { /* already exited */ }
    cameraChild = null
    return { ...state, running: false, monitor: false, startError: detail }
  }
  return state
  } finally {
    cameraStarting = false
  }
}

async function stopCamera() {
  cameraDesired = false
  cameraRestartAttempts = 0
  if (cameraRestartTimer !== null) {
    clearTimeout(cameraRestartTimer)
    cameraRestartTimer = null
  }
  await fs.rm(join(CAMERA_DIR, 'wanted.flag'), { force: true })
  await fs.writeFile(join(CAMERA_DIR, 'stop.flag'), 'stop')
  if (cameraChild !== null) {
    const child = cameraChild
    await new Promise((resolveStop) => {
      const timer = setTimeout(() => { try { child.kill() } catch { /* already gone */ } resolveStop() }, 2500)
      child.once('close', () => { clearTimeout(timer); resolveStop() })
    })
    cameraChild = null
  }
  await fs.rm(join(CAMERA_DIR, 'stop.flag'), { force: true })
  await killCameraOrphans()
  return { running: false }
}

async function cameraProfile() {
  try {
    return JSON.parse(await fs.readFile(join(CAMERA_DIR, 'profile.json'), 'utf8'))
  } catch {
    return null
  }
}

async function writeCameraProfile(profile) {
  const target = join(CAMERA_DIR, 'profile.json')
  const tmp = `${target}.tmp-${randomUUID().slice(0, 8)}`
  await fs.writeFile(tmp, JSON.stringify(profile, null, 1))
  await fs.rename(tmp, target)
}

async function calibrateCamera(seconds = 30) {
  if (!CAMERA_SIGNALS) throw new Error('camera signals are disabled')
  const duration = Math.max(3, Math.min(120, Number(seconds) || 30))
  if (cameraChild !== null) await stopCamera()
  const state = await startCamera({ calibrate: duration })
  if (state.monitor === false) return { ok: false, startError: state.startError || 'camera did not start', state }
  await new Promise((resolveWait) => setTimeout(resolveWait, (duration + 3) * 1000))
  const profile = await cameraProfile()
  return {
    ok: Boolean(profile && profile.baseline),
    seconds: duration,
    profilePath: join(CAMERA_DIR, 'profile.json'),
    profile,
    state: await readCameraState(),
  }
}

async function cameraFeedback(observed, corrected) {
  const givenObserved = String(observed || '').trim()
  const givenCorrected = String(corrected || '').trim()
  if (!givenObserved || !givenCorrected) throw new Error('observed and corrected are required')
  const profile = (await cameraProfile()) || { version: 1, baseline: {}, thresholds: { smile: 0.35, brow: 0.4, blink: 0.7 } }
  profile.thresholds = profile.thresholds || { smile: 0.35, brow: 0.4, blink: 0.7 }
  const clamp = (value) => Math.min(0.95, Math.max(0.15, Math.round(value * 1000) / 1000))
  if (givenObserved === 'smile' && givenCorrected !== 'smile') {
    profile.thresholds.smile = clamp(Number(profile.thresholds.smile) + 0.03)
  } else if (givenCorrected === 'smile') {
    profile.thresholds.smile = clamp(Number(profile.thresholds.smile) - 0.03)
  }
  if (givenObserved === 'brow_down' && givenCorrected !== 'brow_down') {
    profile.thresholds.brow = clamp(Number(profile.thresholds.brow) + 0.03)
  } else if (givenCorrected === 'brow_down') {
    profile.thresholds.brow = clamp(Number(profile.thresholds.brow) - 0.03)
  }
  profile.feedback = profile.feedback || { total: 0 }
  profile.feedback.total += 1
  profile.feedback.last = { observed: givenObserved, corrected: givenCorrected, at: new Date().toISOString() }
  profile.updatedAt = new Date().toISOString()
  await writeCameraProfile(profile)
  try {
    await fs.appendFile(join(CAMERA_DIR, 'feedback.jsonl'), JSON.stringify({
      ts: Date.now() / 1000, observed: givenObserved, corrected: givenCorrected,
    }) + '\n')
  } catch {
    /* feedback log is best-effort */
  }
  return { ok: true, thresholds: profile.thresholds, total: profile.feedback.total, profilePath: join(CAMERA_DIR, 'profile.json') }
}

async function cameraSnapshot() {
  const latest = join(CAMERA_DIR, 'latest.jpg')
  try {
    const stat = await fs.stat(latest)
    if (Date.now() - stat.mtimeMs < 2000) {
      const path = join(CAMERA_DIR, `snapshot-${Date.now()}.jpg`)
      await fs.copyFile(latest, path)
      return { ok: true, path, source: 'monitor' }
    }
  } catch {
    /* no live frame; fall back to ffmpeg below */
  }
  const path = join(CAMERA_DIR, `snapshot-${Date.now()}.jpg`)
  const code = await new Promise((resolveSnap) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'dshow',
      '-framerate', '15', '-video_size', '640x480', '-i', CAMERA_DEVICE,
      '-frames:v', '1', '-y', path], { windowsHide: true, stdio: 'ignore' })
    child.on('close', (value) => resolveSnap(value ?? -1))
    child.on('error', () => resolveSnap(-1))
  })
  return { ok: code === 0, path: code === 0 ? path : null, source: 'ffmpeg' }
}

async function waitCameraEvent(kinds, timeoutMs) {
  const baseline = await readCameraEvents(200)
  const startSeq = baseline.length > 0 ? baseline[baseline.length - 1].seq ?? 0 : 0
  const wanted = Array.isArray(kinds) && kinds.length > 0 ? new Set(kinds) : null
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const rows = await readCameraEvents(200)
    for (const row of rows) {
      if ((row.seq ?? 0) <= startSeq) continue
      if (wanted !== null && !wanted.has(row.kind)) continue
      return { event: row, state: await readCameraState(), waitedMs: timeoutMs - (deadline - Date.now()) }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  return { event: null, state: await readCameraState(), timedOut: true }
}

function fmtClock(seconds) {
  const s = Math.max(0, Math.round(seconds || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function csvEscape(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
}

function recordFromEvent(event, out, title) {
  const states = event.states || []
  const reviews = event.review || reviewEventRecord(event)
  const top = states.reduce((best, state) => {
    const emphasis = state.attention ? state.attention.emphasis : 0
    return emphasis > (best ? best.emphasis : -1)
      ? { t0: state.t0, t1: state.t1, emphasis, url: state.url_hint ?? null }
      : best
  }, null)
  return {
    title: title || out.split(/[\\/]/).pop(),
    out,
    video: event.video ?? null,
    mode: event.mode ?? '',
    duration: Number(event.span_s || 0),
    states: states.length,
    chapters: (event.chapters || []).length,
    units: (event.units || []).length,
    gaps: (event.gaps || []).length,
    gates: Boolean(event.gates && event.gates.all_ok),
    flags: Array.isArray(reviews.flags) ? reviews.flags : [],
    top,
  }
}

function recordMarkdown(record, event, annotations = []) {
  const chapters = event.chapters || []
  const units = event.units || []
  const flags = record.flags
  const lines = [
    `# ${record.title}`,
    '',
    `- 来源视频：${record.video || '—'}`,
    `- 模式：${record.mode} · 时长：${fmtClock(record.duration)} · 状态：${record.states} · 章节：${record.chapters} · 语元：${record.units} · 语音缺口：${record.gaps}`,
    `- 校验：${record.gates ? 'PASS' : 'FAIL'}`,
    '',
    '## 审阅标记',
    '',
  ]
  if (flags.length === 0) lines.push('无。')
  else for (const flag of flags) lines.push(`- [${flag.level}] ${flag.code}：${flag.message}`)
  if (annotations.length > 0) {
    lines.push('', '## 标注', '', '| 时间 | 类型 | 内容 | 作者 |', '|---|---|---|---|')
    for (const annotation of annotations) {
      lines.push(`| ${fmtClock(annotation.t0)}–${fmtClock(annotation.t1)} | ${annotation.kind === 'label' ? '标签' : '备注'} | ${String(annotation.text).replace(/\|/g, '／')} | ${annotation.author || '—'} |`)
    }
  }
  lines.push('', '## 章节', '', '| 时间 | 依据 | URL | 停留 | 注意力 |', '|---|---|---|---|---|')
  for (const chapter of chapters) {
    lines.push(`| ${fmtClock(chapter.t0)}–${fmtClock(chapter.t1)} | ${chapter.reason === 'url' ? '页面切换' : '话题'} | ${chapter.url || '—'} | ${Math.round(chapter.dwell)}s | ${Math.round(chapter.attention)} |`)
  }
  lines.push('', '## 注意力最高的状态', '')
  const topStates = [...(event.states || [])]
    .sort((a, b) => (b.attention ? b.attention.emphasis : 0) - (a.attention ? a.attention.emphasis : 0))
    .slice(0, 8)
  for (const state of topStates) {
    const attention = state.attention || {}
    lines.push(`- ${fmtClock(state.t0)}–${fmtClock(state.t1)} · 注意力 ${Math.round(attention.emphasis || 0)} · ${state.url_hint || '无 URL'}${state.label_hi || state.label || state.label_speech ? ' · ' + String(state.label_hi || state.label || state.label_speech).slice(0, 80) : ''}`)
  }
  const urls = new Map()
  for (const state of event.states || []) {
    const key = state.url_hint || '无 URL'
    urls.set(key, (urls.get(key) || 0) + 1)
  }
  lines.push('', '## URL 分布', '', '| URL | 状态数 |', '|---|---|')
  for (const [url, count] of [...urls.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${url} | ${count} |`)
  }
  const speechByGap = (event.gaps || []).slice(0, 10)
  if (speechByGap.length > 0) {
    lines.push('', '## 语音缺口（前 10）', '', '| 时间 | 时长 |', '|---|---|')
    for (const gap of speechByGap) {
      lines.push(`| ${fmtClock(gap.t0)}–${fmtClock(gap.t1)} | ${Math.round(gap.t1 - gap.t0)}s |`)
    }
  }
  void units
  return lines.join('\n')
}

function chaptersCsv(event) {
  const header = ['start', 'end', 'start_s', 'end_s', 'reason', 'url', 'dwell_s', 'attention']
  const rows = (event.chapters || []).map((chapter) => [
    fmtClock(chapter.t0), fmtClock(chapter.t1), Math.round(chapter.t0), Math.round(chapter.t1),
    chapter.reason, chapter.url || '', Math.round(chapter.dwell), Math.round(chapter.attention),
  ])
  return [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n')
}

async function exportRecord(out, formats = ['md', 'csv', 'json', 'docx', 'xlsx']) {
  if (!out || !insideRoots(out)) throw new Error('out is missing or outside allowed roots')
  const event = JSON.parse(await fs.readFile(join(out, 'event.json'), 'utf8'))
  let title = out.split(/[\\/]/).pop()
  try {
    title = JSON.parse(await fs.readFile(join(out, 'review.json'), 'utf8')).title || title
  } catch {
    /* optional */
  }
  const record = recordFromEvent(event, out, title)
  let annotations = []
  try {
    annotations = (await readAnnotations(out)).annotations
  } catch {
    /* optional sidecar */
  }
  const dir = join(HOME, 'exports', `${title.replace(/[\\/:*?"<>|]/g, '_')}-${Date.now()}`)
  await fs.mkdir(dir, { recursive: true })
  const files = []
  const warnings = []
  const wanted = new Set(formats)
  if (wanted.has('json')) {
    const target = join(dir, 'event.json')
    await fs.writeFile(target, JSON.stringify(event, null, 1))
    files.push(target)
    if (annotations.length > 0) {
      const sidecar = join(dir, 'annotations.json')
      await fs.writeFile(sidecar, JSON.stringify({ version: 1, annotations }, null, 1))
      files.push(sidecar)
    }
  }
  if (wanted.has('md')) {
    const target = join(dir, 'analysis.md')
    await fs.writeFile(target, recordMarkdown(record, event, annotations))
    files.push(target)
  }
  if (wanted.has('csv')) {
    const target = join(dir, 'chapters.csv')
    await fs.writeFile(target, chaptersCsv(event))
    files.push(target)
  }
  const office = ['docx', 'xlsx'].filter((format) => wanted.has(format))
  if (office.length > 0) {
    const result = await new Promise((resolveOffice) => {
      const child = spawn(PYTHON, [
        '-m', 'event_build.export_office',
        '--event', join(out, 'event.json'),
        '--out', dir,
        '--formats', office.join(','),
        '--title', title,
      ], { windowsHide: true })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => { stdout += chunk })
      child.stderr.on('data', (chunk) => { stderr += chunk })
      child.on('close', (code) => resolveOffice({ code, stdout, stderr }))
      child.on('error', (error) => resolveOffice({ code: -1, stdout: '', stderr: String(error) }))
    })
    if (result.code === 0) {
      try {
        files.push(...(JSON.parse(result.stdout.trim() || '{}').files || []))
      } catch {
        warnings.push('Word/Excel 导出结果无法解析')
      }
    } else {
      warnings.push('Word/Excel 导出失败（需要 python-docx / openpyxl：pip install -e "engine[office]"）')
    }
  }
  return { ok: true, dir, files, warnings }
}

async function collectSummary() {
  const records = await listRecords()
  const per = []
  for (const item of records) {
    try {
      const event = JSON.parse(await fs.readFile(join(item.out, 'event.json'), 'utf8'))
      const record = recordFromEvent(event, item.out, item.title || item.name || item.dir)
      try {
        record.tags = JSON.parse(await fs.readFile(join(item.out, 'review.json'), 'utf8')).tags || []
      } catch {
        record.tags = []
      }
      per.push(record)
    } catch {
      /* skip unreadable record */
    }
  }
  const totals = {
    records: per.length,
    duration: Math.round(per.reduce((sum, r) => sum + r.duration, 0)),
    states: per.reduce((sum, r) => sum + r.states, 0),
    chapters: per.reduce((sum, r) => sum + r.chapters, 0),
    units: per.reduce((sum, r) => sum + r.units, 0),
    gatesOk: per.filter((r) => r.gates).length,
    flags: per.reduce((sum, r) => sum + r.flags.length, 0),
  }
  const flagsByCode = {}
  for (const record of per) {
    for (const flag of record.flags) {
      flagsByCode[flag.code] = (flagsByCode[flag.code] || 0) + 1
    }
  }
  const topSegments = per
    .filter((record) => record.top)
    .map((record) => ({ title: record.title, out: record.out, ...record.top }))
    .sort((a, b) => b.emphasis - a.emphasis)
    .slice(0, 10)
  return { generatedAt: new Date().toISOString(), totals, flagsByCode, records: per, topSegments }
}

async function exportSummary() {
  const summary = await collectSummary()
  const dir = join(HOME, 'exports', `summary-${Date.now()}`)
  await fs.mkdir(dir, { recursive: true })
  const lines = [
    '# 视频分析总览',
    '',
    `- 生成时间：${summary.generatedAt}`,
    `- 记录数：${summary.totals.records} · 总时长：${fmtClock(summary.totals.duration)} · 章节：${summary.totals.chapters}`,
    `- 状态：${summary.totals.states} · 语元：${summary.totals.units} · 校验通过：${summary.totals.gatesOk}/${summary.totals.records}`,
    `- 审阅标记：${summary.totals.flags}`,
    '',
    '## 记录',
    '',
    '| 标题 | 时长 | 章节 | 状态 | 校验 | 审阅标记 |',
    '|---|---|---|---|---|---|',
  ]
  for (const record of summary.records) {
    lines.push(`| ${record.title} | ${fmtClock(record.duration)} | ${record.chapters} | ${record.states} | ${record.gates ? 'PASS' : 'FAIL'} | ${record.flags.length} |`)
  }
  lines.push('', '## 跨记录注意力最高段落', '')
  for (const segment of summary.topSegments) {
    lines.push(`- ${segment.title} · ${fmtClock(segment.t0)}–${fmtClock(segment.t1)} · ${Math.round(segment.emphasis)}`)
  }
  lines.push('', '## 审阅标记分布', '')
  for (const [code, count] of Object.entries(summary.flagsByCode).sort((a, b) => b[1] - a[1])) {
    lines.push(`- ${code}：${count}`)
  }
  const md = join(dir, 'summary.md')
  const json = join(dir, 'summary.json')
  await fs.writeFile(md, lines.join('\n'))
  await fs.writeFile(json, JSON.stringify(summary, null, 1))
  const csv = join(dir, 'records.csv')
  const head = 'title,out,duration_s,states,chapters,units,gaps,gates,flags\n'
  const rows = summary.records.map((r) => [r.title, r.out, Math.round(r.duration), r.states, r.chapters, r.units, r.gaps, r.gates, r.flags.length].map(csvEscape).join(','))
  await fs.writeFile(csv, head + rows.join('\n'))
  return { ok: true, dir, files: [md, json, csv] }
}

function contextAt(event, time, windowSec = 8) {
  const states = event.states || []
  const chapters = event.chapters || []
  const units = event.units || []
  const state = states.find((item) => item.t0 <= time && time <= item.t1) || null
  const chapter = chapters.find((item) => item.t0 <= time && time <= item.t1) || null
  const transcript = units
    .filter((unit) => unit.t1 >= time - windowSec && unit.t0 <= time + windowSec)
    .slice(0, 8)
    .map((unit) => ({ t0: unit.t0, t1: unit.t1, text: unit.text }))
  return {
    state: state && {
      t0: state.t0, t1: state.t1, url: state.url_hint ?? null,
      label: state.label_hi || state.label || state.label_speech || null,
      attention: state.attention ? state.attention.emphasis : null,
    },
    chapter: chapter && {
      t0: chapter.t0, t1: chapter.t1, reason: chapter.reason, url: chapter.url ?? null,
      attention: chapter.attention,
    },
    transcript,
  }
}

async function frameFor(out, t) {
  if (!out || !insideRoots(out)) throw new Error('out is missing or outside allowed roots')
  const time = Number(t)
  if (!Number.isFinite(time)) throw new Error('t must be a number of seconds')
  const event = JSON.parse(await fs.readFile(join(out, 'event.json'), 'utf8'))
  const fps = Number(event.fps || 1)
  const start = Number(event.start || 0)
  const frameIndex = Math.max(1, Math.round((time - start) * fps) + 1)
  const name = `f_${String(frameIndex).padStart(6, '0')}.jpg`
  const framesDir = join(out, 'frames')
  let frame = join(framesDir, name)
  if (!existsSync(frame)) {
    const cacheDir = join(out, 'frames-on-demand')
    await fs.mkdir(cacheDir, { recursive: true })
    frame = join(cacheDir, name)
    if (!existsSync(frame)) {
      const video = event.video
      if (!video || !existsSync(video)) {
        throw new Error(`frame ${name} is missing and the source video is not available`)
      }
      const code = await new Promise((resolveExtract) => {
        const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-ss', String(time),
          '-i', video, '-frames:v', '1', '-y', frame], { windowsHide: true, stdio: 'ignore' })
        child.on('close', (value) => resolveExtract(value ?? -1))
        child.on('error', () => resolveExtract(-1))
      })
      if (code !== 0) throw new Error(`failed to extract frame at ${time}s`)
    }
  }
  return {
    out,
    t: time,
    frame,
    frameIndex,
    video: event.video ?? null,
    ...contextAt(event, time),
    hint: 'call read_image on `frame` to actually see the picture',
  }
}

async function ocrFrame(out, t) {
  if (!OCR_ENABLED) throw new Error('OCR is disabled')
  if (!OCR_COMMAND) throw new Error('OCR is not configured: set ocrCommand / DSH_EVENT_VIDEO_OCR_COMMAND')
  const info = await frameFor(out, t)
  const cacheDir = join(out, 'ocr-cache')
  const cachePath = join(cacheDir, `${info.frame.split(/[\\/]/).pop()}.json`)
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'))
    if (cached && cached.engine) return { ...cached, out, t: info.t, frame: info.frame, cached: true }
  } catch {
    /* first run */
  }
  const started = Date.now()
  const result = await new Promise((resolveOcr) => {
    const args = [...OCR_ARGS]
    if (OCR_SCRIPT) args.push(OCR_SCRIPT)
    args.push('--image', info.frame)
    const child = spawn(OCR_COMMAND, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const timer = setTimeout(() => { try { child.kill() } catch { /* already gone */ } }, 300000)
    child.on('error', (error) => { clearTimeout(timer); resolveOcr({ code: -1, stdout, stderr: String(error) }) })
    child.on('close', (code) => { clearTimeout(timer); resolveOcr({ code, stdout, stderr }) })
  })
  if (result.code !== 0) throw new Error(`OCR command exited ${result.code}: ${result.stderr.slice(-300)}`)
  const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  let payload = {}
  for (let index = lines.length - 1; index >= 0 && index >= lines.length - 5; index -= 1) {
    try {
      payload = JSON.parse(lines[index])
      break
    } catch {
      /* OCR tools may log before the JSON line */
    }
  }
  if (!payload || typeof payload !== 'object') throw new Error('OCR command did not return JSON')
  await fs.mkdir(cacheDir, { recursive: true }).catch(() => {})
  await fs.writeFile(cachePath, JSON.stringify(payload, null, 1)).catch(() => {})
  return {
    out,
    t: info.t,
    frame: info.frame,
    engine: payload.engine || 'unknown',
    text: payload.text || '',
    lines: Array.isArray(payload.lines) ? payload.lines : [],
    seconds: Math.round((Date.now() - started) / 100) / 10,
  }
}

async function groundUiElement(out, t, instruction) {
  if (!GROUND_ENABLED) throw new Error('grounding is disabled')
  if (!GROUND_COMMAND) throw new Error('grounding is not configured: set groundCommand / DSH_EVENT_VIDEO_GROUND_COMMAND')
  if (!instruction) throw new Error('instruction is required')
  const info = await frameFor(out, t)
  const cacheDir = join(out, 'ground-cache')
  const safe = Buffer.from(instruction, 'utf8').toString('base64url').slice(0, 24)
  const frameBase = info.frame.split(/[\\/]/).pop().replace(/\.[^.]+$/, '')
  const cachePath = join(cacheDir, `${frameBase}-${safe}.json`)
  try {
    const cached = JSON.parse(await fs.readFile(cachePath, 'utf8'))
    if (cached && cached.engine) return { ...cached, out, t: info.t, frame: info.frame, cached: true }
  } catch {
    /* first run */
  }
  const started = Date.now()
  const result = await new Promise((resolveGround) => {
    const args = [...GROUND_ARGS]
    if (GROUND_SCRIPT) args.push(GROUND_SCRIPT)
    args.push('--image', info.frame, '--instruction', instruction, '--endpoint', GROUND_ENDPOINT, '--alias', GROUND_ALIAS)
    const child = spawn(GROUND_COMMAND, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const timer = setTimeout(() => { try { child.kill() } catch { /* already gone */ } }, 300000)
    child.on('error', (error) => { clearTimeout(timer); resolveGround({ code: -1, stdout, stderr: String(error) }) })
    child.on('close', (code) => { clearTimeout(timer); resolveGround({ code, stdout, stderr }) })
  })
  if (result.code !== 0) throw new Error(`grounding command exited ${result.code}: ${result.stderr.slice(-300)}`)
  const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  let payload = {}
  for (let index = lines.length - 1; index >= 0 && index >= lines.length - 5; index -= 1) {
    try {
      payload = JSON.parse(lines[index])
      break
    } catch {
      /* adapter may log before the JSON line */
    }
  }
  if (!payload || typeof payload !== 'object') throw new Error('grounding command did not return JSON')
  await fs.mkdir(cacheDir, { recursive: true }).catch(() => {})
  await fs.writeFile(cachePath, JSON.stringify(payload, null, 1)).catch(() => {})
  return {
    out,
    t: info.t,
    frame: info.frame,
    engine: payload.engine || 'unknown',
    instruction,
    point: payload.point || null,
    box: payload.box || null,
    normalized: payload.normalized || null,
    raw: payload.raw || '',
    seconds: Math.round((Date.now() - started) / 100) / 10,
  }
}

function serveFrameImage(res, path) {
  fs.stat(path).then((stat) => {
    res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': stat.size, 'cache-control': 'no-store' })
    createReadStream(path).pipe(res)
  }).catch(() => {
    sendJson(res, 404, { error: 'frame not found' })
  })
}

const readVideoFrameTool = {
  name: 'read_video_frame',
  description: 'Return the exact frame at a timestamp of a built event record, with the scene label, chapter and nearby speech. Use read_image on the returned `frame` path to actually see the picture. Use this to spot-check review flags or answer "what was on screen at mm:ss".',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['out', 't'],
    properties: {
      out: { type: 'string', description: 'Event record output directory.' },
      t: { type: 'number', description: 'Seconds from the start of the recording.' },
    },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
  },
  timeoutMs: 30000,
  async execute(args) {
    return frameFor(args.out, args.t)
  },
}

function tokenize(text) {
  const lower = String(text ?? '').toLowerCase()
  const tokens = []
  for (const word of lower.match(/[a-z0-9]{2,}/g) || []) tokens.push(word)
  for (const run of lower.match(/[\u4e00-\u9fff]+/g) || []) {
    if (run.length <= 2) {
      tokens.push(run)
      for (const char of run) tokens.push(char)
      continue
    }
    for (let index = 0; index < run.length - 1; index += 1) tokens.push(run.slice(index, index + 2))
  }
  return tokens
}

function searchSignature(records) {
  return createHash('sha1')
    .update(records.map((record) => `${record.id}:${record.updated || ''}`).join('|'))
    .digest('hex')
}

async function buildSearchIndex(records) {
  const chunks = []
  for (const item of records) {
    let event
    try {
      event = JSON.parse(await fs.readFile(join(item.out, 'event.json'), 'utf8'))
    } catch {
      continue
    }
    const title = item.title || item.name || item.dir || item.out
    const fps = Number(event.fps || 1)
    const start = Number(event.start || 0)
    const videoId = item.videoId || item.id
    const frameAt = (t) => `f_${String(Math.max(1, Math.round((Number(t) - start) * fps) + 1)).padStart(6, '0')}.jpg`
    for (const unit of event.units || []) {
      if (!unit.text) continue
      chunks.push({
        recordId: item.id, videoId, title, out: item.out, t0: unit.t0, t1: unit.t1,
        kind: 'speech', text: unit.text, frame: frameAt(unit.t0), url: null,
      })
    }
    for (const state of event.states || []) {
      const text = state.label_hi || state.label || state.label_speech
      if (!text) continue
      chunks.push({
        recordId: item.id, videoId, title, out: item.out, t0: state.t0, t1: state.t1,
        kind: 'screen', text, frame: frameAt(state.t0), url: state.url_hint ?? null,
      })
    }
  }
  const index = { version: 2, builtAt: new Date().toISOString(), signature: searchSignature(records), chunks }
  await fs.mkdir(join(HOME, 'index'), { recursive: true })
  await fs.writeFile(join(HOME, 'index', 'search-index.json'), JSON.stringify(index))
  return index
}

async function ensureSearchIndex() {
  const records = await listRecords()
  const path = join(HOME, 'index', 'search-index.json')
  try {
    const index = JSON.parse(await fs.readFile(path, 'utf8'))
    if (index.version === 2 && index.signature === searchSignature(records)) return index
  } catch {
    /* rebuild below */
  }
  return buildSearchIndex(records)
}

async function searchLibrary(query, limit = 8, filterOut = null) {
  const index = await ensureSearchIndex()
  const qTokens = [...new Set(tokenize(query))]
  const chunks = filterOut ? index.chunks.filter((chunk) => chunk.out === filterOut) : index.chunks
  const N = chunks.length
  if (qTokens.length === 0 || N === 0) return { query, total: 0, hits: [] }

  const tokenized = chunks.map((chunk) => tokenize(chunk.text))
  const documentFrequency = new Map()
  for (const token of qTokens) {
    let count = 0
    for (const tokens of tokenized) if (tokens.includes(token)) count += 1
    documentFrequency.set(token, count)
  }
  const averageLength = tokenized.reduce((sum, tokens) => sum + tokens.length, 0) / N
  const k1 = 1.2
  const b = 0.75
  const scored = []
  chunks.forEach((chunk, indexOfChunk) => {
    const tokens = tokenized[indexOfChunk]
    const frequency = new Map()
    for (const token of tokens) frequency.set(token, (frequency.get(token) || 0) + 1)
    let score = 0
    for (const token of qTokens) {
      const tf = frequency.get(token)
      if (!tf) continue
      const idf = Math.log((N + 1) / ((documentFrequency.get(token) || 0) + 1)) + 1
      score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (tokens.length / Math.max(1, averageLength))))
    }
    if (score > 0) scored.push({ chunk, score })
  })
  scored.sort((a, b2) => b2.score - a.score)
  const cap = Math.max(1, Math.min(50, Number(limit) || 8))
  // The same source video may have several builds; cite it once and note duplicates.
  const deduped = []
  const seen = new Map()
  for (const entry of scored) {
    const { chunk } = entry
    const key = `${chunk.videoId || chunk.recordId}|${chunk.t0}|${chunk.text.slice(0, 60)}`
    const existing = seen.get(key)
    if (existing) {
      existing.duplicates += 1
      continue
    }
    const hit = {
      recordId: chunk.recordId,
      videoId: chunk.videoId || chunk.recordId,
      title: chunk.title,
      out: chunk.out,
      t0: chunk.t0,
      t1: chunk.t1,
      at: fmtClock(chunk.t0),
      kind: chunk.kind,
      text: chunk.text.slice(0, 220),
      frame: chunk.frame,
      url: chunk.url,
      score: Math.round(entry.score * 1000) / 1000,
      duplicates: 0,
    }
    seen.set(key, hit)
    deduped.push(hit)
    if (deduped.length >= cap) break
  }
  return { query, total: scored.length, unique: deduped.length, hits: deduped }
}

async function askVideoLibrary(question, limit = 6) {
  const result = await searchLibrary(question, limit)
  return {
    question,
    answer_guidance: 'Answer only from the evidence below. Cite every claim as [title @ mm:ss]. If the evidence is insufficient, say what is missing instead of guessing.',
    searched: result.total,
    evidence: result.hits.map((hit) => ({
      title: hit.title,
      at: hit.at,
      t0: hit.t0,
      frame: hit.frame,
      kind: hit.kind,
      quote: hit.text,
      score: hit.score,
    })),
  }
}

const ocrFrameTool = {
  name: 'ocr_video_frame',
  description: 'Read exact on-screen text at a timestamp with the configured OCR command (PaddleOCR-VL or PaddleOCR). Returns engine, text lines and the frame anchor. Use this for verbatim text/URLs; VLM descriptions are not exact.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['out', 't'],
    properties: {
      out: { type: 'string', description: 'Event record output directory.' },
      t: { type: 'number', description: 'Seconds from the start of the recording.' },
    },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
  },
  timeoutMs: 320000,
  async execute(args) {
    return ocrFrame(args.out, args.t)
  },
}

const groundUiTool = {
  name: 'ground_ui_element',
  description: 'Locate a UI element in a frame with the configured GUI grounding model (UI-TARS). Returns the element point/box in pixels, the model raw answer and the frame anchor. Requires a llama.cpp/OpenAI-compatible grounding endpoint (groundCommand/groundEndpoint).',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['out', 't', 'instruction'],
    properties: {
      out: { type: 'string', description: 'Event record output directory.' },
      t: { type: 'number', description: 'Seconds from the start of the recording.' },
      instruction: { type: 'string', description: 'Target element description, e.g. 商品价格 or 登录按钮.' },
    },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
  },
  timeoutMs: 320000,
  async execute(args) {
    return groundUiElement(args.out, args.t, args.instruction)
  },
}

const describeFramesTool = {
  name: 'describe_video_frames',
  description: 'Ask the configured VLM (Ollama /api/chat or OpenAI-compatible) to describe sampled frames of a record. Use keyFrames+think for a few important frames (chapter starts, annotations, top attention) with a reasoning model; use the default for broad coverage. Writes vision.json.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['out'],
    properties: {
      out: { type: 'string', description: 'Event record output directory.' },
      limit: { type: 'number', description: 'Max frames to describe (default 24; keyFrames default 6).' },
      keyFrames: { type: 'boolean', description: 'Only chapter starts, annotations and top-attention states.' },
      think: { type: 'boolean', description: 'Allow model reasoning (slower, local compute only; uses vlmThinkModel).' },
      model: { type: 'string', description: 'Override the Ollama/OpenAI model for this call, e.g. gemma3:12b or minicpm-v:8b.' },
    },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
  },
  timeoutMs: 900000,
  async execute(args) {
    return describeRecord(args.out, {
      limit: args.limit, keyFrames: args.keyFrames, think: args.think, model: args.model,
    })
  },
}

const exportWorkItemsTool = {
  name: 'export_work_items',
  description: 'Turn a record into tickets or an SOP: export_video_work_items writes tickets.md/csv/json with time, evidence frame and acceptance; kind="sop" writes ordered steps from chapters. Items can be passed explicitly (title/detail/priority/t0/t1/frame/acceptance) or derived from annotations and review flags.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['out'],
    properties: {
      out: { type: 'string', description: 'Event record output directory.' },
      kind: { type: 'string', enum: ['tickets', 'sop'], description: 'tickets (default) or sop.' },
      items: {
        type: 'array',
        description: 'Optional action items; omit to derive from annotations + review flags (tickets) or chapters (sop).',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            title: { type: 'string' },
            detail: { type: 'string' },
            priority: { type: 'string' },
            t0: { type: 'number' },
            t1: { type: 'number' },
            frame: { type: 'string' },
            quote: { type: 'string' },
            acceptance: { type: 'string' },
          },
          required: ['title'],
        },
      },
      formats: { type: 'array', items: { type: 'string' }, description: 'Any of md, csv, json (default all three).' },
    },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
  },
  timeoutMs: 30000,
  async execute(args) {
    return exportWorkItems(args.out, args.kind || 'tickets', args.items || null, args)
  },
}

const annotateTool = {
  name: 'annotate_video_record',
  description: 'Add a timestamped annotation (note or chapter label) to an event record. Stored in the record\'s annotations.json sidecar; event.json is never modified. Returns the new annotation with its frame anchor.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['out', 't0', 'text'],
    properties: {
      out: { type: 'string', description: 'Event record output directory.' },
      t0: { type: 'number', description: 'Start time in seconds.' },
      t1: { type: 'number', description: 'Optional end time in seconds.' },
      text: { type: 'string', description: 'Annotation text (max 500 chars).' },
      kind: { type: 'string', enum: ['note', 'label'], description: 'note or chapter label (default note).' },
    },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
  },
  timeoutMs: 20000,
  async execute(args) {
    return addAnnotation(args.out, { ...args, author: 'agent' })
  },
}

const listAnnotationsTool = {
  name: 'list_video_annotations',
  description: 'List the timestamped annotations written for an event record (annotations.json sidecar).',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['out'],
    properties: { out: { type: 'string', description: 'Event record output directory.' } },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
  },
  timeoutMs: 20000,
  async execute(args) {
    return readAnnotations(args.out)
  },
}

const searchLibraryTool = {
  name: 'search_video_library',
  description: 'Search every analyzed video in the library for timestamped evidence (speech units and on-screen labels). Returns ranked hits with record title, time, frame path and quote. Use ask_video_library when you need an answer with citations.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: { type: 'string', description: 'Keywords or a natural-language phrase.' },
      limit: { type: 'number', description: 'Max hits (default 8).' },
      out: { type: 'string', description: 'Optional: restrict to one record directory.' },
    },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
  },
  timeoutMs: 60000,
  async execute(args) {
    return searchLibrary(args.query, args.limit ?? 8, args.out ?? null)
  },
}

const askLibraryTool = {
  name: 'ask_video_library',
  description: 'Answer a question from the analyzed-video library using retrieved timestamped evidence. Returns an evidence list with citations (title, mm:ss, frame, quote) and guidance to answer only from that evidence.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['question'],
    properties: {
      question: { type: 'string', description: 'Question in the user\'s language.' },
      limit: { type: 'number', description: 'Max evidence items (default 6).' },
    },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
  },
  timeoutMs: 60000,
  async execute(args) {
    return askVideoLibrary(args.question, args.limit ?? 6)
  },
}

async function serveCameraStream(req, res) {
  const boundary = 'dshevframe'
  res.writeHead(200, {
    'content-type': `multipart/x-mixed-replace; boundary=${boundary}`,
    'cache-control': 'no-store, no-cache, must-revalidate',
    pragma: 'no-cache',
    connection: 'close',
  })
  const path = join(CAMERA_DIR, 'latest.jpg')
  let lastMtime = 0
  let closed = false
  let timer = null
  let maxTimer = null
  const finish = () => {
    if (closed) return
    closed = true
    clearInterval(timer)
    clearTimeout(maxTimer)
    try { res.end() } catch { /* client already gone */ }
  }
  req.on('close', finish)
  res.on('close', finish)
  maxTimer = setTimeout(finish, 15 * 60 * 1000)

  const pushFrame = async () => {
    if (closed) return
    try {
      const stat = await fs.stat(path)
      if (stat.mtimeMs === lastMtime) return
      lastMtime = stat.mtimeMs
      const buffer = await fs.readFile(path)
      if (closed) return
      res.write(`--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${buffer.length}\r\n\r\n`)
      res.write(buffer)
      res.write('\r\n')
    } catch {
      /* no frame yet; keep the stream open */
    }
  }
  timer = setInterval(pushFrame, 60)
  await pushFrame()
}

function handler(req, res) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
  const route = url.pathname
  const run = async () => {
    if (route === '/event-video/records') {
      sendJson(res, 200, { records: await listRecords() })
      return
    }
    if (route === '/event-video/data') {
      const out = url.searchParams.get('out')
      if (!out) {
        sendJson(res, 400, { error: 'missing out' })
        return
      }
      sendJson(res, 200, await readRecord(out))
      return
    }
    if (route === '/event-video/media') {
      await serveMedia(req, res, url)
      return
    }
    if (route === '/event-video/frame') {
      const out = url.searchParams.get('out') || ''
      const time = Number(url.searchParams.get('t') || '0')
      try {
        const info = await frameFor(out, time)
        if ((url.searchParams.get('format') || '') === 'image') {
          serveFrameImage(res, info.frame)
        } else {
          sendJson(res, 200, info)
        }
      } catch (error) {
        sendJson(res, 400, { error: String(error.message) })
      }
      return
    }
    if (route === '/event-video/ocr' && req.method === 'POST') {
      const body = await readBody(req)
      try {
        sendJson(res, 200, await ocrFrame(body.out, body.t))
      } catch (error) {
        sendJson(res, 400, { error: String(error.message) })
      }
      return
    }
    if (route === '/event-video/ground' && req.method === 'POST') {
      const body = await readBody(req)
      try {
        sendJson(res, 200, await groundUiElement(body.out, body.t, body.instruction))
      } catch (error) {
        sendJson(res, 400, { error: String(error.message) })
      }
      return
    }
    if (route === '/event-video/thumb') {
      await serveThumb(req, res, url)
      return
    }
    if (route === '/event-video/jobs' && req.method === 'GET') {
      handleJobs(res)
      return
    }
    if (route === '/event-video/enqueue' && req.method === 'POST') {
      await handleEnqueue(req, res)
      return
    }
    if (route === '/event-video/tags' && req.method === 'POST') {
      await handleTags(req, res)
      return
    }
    if (route === '/event-video/review' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body.out || !insideRoots(body.out)) {
        sendJson(res, 400, { error: 'invalid out' })
        return
      }
      const event = JSON.parse(await fs.readFile(join(body.out, 'event.json'), 'utf8'))
      sendJson(res, 200, reviewEventRecord(event))
      return
    }
    if (route === '/event-video/summary' && req.method === 'GET') {
      sendJson(res, 200, await collectSummary())
      return
    }
    if (route === '/event-video/export' && req.method === 'POST') {
      const body = await readBody(req)
      try {
        sendJson(res, 200, await exportRecord(body.out, body.formats))
      } catch (error) {
        sendJson(res, 400, { error: String(error.message) })
      }
      return
    }
    if (route === '/event-video/export-summary' && req.method === 'POST') {
      try {
        sendJson(res, 200, await exportSummary())
      } catch (error) {
        sendJson(res, 400, { error: String(error.message) })
      }
      return
    }
    if (route === '/event-video/rename' && req.method === 'POST') {
      await handleRename(req, res)
      return
    }
    if (route === '/event-video/delete' && req.method === 'POST') {
      await handleDelete(req, res)
      return
    }
    if (route === '/event-video/reveal' && req.method === 'POST') {
      await handleReveal(req, res)
      return
    }
    if (route === '/event-video/trash' && req.method === 'GET') {
      sendJson(res, 200, { items: await listTrash() })
      return
    }
    if (route === '/event-video/restore' && req.method === 'POST') {
      await handleRestore(req, res)
      return
    }
    if (route === '/camera/status') {
      sendJson(res, 200, await readCameraState())
      return
    }
    if (route === '/camera/events') {
      sendJson(res, 200, { events: await readCameraEvents(Number(url.searchParams.get('limit') || 20)) })
      return
    }
    if (route === '/camera/start' && req.method === 'POST') {
      sendJson(res, 200, await startCamera())
      return
    }
    if (route === '/camera/stop' && req.method === 'POST') {
      sendJson(res, 200, await stopCamera())
      return
    }
    if (route === '/camera/debug' && req.method === 'GET') {
      const mode = (url.searchParams.get('mode') || 'python').toLowerCase()
      const args = mode === 'monitor'
        ? [CAMERA_SCRIPT, '--camera-dir', CAMERA_DIR, '--device', CAMERA_DEVICE]
        : ['-c', 'import sys; print(sys.executable); print(sys.version)']
      const result = await new Promise((resolveDebug) => {
        const child = spawn(PYTHON, args, { windowsHide: true })
        let stdout = ''
        let stderr = ''
        let settled = false
        const finish = (value) => { if (!settled) { settled = true; resolveDebug(value) } }
        child.stdout.on('data', (chunk) => { stdout += chunk })
        child.stderr.on('data', (chunk) => { stderr += chunk })
        child.on('error', (error) => finish({ error: String(error), stdout, stderr }))
        child.on('close', (code) => finish({ code, stdout, stderr }))
        if (mode === 'monitor') {
          setTimeout(() => {
            try { child.kill() } catch { /* gone */ }
            finish({ killedAfterMs: 6000, alive: child.exitCode === null, stdout, stderr })
          }, 6000)
        }
      })
      sendJson(res, 200, { python: PYTHON, script: CAMERA_SCRIPT, args, cwd: process.cwd(), result })
      return
    }
    if (route === '/camera/calibrate' && req.method === 'POST') {
      const body = await readBody(req)
      try {
        sendJson(res, 200, await calibrateCamera(body.seconds ?? 30))
      } catch (error) {
        sendJson(res, 400, { error: String(error.message) })
      }
      return
    }
    if (route === '/camera/feedback' && req.method === 'POST') {
      const body = await readBody(req)
      try {
        sendJson(res, 200, await cameraFeedback(body.observed, body.corrected))
      } catch (error) {
        sendJson(res, 400, { error: String(error.message) })
      }
      return
    }
    if (route === '/camera/speak' && req.method === 'POST') {
      const body = await readBody(req)
      try {
        sendJson(res, 200, await speakText(body.text))
      } catch (error) {
        sendJson(res, 400, { error: String(error.message) })
      }
      return
    }
    if (route === '/camera/voice-react' && req.method === 'POST') {
      const body = await readBody(req)
      try {
        sendJson(res, 200, await cameraVoiceReact(body))
      } catch (error) {
        sendJson(res, 400, { error: String(error.message) })
      }
      return
    }
    if (route === '/camera/snapshot' && req.method === 'POST') {
      sendJson(res, 200, await cameraSnapshot())
      return
    }
    if (route === '/camera/stream' && req.method === 'GET') {
      await serveCameraStream(req, res)
      return
    }
    if (route === '/camera/frame') {
      await serveThumb(req, res, url)
      return
    }
    if (route === '/event-video/search' && req.method === 'GET') {
      const query = url.searchParams.get('q') || ''
      const limit = Number(url.searchParams.get('limit') || '8')
      sendJson(res, 200, await searchLibrary(query, limit, url.searchParams.get('out') || null))
      return
    }
    if (route === '/event-video/ask' && req.method === 'GET') {
      const question = url.searchParams.get('q') || ''
      const limit = Number(url.searchParams.get('limit') || '6')
      sendJson(res, 200, await askVideoLibrary(question, limit))
      return
    }
    if (route === '/event-video/annotations') {
      if (!ANNOTATIONS_ENABLED) {
        sendJson(res, 403, { error: 'annotations are disabled' })
        return
      }
      if (req.method === 'GET') {
        const out = url.searchParams.get('out') || ''
        try {
          sendJson(res, 200, await readAnnotations(out))
        } catch (error) {
          sendJson(res, 400, { error: String(error.message) })
        }
        return
      }
      if (req.method === 'POST') {
        const body = await readBody(req)
        try {
          if ((body.action || 'add') === 'add') {
            sendJson(res, 200, await addAnnotation(body.out, body.annotation || body))
          } else if (body.action === 'update') {
            sendJson(res, 200, await updateAnnotation(body.out, body.id, body.patch || {}))
          } else if (body.action === 'delete') {
            sendJson(res, 200, await deleteAnnotation(body.out, body.id))
          } else {
            sendJson(res, 400, { error: 'unknown action' })
          }
        } catch (error) {
          sendJson(res, 400, { error: String(error.message) })
        }
        return
      }
    }
    if (route === '/event-video/work-items' && req.method === 'POST') {
      if (!WORK_ITEMS_ENABLED) {
        sendJson(res, 403, { error: 'work items are disabled' })
        return
      }
      const body = await readBody(req)
      try {
        sendJson(res, 200, await exportWorkItems(body.out, body.kind || 'tickets', body.items || null, body))
      } catch (error) {
        sendJson(res, 400, { error: String(error.message) })
      }
      return
    }
    if (route === '/event-video/vision' && req.method === 'GET') {
      const out = url.searchParams.get('out') || ''
      try {
        sendJson(res, 200, await readVision(out))
      } catch (error) {
        sendJson(res, 400, { error: String(error.message) })
      }
      return
    }
    if (route === '/event-video/describe' && req.method === 'POST') {
      if (!VLM_ENABLED) {
        sendJson(res, 403, { error: 'VLM descriptions are disabled' })
        return
      }
      const body = await readBody(req)
      try {
        sendJson(res, 200, await describeRecord(body.out, { limit: body.limit, keyFrames: body.keyFrames, think: body.think, model: body.model }))
      } catch (error) {
        sendJson(res, 400, { error: String(error.message) })
      }
      return
    }
    sendJson(res, 404, { error: 'not found' })
  }
  run().catch((error) => sendJson(res, 500, { error: String(error?.message ?? error) }))
}

function reviewEventRecord(event) {
  const states = event.states || []
  const chapters = event.chapters || []
  const units = event.units || []
  const gaps = event.gaps || []
  const gates = event.gates || {}
  const alignment = event.alignment || {}
  const flags = []

  const failed = Object.entries(gates).filter(([, value]) => value && value.ok === false).map(([key]) => key)
  if (failed.length > 0) {
    flags.push({ level: 'error', code: 'gates_failed', message: '构建校验未通过：' + failed.join('、') })
  }

  const urls = [...new Set(states.map((s) => s.url_hint).filter(Boolean))]
  for (const url of urls) {
    if (url.includes('?') && !url.includes('=')) {
      flags.push({ level: 'warn', code: 'url_missing_separators', message: 'URL 缺少 = / &，疑似 OCR 误读：' + url })
    } else if (/(analytics_trace_id|client_id|locale|redirect_uri)-/.test(url)) {
      flags.push({ level: 'warn', code: 'url_hyphen_separators', message: 'URL 用 - 代替 = / &，疑似 OCR 误读：' + url })
    }
  }

  const unlabeled = states.filter((s) => !s.label && !s.label_hi && !s.label_speech)
  if (unlabeled.length > 0) {
    flags.push({ level: 'warn', code: 'states_unlabeled', message: `${unlabeled.length} 个状态没有任何标签（语音/OCR 均空）` })
  }

  const longGaps = gaps.filter((g) => (g.duration ?? (g.t1 - g.t0)) >= 60)
  if (longGaps.length > 0) {
    flags.push({ level: 'info', code: 'long_speech_gaps', message: `${longGaps.length} 段语音缺口 ≥60 秒，汇报时需说明这些区间的依据` })
  }

  if ((alignment.action_match_rate ?? 1) < 0.7) {
    flags.push({ level: 'warn', code: 'weak_action_alignment', message: `动作对齐命中率偏低：${alignment.action_match_rate}` })
  }
  if ((alignment.lag_p25_s ?? 0) < -20) {
    flags.push({ level: 'warn', code: 'large_speech_lag', message: `语音滞后 p25 = ${alignment.lag_p25_s}s，部分状态可能借用较远语句` })
  }

  for (const chapter of chapters) {
    if (chapter.dwell < 30 || chapter.dwell > 300) {
      flags.push({ level: 'info', code: 'chapter_length_outlier', message: `章节长度异常：${Math.round(chapter.dwell)}s` })
    }
  }

  const topStates = [...states]
    .sort((a, b) => (b.attention ? b.attention.emphasis : 0) - (a.attention ? a.attention.emphasis : 0))
    .slice(0, 3)
    .map((s) => ({
      t0: s.t0,
      t1: s.t1,
      url: s.url_hint ?? null,
      label: s.label_hi || s.label || s.label_speech || null,
      emphasis: s.attention ? s.attention.emphasis : 0,
    }))

  const longestGaps = longGaps
    .slice()
    .sort((a, b) => (b.duration ?? (b.t1 - b.t0)) - (a.duration ?? (a.t1 - a.t0)))
    .slice(0, 3)
    .map((g) => {
      const near = units
        .filter((u) => u.t1 >= g.t0 && u.t0 <= g.t1)
        .map((u) => u.text)
        .join('')
        .slice(0, 120)
      return { t0: g.t0, t1: g.t1, duration: Math.round(g.duration ?? (g.t1 - g.t0)), speech: near }
    })

  return {
    ok: flags.every((f) => f.level !== 'error'),
    counts: {
      states: states.length,
      chapters: chapters.length,
      units: units.length,
      gaps: gaps.length,
      urls: urls.length,
      chapters_without_url: chapters.filter((c) => !c.url).length,
    },
    flags,
    samples: { topStates, longestGaps },
  }
}

const exportTool = {
  name: 'export_video_analysis',
  description: 'Export the analysis of one event record: analysis.md (readable report), chapters.csv, raw event.json, and analysis.docx / analysis.xlsx (deliverable documents). Returns the export directory and file paths. Use after building/reviewing a record when the user wants files.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['out'],
    properties: {
      out: { type: 'string', description: 'Event record output directory.' },
      formats: { type: 'array', items: { type: 'string' }, description: 'Any of md, csv, json, docx, xlsx (default all five).' },
    },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
  },
  timeoutMs: 20000,
  async execute(args) {
    return exportRecord(args.out, args.formats)
  },
}

const summaryTool = {
  name: 'summarize_video_analyses',
  description: 'One-shot overview of every analyzed video in the library: totals (records, duration, states, chapters, units), per-record metrics, review-flag counts by code, and the highest-attention segments across records.',
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
  },
  timeoutMs: 45000,
  async execute() {
    return collectSummary()
  },
}

const reviewTool = {
  name: 'review_video_event',
  description: 'Review a built event record before reporting it: completeness gates, OCR URL anomalies (missing = / &, truncated), unlabeled states, long speech gaps, alignment outliers, chapter length anomalies. Call this immediately after build_video_event and include the flags in your answer.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['out'],
    properties: { out: { type: 'string', description: 'Event record output directory (the `out` returned by build_video_event).' } },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
  },
  timeoutMs: 20000,
  async execute(args) {
    if (!args.out || !insideRoots(args.out)) throw new Error('out is missing or outside allowed roots')
    const event = JSON.parse(await fs.readFile(join(args.out, 'event.json'), 'utf8'))
    return event.review || reviewEventRecord(event)
  },
}

const cameraStateTool = {
  name: 'camera_state',
  description: 'Read the local reflex camera state immediately: monitor status, motion, brightness, subject presence, frame age, latest event. Returns structured JSON without consuming image tokens.',
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
  },
  timeoutMs: 5000,
  async execute() {
    return readCameraState()
  },
}

const cameraWaitTool = {
  name: 'camera_wait',
  description: 'Block until the reflex camera reports one of the requested event kinds (motion_start, motion_stop, scene_change, subject_appear, subject_disappear), or the timeout expires. Returns the event with its keyframe path plus the current state. Use this instead of polling camera_state.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kinds: { type: 'array', items: { type: 'string' }, description: 'Event kinds to wait for; omit for any event.' },
      timeout_s: { type: 'number', description: 'Seconds to wait, 1-30 (default 10).' },
    },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
  },
  timeoutMs: 35000,
  async execute(args) {
    const timeout = Math.min(30, Math.max(1, args.timeout_s || 10)) * 1000
    return waitCameraEvent(args.kinds, timeout)
  },
}

function runProcess(command, args, timeoutMs = 20000) {
  return new Promise((resolveRun) => {
    let child
    try {
      child = spawn(command, args, { windowsHide: true, stdio: 'ignore' })
    } catch {
      resolveRun(-1)
      return
    }
    const timer = setTimeout(() => { try { child.kill() } catch { /* already gone */ } }, timeoutMs)
    child.on('error', () => { clearTimeout(timer); resolveRun(-1) })
    child.on('close', (code) => { clearTimeout(timer); resolveRun(code ?? -1) })
  })
}

function escapePowerShell(text) {
  return String(text).replace(/'/g, "''")
}

function renderVoiceTemplate(template, event, state) {
  const base = template && String(template).trim() ? String(template) : '检测到 {kind}'
  const kind = event && event.kind ? String(event.kind) : 'event'
  const startedAt = state && Number(state.startedAt)
  const offset = event && Number.isFinite(Number(event.ts)) && startedAt ? Math.max(0, Number(event.ts) - startedAt) : 0
  return base
    .replaceAll('{kind}', kind)
    .replaceAll('{time}', fmtClock(offset))
    .replaceAll('{gesture}', event && event.gesture ? String(event.gesture) : '')
    .replaceAll('{smile}', event && event.smile !== undefined && event.smile !== null ? String(event.smile) : '')
}

async function speakText(text) {
  if (!VOICE_ENABLED) throw new Error('voice is disabled')
  const message = String(text ?? '').trim()
  if (!message) throw new Error('text is required')
  if (message.length > 300) throw new Error('text is limited to 300 characters')
  if (TTS_COMMAND) {
    const code = await runProcess(TTS_COMMAND, [...TTS_ARGS, message])
    if (code !== 0) throw new Error(`TTS command exited ${code}`)
    return { ok: true, provider: 'command', text: message }
  }
  if (TTS_ENDPOINT) {
    const headers = { 'content-type': 'application/json' }
    if (TTS_API_KEY) headers.authorization = `Bearer ${TTS_API_KEY}`
    const response = await fetch(TTS_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: TTS_MODEL, input: message, voice: TTS_VOICE, response_format: 'mp3' }),
    })
    if (!response.ok) throw new Error(`TTS HTTP ${response.status}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    await fs.mkdir(CAMERA_DIR, { recursive: true })
    const audioPath = join(CAMERA_DIR, `tts-${Date.now()}.mp3`)
    await fs.writeFile(audioPath, buffer)
    return { ok: true, provider: 'endpoint', audioPath, text: message, note: 'audio saved locally; play it with the system player' }
  }
  if (process.platform === 'win32') {
    const script = `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${escapePowerShell(message)}')`
    const code = await runProcess('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], 30000)
    if (code !== 0) throw new Error(`windows SAPI exited ${code}`)
    return { ok: true, provider: 'windows-sapi', text: message }
  }
  const command = process.platform === 'darwin' ? 'say' : 'espeak'
  const code = await runProcess(command, [message], 30000)
  if (code !== 0) throw new Error(`${command} exited ${code}`)
  return { ok: true, provider: command, text: message }
}

async function cameraVoiceReact(options = {}) {
  if (!VOICE_ENABLED) throw new Error('voice is disabled')
  const kinds = Array.isArray(options.kinds) && options.kinds.length > 0
    ? options.kinds.map(String)
    : ['wave', 'gesture', 'pose_action', 'face_present', 'smile']
  const timeoutS = Math.max(1, Math.min(60, Number(options.timeoutS) || 15))
  const waited = await waitCameraEvent(kinds, timeoutS * 1000)
  if (!waited.event) return { ok: false, timedOut: true, state: waited.state }
  const text = renderVoiceTemplate(options.template, waited.event, waited.state)
  let tts = null
  try {
    tts = await speakText(text)
  } catch (error) {
    tts = { ok: false, error: String(error.message) }
  }
  return { ok: true, event: waited.event, spoken: text, tts, state: waited.state }
}

const cameraCalibrateTool = {
  name: 'camera_calibrate',
  description: 'Calibrate the camera signal layer against the user\'s neutral face: restarts the monitor with a calibration window, collects face blendshape baselines, and writes camera/profile.json (baseline + personalized thresholds). Use once per user/lighting change before relying on smile/brow events.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: { seconds: { type: 'number', description: 'Calibration seconds (default 30, max 120).' } },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
  },
  timeoutMs: 180000,
  async execute(args) {
    return calibrateCamera(args.seconds ?? 30)
  },
}

const cameraFeedbackTool = {
  name: 'camera_feedback',
  description: 'Correct a camera expression signal and personalize thresholds. Example: observed="smile", corrected="neutral" raises the smile threshold so false positives become rarer. Writes camera/profile.json; the running monitor picks it up within ~2s.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['observed', 'corrected'],
    properties: {
      observed: { type: 'string', description: 'What the monitor reported: smile | brow_down | neutral.' },
      corrected: { type: 'string', description: 'What it should have been: smile | brow_down | neutral.' },
    },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
  },
  timeoutMs: 20000,
  async execute(args) {
    return cameraFeedback(args.observed, args.corrected)
  },
}

const speakTextTool = {
  name: 'speak_text',
  description: 'Speak a short text locally: Windows SAPI by default, or a configured ttsCommand / OpenAI-compatible ttsEndpoint. Use this to answer by voice after camera_wait or a review question.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: { text: { type: 'string', description: 'Text to speak (max 300 characters).' } },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
  },
  timeoutMs: 60000,
  async execute(args) {
    return speakText(args.text)
  },
}

const cameraVoiceReactTool = {
  name: 'camera_voice_react',
  description: 'Event-triggered voice loop: wait for a camera event (default wave/gesture/face_present/smile), speak a templated response using {kind}/{time}/{gesture}/{smile}, and return the event plus the TTS result. One call covers "wait for event then respond aloud".',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kinds: { type: 'array', items: { type: 'string' }, description: 'Event kinds to wait for (default wave/gesture/face_present/smile).' },
      timeoutS: { type: 'number', description: 'Wait timeout in seconds (default 15, max 60).' },
      template: { type: 'string', description: 'Speech template, e.g. "检测到 {gesture}，已为你继续".' },
    },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
  },
  timeoutMs: 90000,
  async execute(args) {
    return cameraVoiceReact(args)
  },
}

const cameraSnapshotTool = {
  name: 'camera_snapshot',
  description: 'Capture one frame from the local camera on demand and return its saved JPEG path. Use read_image on the returned path to actually see the frame; the monitor does not need to be running.',
  parameters: { type: 'object', additionalProperties: false, properties: {} },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 1) }],
  },
  timeoutMs: 15000,
  async execute() {
    return cameraSnapshot()
  },
}

export const inject = ['webServer', 'tools']

export function apply(ctx, config) {
  configure(config || {})
  try {
    if (existsSync(join(CAMERA_DIR, 'wanted.flag'))) cameraDesired = true
  } catch {
    /* no camera dir yet */
  }
  ctx.effect(() => {
    const timer = setInterval(async () => {
      if (!cameraDesired || cameraChild !== null || cameraStarting || cameraRestartTimer !== null) return
      if (await externalCameraState()) return
      scheduleCameraRestart('watchdog')
    }, 10000)
    return () => clearInterval(timer)
  }, 'event-video: camera watchdog')
  ctx.effect(() => { refreshIndex().catch(() => {}) }, 'event-video: initial index')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/event-video',
    handler,
  }), 'event-video: library routes')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/camera',
    handler,
  }), 'event-video: camera routes')
  ctx.effect(() => ctx.tools.register(reviewTool), 'event-video: review tool')
  if ((config || {}).enableFrameTool !== false && process.env.DSH_EVENT_VIDEO_FRAME_TOOL !== '0') {
    ctx.effect(() => ctx.tools.register(readVideoFrameTool), 'event-video: frame tool')
  }
  if (OCR_ENABLED) {
    ctx.effect(() => ctx.tools.register(ocrFrameTool), 'event-video: ocr tool')
  }
  if (GROUND_ENABLED) {
    ctx.effect(() => ctx.tools.register(groundUiTool), 'event-video: ground tool')
  }
  ctx.effect(() => ctx.tools.register(exportTool), 'event-video: export tool')
  ctx.effect(() => ctx.tools.register(summaryTool), 'event-video: summary tool')
  if (ANNOTATIONS_ENABLED) {
    ctx.effect(() => ctx.tools.register(annotateTool), 'event-video: annotate tool')
    ctx.effect(() => ctx.tools.register(listAnnotationsTool), 'event-video: annotations tool')
  }
  if (WORK_ITEMS_ENABLED) {
    ctx.effect(() => ctx.tools.register(exportWorkItemsTool), 'event-video: work items tool')
  }
  if (VLM_ENABLED) {
    ctx.effect(() => ctx.tools.register(describeFramesTool), 'event-video: describe frames tool')
  }
  if ((config || {}).enableSearchTool !== false && process.env.DSH_EVENT_VIDEO_SEARCH !== '0') {
    ctx.effect(() => ctx.tools.register(searchLibraryTool), 'event-video: search tool')
    ctx.effect(() => ctx.tools.register(askLibraryTool), 'event-video: ask tool')
  }
  ctx.effect(() => ctx.tools.register(cameraStateTool), 'event-video: camera_state tool')
  if (CAMERA_SIGNALS) {
    ctx.effect(() => ctx.tools.register(cameraCalibrateTool), 'event-video: camera_calibrate tool')
    ctx.effect(() => ctx.tools.register(cameraFeedbackTool), 'event-video: camera_feedback tool')
  }
  if (VOICE_ENABLED) {
    ctx.effect(() => ctx.tools.register(speakTextTool), 'event-video: speak_text tool')
    ctx.effect(() => ctx.tools.register(cameraVoiceReactTool), 'event-video: camera_voice_react tool')
  }
  ctx.effect(() => ctx.tools.register(cameraWaitTool), 'event-video: camera_wait tool')
  ctx.effect(() => ctx.tools.register(cameraSnapshotTool), 'event-video: camera_snapshot tool')
}

export const __test = {
  frameFor,
  contextAt,
  readVideoFrameTool,
  reviewEventRecord,
  recordFromEvent,
  chaptersCsv,
  configure,
  tokenize,
  searchLibrary,
  askVideoLibrary,
  buildSearchIndex,
  readAnnotations,
  addAnnotation,
  updateAnnotation,
  deleteAnnotation,
  recordMarkdown,
  exportWorkItems,
  workItemsFromRecord,
  normalizeWorkItems,
  planVisionFrames,
  planKeyVisionFrames,
  ocrFrame,
  ocrFrameTool,
  groundUiElement,
  groundUiTool,
  describeRecord,
  callVlmDescription,
  readVision,
  cameraProfile,
  cameraFeedback,
  calibrateCamera,
  speakText,
  renderVoiceTemplate,
  cameraVoiceReact,
  runProcess,
}
