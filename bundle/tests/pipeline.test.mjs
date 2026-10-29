import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const home = await mkdtemp(join(tmpdir(), 'dsh-event-video-pipeline-'))
process.env.DSH_EVENT_VIDEO_HOME = home
const ocrScript = join(home, 'fake-ocr.mjs')
await writeFile(ocrScript, [
  'const image = process.argv[process.argv.length - 1]',
  'process.stdout.write(JSON.stringify({ engine: "fake-ocr", text: "$220.00", lines: ["$220.00"], boxes: [[560, 250, 650, 275]], image }) + "\\n")',
].join('\n'), 'utf8')
const groundScript = join(home, 'fake-ground.mjs')
await writeFile(groundScript, [
  'process.stdout.write(JSON.stringify({ engine: "fake-ground", point: [600, 260], raw: "(600,260)" }) + "\\n")',
].join('\n'), 'utf8')
process.env.DSH_EVENT_VIDEO_OCR_COMMAND = process.execPath
process.env.DSH_EVENT_VIDEO_OCR_ARGS = ocrScript
process.env.DSH_EVENT_VIDEO_GROUND_COMMAND = process.execPath
process.env.DSH_EVENT_VIDEO_GROUND_ARGS = groundScript

const out = join(home, 'video-events', 'demo')
await mkdir(join(out, 'frames'), { recursive: true })
await writeFile(join(out, 'event.json'), JSON.stringify({
  schema_version: 1, video: null, mode: 'screen', fps: 1, start: 0, span_s: 5, frames: 5,
  states: [
    { t0: 0, t1: 2, url_hint: null, label_hi: 'A', attention: { emphasis: 1 } },
    { t0: 2, t1: 5, url_hint: null, label_hi: 'B', attention: { emphasis: 3 } },
  ],
  chapters: [{ t0: 2, t1: 5, reason: 'topic', url: null, dwell: 3, attention: 3 }],
  units: [], gaps: [], gates: { all_ok: true },
}), 'utf8')
await writeFile(join(out, 'frames', 'f_000003.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))

const { __test } = await import('../index.js')

const result = await __test.runVisionPipeline(out, {
  instructions: ['价格 $220.00'],
  times: [2],
  samples: 3,
})
assert.equal(result.ok, true)
assert.equal(result.tickets.length, 1)
assert.equal(result.tickets[0].confidence, 0.98)
assert.equal(result.tickets[0].instruction, '价格 $220.00')
assert.equal(result.tickets[0].ticket.priority, 'P1')
assert.ok(result.stages.some((stage) => stage.stage === 'fuse_tickets'))
assert.equal(__test.runPipelineTool.name, 'run_vision_pipeline')

const progress = JSON.parse(await readFile(join(out, 'pipeline-progress.json'), 'utf8'))
assert.equal(progress.running, false)
assert.equal(progress.done, 1)

const saved = JSON.parse(await readFile(join(out, 'pipeline.json'), 'utf8'))
assert.equal(saved.tickets.length, 1)
assert.ok(saved.stages.some((stage) => stage.stage === 'fuse_tickets'))

const defaults = await __test.runVisionPipeline(out, { instructions: [] })
assert.equal(defaults.ok, true)

console.log('PIPELINE OK')
