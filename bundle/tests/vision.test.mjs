import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import http from 'node:http'

const home = await mkdtemp(join(tmpdir(), 'dsh-event-video-vision-'))
let lastBody = ''
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    lastBody = body
    assert.ok(body.includes('image_url'), 'OpenAI-style request carries an image_url data payload')
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ message: { content: '假 VLM 描述：页面顶部是导航，中间是商品大图。' } }] }))
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port
process.env.DSH_EVENT_VIDEO_HOME = home
process.env.DSH_EVENT_VIDEO_VLM_ENDPOINT = `http://127.0.0.1:${port}/v1/chat/completions`
process.env.DSH_EVENT_VIDEO_VLM_MODEL = 'fake-vlm'

const records = join(home, 'video-events')
const out = join(records, 'demo')
await mkdir(join(out, 'frames'), { recursive: true })

const { __test } = await import('../index.js')

const event = {
  schema_version: 1, video: null, mode: 'screen', fps: 1, start: 0, span_s: 30, frames: 30,
  states: [
    { t0: 0, t1: 10, url_hint: 'https://example.com', label_hi: 'Home', attention: { emphasis: 2 } },
    { t0: 10, t1: 20, url_hint: 'https://example.com/p', label_hi: 'Product', attention: { emphasis: 9 } },
    { t0: 20, t1: 30, url_hint: null, label_hi: 'FAQ', attention: { emphasis: 1 } },
  ],
  chapters: [{ t0: 0, t1: 30, reason: 'topic', url: null, dwell: 30, attention: 4 }],
  units: [], gaps: [], gates: { all_ok: true },
}
await writeFile(join(out, 'event.json'), JSON.stringify(event), 'utf8')
for (const frame of ['f_000001.jpg', 'f_000011.jpg', 'f_000021.jpg']) {
  await writeFile(join(out, 'frames', frame), Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
}

const planned = __test.planVisionFrames(event, 2)
assert.equal(planned.length, 2)
assert.ok(planned.some((item) => item.t0 === 10), 'top-attention state is always sampled')
assert.ok(planned.every((item) => /^f_\d{6}\.jpg$/.test(item.frame)))

const result = await __test.describeRecord(out, { limit: 3 })
assert.equal(result.ok, true)
assert.equal(result.count, 3)
assert.equal(result.model, 'fake-vlm')
assert.ok(result.descriptions.every((item) => item.description.includes('假 VLM')))

const vision = JSON.parse(await readFile(join(out, 'vision.json'), 'utf8'))
assert.equal(vision.descriptions.length, 3)
assert.ok(vision.createdAt)

const sanitized = await __test.readVision(out)
assert.equal(sanitized.descriptions.length, 3)

const keyPlanned = __test.planKeyVisionFrames(event, 2)
assert.equal(keyPlanned.length, 2)
assert.ok(keyPlanned.some((item) => item.t0 === 10), 'key-frame plan keeps the top-attention state')

const keyResult = await __test.describeRecord(out, { limit: 2, keyFrames: true, think: true })
assert.equal(keyResult.ok, true)
assert.equal(keyResult.think, true)
assert.equal(keyResult.keyFrames, true)
assert.equal(keyResult.model, 'qwen3-vl:8b')
assert.ok(keyResult.count >= 1)
assert.ok(lastBody.includes('reasoning_effort') || lastBody.includes('max_tokens'), 'thinking requests carry a larger budget')

const keyVision = JSON.parse(await readFile(join(out, 'vision.json'), 'utf8'))
assert.equal(keyVision.think, true)
assert.equal(keyVision.keyFrames, true)

server.close()
console.log('VISION OK')
