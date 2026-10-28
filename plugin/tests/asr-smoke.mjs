import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// CPU-only ASR smoke: 20-second slice, small model, talk mode.
// Run with: node D:\agent\event-tool\plugin\tests\asr-smoke.mjs
const entry = process.env.EVENT_VIDEO_PLUGIN
  ?? 'D:\\DSHHome\\profiles\\desktop\\node_modules\\dsh-event-video\\lib\\index.js'
const mod = await import(pathToFileURL(entry).href)

const outDir = process.env.EVENT_BUILD_OUT ?? 'D:\\agent\\video-events\\asr-smoke'
const config = {
  pythonPath: process.env.EVENT_BUILD_PYTHON ?? 'D:\\agent\\event-tool\\.venv\\Scripts\\python.exe',
  modelPath: process.env.EVENT_BUILD_MODEL ?? 'D:\\agent\\models\\whisper-small',
  defaultOutDir: 'D:\\agent\\video-events',
  timeoutMs: 600000,
  asrDevice: 'cpu',
}
const registered = []
const ctx = { effect: (fn) => fn(), tools: { register: (def) => { registered.push(def); return () => {} } } }
mod.apply(ctx, config)

const video = process.env.EVENT_BUILD_VIDEO ?? 'D:\\agent\\video3\\BV1taxL6oE5B.mp4'
const raw = await registered[0].execute({ video, asr: true, asr_device: 'cpu', duration: 20, mode: 'talk', out: outDir })
const summary = JSON.parse(raw.summary)
assert.equal(summary.gates, 'PASS')
assert.equal(raw.timeline.kind, 'event-video-timeline')
assert.equal(summary.gates, 'PASS')
const transcript = await readFile(join(outDir, 'transcript.txt'), 'utf8')
assert.ok(transcript.trim().length > 0, 'transcript written by CPU ASR')
console.log('ASR SMOKE OK', JSON.stringify({ mode: summary.mode, states: summary.states, units: summary.units, chars: transcript.length }))
