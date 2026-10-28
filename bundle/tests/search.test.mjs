import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const home = await mkdtemp(join(tmpdir(), 'dsh-event-video-search-'))
process.env.DSH_EVENT_VIDEO_HOME = home
const recordsDir = join(home, 'video-events')
await mkdir(recordsDir, { recursive: true })

const { __test } = await import('../index.js')

async function makeRecord(name, title, units) {
  const out = join(recordsDir, name)
  await mkdir(out, { recursive: true })
  const event = {
    schema_version: 1, video: null, mode: 'screen', fps: 1, start: 0, span_s: 30, frames: 30,
    states: [{ t0: 0, t1: 30, url_hint: 'https://example.com', label_hi: `${title} 页面`, attention: { emphasis: 3 } }],
    chapters: [{ t0: 0, t1: 30, reason: 'topic', url: null, dwell: 30, attention: 3 }],
    units: units.map((text, index) => ({ t0: 12 + index * 3, t1: 15 + index * 3, text })),
    gaps: [], gates: { all_ok: true },
  }
  await writeFile(join(out, 'event.json'), JSON.stringify(event), 'utf8')
  return out
}

const reviewOut = await makeRecord('review', 'ORIMODO 评审', [
  'Google 登录无法登录，授权错误需要排查',
  '顶部栏滚到顶会突然弹出功能框',
])
const copyOut = await makeRecord('review-copy', 'ORIMODO 评审（副本）', [
  'Google 登录无法登录，授权错误需要排查',
  '顶部栏滚到顶会突然弹出功能框',
])
const productOut = await makeRecord('product', '商品页评审', [
  '左侧缩略图间距太大，底部要渐隐',
  '规格 ×1 ×2 要分两块左对齐',
])
await writeFile(join(recordsDir, 'index.json'), JSON.stringify({
  version: 1,
  items: [
    { id: 'a', videoId: 'vid-a', title: 'ORIMODO 评审', out: reviewOut, updated: '2026-10-29T01:00:00Z' },
    { id: 'c', videoId: 'vid-a', title: 'ORIMODO 评审（副本）', out: copyOut, updated: '2026-10-29T01:30:00Z' },
    { id: 'b', videoId: 'vid-b', title: '商品页评审', out: productOut, updated: '2026-10-29T02:00:00Z' },
  ],
}), 'utf8')

const byLogin = await __test.searchLibrary('登录', 5)
assert.ok(byLogin.total >= 1)
assert.equal(byLogin.hits[0].title, 'ORIMODO 评审')
assert.equal(byLogin.hits[0].at, '00:12')
assert.equal(byLogin.hits[0].frame, 'f_000013.jpg')
assert.ok(byLogin.hits[0].text.includes('登录'))

const loginHits = byLogin.hits.filter((hit) => hit.text.includes('授权'))
assert.equal(loginHits.length, 1, 'duplicate builds of one video are collapsed')
assert.ok(loginHits[0].duplicates >= 1)

const byThumb = await __test.searchLibrary('缩略图', 5)
assert.equal(byThumb.hits[0].title, '商品页评审')
assert.equal(byThumb.hits[0].at, '00:12')

const answer = await __test.askVideoLibrary('登录问题怎么处理', 4)
assert.ok(answer.evidence.length >= 1)
assert.ok(answer.answer_guidance.includes('Cite'))
assert.ok(answer.evidence[0].title === 'ORIMODO 评审')

const empty = await __test.searchLibrary('   ', 5)
assert.equal(empty.total, 0)
assert.deepEqual(empty.hits, [])

assert.ok(__test.tokenize('登录 login').includes('登录'))
assert.ok(__test.tokenize('登录').includes('登'))

console.log('SEARCH TOOLS OK')
