import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, unlink, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const home = await mkdtemp(join(tmpdir(), 'dsh-event-video-fuse-'))
process.env.DSH_EVENT_VIDEO_HOME = home

const ocrScript = join(home, 'fake-ocr.mjs')
await writeFile(ocrScript, [
  'const image = process.argv[process.argv.length - 1]',
  'process.stdout.write(JSON.stringify({ engine: "fake-ocr", text: "$220.00", lines: ["$220.00"], boxes: [[560, 250, 650, 275]], image }) + "\\n")',
].join('\n'), 'utf8')

const groundInside = join(home, 'ground-inside.mjs')
await writeFile(groundInside, [
  'process.stdout.write(JSON.stringify({ engine: "fake-ground", point: [600, 260], raw: "(600,260)" }) + "\\n")',
].join('\n'), 'utf8')
const groundOutside = join(home, 'ground-outside.mjs')
await writeFile(groundOutside, [
  'process.stdout.write(JSON.stringify({ engine: "fake-ground", point: [100, 100], raw: "(100,100)" }) + "\\n")',
].join('\n'), 'utf8')

process.env.DSH_EVENT_VIDEO_OCR_COMMAND = process.execPath
process.env.DSH_EVENT_VIDEO_OCR_ARGS = ocrScript
process.env.DSH_EVENT_VIDEO_GROUND_COMMAND = process.execPath
process.env.DSH_EVENT_VIDEO_GROUND_ARGS = groundInside

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

const match = __test.matchOcrTarget(['$220.00', 'THE UNSPOKEN'], [[560, 250, 650, 275], [10, 20, 100, 40]], '商品价格 $220.00')
assert.equal(match.text, '$220.00')
assert.deepEqual(match.box, [560, 250, 650, 275])

const fused = await __test.fuseVisionEvidence(out, 2, '商品价格 $220.00')
assert.equal(fused.inside, true)
assert.equal(fused.confidence, 0.95)
assert.equal(fused.matchedText, '$220.00')
assert.deepEqual(fused.conflicts, [])
assert.equal(fused.evidence.length, 2)
assert.equal(fused.evidence[0].source, 'ocr')
assert.equal(fused.evidence[1].source, 'ui-tars')

__test.configure({ groundArgs: [groundOutside] })
const outside = await __test.fuseVisionEvidence(out, 2, '价格 $220.00 第二次')
assert.equal(outside.inside, false)
assert.equal(outside.confidence, 0.45)
assert.ok(outside.conflicts.includes('point_outside_ocr_box'))

__test.configure({ groundArgs: [groundInside] })
const consensus = await __test.fuseVisionEvidence(out, 2, '价格 $220.00 共识', { samples: 3 })
assert.equal(consensus.samples, 3)
assert.equal(consensus.consensus.agreement, 1)
assert.equal(consensus.consensus.variants.length, 3)
assert.equal(consensus.inside, true)
assert.equal(consensus.confidence, 0.98)

await writeFile(join(out, 'vision.json'), JSON.stringify({
  version: 1, descriptions: [{ t0: 2, frame: 'f_000003.jpg', description: '页面显示价格 $220.00，品牌 orinodo，设计简约。' }],
}), 'utf8')
const withDescription = await __test.fuseVisionEvidence(out, 2, '价格 $220.00 描述')
assert.ok(withDescription.descriptionCheck)
assert.ok(withDescription.descriptionCheck.contradictions.includes('orinodo'))
assert.ok(withDescription.conflicts.includes('description_ocr_mismatch'))
assert.ok(withDescription.confidence <= 0.7)

await unlink(join(out, 'vision.json'))
const ticket = await __test.fuseToWorkItem(out, 2, '价格 $220.00 工单', { samples: 3, title: '价格元素核对' })
assert.equal(ticket.ok, true)
assert.equal(ticket.item.priority, 'P1')
assert.equal(ticket.item.title, '价格元素核对')
assert.ok(ticket.item.detail.includes('点-框命中'))
assert.equal(ticket.export.kind, 'tickets')
const exportFiles = await readdir(ticket.export.dir)
assert.ok(exportFiles.includes('tickets.md'))
assert.ok(exportFiles.includes('tickets.json'))

console.log('FUSE OK')
