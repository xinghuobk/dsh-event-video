import assert from 'node:assert/strict'
import { mkdtemp, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const home = await mkdtemp(join(tmpdir(), 'dsh-event-video-camera-'))
process.env.DSH_EVENT_VIDEO_HOME = home
await mkdir(join(home, 'camera'), { recursive: true })

const { __test } = await import('../index.js')

const raised = await __test.cameraFeedback('smile', 'neutral')
assert.equal(raised.ok, true)
assert.ok(raised.thresholds.smile > 0.35, 'false-positive smile feedback raises the threshold')
assert.equal(raised.total, 1)

const lowered = await __test.cameraFeedback('neutral', 'smile')
assert.ok(lowered.thresholds.smile < raised.thresholds.smile, 'missed-smile feedback lowers the threshold')

const profile = await __test.cameraProfile()
assert.equal(profile.feedback.total, 2)
assert.deepEqual(profile.feedback.last.corrected, 'smile')
assert.ok(profile.updatedAt)

await assert.rejects(() => __test.cameraFeedback('', 'smile'), /required/)
await assert.rejects(() => __test.cameraFeedback('smile', ''), /required/)

__test.configure({ enableCameraSignals: false })
await assert.rejects(() => __test.calibrateCamera(3), /disabled/)
__test.configure({})

console.log('CAMERA PROFILE OK')
