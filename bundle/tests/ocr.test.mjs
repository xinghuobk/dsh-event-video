import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const home = await mkdtemp(join(tmpdir(), 'dsh-event-video-ocr-'))
process.env.DSH_EVENT_VIDEO_HOME = home
const fakeScript = join(home, 'fake-ocr.mjs')
await writeFile(fakeScript, [
  'const image = process.argv[process.argv.length - 1]',
  'process.stdout.write(JSON.stringify({ engine: "fake-ocr", text: "THE UNSPOKEN\\n$220.00", lines: ["THE UNSPOKEN", "$220.00"], image }) + "\\n")',
].join('\n'), 'utf8')
process.env.DSH_EVENT_VIDEO_OCR_COMMAND = process.execPath
process.env.DSH_EVENT_VIDEO_OCR_ARGS = fakeScript

const records = join(home, 'video-events')
const out = join(records, 'demo')
await mkdir(join(out, 'frames'), { recursive: true })
await writeFile(join(out, 'event.json'), JSON.stringify({
  schema_version: 1, video: null, mode: 'screen', fps: 1, start: 0, span_s: 5, frames: 5,
  states: [{ t0: 0, t1: 5, url_hint: null, label_hi: 'Demo', attention: { emphasis: 1 } }],
  chapters: [{ t0: 0, t1: 5, reason: 'topic', url: null, dwell: 5, attention: 1 }],
  units: [], gaps: [], gates: { all_ok: true },
}), 'utf8')
await writeFile(join(out, 'frames', 'f_000003.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))

const { __test } = await import('../index.js')

const result = await __test.ocrFrame(out, 2)
assert.equal(result.engine, 'fake-ocr')
assert.ok(result.text.includes('THE UNSPOKEN'))
assert.equal(result.frame, join(out, 'frames', 'f_000003.jpg'))
assert.equal(result.t, 2)
assert.ok(result.seconds >= 0)
const again = await __test.ocrFrame(out, 2)
assert.equal(again.cached, true)
assert.equal(again.text, result.text)

const tool = __test.ocrFrameTool
assert.equal(tool.name, 'ocr_video_frame')
assert.deepEqual(tool.parameters.required, ['out', 't'])

__test.configure({ enableOcr: false })
await assert.rejects(() => __test.ocrFrame(out, 2), /disabled/)
delete process.env.DSH_EVENT_VIDEO_OCR_COMMAND
__test.configure({ ocrCommand: '' })
await assert.rejects(() => __test.ocrFrame(out, 2), /not configured/)

console.log('OCR TOOL OK')
