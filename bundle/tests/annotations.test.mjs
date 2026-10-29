import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const home = await mkdtemp(join(tmpdir(), 'dsh-event-video-anno-'))
process.env.DSH_EVENT_VIDEO_HOME = home
const records = join(home, 'video-events')
const out = join(records, 'demo')
await mkdir(join(out, 'frames'), { recursive: true })

const { __test } = await import('../index.js')

const event = {
  schema_version: 1, video: null, mode: 'screen', fps: 1, start: 0, span_s: 10, frames: 10,
  states: [{ t0: 0, t1: 10, url_hint: 'https://example.com', label_hi: 'Demo', attention: { emphasis: 2 } }],
  chapters: [{ t0: 0, t1: 10, reason: 'topic', url: null, dwell: 10, attention: 2 }],
  units: [{ t0: 5, t1: 6, text: '这一句需要标注' }],
  gaps: [], gates: { all_ok: true },
}
const eventPath = join(out, 'event.json')
await writeFile(eventPath, JSON.stringify(event), 'utf8')
const original = await readFile(eventPath)

const added = await __test.addAnnotation(out, { t0: 5, text: ' 测试标注：这里需要确认按钮对比度 ', author: 'tester' })
assert.equal(added.ok, true)
assert.equal(added.annotation.text, '测试标注：这里需要确认按钮对比度')
assert.equal(added.annotation.frame, 'f_000006.jpg')
assert.equal(added.annotation.author, 'tester')

const sidecar = JSON.parse(await readFile(join(out, 'annotations.json'), 'utf8'))
assert.equal(sidecar.annotations.length, 1)

const after = await readFile(eventPath)
assert.deepEqual(after, original, 'event.json must not be modified by annotations')

const listed = await __test.readAnnotations(out)
assert.equal(listed.annotations.length, 1)

const updated = await __test.updateAnnotation(out, added.annotation.id, { text: '改过的标注' })
assert.equal(updated.annotation.text, '改过的标注')
assert.equal(updated.annotation.frame, 'f_000006.jpg')

const resolved = await __test.updateAnnotation(out, added.annotation.id, { resolved: true })
assert.equal(resolved.annotation.resolved, true)
const openItem = await __test.addAnnotation(out, { t0: 2, text: '仍待处理的问题' })
const replied = await __test.addReply(out, openItem.annotation.id, { text: '我来看看这个对比度', author: 'reviewer' })
assert.equal(replied.ok, true)
assert.equal(replied.annotation.replies.length, 1)
assert.equal(replied.annotation.replies[0].author, 'reviewer')
assert.equal(__test.replyAnnotationTool.name, 'reply_video_annotation')
await assert.rejects(() => __test.addReply(out, openItem.annotation.id, { text: '   ' }), /reply text is required/)
const workItems = await __test.workItemsFromRecord(out)
assert.ok(workItems.some((item) => item.title === '仍待处理的问题'), 'unresolved annotation becomes a work item')
assert.ok(!workItems.some((item) => item.title === '改过的标注'), 'resolved annotation is excluded')
assert.ok(workItems.some((item) => item.title === '仍待处理的问题' && item.detail.includes('1 条回复')), 'reply count appears in the work item')
assert.equal(__test.resolveAnnotationTool.name, 'resolve_video_annotation')

const record = __test.recordFromEvent(event, out, 'Demo record')
const markdown = __test.recordMarkdown(record, event, (await __test.readAnnotations(out)).annotations)
assert.ok(markdown.includes('## 标注'))
assert.ok(markdown.includes('改过的标注'))

await assert.rejects(() => __test.addAnnotation(out, { t0: 1, text: '   ' }), /text is required/)
await assert.rejects(() => __test.addAnnotation(out, { t0: 1, text: 'x'.repeat(501) }), /500/)
await assert.rejects(() => __test.addAnnotation(join(home, '..', 'outside'), { t0: 1, text: 'x' }), /outside allowed roots/)
await assert.rejects(() => __test.deleteAnnotation(out, 'missing-id'), /not found/)

const removed = await __test.deleteAnnotation(out, added.annotation.id)
assert.equal(removed.annotations.length, 1)
const removedOpen = await __test.deleteAnnotation(out, openItem.annotation.id)
assert.equal(removedOpen.annotations.length, 0)

console.log('ANNOTATIONS OK')
