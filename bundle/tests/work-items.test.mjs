import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const home = await mkdtemp(join(tmpdir(), 'dsh-event-video-work-'))
process.env.DSH_EVENT_VIDEO_HOME = home
const records = join(home, 'video-events')

const { __test } = await import('../index.js')

async function makeRecord(name, { flags = [], units = [], chapters = [] } = {}) {
  const out = join(records, name)
  await mkdir(out, { recursive: true })
  const event = {
    schema_version: 1, video: null, mode: 'screen', fps: 1, start: 0, span_s: 20, frames: 20,
    states: [{ t0: 0, t1: 20, url_hint: 'https://example.com', label_hi: 'Demo', attention: { emphasis: 2 } }],
    chapters: chapters.length > 0 ? chapters : [{ t0: 0, t1: 20, reason: 'topic', url: null, dwell: 20, attention: 2 }],
    units: units.map((text, index) => ({ t0: 5 + index * 3, t1: 8 + index * 3, text })),
    gaps: [],
    gates: { all_ok: true },
    review: { flags },
  }
  await writeFile(join(out, 'event.json'), JSON.stringify(event), 'utf8')
  return out
}

const withItems = await makeRecord('review', {
  flags: [{ level: 'warn', code: 'weak_action_alignment', message: '动作对齐命中率偏低：0.5' }],
  chapters: [
    { t0: 0, t1: 10, reason: 'topic', url: 'https://example.com/a', dwell: 10, attention: 2 },
    { t0: 10, t1: 20, reason: 'url', url: 'https://example.com/b', dwell: 10, attention: 5 },
  ],
})
await __test.addAnnotation(withItems, { t0: 6, text: '按钮对比度需要提高', author: 'user' })

const tickets = await __test.exportWorkItems(withItems, 'tickets')
assert.equal(tickets.ok, true)
assert.ok(tickets.count >= 2, 'annotation + review flag become tickets')
const md = await readFile(join(tickets.dir, 'tickets.md'), 'utf8')
assert.ok(md.includes('按钮对比度需要提高'))
assert.ok(md.includes('证据帧：f_000007.jpg'))
assert.ok(md.includes('weak_action_alignment'))
const csv = await readFile(join(tickets.dir, 'tickets.csv'), 'utf8')
assert.ok(csv.split('\n')[0].startsWith('title,priority,time,frame'))
const json = JSON.parse(await readFile(join(tickets.dir, 'tickets.json'), 'utf8'))
assert.equal(json.kind, 'tickets')
assert.ok(json.items.every((item) => item.source))

const sop = await __test.exportWorkItems(withItems, 'sop')
assert.equal(sop.count, 2, 'one SOP step per chapter')
const sopMd = await readFile(join(sop.dir, 'sop.md'), 'utf8')
assert.ok(sopMd.includes('| 步骤 |'))
assert.ok(sopMd.includes('https://example.com/b'))

const explicit = await __test.exportWorkItems(withItems, 'tickets', [
  { title: '修复导航', priority: 'P0', t0: 12, acceptance: '导航单行展示' },
])
assert.equal(explicit.count, 1)
const explicitMd = await readFile(join(explicit.dir, 'tickets.md'), 'utf8')
assert.ok(explicitMd.includes('[P0] 修复导航'))
assert.ok(explicitMd.includes('导航单行展示'))

assert.throws(() => __test.normalizeWorkItems([{}]), /missing a title/)
assert.throws(() => __test.normalizeWorkItems('nope'), /must be an array/)

const legacy = await makeRecord('legacy')
const legacyEvent = JSON.parse(await readFile(join(legacy, 'event.json'), 'utf8'))
legacyEvent.states[0].url_hint = 'https://example.com/login?analytics_trace_id-1'
delete legacyEvent.review
await writeFile(join(legacy, 'event.json'), JSON.stringify(legacyEvent), 'utf8')
const fallback = await __test.exportWorkItems(legacy, 'tickets')
assert.ok(fallback.count >= 1, 'records without an embedded review fall back to deterministic review')
const fallbackMd = await readFile(join(fallback.dir, 'tickets.md'), 'utf8')
assert.ok(fallbackMd.includes('证据帧：'), 'review tickets carry a frame anchor')

const empty = await makeRecord('empty')
await assert.rejects(() => __test.exportWorkItems(empty, 'tickets'), /no action items/)

console.log('WORK ITEMS OK')
