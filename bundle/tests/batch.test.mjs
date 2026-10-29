import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const home = await mkdtemp(join(tmpdir(), 'dsh-event-video-batch-'))
process.env.DSH_EVENT_VIDEO_HOME = home
const ocrScript = join(home, 'fake-ocr.mjs')
await writeFile(ocrScript, [
  'process.stdout.write(JSON.stringify({ engine: "fake-ocr", text: "$220.00", lines: ["$220.00"], boxes: [[560, 250, 650, 275]] }) + "\\n")',
].join('\n'), 'utf8')
const groundScript = join(home, 'fake-ground.mjs')
await writeFile(groundScript, [
  'process.stdout.write(JSON.stringify({ engine: "fake-ground", point: [600, 260], raw: "(600,260)" }) + "\\n")',
].join('\n'), 'utf8')
process.env.DSH_EVENT_VIDEO_OCR_COMMAND = process.execPath
process.env.DSH_EVENT_VIDEO_OCR_ARGS = ocrScript
process.env.DSH_EVENT_VIDEO_GROUND_COMMAND = process.execPath
process.env.DSH_EVENT_VIDEO_GROUND_ARGS = groundScript

const records = join(home, 'video-events')
const outs = []
for (const name of ['a', 'b']) {
  const out = join(records, name)
  await mkdir(join(out, 'frames'), { recursive: true })
  await writeFile(join(out, 'event.json'), JSON.stringify({
    schema_version: 1, video: null, mode: 'screen', fps: 1, start: 0, span_s: 5, frames: 5,
    states: [{ t0: 2, t1: 5, url_hint: null, label_hi: name, attention: { emphasis: 1 } }],
    chapters: [{ t0: 2, t1: 5, reason: 'topic', url: null, dwell: 3, attention: 1 }],
    units: [], gaps: [], gates: { all_ok: true },
  }), 'utf8')
  await writeFile(join(out, 'frames', 'f_000003.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  outs.push(out)
}

const { __test } = await import('../index.js')

const started = await __test.startVisionBatch(outs, { instructions: ['价格 $220.00'], times: [2], samples: 3 })
assert.equal(started.ok, true)
assert.equal(started.records, 2)
const progress = await __test.readBatchProgress(started.id)
assert.ok(['running', 'done'].includes(progress.status))

const result = await __test.runVisionBatchAndWait(outs, { instructions: ['价格 $220.00'], times: [2], samples: 3 })
assert.equal(result.status, 'done')
assert.equal(result.records.length, 2)
assert.ok(result.records.every((item) => item.status === 'done'))
assert.ok(result.records.every((item) => item.tickets === 1))
assert.equal(__test.runBatchTool.name, 'run_vision_batch')

const files = await readdir(join(home, 'batches'))
assert.ok(files.length >= 1)
const saved = JSON.parse(await readFile(join(home, 'batches', files[files.length - 1]), 'utf8'))
assert.equal(saved.status, 'done')

await assert.rejects(() => __test.startVisionBatch([], {}), /records is required/)
await assert.rejects(() => __test.startVisionBatch([join(home, 'missing')], {}), /not an event record/)

console.log('BATCH OK')
