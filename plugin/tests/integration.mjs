import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Run with: node plugin/tests/integration.mjs
// Requires EVENT_BUILD_VIDEO and EVENT_BUILD_TRANSCRIPT (see smoke.mjs).
const profileDir = process.env.DSH_PROFILE_DIR
  ?? join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.dsh', 'profiles', process.env.DSH_PROFILE ?? 'desktop')
const entry = process.env.EVENT_VIDEO_PLUGIN
  ?? join(profileDir, 'node_modules', 'dsh-event-video', 'lib', 'index.js')
const mod = await import(pathToFileURL(entry).href)

const video = process.env.EVENT_BUILD_VIDEO
const transcript = process.env.EVENT_BUILD_TRANSCRIPT
if (!video || !transcript) {
  throw new Error('set EVENT_BUILD_VIDEO and EVENT_BUILD_TRANSCRIPT to run the integration test')
}

const outDir = process.env.EVENT_BUILD_OUT ?? join(process.env.TEMP ?? '/tmp', 'event-video-integration')
const config = {
  pythonPath: process.env.EVENT_BUILD_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'),
  defaultOutDir: outDir,
  timeoutMs: 600000,
}
const registered = []
const ctx = { effect: (fn) => fn(), tools: { register: (def) => { registered.push(def); return () => {} } } }
mod.apply(ctx, config)
assert.equal(registered[0].name, 'build_video_event')

const raw = await registered[0].execute({ video, transcript, duration: 40, out: outDir })
const summary = JSON.parse(raw.summary)
assert.equal(summary.gates, 'PASS')
assert.ok(summary.chapters >= 1, 'summary carries chapter count')
assert.ok(summary.attention_top && summary.attention_top.emphasis >= 0, 'summary carries the top-attention state')
assert.equal(raw.timeline.kind, 'event-video-timeline')
assert.equal(raw.timeline.chapters.length, summary.chapters)
assert.ok(Array.isArray(summary.review.flags), 'summary carries review flags')

const event = JSON.parse(await readFile(join(outDir, 'event.json'), 'utf8'))
assert.ok(event.chapters.length >= 1)
assert.equal(event.gates.chapters_partition.ok, true)
assert.ok(event.states.every((s) => s.attention && typeof s.attention.emphasis === 'number'))
assert.equal(event.schema_version, 1)
assert.ok(event.review && Array.isArray(event.review.flags), 'event carries the embedded review block')

console.log('INTEGRATION OK', JSON.stringify({
  mode: summary.mode,
  chapters: summary.chapters,
  states: summary.states,
  flags: summary.review.flags.length,
}))
