import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Run with:  node D:\agent\event-tool\plugin\tests\integration.mjs
// Asserts the installed plugin registers the tool, runs the engine on a short
// slice, and that the produced record carries chapters and per-state attention.
const entry = process.env.EVENT_VIDEO_PLUGIN
  ?? 'D:\\DSHHome\\profiles\\desktop\\node_modules\\dsh-event-video\\lib\\index.js'
const mod = await import(pathToFileURL(entry).href)

const outDir = process.env.EVENT_BUILD_OUT ?? 'D:\\agent\\video-events\\integration'
const config = ({
  pythonPath: process.env.EVENT_BUILD_PYTHON ?? 'D:\\agent\\event-tool\\.venv\\Scripts\\python.exe',
  defaultOutDir: 'D:\\agent\\video-events',
  timeoutMs: 600000,
})
const registered = []
const ctx = { effect: (fn) => fn(), tools: { register: (def) => { registered.push(def); return () => {} } } }
mod.apply(ctx, config)
assert.equal(registered[0].name, 'build_video_event')

const video = process.env.EVENT_BUILD_VIDEO
  ?? 'D:\\zch28_Downloads\\from_wei\\xwechat_files\\wxid_i559vegullrl22_1697\\msg\\video\\2026-10\\9bf4283bd377b52fc6dcc07165cbe1c5_raw.mp4'
const transcript = process.env.EVENT_BUILD_TRANSCRIPT ?? 'D:\\agent\\video-run\\transcript.txt'

const raw = await registered[0].execute({ video, transcript, duration: 40, out: outDir })
const summary = JSON.parse(raw.summary)
assert.equal(summary.gates, 'PASS')
assert.ok(summary.chapters >= 1, 'summary carries chapter count')
assert.ok(summary.attention_top && summary.attention_top.emphasis >= 0, 'summary carries the top-attention state')
assert.equal(raw.timeline.kind, 'event-video-timeline')
assert.equal(raw.timeline.chapters.length, summary.chapters)

const event = JSON.parse(await readFile(join(outDir, 'event.json'), 'utf8'))
assert.ok(event.chapters.length >= 1)
assert.equal(event.gates.chapters_partition.ok, true)
assert.ok(event.states.every((s) => s.attention && typeof s.attention.emphasis === 'number'))
assert.equal(event.schema_version, 1)

console.log('INTEGRATION OK', JSON.stringify({
  mode: summary.mode,
  chapters: summary.chapters,
  states: summary.states,
  top: summary.attention_top,
}))
