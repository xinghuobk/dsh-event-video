import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const entry = process.env.EVENT_VIDEO_PLUGIN
  ?? 'process.env.EVENT_VIDEO_PLUGIN'
const mod = await import(pathToFileURL(entry).href)

const config = mod.Config({
  pythonPath: 'process.env.EVENT_BUILD_PYTHON',
  defaultOutDir: 'D:\\agent\\video-events',
  timeoutMs: 3600000,
})
const registered = []
const ctx = { effect: (fn) => fn(), tools: { register: (def) => { registered.push(def); return () => {} } } }
mod.apply(ctx, config)

const video = 'D:\\zch28_Downloads\\from_wei\\xwechat_files\\wxid_i559vegullrl22_1697\\msg\\video\\2026-10\\9bf4283bd377b52fc6dcc07165cbe1c5_raw.mp4'
const transcript = 'process.env.EVENT_BUILD_TRANSCRIPT'
const out = await registered[0].execute({
  video,
  transcript,
  out: 'D:\\agent\\video-events\\orimodo-1h',
})
const parsed = JSON.parse(out)
assert.equal(parsed.gates, 'PASS')
console.log(out)
