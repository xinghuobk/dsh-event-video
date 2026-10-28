/**
 * dsh-event-video — model-facing tool that builds a verified event record.
 *
 * Deliberately dependency-free: the loader resolves bare specifiers from the
 * application install, not the profile, and the profile's shared fallback holds
 * an older Harness API. This plugin therefore imports nothing but Node builtins
 * and hands the tools registry a plain ToolDefinition object.
 */
import { execFile } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Default data home: <DSH_EVENT_VIDEO_HOME> or ~/event-video. */
function eventHome() {
  return process.env.DSH_EVENT_VIDEO_HOME || join(os.homedir(), 'event-video')
}

export const name = 'event-video'

export const inject = ['tools']

const DEFAULTS = {
  pythonPath: process.platform === 'win32' ? 'python' : 'python3',
  modelPath: '',
  defaultOutDir: join(eventHome(), 'video-events'),
  timeoutMs: 1800000,
  fps: 1,
  sceneTh: 9,
  maxDurationSec: 0,
  asrDevice: 'cpu',
  language: 'zh',
}

function resolveConfig(raw) {
  const cfg = { ...DEFAULTS, ...(raw ?? {}) }
  if (typeof cfg.pythonPath !== 'string' || cfg.pythonPath.length === 0) {
    throw new Error('event-video: pythonPath must be a non-empty string')
  }
  if (!Number.isFinite(cfg.timeoutMs) || cfg.timeoutMs <= 0) {
    throw new Error('event-video: timeoutMs must be a positive number')
  }
  if (!['cpu', 'cuda', 'auto'].includes(cfg.asrDevice)) {
    throw new Error('event-video: asrDevice must be cpu, cuda or auto')
  }
  return cfg
}

function summaryText(event, outDir) {
  const gates = event.gates ?? {}
  const failed = Object.entries(gates).filter(([, v]) => v && v.ok === false).map(([k]) => k)
  const top = (event.states ?? []).reduce((best, s) => {
    const e = s.attention?.emphasis ?? 0
    return e > (best?.emphasis ?? -1) ? { t0: s.t0, t1: s.t1, emphasis: e, url: s.url_hint ?? null } : best
  }, null)
  return JSON.stringify({
    out: outDir,
    mode: event.mode,
    frames: event.frames,
    states: event.states?.length ?? 0,
    transitions: event.transitions?.length ?? 0,
    units: event.units?.length ?? 0,
    chapters: event.chapters?.length ?? 0,
    gaps: event.gaps?.length ?? 0,
    attention_top: top,
    alignment: event.alignment,
    gates: gates.all_ok ? 'PASS' : `FAIL: ${failed.join(', ')}`,
    review: event.review ?? null,
  }, null, 1)
}

/** Structured card payload: the persisted presentationMeta a client timeline card reads. */
function timelineMeta(event, outDir) {
  const gates = event.gates ?? {}
  const failed = Object.entries(gates).filter(([, v]) => v && v.ok === false).map(([k]) => k)
  const states = event.states ?? []
  const top = [...states]
    .sort((a, b) => (b.attention?.emphasis ?? 0) - (a.attention?.emphasis ?? 0))
    .slice(0, 6)
    .map(s => ({ t0: s.t0, t1: s.t1, emphasis: s.attention?.emphasis ?? 0,
                 deictic: s.attention?.deictic_hits ?? 0, action: s.attention?.action_hits ?? 0,
                 url: s.url_hint ?? null }))
  return {
    kind: 'event-video-timeline',
    out: outDir,
    mode: event.mode,
    frames: event.frames,
    states: states.length,
    transitions: event.transitions?.length ?? 0,
    units: event.units?.length ?? 0,
    gaps: event.gaps?.length ?? 0,
    span: event.span_s ?? 0,
    gates: gates.all_ok ? 'PASS' : `FAIL: ${failed.join(', ')}`,
    chapters: (event.chapters ?? []).map(c => ({
      t0: c.t0, t1: c.t1, dwell: c.dwell, attention: c.attention,
      reason: c.reason, url: c.url ?? null,
    })),
    top,
  }
}

const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['video'],
  properties: {
    video: { type: 'string', description: 'Absolute path to the local video file.' },
    out: { type: 'string', description: 'Output directory; defaults to a timestamped dir under the configured root.' },
    transcript: { type: 'string', description: 'Path to a [mm:ss] text transcript. Omit when using asr.' },
    asr: { type: 'boolean', description: 'Transcribe locally with the configured faster-whisper model.' },
    asr_device: { type: 'string', enum: ['cpu', 'cuda', 'auto'], description: 'ASR device; cpu avoids the GPU power spike that can hard-reset this machine.' },
    language: { type: 'string', description: 'Spoken language for ASR (default zh).' },
    duration: { type: 'number', description: 'Only process the first N seconds.' },
    mode: { type: 'string', enum: ['auto', 'screen', 'action', 'talk'], description: 'Content mode.' },
    hi_labels: { type: 'boolean', description: 'High-resolution OCR for state labels (slower).' },
  },
}

export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  const definition = {
    name: 'build_video_event',
    description: 'Build a verified event record from a local video: frame state machine, speech units, timestamp anchors, semantic chapters, attention proxy, and completeness gates. Returns the output directory, counts, and a deterministic `review` block (flags worth double-checking). Use when the user wants a long video read completely with every statement anchored to a timestamp. Always report the review flags in your answer.',
    parameters: PARAMETERS,
    output: {
      schema: {
        type: 'object',
        properties: { summary: { type: 'string' }, timeline: { type: 'object', additionalProperties: true } },
        required: ['summary'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.summary }],
      presentationMeta: (_args, value) => value.timeline,
    },
    timeoutMs: config.timeoutMs,
    async execute(args) {
      if (config.modelPath === '' && args.asr === true) {
        throw new Error('event-video: `asr` needs Config.modelPath (a local faster-whisper model directory)')
      }
      const outDir = args.out ?? join(config.defaultOutDir || process.cwd(), `event-${Date.now()}`)
      await mkdir(outDir, { recursive: true })
      const cli = ['-m', 'event_build.cli', args.video, '--out', outDir,
        '--fps', String(config.fps), '--scene-th', String(config.sceneTh)]
      if (args.transcript) cli.push('--transcript', args.transcript)
      else if (args.asr) {
        cli.push('--asr', '--whisper-model', config.modelPath)
        const device = args.asr_device ?? config.asrDevice
        if (device !== 'auto') cli.push('--asr-device', device)
        cli.push('--language', args.language ?? config.language)
      } else throw new Error('event-video: provide `transcript` or `asr`')
      if (args.duration) cli.push('--duration', String(args.duration))
      if (args.mode) cli.push('--mode', args.mode)
      if (args.hi_labels) cli.push('--hi-labels')
      try {
        await run(config.pythonPath, cli, { timeout: config.timeoutMs, maxBuffer: 64 * 1024 * 1024 })
      } catch (error) {
        const detail = `${error.stderr ?? ''}`.trim().split('\n').slice(-6).join('\n')
        throw new Error(`event-video build failed: ${error.message}${detail ? `\n${detail}` : ''}`)
      }
      const event = JSON.parse(await readFile(join(outDir, 'event.json'), 'utf8'))
      try {
        await writeFile(join(outDir, 'review.json'), JSON.stringify({
          video: args.video,
          out: outDir,
          created: new Date().toISOString(),
        }, null, 2))
      } catch {
        /* the review sidecar is optional: the panel then shows "no video" */
      }
      return { summary: summaryText(event, outDir), timeline: timelineMeta(event, outDir) }
    },
  }
  ctx.effect(() => ctx.tools.register(definition))
}
