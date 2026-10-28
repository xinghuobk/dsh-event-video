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
  return { event, review, annotations }
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

async function startCamera() {
  if (cameraChild !== null) return readCameraState()
  await fs.mkdir(CAMERA_DIR, { recursive: true })
  await fs.rm(join(CAMERA_DIR, 'stop.flag'), { force: true })
  await killCameraOrphans()
  cameraLog = ''
  const child = spawn(PYTHON, [CAMERA_SCRIPT, '--camera-dir', CAMERA_DIR, '--device', CAMERA_DEVICE],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  cameraChild = child
  const collect = (chunk) => { cameraLog = (cameraLog + String(chunk)).slice(-4000) }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  child.on('error', (error) => {
    cameraLog += `\nspawn error: ${error.message}`
    if (cameraChild === child) cameraChild = null
  })
  child.on('close', (code) => {
    if (cameraChild === child) cameraChild = null
    cameraLog += `\nexit ${code}`
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
}

async function stopCamera() {
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
  timer = setInterval(pushFrame, 100)
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
  ctx.effect(() => ctx.tools.register(exportTool), 'event-video: export tool')
  ctx.effect(() => ctx.tools.register(summaryTool), 'event-video: summary tool')
  if (ANNOTATIONS_ENABLED) {
    ctx.effect(() => ctx.tools.register(annotateTool), 'event-video: annotate tool')
    ctx.effect(() => ctx.tools.register(listAnnotationsTool), 'event-video: annotations tool')
  }
  if ((config || {}).enableSearchTool !== false && process.env.DSH_EVENT_VIDEO_SEARCH !== '0') {
    ctx.effect(() => ctx.tools.register(searchLibraryTool), 'event-video: search tool')
    ctx.effect(() => ctx.tools.register(askLibraryTool), 'event-video: ask tool')
  }
  ctx.effect(() => ctx.tools.register(cameraStateTool), 'event-video: camera_state tool')
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
}
