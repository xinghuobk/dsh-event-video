import assert from 'node:assert/strict'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Run with: node plugin/tests/smoke.mjs
// Requires:
//   EVENT_BUILD_VIDEO      absolute path to a short local mp4
//   EVENT_BUILD_TRANSCRIPT absolute path to a [mm:ss] transcript
//   EVENT_VIDEO_PLUGIN     optional path to the installed plugin entry
//   EVENT_BUILD_PYTHON     optional python executable with event-build installed
const profileDir = process.env.DSH_PROFILE_DIR
  ?? join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.dsh', 'profiles', process.env.DSH_PROFILE ?? 'desktop')
const entry = process.env.EVENT_VIDEO_PLUGIN
  ?? join(profileDir, 'node_modules', 'dsh-event-video', 'lib', 'index.js')
const mod = await import(pathToFileURL(entry).href)

const video = process.env.EVENT_BUILD_VIDEO
const transcript = process.env.EVENT_BUILD_TRANSCRIPT
if (!video || !transcript) {
  throw new Error('set EVENT_BUILD_VIDEO and EVENT_BUILD_TRANSCRIPT to run the smoke test')
}

const config = {
  pythonPath: process.env.EVENT_BUILD_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'),
  defaultOutDir: process.env.EVENT_BUILD_OUT ?? join(process.env.TEMP ?? '/tmp', 'event-video-smoke'),
  timeoutMs: 600000,
}
assert.equal(mod.inject[0], 'tools')

const registered = []
const ctx = { effect: (fn) => fn(), tools: { register: (def) => { registered.push(def); return () => {} } } }
mod.apply(ctx, config)
assert.equal(registered.length, 1)
assert.equal(registered[0].name, 'build_video_event')

const out = await registered[0].execute({ video, transcript, duration: 40, out: config.defaultOutDir })
const parsed = JSON.parse(out.summary)
assert.equal(parsed.gates, 'PASS')
assert.ok(parsed.states >= 1)
assert.ok(parsed.units >= 1)
assert.equal(out.timeline.kind, 'event-video-timeline')
assert.ok(out.timeline.chapters.length >= 1)
assert.ok(parsed.review, 'summary carries the deterministic review block')
console.log('SMOKE OK', out.summary.replace(/\n/g, ' '))
