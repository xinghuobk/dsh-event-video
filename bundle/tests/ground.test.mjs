import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const home = await mkdtemp(join(tmpdir(), 'dsh-event-video-ground-'))
process.env.DSH_EVENT_VIDEO_HOME = home
const fakeScript = join(home, 'fake-ground.mjs')
await writeFile(fakeScript, [
  'const args = process.argv.slice(2)',
  'const image = args[args.indexOf("--image") + 1]',
  'const instruction = args[args.indexOf("--instruction") + 1]',
  'process.stdout.write(JSON.stringify({ engine: "fake-ground", instruction, point: [100, 200], box: [90, 180, 110, 220], normalized: [100, 200], raw: "click(point=\'<|box_start|>(100,200)<|box_end|>\')", image }) + "\\n")',
].join('\n'), 'utf8')
process.env.DSH_EVENT_VIDEO_GROUND_COMMAND = process.execPath
process.env.DSH_EVENT_VIDEO_GROUND_ARGS = fakeScript

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

const result = await __test.groundUiElement(out, 2, '商品价格')
assert.equal(result.engine, 'fake-ground')
assert.equal(result.instruction, '商品价格')
assert.deepEqual(result.point, [100, 200])
assert.equal(result.frame, join(out, 'frames', 'f_000003.jpg'))
assert.equal(result.t, 2)
const again = await __test.groundUiElement(out, 2, '商品价格')
assert.equal(again.cached, true)

assert.equal(__test.groundUiTool.name, 'ground_ui_element')
assert.deepEqual(__test.groundUiTool.parameters.required, ['out', 't', 'instruction'])

__test.configure({ enableGround: false })
await assert.rejects(() => __test.groundUiElement(out, 2, 'x'), /disabled/)
delete process.env.DSH_EVENT_VIDEO_GROUND_COMMAND
__test.configure({ groundCommand: '' })
await assert.rejects(() => __test.groundUiElement(out, 2, 'x'), /not configured/)

console.log('GROUND TOOL OK')
