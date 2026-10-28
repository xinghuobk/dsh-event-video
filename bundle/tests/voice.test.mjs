import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const home = await mkdtemp(join(tmpdir(), 'dsh-event-video-voice-'))
process.env.DSH_EVENT_VIDEO_HOME = home
await mkdir(join(home, 'camera'), { recursive: true })

const fakeScript = join(home, 'fake-tts.cjs')
const spokenFile = join(home, 'spoken.txt')
await writeFile(fakeScript, 'require("fs").writeFileSync(process.argv[2], process.argv[3] || "")\n', 'utf8')
process.env.DSH_EVENT_VIDEO_TTS_COMMAND = process.execPath
process.env.DSH_EVENT_VIDEO_TTS_ARGS = `${fakeScript}|${spokenFile}`

const { __test } = await import('../index.js')

const spoken = await __test.speakText('你好，事件触发的语音测试')
assert.equal(spoken.ok, true)
assert.equal(spoken.provider, 'command')
const written = await readFile(spokenFile, 'utf8')
assert.equal(written, '你好，事件触发的语音测试')

const rendered = __test.renderVoiceTemplate('检测到 {kind}，动作 {gesture}，时间 {time}',
  { kind: 'gesture', gesture: 'open_palm', ts: 105 }, { startedAt: 100 })
assert.ok(rendered.includes('gesture'))
assert.ok(rendered.includes('open_palm'))
assert.ok(rendered.includes('00:05'))

assert.equal(__test.renderVoiceTemplate(null, { kind: 'wave' }, {}), '检测到 wave')

await assert.rejects(() => __test.speakText('   '), /required/)
await assert.rejects(() => __test.speakText('x'.repeat(301)), /300/)

const timedOut = await __test.cameraVoiceReact({ kinds: ['wave'], timeoutS: 1, template: '检测到 {kind}' })
assert.equal(timedOut.ok, false)
assert.equal(timedOut.timedOut, true)

__test.configure({ enableVoice: false })
await assert.rejects(() => __test.speakText('x'), /disabled/)
await assert.rejects(() => __test.cameraVoiceReact({ timeoutS: 1 }), /disabled/)
__test.configure({})

console.log('VOICE OK')
