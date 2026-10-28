import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Each test gets its own data home before the bundle module is imported,
// so the module-level configure() call sees a writable allowed root.
const home = await mkdtemp(join(tmpdir(), 'dsh-event-video-test-'))
process.env.DSH_EVENT_VIDEO_HOME = home
const records = join(home, 'video-events')
await mkdir(records, { recursive: true })

const { __test } = await import('../index.js')

const out = join(records, 'demo')
await mkdir(join(out, 'frames'), { recursive: true })
const event = {
  schema_version: 1,
  video: null,
  mode: 'screen',
  fps: 1,
  start: 0,
  span_s: 3,
  frames: 3,
  states: [
    { t0: 0, t1: 3, url_hint: 'https://example.com', label_hi: 'Demo page', attention: { emphasis: 5 } },
  ],
  chapters: [{ t0: 0, t1: 3, reason: 'topic', url: 'https://example.com', dwell: 3, attention: 5 }],
  units: [
    { t0: 0, t1: 1, text: '第一句' },
    { t0: 1, t1: 2, text: '第二句' },
  ],
  gaps: [],
  gates: { all_ok: true },
}
await writeFile(join(out, 'event.json'), JSON.stringify(event), 'utf8')
await writeFile(join(out, 'frames', 'f_000002.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))

const info = await __test.frameFor(out, 1.2)
assert.ok(info.frame.endsWith('f_000002.jpg'), 'picks the frame for the timestamp')
assert.equal(info.state.label, 'Demo page')
assert.equal(info.chapter.reason, 'topic')
assert.ok(info.transcript.length >= 1)
assert.ok(info.hint.includes('read_image'))

const tool = __test.readVideoFrameTool
assert.equal(tool.name, 'read_video_frame')
assert.deepEqual(tool.parameters.required, ['out', 't'])

await assert.rejects(() => __test.frameFor(join(home, '..', 'outside'), 1), /outside allowed roots/)
await assert.rejects(() => __test.frameFor(out, 'abc'), /must be a number/)

// A record without a frame on disk and without a video must fail loudly.
await mkdir(join(out, 'frames-empty'), { recursive: true })
await writeFile(join(out, 'frames-empty', 'event.json'), JSON.stringify({ ...event, fps: 10, video: null }), 'utf8')
await assert.rejects(() => __test.frameFor(join(out, 'frames-empty'), 5), /missing|not available/)

console.log('FRAME TOOL OK')
