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

async function readRecord(out) {
  if (!insideRoots(out)) throw new Error('path outside allowed roots')
  const event = JSON.parse(await fs.readFile(join(out, 'event.json'), 'utf8'))
  let review = null
  try {
    review = JSON.parse(await fs.readFile(join(out, 'review.json'), 'utf8'))
  } catch {
    /* optional */
  }
  return { event, review }
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

async function startCamera() {
  if (cameraChild !== null) return readCameraState()
  await fs.mkdir(CAMERA_DIR, { recursive: true })
  await fs.rm(join(CAMERA_DIR, 'stop.flag'), { force: true })
  cameraChild = spawn(PYTHON, [CAMERA_SCRIPT, '--home', CAMERA_DIR, '--device', CAMERA_DEVICE], { windowsHide: true, stdio: 'ignore' })
  cameraChild.on('close', () => { cameraChild = null })
  return readCameraState()
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
  return { running: false }
}

async function cameraSnapshot() {
  const path = join(CAMERA_DIR, `snapshot-${Date.now()}.jpg`)
  const code = await new Promise((resolveSnap) => {
    const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'dshow',
      '-framerate', '15', '-video_size', '640x480', '-i', CAMERA_DEVICE,
      '-frames:v', '1', '-y', path], { windowsHide: true, stdio: 'ignore' })
    child.on('close', (value) => resolveSnap(value ?? -1))
    child.on('error', () => resolveSnap(-1))
  })
  return { ok: code === 0, path: code === 0 ? path : null }
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
    if (route === '/camera/snapshot' && req.method === 'POST') {
      sendJson(res, 200, await cameraSnapshot())
      return
    }
    if (route === '/camera/frame') {
      await serveThumb(req, res, url)
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
  ctx.effect(() => ctx.tools.register(cameraStateTool), 'event-video: camera_state tool')
  ctx.effect(() => ctx.tools.register(cameraWaitTool), 'event-video: camera_wait tool')
  ctx.effect(() => ctx.tools.register(cameraSnapshotTool), 'event-video: camera_snapshot tool')
}
