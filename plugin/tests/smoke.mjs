import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

// Run with:  node D:\agent\event-tool\plugin\tests\smoke.mjs
// The plugin must already be installed into the DSH profile (npm install --install-links).
const entry = process.env.EVENT_VIDEO_PLUGIN
  ?? 'D:\\DSHHome\\profiles\\desktop\\node_modules\\dsh-event-video\\lib\\index.js'
const mod = await import(pathToFileURL(entry).href)

const config = ({
  pythonPath: process.env.EVENT_BUILD_PYTHON ?? 'D:\\agent\\event-tool\\.venv\\Scripts\\python.exe',
  defaultOutDir: process.env.EVENT_BUILD_OUT ?? 'D:\\agent\\video-events\\smoke',
  timeoutMs: 600000,
})
assert.equal(mod.inject[0], 'tools')

const registered = []
const ctx = { effect: (fn) => fn(), tools: { register: (def) => { registered.push(def); return () => {} } } }
mod.apply(ctx, config)
assert.equal(registered.length, 1)
assert.equal(registered[0].name, 'build_video_event')

const video = process.env.EVENT_BUILD_VIDEO
  ?? 'D:\\zch28_Downloads\\from_wei\\xwechat_files\\wxid_i559vegullrl22_1697\\msg\\video\\2026-10\\9bf4283bd377b52fc6dcc07165cbe1c5_raw.mp4'
const transcript = process.env.EVENT_BUILD_TRANSCRIPT ?? 'D:\\agent\\video-run\\transcript.txt'
const out = await registered[0].execute({ video, transcript, duration: 40, out: 'D:\\agent\\video-events\\smoke' })
const parsed = JSON.parse(out.summary)
assert.equal(parsed.gates, 'PASS')
assert.ok(parsed.states >= 1)
assert.ok(parsed.units >= 1)
assert.equal(out.timeline.kind, 'event-video-timeline')
assert.ok(out.timeline.chapters.length >= 1)
console.log('SMOKE OK', out.summary.replace(/\n/g, ' '))
