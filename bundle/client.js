window.__ModuleLoader__.load({
  id: '@local/dsh-event-video-card',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useSyncExternalStore } = React

    const LS_KEY = 'dsh.event-video.records.v1'
    const MAX_RECORDS = 12
    const ACCENT = 'rgba(124,140,255,'
    let layout = null

    function readRecords() {
      try {
        const raw = localStorage.getItem(LS_KEY)
        const arr = raw ? JSON.parse(raw) : []
        return Array.isArray(arr) ? arr : []
      } catch {
        return []
      }
    }

    function persist(list) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, MAX_RECORDS)))
      } catch {
        /* storage full or disabled: keep the in-memory list */
      }
    }

    const store = {
      records: readRecords(),
      listeners: new Set(),
      subscribe(fn) {
        store.listeners.add(fn)
        return () => store.listeners.delete(fn)
      },
      get() {
        return store.records
      },
      emit() {
        for (const fn of [...store.listeners]) fn()
      },
      add(meta) {
        const record = Object.assign({ savedAt: Date.now() }, meta)
        store.records = [record, ...store.records.filter((r) => r.out !== meta.out)].slice(0, MAX_RECORDS)
        persist(store.records)
        store.emit()
      },
      clear() {
        store.records = []
        persist(store.records)
        store.emit()
      },
    }

    function fmt(sec) {
      const s = Math.max(0, Math.round(sec || 0))
      return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    }

    function basename(path) {
      if (!path) return '未命名记录'
      const parts = path.split(/[\\/]/)
      return parts[parts.length - 1] || path
    }

    function hostOf(url) {
      if (!url) return ''
      try {
        const parsed = new URL(url)
        return parsed.host + (parsed.pathname === '/' ? '' : parsed.pathname)
      } catch {
        return url.replace(/^https?:\/\//, '')
      }
    }

    function median(values) {
      if (values.length === 0) return 0
      const sorted = [...values].sort((a, b) => a - b)
      return sorted[Math.floor(sorted.length / 2)]
    }

    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {})
      }
    }

    function useToast() {
      const [toast, setToast] = useState('')
      const timer = useRef(null)
      useEffect(() => () => clearTimeout(timer.current), [])
      const show = (message) => {
        setToast(message)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setToast(''), 1600)
      }
      return [toast, show]
    }

    function chaptersMarkdown(record) {
      const chs = record.chapters || []
      const head = '| 开始 | 结束 | 依据 | URL | 注意力 |\n|---|---|---|---|---|'
      const rows = chs.map((c) => `| ${fmt(c.t0)} | ${fmt(c.t1)} | ${c.reason === 'url' ? '页面切换' : '话题'} | ${c.url || '—'} | ${Math.round(c.attention || 0)} |`)
      return `${head}\n${rows.join('\n')}`
    }

    function lanesOf(chapters) {
      const map = new Map()
      for (const c of chapters) {
        const key = hostOf(c.url) || '无地址栏'
        if (!map.has(key)) map.set(key, [])
        map.get(key).push(c)
      }
      return [...map.entries()]
        .map(([label, list]) => ({ label, list: list.slice().sort((a, b) => a.t0 - b.t0) }))
        .sort((a, b) => a.list[0].t0 - b.list[0].t0)
    }

    const CSS = `
      .dsev {
        color: var(--dsw-alias-label-primary);
        font-family: inherit;
        font-size: 13px;
        line-height: 1.5;
        --dsev-mono: var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace);
        --dsev-accent: #7c8cff;
        --dsev-accent-2: #52c7bd;
        --dsev-accent-3: #f0a35e;
        --dsev-accent-4: #b07cff;
        --dsev-surface: var(--dsw-alias-bg-base);
        --dsev-surface-2: var(--dsw-alias-bg-layer-2);
        --dsev-border: var(--dsw-alias-border-l1);
        --dsev-text-2: var(--dsw-alias-label-secondary);
        --dsev-text-3: var(--dsw-alias-label-tertiary);
      }
      .dsev-card {
        border: 0.5px solid var(--dsev-border);
        border-radius: 14px;
        background: var(--dsev-surface);
        overflow: hidden;
        box-shadow: 0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary) 4%, transparent);
        animation: dsev-fade 0.2s ease;
      }
      .dsev-card-head {
        display: flex; align-items: center; gap: 10px;
        padding: 13px 16px; cursor: pointer; user-select: none;
        transition: background 0.15s ease;
      }
      .dsev-card-head:hover { background: var(--dsev-surface-2); }
      .dsev-mark { width: 16px; height: 16px; flex: none; color: var(--dsev-accent); }
      .dsev-title { font-size: 13px; font-weight: 600; white-space: nowrap; letter-spacing: -0.005em; }
      .dsev-meta { font-size: 12px; color: var(--dsev-text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dsev-grow { flex: 1; min-width: 8px; }
      .dsev-btn {
        border: 0.5px solid var(--dsev-border); background: transparent;
        color: var(--dsw-alias-label-primary); border-radius: 9px; height: 28px;
        padding: 0 11px; font-size: 12px; font-family: inherit; cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease, transform 0.08s ease;
        white-space: nowrap;
      }
      .dsev-btn:hover { background: var(--dsev-surface-2); }
      .dsev-btn:active { transform: scale(0.98); }
      .dsev-btn:focus-visible { outline: 2px solid var(--dsev-accent); outline-offset: 1px; }
      .dsev-btn-primary { color: var(--dsev-accent); border-color: color-mix(in srgb, var(--dsev-accent) 45%, transparent); }
      .dsev-btn-ghost { border-color: transparent; color: var(--dsev-text-2); }
      .dsev-badge {
        display: inline-flex; align-items: center; gap: 5px;
        font-size: 11px; line-height: 20px; padding: 0 8px; border-radius: 999px;
        color: var(--dsev-text-2); background: var(--dsev-surface-2);
        white-space: nowrap;
      }
      .dsev-badge-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-success-primary); }
      .dsev-badge-dot-bad { background: var(--dsw-alias-state-error-primary); }

      .dsev-card-body { padding: 2px 16px 16px; border-top: 0.5px solid var(--dsev-border); }

      .dsev-panel { height: 100%; display: flex; overflow: hidden; background: var(--dsev-surface); color: var(--dsw-alias-label-primary); }
      .dsev-side {
        width: 236px; min-width: 236px; flex: none; display: flex; flex-direction: column;
        border-right: 0.5px solid var(--dsev-border);
        background: color-mix(in srgb, var(--dsev-surface-2) 45%, transparent);
        overflow: hidden;
      }
      .dsev-side-head {
        display: flex; align-items: center; gap: 8px; flex: none;
        padding: 16px 14px 10px; font-size: 12px; font-weight: 600; letter-spacing: 0.02em;
        color: var(--dsev-text-2); background: inherit;
      }
      .dsev-count { font-size: 11px; color: var(--dsev-text-3); background: var(--dsev-surface-2); border-radius: 999px; padding: 1px 7px; }
      .dsev-records { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 0 8px 14px; }
      .dsev-record { padding: 9px 10px; border-radius: 9px; cursor: pointer; margin-bottom: 2px; border: 0.5px solid transparent; transition: background 0.15s ease; }
      .dsev-record:hover { background: var(--dsev-surface-2); }
      .dsev-record-on { background: var(--dsev-surface); border-color: var(--dsev-border); }
      .dsev-rec-name { font-size: 12.5px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dsev-rec-meta { font-size: 11px; color: var(--dsev-text-3); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dsev-review-rec { display: flex; gap: 10px; align-items: center; }
      .dsev-rec-thumb {
        width: 64px; height: 36px; border-radius: 6px; flex: none;
        object-fit: cover; background: var(--dsev-surface-2);
        border: 0.5px solid var(--dsev-border);
      }

      .dsev-main { flex: 1; min-width: 0; overflow-y: auto; position: relative; }
      .dsev-main::before {
        content: ''; position: absolute; inset: 0 0 auto 0; height: 300px; pointer-events: none;
        background: radial-gradient(90% 160% at 50% 0%, rgba(124,140,255,0.14) 0%, transparent 65%);
      }
      .dsev-page { position: relative; max-width: 1240px; margin: 0 auto; padding: 26px 28px 48px; animation: dsev-fade 0.25s ease; }

      .dsev-noside .dsev-topbar-wrap { padding: 16px 28px 0; position: relative; z-index: 1; }
      .dsev-noside .dsev-main { width: 100%; }
      .dsev-topbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; row-gap: 8px; margin-bottom: 18px; }
      .dsev-topbar-title { font-size: 15px; font-weight: 600; letter-spacing: 0.01em; color: var(--dsev-text-1); }
      .dsev-record-select {
        height: 30px; max-width: 320px; padding: 0 26px 0 8px;
        border: 0.5px solid transparent; border-radius: 8px; background: transparent;
        color: var(--dsev-text-1); font-size: 15px; font-weight: 600; cursor: pointer;
        appearance: none; background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);
        background-position: calc(100% - 14px) 13px, calc(100% - 9px) 13px; background-size: 5px 5px; background-repeat: no-repeat;
      }
      .dsev-record-select:hover { border-color: var(--dsev-border); background-color: var(--dsev-surface-2); }
      .dsev-topbar-actions { display: flex; gap: 8px; margin-left: auto; }

      .dsev-canvas-card {
        border: 0.5px solid var(--dsev-border); border-radius: 16px;
        background: color-mix(in srgb, var(--dsev-surface) 92%, transparent);
        padding: 22px 22px 16px;
        box-shadow: 0 8px 32px color-mix(in srgb, var(--dsw-alias-label-primary) 6%, transparent);
        position: relative; overflow: hidden;
      }
      .dsev-canvas-head { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin-bottom: 18px; }
      .dsev-range { font-family: var(--dsev-mono); font-size: 26px; font-weight: 600; letter-spacing: -0.02em; }
      .dsev-range span { color: var(--dsev-text-3); font-weight: 400; padding: 0 4px; }
      .dsev-canvas-meta { display: flex; gap: 14px; font-size: 12px; color: var(--dsev-text-3); }
      .dsev-canvas-meta b { color: var(--dsw-alias-label-primary); font-weight: 600; font-variant-numeric: tabular-nums; }

      .dsev-axis { display: grid; grid-template-columns: 132px minmax(0, 1fr); gap: 12px; margin-bottom: 6px; }
      .dsev-axis-scale { position: relative; height: 16px; }
      .dsev-axis-tick {
        position: absolute; top: 0; transform: translateX(-50%);
        font-family: var(--dsev-mono); font-size: 10px; color: var(--dsev-text-3); white-space: nowrap;
      }
      .dsev-axis-tick:first-child { transform: none; }
      .dsev-axis-tick:last-child { transform: translateX(-100%); }
      .dsev-lanes { display: flex; flex-direction: column; gap: 6px; }
      .dsev-lane { display: grid; grid-template-columns: 132px minmax(0, 1fr); gap: 12px; align-items: center; }
      .dsev-lane-label {
        font-size: 11.5px; color: var(--dsev-text-2);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      .dsev-lane-track {
        position: relative; height: 30px; border-radius: 8px;
        background: color-mix(in srgb, var(--dsev-surface-2) 70%, transparent);
      }
      .dsev-block {
        position: absolute; top: 4px; height: 22px; border: 0; padding: 0;
        border-radius: 5px; cursor: pointer;
        transition: transform 0.12s ease, filter 0.12s ease;
        min-width: 2px;
      }
      .dsev-block:hover { filter: brightness(1.2); transform: translateY(-1px); }
      .dsev-block-on { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: 1px; z-index: 2; }
      .dsev-playhead {
        position: absolute; top: 0; bottom: 0; width: 1.5px;
        background: var(--dsw-alias-label-primary); opacity: 0.55;
        pointer-events: none; z-index: 1;
      }
      .dsev-canvas-hint { margin-top: 14px; font-size: 11.5px; color: var(--dsev-text-3); font-family: var(--dsev-mono); }

      .dsev-detailbar {
        display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
        margin-top: 16px; padding: 12px 14px;
        border: 0.5px solid var(--dsev-border); border-radius: 12px;
        background: var(--dsev-surface-2);
        animation: dsev-fade 0.15s ease;
      }
      .dsev-detailbar-time { font-family: var(--dsev-mono); font-size: 15px; font-weight: 600; }
      .dsev-detailbar-url { font-size: 12px; color: var(--dsev-text-2); flex: 1; min-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dsev-detailbar-stats { display: flex; gap: 12px; font-size: 11.5px; color: var(--dsev-text-3); }
      .dsev-detailbar-stats b { color: var(--dsw-alias-label-primary); font-weight: 600; font-variant-numeric: tabular-nums; }
      .dsev-detailbar .dsev-btn { height: 26px; }

      .dsev-toolbar { display: flex; gap: 8px; align-items: center; margin: 22px 0 12px; flex-wrap: wrap; }
      .dsev-input {
        flex: 1; min-width: 140px; max-width: 240px; height: 30px;
        border: 0.5px solid var(--dsev-border); border-radius: 9px;
        background: var(--dsev-surface); color: var(--dsw-alias-label-primary);
        padding: 0 11px; font-size: 12px; font-family: inherit;
      }
      .dsev-input:focus { outline: none; border-color: var(--dsev-accent); box-shadow: 0 0 0 3px rgba(124,140,255,0.18); }
      .dsev-chips { display: flex; gap: 6px; flex-wrap: wrap; }
      .dsev-chip {
        border: 0.5px solid var(--dsev-border); background: transparent;
        color: var(--dsev-text-2); border-radius: 999px; height: 26px;
        padding: 0 11px; font-size: 11.5px; font-family: inherit; cursor: pointer;
        transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
      }
      .dsev-chip:hover { color: var(--dsw-alias-label-primary); }
      .dsev-chip-on { color: var(--dsev-accent); border-color: rgba(124,140,255,0.55); background: rgba(124,140,255,0.10); }

      .dsev-columns { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; align-items: start; }
      @media (max-width: 1020px) { .dsev-columns { grid-template-columns: minmax(0, 1fr); } }
      .dsev-rail > * + * { margin-top: 16px; }

      .dsev-card-box {
        border: 0.5px solid var(--dsev-border); border-radius: 14px;
        background: color-mix(in srgb, var(--dsev-surface) 90%, transparent);
        padding: 16px;
      }
      .dsev-card-title {
        display: flex; align-items: center; gap: 8px;
        font-size: 12px; font-weight: 600; color: var(--dsev-text-2);
        margin-bottom: 12px; letter-spacing: 0.02em;
      }
      .dsev-card-title::before { content: ''; width: 3px; height: 12px; border-radius: 2px; background: var(--dsev-accent); }

      .dsev-group-label { display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--dsev-text-3); margin: 14px 0 4px; }
      .dsev-group-label::after { content: ''; flex: 1; height: 0.5px; background: var(--dsev-border); }
      .dsev-ch {
        display: grid; grid-template-columns: 92px 18px minmax(0, 1fr) 108px;
        gap: 10px; align-items: center; padding: 8px 10px;
        border-radius: 9px; cursor: pointer; transition: background 0.15s ease;
      }
      .dsev-ch:hover { background: var(--dsev-surface-2); }
      .dsev-ch-on { background: rgba(124,140,255,0.10); }
      .dsev-ch:focus-visible { outline: 2px solid var(--dsev-accent); outline-offset: -2px; }
      .dsev-ch-time { font-family: var(--dsev-mono); font-size: 11.5px; color: var(--dsev-text-3); white-space: nowrap; }
      .dsev-ch-icon { width: 14px; height: 14px; color: var(--dsev-text-3); }
      .dsev-ch-icon-url { color: var(--dsev-accent); }
      .dsev-ch-title { font-size: 12.5px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dsev-ch-sub { font-size: 11px; color: var(--dsev-text-3); margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dsev-ch-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; min-width: 86px; }
      .dsev-meter { width: 100%; height: 3px; border-radius: 2px; background: var(--dsev-surface-2); overflow: hidden; flex: none; }
      .dsev-meter > i { display: block; height: 100%; border-radius: 2px; background: rgba(124,140,255,0.75); }
      .dsev-num { font-family: var(--dsev-mono); font-size: 11px; color: var(--dsev-text-3); min-width: 22px; text-align: right; }

      .dsev-kv { display: grid; grid-template-columns: 54px minmax(0, 1fr); gap: 6px 10px; font-size: 12px; }
      .dsev-kv b { color: var(--dsev-text-3); font-weight: 400; }
      .dsev-kv a { color: var(--dsev-accent); text-decoration: none; word-break: break-all; }
      .dsev-detail-actions { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }

      .dsev-rank { display: flex; align-items: center; gap: 10px; padding: 7px 0; }
      .dsev-rank + .dsev-rank { border-top: 0.5px solid var(--dsev-border); }
      .dsev-rank-no {
        width: 18px; height: 18px; border-radius: 5px; flex: none;
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 10.5px; font-weight: 600; color: var(--dsev-text-2);
        background: var(--dsev-surface-2);
      }
      .dsev-rank-time { font-family: var(--dsev-mono); font-size: 11.5px; color: var(--dsev-text-2); }
      .dsev-rank-bar { flex: 1; height: 4px; border-radius: 2px; background: var(--dsev-surface-2); overflow: hidden; }
      .dsev-rank-bar > i { display: block; height: 100%; background: rgba(124,140,255,0.75); }
      .dsev-rank-score { font-family: var(--dsev-mono); font-size: 11px; color: var(--dsev-text-3); min-width: 28px; text-align: right; }

      .dsev-dist-track { display: flex; height: 10px; border-radius: 5px; overflow: hidden; gap: 2px; }
      .dsev-dist-seg { border-radius: 3px; min-width: 3px; }
      .dsev-dist-list { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
      .dsev-dist-row { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--dsev-text-2); }
      .dsev-dist-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dsev-dist-count { font-family: var(--dsev-mono); color: var(--dsev-text-3); }
      .dsev-donut-swatch { width: 8px; height: 8px; border-radius: 2px; flex: none; }

      .dsev-empty { border: 0.5px dashed var(--dsw-alias-border-l2); border-radius: 16px; padding: 60px 32px; text-align: center; color: var(--dsev-text-3); }
      .dsev-empty h3 { margin: 16px 0 6px; color: var(--dsw-alias-label-primary); font-size: 16px; font-weight: 600; }
      .dsev-empty code { font-family: var(--dsev-mono); font-size: 12px; background: var(--dsev-surface-2); padding: 2px 7px; border-radius: 5px; color: var(--dsev-text-2); }
      .dsev-foot { margin-top: 10px; font-size: 11px; color: var(--dsev-text-3); font-family: var(--dsev-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dsev-toast {
        position: fixed; left: 50%; bottom: 36px; transform: translateX(-50%);
        background: var(--dsw-alias-label-primary); color: var(--dsev-surface);
        font-size: 12px; padding: 7px 14px; border-radius: 999px; z-index: 60;
        box-shadow: 0 6px 20px color-mix(in srgb, var(--dsw-alias-label-primary) 25%, transparent);
        animation: dsev-fade 0.18s ease;
      }
      @keyframes dsev-fade { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }

      .dsev-review { height: 100%; display: flex; overflow: hidden; background: var(--dsev-surface); color: var(--dsw-alias-label-primary); }
      .dsev-review-main { flex: 1; min-width: 0; overflow-y: auto; padding: 22px 26px 40px; }
      .dsev-video-wrap { position: relative; background: #000; border-radius: 12px; overflow: hidden; border: 0.5px solid var(--dsev-border); }
      .dsev-video { display: block; width: 100%; max-height: 64vh; object-fit: contain; background: #000; }
      .dsev-video-empty { position: relative; display: block; height: 340px; color: var(--dsev-text-3); font-size: 13px; border: 1px dashed var(--dsev-border); border-radius: 12px; overflow: hidden; background: var(--dsev-surface-2); }
      .dsev-video-empty-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: 0.42; filter: saturate(0.9); }
      .dsev-video-empty-overlay { position: relative; z-index: 1; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; background: linear-gradient(180deg, rgba(0,0,0,0.2), rgba(0,0,0,0.55)); }
      .dsev-summary-strip { display: flex; flex-wrap: wrap; gap: 10px; margin: 4px 0 2px; }
      .dsev-sum-chip { display: flex; align-items: baseline; gap: 6px; padding: 6px 12px; border: 0.5px solid var(--dsev-border); border-radius: 10px; background: linear-gradient(180deg, rgba(255,255,255,0.035), transparent); }
      .dsev-sum-chip-label { font-size: 11px; color: var(--dsev-text-3); }
      .dsev-sum-chip-value { font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
      .dsev-video-empty-title { font-size: 14px; font-weight: 600; color: var(--dsev-text-2); }
      .dsev-video-empty-sub { font-size: 12px; opacity: 0.7; }
      .dsev-controls { display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
      .dsev-progress { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
      .dsev-progress-track { height: 6px; border-radius: 999px; background: rgba(127,127,127,0.18); overflow: hidden; }
      .dsev-progress-fill { height: 100%; border-radius: 999px; background: var(--dsev-accent); transition: width 0.25s ease; }
      .dsev-progress-label { font-size: 12px; opacity: 0.75; }
      .dsev-select {
        height: 28px; border: 0.5px solid var(--dsev-border); border-radius: 8px;
        background: var(--dsev-surface); color: var(--dsw-alias-label-primary);
        font-size: 12px; font-family: inherit; padding: 0 8px;
      }
      .dsev-seek { position: relative; height: 26px; margin-top: 8px; cursor: pointer; touch-action: none; }
      .dsev-seek-track {
        position: absolute; left: 0; right: 0; top: 10px; height: 8px;
        border-radius: 4px; background: var(--dsev-surface-2); overflow: hidden; display: flex; gap: 1px;
      }
      .dsev-seek-seg { height: 100%; min-width: 1px; }
      .dsev-seek-head {
        position: absolute; top: 2px; width: 3px; height: 22px; border-radius: 2px;
        background: var(--dsw-alias-label-primary); transform: translateX(-50%); pointer-events: none;
      }
      .dsev-seek-labels { display: flex; justify-content: space-between; font-family: var(--dsev-mono); font-size: 10.5px; color: var(--dsev-text-3); }

      .dsev-review-columns { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; margin-top: 16px; align-items: start; }
      .dsev-review-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; align-items: start; }
      .dsev-review-side { display: flex; flex-direction: column; gap: 16px; align-self: stretch; min-height: 0; }
      .dsev-review-side > .dsev-card-box:last-child { flex: 1; display: flex; flex-direction: column; min-height: 0; }
      .dsev-review-side .dsev-units { flex: 1; overflow-y: auto; max-height: none; }
      .dsev-ch-att { font-size: 11px; color: var(--dsev-text-3); white-space: nowrap; }
      @media (max-width: 1080px) { .dsev-review-columns { grid-template-columns: minmax(0, 1fr); } }
      .dsev-now { border: 0.5px solid var(--dsev-border); border-radius: 14px; padding: 14px 16px; background: color-mix(in srgb, var(--dsev-surface) 92%, transparent); }
      .dsev-now-range { font-family: var(--dsev-mono); font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
      .dsev-now-url { font-size: 12px; color: var(--dsev-text-2); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dsev-now-stats { display: flex; gap: 12px; margin-top: 8px; font-size: 11.5px; color: var(--dsev-text-3); }
      .dsev-now-stats b { color: var(--dsw-alias-label-primary); font-weight: 600; font-variant-numeric: tabular-nums; }
      .dsev-now-label { margin-top: 10px; font-size: 12.5px; color: var(--dsw-alias-label-primary); line-height: 1.5; }
      .dsev-units { margin-top: 14px; max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; padding-right: 2px; }
      .dsev-unit {
        display: grid; grid-template-columns: 46px minmax(0, 1fr); gap: 8px; align-items: baseline;
        padding: 5px 8px; border-radius: 7px; font-size: 12px; color: var(--dsev-text-2);
        cursor: pointer; transition: background 0.12s ease, color 0.12s ease;
      }
      .dsev-unit:hover { background: var(--dsev-surface-2); }
      .dsev-unit-on { background: rgba(124,140,255,0.14); color: var(--dsw-alias-label-primary); }
      .dsev-unit-time { font-family: var(--dsev-mono); font-size: 10.5px; color: var(--dsev-text-3); }
      .dsev-review-chapters { margin-top: 16px; }
      .dsev-review-records { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 0 8px 14px; }
      .dsev-video-error { padding: 14px 16px; font-size: 12px; color: var(--dsw-alias-state-error-primary); }
      .dsev-video-note { padding: 10px 14px; font-size: 12px; color: var(--dsev-text-3); border-top: 0.5px solid var(--dsev-border); }
      .dsev-tabs { display: flex; gap: 2px; background: var(--dsev-surface-2); padding: 3px; border-radius: 10px; }
      .dsev-tab {
        border: 0; background: transparent; color: var(--dsev-text-2);
        font-size: 12px; font-family: inherit; height: 26px; padding: 0 14px;
        border-radius: 8px; cursor: pointer; transition: background 0.15s ease, color 0.15s ease;
      }
      .dsev-tab:hover { color: var(--dsw-alias-label-primary); }
      .dsev-tab-on { background: var(--dsev-surface); color: var(--dsw-alias-label-primary); font-weight: 500; }
      .dsev-library { padding: 4px 0 20px; }
      .dsev-lib-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 4px; }
      .dsev-grid-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; margin-top: 14px; }
      .dsev-lib-card {
        border: 0.5px solid var(--dsev-border); border-radius: 12px; overflow: hidden;
        background: var(--dsev-surface); cursor: pointer; transition: border-color 0.15s ease, transform 0.15s ease;
        position: relative;
      }
      .dsev-lib-card:hover { border-color: rgba(124,140,255,0.55); transform: translateY(-1px); }
      .dsev-lib-card-on { border-color: var(--dsev-accent); box-shadow: 0 0 0 2px rgba(124,140,255,0.25); }
      .dsev-lib-select { position: absolute; top: 8px; left: 8px; z-index: 2; width: 16px; height: 16px; accent-color: var(--dsev-accent); cursor: pointer; }
      .dsev-batch-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; }
      .dsev-batch-priorities { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 10px; }
      .dsev-batch-priorities .dsev-check { display: flex; align-items: center; gap: 6px; font-size: 12px; }
      .dsev-lib-thumb { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; display: block; background: var(--dsev-surface-2); }
      .dsev-lib-body { padding: 10px 12px; }
      .dsev-lib-title { font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dsev-lib-meta { font-size: 11px; color: var(--dsev-text-3); margin-top: 2px; }
      .dsev-tags { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 6px; }
      .dsev-tag { font-size: 10.5px; padding: 0 7px; line-height: 17px; border-radius: 999px; background: rgba(124,140,255,0.12); color: var(--dsev-accent); }
      .dsev-lib-check { position: absolute; top: 8px; right: 8px; width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,0.8); background: rgba(0,0,0,0.35); color: #fff; font-size: 11px; line-height: 15px; text-align: center; }
      .dsev-build { border: 0.5px solid var(--dsev-border); border-radius: 12px; padding: 12px 14px; margin-top: 14px; background: color-mix(in srgb, var(--dsev-surface-2) 35%, transparent); }
      .dsev-build-title { font-size: 12px; font-weight: 600; color: var(--dsev-text-2); margin-bottom: 10px; }
      .dsev-build-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1.4fr) 90px 90px auto; gap: 8px; align-items: end; }
      @media (max-width: 900px) { .dsev-build-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }
      .dsev-field { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--dsev-text-3); }
      .dsev-field input, .dsev-field select {
        height: 28px; border: 0.5px solid var(--dsev-border); border-radius: 8px;
        background: var(--dsev-surface); color: var(--dsw-alias-label-primary);
        font-size: 12px; font-family: inherit; padding: 0 8px; min-width: 0;
      }
      .dsev-check { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--dsev-text-2); }
      .dsev-jobs { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
      .dsev-job { display: flex; gap: 10px; align-items: center; font-size: 11.5px; padding: 6px 10px; border: 0.5px solid var(--dsev-border); border-radius: 8px; }
      .dsev-job-status { font-weight: 600; min-width: 58px; }
      .dsev-compare { margin-top: 16px; }
      .dsev-compare table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .dsev-compare th, .dsev-compare td { padding: 6px 10px; border-bottom: 0.5px solid var(--dsev-border); text-align: left; }
      .dsev-compare th { color: var(--dsev-text-3); font-weight: 500; font-size: 11px; }
      .dsev-cam { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
      @media (max-width: 980px) { .dsev-cam { grid-template-columns: minmax(0, 1fr); } }
      .dsev-cam-frame { border: 0.5px solid var(--dsev-border); border-radius: 14px; overflow: hidden; background: #000; }
      .dsev-cam-frame img { display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover; }
      .dsev-cam-placeholder { display: flex; flex-direction: column; align-items: center; justify-content: center; aspect-ratio: 4 / 3; color: var(--dsev-text-3); gap: 10px; }
      .dsev-cam-controls { display: flex; gap: 8px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
      .dsev-cam-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
      .dsev-cam-chip { font-size: 11px; padding: 2px 9px; border-radius: 999px; background: var(--dsev-surface-2); color: var(--dsev-text-2); }
      .dsev-cam-chip-on { background: rgba(124,140,255,0.16); color: var(--dsev-accent); }
      .dsev-cam-events { max-height: 520px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
      .dsev-cam-event { display: flex; gap: 10px; align-items: center; padding: 6px; border: 0.5px solid var(--dsev-border); border-radius: 10px; }
      .dsev-cam-event img { width: 80px; height: 60px; object-fit: cover; border-radius: 6px; flex: none; background: var(--dsev-surface-2); }
      .dsev-cam-event-name { font-size: 12px; font-weight: 500; }
      .dsev-cam-event-meta { font-size: 11px; color: var(--dsev-text-3); }
      .dsev-cam-note { font-size: 11.5px; color: var(--dsev-text-3); margin-top: 10px; line-height: 1.6; }
      .dsev-sum-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; margin: 16px 0; }
      @media (max-width: 900px) { .dsev-sum-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      .dsev-sum-card { border: 0.5px solid var(--dsev-border); border-radius: 12px; padding: 12px 14px; background: var(--dsev-surface); }
      .dsev-sum-label { font-size: 11px; color: var(--dsev-text-3); }
      .dsev-sum-value { font-size: 22px; font-weight: 600; letter-spacing: -0.02em; margin-top: 2px; font-variant-numeric: tabular-nums; }
      .dsev-flag-row { display: flex; gap: 8px; align-items: center; padding: 6px 0; border-top: 0.5px solid var(--dsev-border); font-size: 12px; }
      .dsev-flag-code { font-family: var(--dsev-mono); font-size: 11px; color: var(--dsev-accent); }
      .dsev-flag-count { margin-left: auto; font-variant-numeric: tabular-nums; color: var(--dsev-text-3); }
      .dsev-sum-top { display: flex; gap: 8px; align-items: center; padding: 6px 0; border-top: 0.5px solid var(--dsev-border); font-size: 12px; }
      .dsev-sum-top-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsev-text-2); }

      /* --- polish pass: micro-interactions, depth, motion --- */
      .dsev { font-feature-settings: "cv02", "cv03", "cv04", "ss01"; }
      .dsev-btn { transition: transform 0.12s ease, box-shadow 0.16s ease, background 0.16s ease, border-color 0.16s ease; }
      .dsev-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 18px rgba(0, 0, 0, 0.22); }
      .dsev-btn:active { transform: translateY(0) scale(0.98); }
      .dsev-btn-primary { color: #fff; background: linear-gradient(135deg, #7c8cff, #6a5cff); box-shadow: 0 6px 18px rgba(124, 140, 255, 0.28); }
      .dsev-btn-primary:hover { box-shadow: 0 12px 26px rgba(124, 140, 255, 0.4); }
      .dsev-btn:focus-visible, .dsev-input:focus-visible, .dsev-select:focus-visible, .dsev-record-select:focus-visible {
        outline: none; box-shadow: 0 0 0 3px rgba(124, 140, 255, 0.32);
      }
      .dsev-tab { border-radius: 8px; transition: background 0.15s ease, color 0.15s ease, transform 0.12s ease; }
      .dsev-tab:hover { background: rgba(124, 140, 255, 0.09); }
      .dsev-tab-on { background: linear-gradient(180deg, rgba(124, 140, 255, 0.22), rgba(124, 140, 255, 0.07)); box-shadow: inset 0 0 0 1px rgba(124, 140, 255, 0.26); }
      .dsev-noside .dsev-topbar-wrap {
        position: sticky; top: 0; z-index: 6;
        background: color-mix(in srgb, var(--dsev-surface) 80%, transparent);
        backdrop-filter: blur(12px) saturate(1.15);
        border-bottom: 0.5px solid transparent;
      }
      .dsev-lib-card { transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease; }
      .dsev-lib-card:hover {
        transform: translateY(-3px);
        box-shadow: 0 16px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(124, 140, 255, 0.28);
      }
      /* Frame.io-style timecoded comment cards */
      .dsev-comment-filter { display: flex; gap: 6px; margin-bottom: 10px; }
      .dsev-filter-chip {
        border: 0.5px solid var(--dsev-border); background: transparent; color: var(--dsev-text-3);
        font-size: 12px; padding: 4px 10px; border-radius: 999px; cursor: pointer;
      }
      .dsev-filter-chip:hover { color: var(--dsev-text-1); }
      .dsev-filter-chip-on { color: var(--dsev-text-1); border-color: rgba(124, 140, 255, 0.5); background: rgba(124, 140, 255, 0.12); }
      .dsev-comment {
        border: 0.5px solid var(--dsev-border); border-radius: 12px; padding: 10px 12px;
        margin-bottom: 8px; background: var(--dsev-surface);
      }
      .dsev-comment-done { opacity: 0.6; }
      .dsev-comment-head { display: flex; align-items: center; gap: 8px; }
      .dsev-comment-author { font-size: 12px; color: var(--dsev-text-3); }
      .dsev-comment-status {
        font-size: 11px; color: var(--dsev-text-3);
        border: 0.5px solid var(--dsev-border); border-radius: 999px; padding: 1px 8px;
      }
      .dsev-comment-done .dsev-comment-status { color: #4ade80; border-color: rgba(74, 222, 128, 0.4); }
      .dsev-comment-body { margin-top: 8px; font-size: 13.5px; line-height: 1.55; color: var(--dsev-text-2); }
      .dsev-comment-toggle { font-size: 12px; }
      /* --- home / onboarding --- */
      .dsev-home { display: flex; flex-direction: column; gap: 18px; }
      .dsev-home-hero {
        display: flex; align-items: center; gap: 20px; flex-wrap: wrap;
        justify-content: space-between; padding: 6px 0 2px;
      }
      .dsev-home-hero h1 { margin: 0; font-size: 24px; font-weight: 650; letter-spacing: -0.02em; }
      .dsev-home-hero p { margin: 8px 0 0; font-size: 13.5px; color: var(--dsev-text-3); line-height: 1.65; max-width: 560px; }
      .dsev-home-actions { display: flex; gap: 8px; }
      .dsev-home-actions .dsev-btn { display: inline-flex; align-items: center; gap: 6px; }
      .dsev-home-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
      .dsev-stat {
        display: flex; align-items: center; gap: 10px; padding: 12px 14px;
        border: 0.5px solid var(--dsev-border); border-radius: 12px; background: var(--dsev-surface);
      }
      .dsev-stat-icon { color: var(--dsev-accent); display: flex; }
      .dsev-stat-value { font-size: 19px; font-weight: 650; font-variant-numeric: tabular-nums; }
      .dsev-stat-label { font-size: 12px; color: var(--dsev-text-3); }
      .dsev-onboard {
        border: 0.5px solid var(--dsev-border); border-radius: 14px; padding: 16px 18px;
        background: linear-gradient(180deg, rgba(124, 140, 255, 0.08), transparent 70%), var(--dsev-surface);
      }
      .dsev-onboard-head { display: flex; align-items: flex-start; gap: 12px; justify-content: space-between; }
      .dsev-onboard-title { font-size: 15px; font-weight: 600; }
      .dsev-onboard-sub { font-size: 12px; color: var(--dsev-text-3); margin-top: 3px; }
      .dsev-onboard-steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-top: 14px; }
      .dsev-step { display: flex; gap: 10px; align-items: flex-start; }
      .dsev-step-index {
        width: 18px; height: 18px; border-radius: 50%; flex: none;
        display: inline-flex; align-items: center; justify-content: center;
        font-size: 11px; background: var(--dsev-accent); color: #fff; margin-top: 1px;
      }
      .dsev-step-icon { color: var(--dsev-text-3); display: flex; margin-top: 1px; }
      .dsev-step-title { font-size: 13.5px; font-weight: 600; }
      .dsev-step-text { font-size: 12.5px; color: var(--dsev-text-3); margin-top: 3px; line-height: 1.55; }
      .dsev-home-section { display: flex; flex-direction: column; gap: 10px; }
      .dsev-home-section-title { font-size: 15px; font-weight: 600; }
      .dsev-home-recent { display: flex; flex-direction: column; gap: 8px; }
      .dsev-home-row {
        display: flex; align-items: center; gap: 12px; padding: 8px 10px;
        border: 0.5px solid var(--dsev-border); border-radius: 12px; background: var(--dsev-surface);
        cursor: pointer; transition: border-color 0.15s ease, transform 0.15s ease;
      }
      .dsev-home-row:hover { border-color: rgba(124, 140, 255, 0.4); transform: translateY(-1px); }
      .dsev-home-thumb { width: 84px; height: 48px; object-fit: cover; border-radius: 8px; background: var(--dsev-surface-2); flex: none; }
      .dsev-home-row-body { min-width: 0; flex: 1; }
      .dsev-home-row-title { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dsev-home-row-meta { font-size: 12px; color: var(--dsev-text-3); margin-top: 2px; }
      .dsev-home-row-open { color: var(--dsev-text-3); display: flex; }
      .dsev-tab { display: inline-flex; align-items: center; gap: 6px; }
      .dsev-btn { display: inline-flex; align-items: center; gap: 6px; }
      .dsev-btn svg { flex: none; }
      /* --- friendlier library chrome --- */
      .dsev-lib-hero { margin: 2px 0 14px; }
      .dsev-lib-hero-title { font-size: 22px; font-weight: 650; letter-spacing: -0.02em; }
      .dsev-lib-hero-sub { font-size: 13.5px; color: var(--dsev-text-3); margin-top: 4px; }
      .dsev-lib-status { font-size: 11.5px; color: var(--dsev-text-3); border: 0.5px solid var(--dsev-border); border-radius: 999px; padding: 1px 8px; }
      .dsev-lib-status-ok { color: #4ade80; border-color: rgba(74, 222, 128, 0.35); }
      .dsev-advanced { margin-top: 8px; }
      .dsev-advanced summary { font-size: 12px; color: var(--dsev-text-3); cursor: pointer; }
      .dsev-advanced summary:hover { color: var(--dsev-text-1); }
      .dsev-advanced-row { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 8px; }
      .dsev-empty-start {
        border: 1px dashed var(--dsev-border); border-radius: 14px; padding: 22px;
        margin-top: 12px; background: var(--dsev-surface);
      }
      .dsev-empty-start-title { font-size: 15px; font-weight: 600; }
      .dsev-empty-start-sub { font-size: 13px; color: var(--dsev-text-3); margin-top: 6px; line-height: 1.6; }
      .dsev-comment-replies {
        margin-top: 8px; padding-left: 10px; border-left: 2px solid var(--dsev-border);
        display: flex; flex-direction: column; gap: 6px;
      }
      .dsev-comment-reply-author { font-size: 11px; color: var(--dsev-text-3); }
      .dsev-comment-reply-text { font-size: 13px; color: var(--dsev-text-2); line-height: 1.5; }
      .dsev-comment-actions { margin-top: 8px; display: flex; gap: 6px; }
      .dsev-comment-reply-btn { font-size: 12px; }
      .dsev-comment-reply-form { display: flex; gap: 6px; margin-top: 8px; }
      .dsev-comment-reply-form .dsev-input { flex: 1; }
      .dsev-lib-card img { transition: transform 0.35s ease, filter 0.35s ease; }
      .dsev-lib-card:hover img { transform: scale(1.04); filter: saturate(1.1) brightness(1.03); }
      .dsev-video-wrap { box-shadow: 0 18px 44px rgba(0, 0, 0, 0.38), inset 0 0 0 1px rgba(255, 255, 255, 0.04); transition: box-shadow 0.3s ease; }
      .dsev-video-playing { box-shadow: 0 18px 54px rgba(124, 140, 255, 0.28), inset 0 0 0 1px rgba(124, 140, 255, 0.28); }
      .dsev-seek { transition: height 0.15s ease; }
      .dsev-seek:hover { height: 10px; }
      .dsev-seek-head { transition: transform 0.12s ease; }
      .dsev-seek:hover .dsev-seek-head { transform: scale(1.25); }
      .dsev-ch { position: relative; transition: background 0.15s ease, transform 0.15s ease; }
      .dsev-ch:hover { background: rgba(124, 140, 255, 0.07); transform: translateX(2px); }
      .dsev-ch-on::before {
        content: ''; position: absolute; left: 0; top: 8px; bottom: 8px; width: 2.5px;
        border-radius: 2px; background: var(--dsev-accent); box-shadow: 0 0 10px rgba(124, 140, 255, 0.8);
      }
      .dsev-card-box { transition: border-color 0.2s ease, background 0.2s ease; }
      .dsev-card-box:hover { border-color: rgba(124, 140, 255, 0.28); }
      .dsev-now { background: linear-gradient(180deg, rgba(124, 140, 255, 0.09), transparent 70%), var(--dsev-surface); box-shadow: 0 12px 28px rgba(0, 0, 0, 0.2); }
      .dsev-batch { background: linear-gradient(180deg, rgba(124, 140, 255, 0.07), transparent 62%), var(--dsev-surface); }
      .dsev-batch-running { border-color: rgba(124, 140, 255, 0.5); box-shadow: 0 0 0 1px rgba(124, 140, 255, 0.25), 0 0 26px rgba(124, 140, 255, 0.16); }
      .dsev-progress-fill {
        background: linear-gradient(90deg, #7c8cff, #a78bfa 50%, #7c8cff);
        background-size: 200% 100%;
        animation: dsev-shimmer 1.6s linear infinite;
        box-shadow: 0 0 12px rgba(124, 140, 255, 0.5);
      }
      @keyframes dsev-shimmer { from { background-position: 0% 0; } to { background-position: -200% 0; } }
      .dsev-badge-dot { animation: dsev-pulse 2s ease-in-out infinite; }
      @keyframes dsev-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.45); }
        50% { box-shadow: 0 0 0 5px rgba(74, 222, 128, 0); }
      }
      .dsev-empty { background: radial-gradient(600px 200px at 50% 0%, rgba(124, 140, 255, 0.08), transparent 70%); }
      .dsev-lib-select { accent-color: var(--dsev-accent); transition: transform 0.12s ease; }
      .dsev-lib-select:checked { transform: scale(1.08); }
      .dsev-grid-cards > * { animation: dsev-rise 0.35s ease both; }
      .dsev-grid-cards > *:nth-child(2) { animation-delay: 0.03s; }
      .dsev-grid-cards > *:nth-child(3) { animation-delay: 0.06s; }
      .dsev-grid-cards > *:nth-child(4) { animation-delay: 0.09s; }
      .dsev-grid-cards > *:nth-child(5) { animation-delay: 0.12s; }
      .dsev-grid-cards > *:nth-child(6) { animation-delay: 0.15s; }
      @keyframes dsev-rise { from { opacity: 0; transform: translateY(7px); } to { opacity: 1; transform: none; } }
      /* --- readability + player emphasis --- */
      .dsev-player-hero { margin-top: 12px; }
      .dsev { font-size: 14.5px; }
      .dsev-meta { font-size: 12.5px; }
      .dsev-card-title { font-size: 14px; }
      .dsev-tab { font-size: 14px; }
      .dsev-btn { font-size: 13.5px; }
      .dsev-topbar-title, .dsev-record-select { font-size: 17px; }
      .dsev-record-select { height: 34px; }
      .dsev-sum-chip-label { font-size: 12px; }
      .dsev-sum-chip-value { font-size: 16px; }
      .dsev-ch-time { font-size: 12.5px; }
      .dsev-ch-title { font-size: 14px; }
      .dsev-ch-sub { font-size: 12px; }
      .dsev-ch-att { font-size: 12px; }
      .dsev-unit { font-size: 13.5px; }
      .dsev-time { font-size: 12.5px; }
      .dsev-now-range { font-size: 21px; }
      .dsev-now-url { font-size: 13px; }
      .dsev-now-label { font-size: 13.5px; }
      .dsev-flag-row { font-size: 12.5px; }
      /* --- library density --- */
      .dsev-lib-title { font-size: 15px; }
      .dsev-lib-meta { font-size: 12.5px; }
      .dsev-lib-source { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
      .dsev-lib-actions { display: flex; gap: 8px; align-items: center; margin-top: 10px; }
      .dsev-lib-more { margin-left: auto; position: relative; }
      .dsev-lib-more summary { list-style: none; cursor: pointer; }
      .dsev-lib-more summary::-webkit-details-marker { display: none; }
      .dsev-lib-menu {
        position: absolute; right: 0; top: calc(100% + 6px); z-index: 20; min-width: 124px;
        padding: 6px; border: 0.5px solid var(--dsev-border); border-radius: 10px;
        background: var(--dsev-surface); box-shadow: 0 16px 34px rgba(0, 0, 0, 0.4);
        display: flex; flex-direction: column; gap: 2px;
      }
      .dsev-menu-item {
        text-align: left; border: 0; background: transparent; color: var(--dsev-text-2);
        font-size: 13px; padding: 7px 10px; border-radius: 7px; cursor: pointer;
      }
      .dsev-menu-item:hover { background: rgba(124, 140, 255, 0.12); color: var(--dsev-text-1); }
      .dsev-menu-danger { color: var(--dsw-alias-state-error-primary); }
      .dsev-build-head { display: flex; align-items: center; gap: 10px; cursor: pointer; }
      .dsev-build-head .dsev-grow { flex: 1; }
      .dsev-build-head .dsev-build-title { margin: 0; font-size: 14px; }
      .dsev-more-view { max-width: 110px; }
      .dsev-review-tabs { display: flex; gap: 6px; margin-top: 16px; border-bottom: 0.5px solid var(--dsev-border); }
      .dsev-review-tab {
        position: relative; border: 0; background: transparent; color: var(--dsev-text-3);
        padding: 9px 13px 11px; font-size: 13.5px; cursor: pointer; border-radius: 8px 8px 0 0;
        transition: color 0.15s ease, background 0.15s ease;
      }
      .dsev-review-tab:hover { color: var(--dsev-text-1); background: rgba(124, 140, 255, 0.07); }
      .dsev-review-tab-on { color: var(--dsev-text-1); font-weight: 600; }
      .dsev-review-tab-on::after {
        content: ''; position: absolute; left: 10px; right: 10px; bottom: -0.5px; height: 2px;
        border-radius: 2px; background: var(--dsev-accent); box-shadow: 0 0 8px rgba(124, 140, 255, 0.7);
      }
      .dsev-review-panel {
        margin-top: 14px; border: 0.5px solid var(--dsev-border); border-radius: 14px;
        padding: 10px 14px; background: var(--dsev-surface); min-height: 160px;
      }
      .dsev-panel-scroll { max-height: 46vh; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
      .dsev-now { margin-top: 12px; }
      @media (prefers-reduced-motion: reduce) {
        .dsev, .dsev * { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
      }
    `

    function Mark({ className, size }) {
      const edge = size || 16
      return h('svg', { width: edge, height: edge, className, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 3, y: 9, width: 4, height: 6, rx: 1, fill: 'currentColor' }),
        h('rect', { x: 9, y: 5, width: 4, height: 14, rx: 1, fill: 'currentColor' }),
        h('rect', { x: 15, y: 8, width: 4, height: 8, rx: 1, fill: 'currentColor', opacity: 0.6 }))
    }

    function blockColor(chapter, maxAtt) {
      if (chapter.reason === 'url') return 'rgba(124,140,255,0.95)'
      const strength = 0.25 + 0.6 * ((chapter.attention || 0) / Math.max(1, maxAtt))
      return `${ACCENT}${strength.toFixed(2)})`
    }

    function Canvas({ chapters, span, selected, onSelect }) {
      const lanes = useMemo(() => lanesOf(chapters), [chapters])
      const total = Math.max(span || 1, chapters.length ? chapters[chapters.length - 1].t1 : 1, 1)
      const maxAtt = Math.max(1, ...chapters.map((c) => c.attention || 0))
      const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => h('span', {
        key: p,
        className: 'dsev-axis-tick',
        style: { left: p * 100 + '%' },
      }, fmt(total * p)))
      const laneRows = lanes.map((lane) => {
        const blocks = lane.list.map((c) => {
          const left = (c.t0 / total) * 100
          const width = Math.max(((c.t1 - c.t0) / total) * 100, 0.35)
          const index = chapters.indexOf(c)
          const title = `${fmt(c.t0)}–${fmt(c.t1)} · ${Math.round(c.dwell)}s · 注意力 ${Math.round(c.attention)}`
          return h('button', {
            key: 'b' + index,
            type: 'button',
            className: 'dsev-block' + (selected === index ? ' dsev-block-on' : ''),
            style: { left: left + '%', width: width + '%', background: blockColor(c, maxAtt) },
            title,
            onClick: () => onSelect(index),
          })
        })
        const playhead = selected !== null && chapters[selected] && lane.list.includes(chapters[selected])
          ? h('div', { className: 'dsev-playhead', style: { left: (chapters[selected].t0 / total) * 100 + '%' } })
          : null
        return h('div', { className: 'dsev-lane', key: lane.label },
          h('span', { className: 'dsev-lane-label', title: lane.label }, lane.label),
          h('div', { className: 'dsev-lane-track' }, blocks, playhead))
      })
      return h('div', null,
        h('div', { className: 'dsev-axis' },
          h('span', null),
          h('div', { className: 'dsev-axis-scale' }, ticks)),
        h('div', { className: 'dsev-lanes' }, laneRows),
        h('div', { className: 'dsev-canvas-hint' }, selected === null
          ? '点击任意色块选中章节 · 蓝色 = 页面切换，深浅 = 注意力强度'
          : `${fmt(chapters[selected].t0)}–${fmt(chapters[selected].t1)} · ${hostOf(chapters[selected].url) || '无地址栏'}`))
    }

    function MiniTrack({ chapters, span, active, onSelect }) {
      const total = Math.max(span || 1, chapters.length ? chapters[chapters.length - 1].t1 : 1, 1)
      const maxAtt = Math.max(1, ...chapters.map((c) => c.attention || 0))
      const segs = chapters.map((c, i) => {
        const width = Math.max(((c.t1 - c.t0) / total) * 100, 0.4)
        return h('button', {
          key: 'seg' + i,
          type: 'button',
          className: 'dsev-block' + (active === i ? ' dsev-block-on' : ''),
          style: { position: 'static', width: width + '%', height: '100%', background: blockColor(c, maxAtt) },
          title: `${fmt(c.t0)}–${fmt(c.t1)}`,
          onClick: () => onSelect && onSelect(i),
        })
      })
      return h('div', { style: { display: 'flex', gap: 2, height: 12, background: 'var(--dsev-surface-2)', borderRadius: 6, padding: 2, marginTop: 14 } }, segs)
    }

    function DetailBar({ chapter, onCopy }) {
      if (!chapter) {
        return h('div', { className: 'dsev-detailbar' },
          h('span', { className: 'dsev-detailbar-time' }, '—'),
          h('span', { className: 'dsev-detailbar-url' }, '点击上方时间线选中一个章节'),
          h('span', { className: 'dsev-detailbar-stats' }, '选中后可复制时间戳 / URL'))
      }
      const url = chapter.url
      return h('div', { className: 'dsev-detailbar' },
        h('span', { className: 'dsev-detailbar-time' }, `${fmt(chapter.t0)}–${fmt(chapter.t1)}`),
        h('span', { className: 'dsev-detailbar-url', title: url || '' }, url ? hostOf(url) : '无地址栏'),
        h('span', { className: 'dsev-detailbar-stats' },
          h('span', null, '停留 ', h('b', null, `${Math.round(chapter.dwell || 0)}s`)),
          h('span', null, '注意力 ', h('b', null, String(Math.round(chapter.attention || 0)))),
          h('span', null, chapter.reason === 'url' ? '页面切换' : '话题')),
        h('button', {
          type: 'button', className: 'dsev-btn dsev-btn-primary',
          onClick: () => onCopy(`${fmt(chapter.t0)}–${fmt(chapter.t1)}${url ? ' ' + url : ''}`, '已复制时间戳'),
        }, '复制时间戳'),
        url ? h('button', {
          type: 'button', className: 'dsev-btn',
          onClick: () => onCopy(url, '已复制 URL'),
        }, '复制 URL') : null)
    }

    function ChapterRow({ chapter, active, maxAtt, onSelect }) {
      const attentionPct = Math.round(((chapter.attention || 0) / Math.max(1, maxAtt)) * 100)
      return h('div', {
        className: 'dsev-ch' + (active ? ' dsev-ch-on' : ''),
        onClick: onSelect,
        tabIndex: 0,
        onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') onSelect() },
      },
      h('span', { className: 'dsev-ch-time' }, `${fmt(chapter.t0)}–${fmt(chapter.t1)}`),
      h('span', { className: 'dsev-ch-icon' + (chapter.url ? ' dsev-ch-icon-url' : ''), 'aria-hidden': true }, chapter.url ? '↗' : '·'),
      h('div', null,
        h('div', { className: 'dsev-ch-title', title: chapter.url || '' }, hostOf(chapter.url) || '无地址栏'),
        h('div', { className: 'dsev-ch-sub' }, `${chapter.reason === 'url' ? '页面切换' : '话题'} · ${Math.round(chapter.dwell || 0)} 秒`)),
      h('div', {
        className: 'dsev-ch-right',
        title: `注意力：相对本记录最高章节的 ${attentionPct}%（原始值 ${Math.round(chapter.attention || 0)}）`,
      },
      h('span', { className: 'dsev-ch-att' }, `注意力 ${attentionPct}%`),
      h('span', { className: 'dsev-meter' }, h('i', { style: { width: attentionPct + '%' } }))))
    }

    function ChapterList({ chapters, activeIndex, onSelect }) {
      const maxAtt = Math.max(1, ...chapters.map((c) => c.attention || 0))
      const rows = []
      let lastHost = null
      chapters.forEach((c, i) => {
        const host = hostOf(c.url) || '无地址栏'
        if (host !== lastHost) {
          rows.push(h('div', { className: 'dsev-group-label', key: 'g' + i }, host))
          lastHost = host
        }
        rows.push(h(ChapterRow, {
          key: 'ch' + i,
          chapter: c,
          active: i === activeIndex,
          maxAtt,
          onSelect: () => onSelect(i),
        }))
      })
      return h('div', null, rows)
    }

    function TopList({ record }) {
      const top = (record.top || []).slice(0, 5)
      if (top.length === 0) return null
      const max = Math.max(1, ...top.map((s) => s.emphasis || 0))
      const rows = top.map((s, i) => h('div', { className: 'dsev-rank', key: 'r' + i },
        h('span', { className: 'dsev-rank-no' }, String(i + 1)),
        h('span', { className: 'dsev-rank-time' }, `${fmt(s.t0)}–${fmt(s.t1)}`),
        h('span', { className: 'dsev-rank-bar' }, h('i', { style: { width: Math.round(((s.emphasis || 0) / max) * 100) + '%' } })),
        h('span', { className: 'dsev-rank-score' }, String(Math.round(s.emphasis || 0)))))
      return h('div', { className: 'dsev-card-box' },
        h('div', { className: 'dsev-card-title' }, '注意力最高的段落'),
        rows)
    }

    const PAGE_COLORS = ['#7c8cff', '#52c7bd', '#b07cff', '#f0a35e', '#e06f9a']

    function PageDistribution({ chapters }) {
      const counts = new Map()
      for (const c of chapters) {
        const key = hostOf(c.url) || '无地址栏'
        counts.set(key, (counts.get(key) || 0) + 1)
      }
      if (counts.size === 0) return null
      const entries = [...counts.entries()].sort((a, b) => b[1] - a[1])
      const bar = h('div', { className: 'dsev-dist-track' },
        entries.map(([url, count], i) => h('div', {
          key: url, className: 'dsev-dist-seg', title: `${url} · ${count} 章`,
          style: { flex: count, background: PAGE_COLORS[i % PAGE_COLORS.length] },
        })))
      const rows = entries.slice(0, 6).map(([url, count], i) => h('div', { className: 'dsev-dist-row', key: url },
        h('span', { className: 'dsev-donut-swatch', style: { background: PAGE_COLORS[i % PAGE_COLORS.length] } }),
        h('span', { className: 'dsev-dist-name', title: url }, url),
        h('span', { className: 'dsev-dist-count' }, String(count))))
      return h('div', { className: 'dsev-card-box' },
        h('div', { className: 'dsev-card-title' }, '页面分布'),
        bar,
        h('div', { className: 'dsev-dist-list' }, rows))
    }

    function CardView({ meta }) {
      const [open, setOpen] = useState(false)
      const [active, setActive] = useState(null)
      const chapters = Array.isArray(meta.chapters) ? meta.chapters : []
      const ok = meta.gates === 'PASS'
      const openPanel = (e) => {
        e.stopPropagation()
        if (layout) layout.selectPanel('event-video')
      }
      const head = h('div', { className: 'dsev-card-head', onClick: () => setOpen(!open), role: 'button', tabIndex: 0 },
        h(Mark, { className: 'dsev-mark' }),
        h('span', { className: 'dsev-title' }, '视频事件时间线'),
        h('span', { className: 'dsev-meta' }, `${meta.mode || ''} · ${meta.states || 0} 状态 · ${chapters.length} 章`),
        h('span', { className: 'dsev-grow' }),
        h('span', { className: 'dsev-badge' },
          h('i', { className: 'dsev-badge-dot' + (ok ? '' : ' dsev-badge-dot-bad') }),
          ok ? '校验通过' : '校验失败'),
        h('button', { type: 'button', className: 'dsev-btn dsev-btn-primary', onClick: openPanel }, '在面板打开'),
        h('button', { type: 'button', className: 'dsev-btn dsev-btn-ghost', onClick: (e) => { e.stopPropagation(); setOpen(!open) } }, open ? '收起' : '展开'))
      const body = open ? h('div', { className: 'dsev-card-body' },
        h(MiniTrack, { chapters, span: meta.span, active, onSelect: setActive }),
        h('div', { style: { marginTop: 8 } },
          chapters.slice(0, 6).map((c, i) => h(ChapterRow, {
            key: 'c' + i,
            chapter: c,
            active: i === active,
            maxAtt: Math.max(1, ...chapters.map((x) => x.attention || 0)),
            onSelect: () => setActive(i),
          }))),
        chapters.length > 6 ? h('div', { className: 'dsev-foot' }, `还有 ${chapters.length - 6} 章，在面板中查看全部`) : null,
        h('div', { className: 'dsev-foot' }, meta.out || '')) : null
      return h('div', { className: 'dsev dsev-card' }, head, body)
    }

    function Card(props) {
      const phase = props.phase
      const block = props.block
      const meta = phase === 'result' && block && block.meta && block.meta.kind === 'event-video-timeline' ? block.meta : null
      useEffect(() => {
        if (meta) store.add(meta)
      }, [meta && meta.out])
      if (phase !== 'result') {
        return h('div', { className: 'dsev', style: { padding: '9px 14px', opacity: 0.65 } }, '读取视频事件…')
      }
      if (!meta) {
        return h('div', { className: 'dsev', style: { padding: '9px 14px', opacity: 0.65 } }, '事件记录已生成，但卡片缺少时间线数据。')
      }
      return h(CardView, { meta })
    }

    function RecordItem({ record, active, onSelect }) {
      return h('div', {
        className: 'dsev-record' + (active ? ' dsev-record-on' : ''),
        onClick: () => onSelect(record.out),
        title: record.out || '',
      },
      h('div', { className: 'dsev-rec-name' }, basename(record.out)),
      h('div', { className: 'dsev-rec-meta' }, `${(record.chapters || []).length} 章 · ${record.states || 0} 状态`),
      h('div', { className: 'dsev-rec-meta' }, record.savedAt ? new Date(record.savedAt).toLocaleString() : ''))
    }

    function EmptyState() {
      return h('div', { className: 'dsev-empty' },
        h(Mark, { className: 'dsev-mark', size: 36 }),
        h('h3', null, '还没有事件记录'),
        h('div', null, '在对话里调用 ', h('code', null, 'build_video_event'), ' 构建一个视频，完成后这里会自动出现时间线。'))
    }

    function PanelBody({ record, chapters, filtered, activeIndex, setActiveIndex, query, setQuery, filter, setFilter, sort, setSort }) {
      const [toast, showToast] = useToast()
      const selected = activeIndex !== null ? chapters[activeIndex] : null
      const topbar = h('div', { className: 'dsev-topbar' },
        h('span', { className: 'dsev-topbar-title' }, '视频事件'),
        h('span', { className: 'dsev-badge' },
          h('i', { className: 'dsev-badge-dot' + (record.gates === 'PASS' ? '' : ' dsev-badge-dot-bad') }),
          record.gates || ''),
        h('div', { className: 'dsev-topbar-actions' },
          h('button', {
            type: 'button', className: 'dsev-btn',
            onClick: () => { copyText(chaptersMarkdown(record)); showToast('已复制章节表') },
          }, '复制章节表'),
          h('button', {
            type: 'button', className: 'dsev-btn',
            onClick: () => { copyText(record.out || ''); showToast('已复制路径') },
          }, '复制路径')))
      const canvasHead = h('div', { className: 'dsev-canvas-head' },
        h('div', null,
          h('div', { className: 'dsev-range' }, fmt(0), h('span', null, '—'), fmt(record.span || 0)),
          h('div', { className: 'dsev-canvas-meta' },
            h('span', null, h('b', null, String(chapters.length)), ' 章'),
            h('span', null, h('b', null, String(record.states || 0)), ' 个画面片段'),
            h('span', null, h('b', null, String(record.units || 0)), ' 条台词'),
            h('span', null, record.mode || ''),
            h('span', null, 'v1.5'))))
      const canvasCard = h('div', { className: 'dsev-canvas-card' },
        canvasHead,
        h(Canvas, { chapters, span: record.span, selected: activeIndex, onSelect: setActiveIndex }),
        h(DetailBar, { chapter: selected, onCopy: (text, message) => { copyText(text); showToast(message || '已复制') } }))
      const filterChips = [['all', '全部'], ['url', '页面切换'], ['hot', '高注意力']].map(([key, label]) =>
        h('button', {
          key, type: 'button',
          className: 'dsev-chip' + (filter === key ? ' dsev-chip-on' : ''),
          onClick: () => setFilter(key),
        }, label))
      const sortChips = [['time', '按时间'], ['attention', '按注意力']].map(([key, label]) =>
        h('button', {
          key, type: 'button',
          className: 'dsev-chip' + (sort === key ? ' dsev-chip-on' : ''),
          onClick: () => setSort(key),
        }, label))
      const toolbar = h('div', { className: 'dsev-toolbar' },
        h('input', { className: 'dsev-input', placeholder: '搜索时间 / URL', value: query, onChange: (e) => setQuery(e.target.value) }),
        h('div', { className: 'dsev-chips' }, filterChips),
        h('div', { className: 'dsev-chips' }, sortChips))
      const listCard = h('div', { className: 'dsev-card-box' },
        h('div', { className: 'dsev-card-title' }, '章节列表'),
        h(ChapterList, {
          chapters: filtered,
          activeIndex: activeIndex !== null ? filtered.indexOf(chapters[activeIndex]) : -1,
          onSelect: (i) => setActiveIndex(chapters.indexOf(filtered[i])),
        }))
      const rail = h('div', { className: 'dsev-rail' },
        h(TopList, { record }),
        h(PageDistribution, { chapters }))
      return h('div', { className: 'dsev-page' },
        topbar,
        canvasCard,
        toolbar,
        h('div', { className: 'dsev-columns' }, listCard, rail),
        toast ? h('div', { className: 'dsev-toast' }, toast) : null)
    }

    function Panel() {
      const records = useSyncExternalStore(store.subscribe, store.get, store.get)
      const [activeOut, setActiveOut] = useState(records.length ? records[0].out : null)
      const [query, setQuery] = useState('')
      const [filter, setFilter] = useState('all')
      const [sort, setSort] = useState('time')
      const [chapterIndex, setChapterIndex] = useState(null)

      useEffect(() => {
        if (records.length === 0) {
          if (activeOut !== null) setActiveOut(null)
          return
        }
        if (!records.some((r) => r.out === activeOut)) setActiveOut(records[0].out)
      }, [records, activeOut])

      const record = records.find((r) => r.out === activeOut) || null
      const chapters = record ? record.chapters || [] : []
      const filtered = useMemo(() => {
        const list = chapters.filter((c) => {
          if (query) {
            const hay = (fmt(c.t0) + ' ' + fmt(c.t1) + ' ' + (c.url || '') + ' ' + c.reason).toLowerCase()
            if (!hay.includes(query.toLowerCase())) return false
          }
          if (filter === 'url') return c.reason === 'url'
          if (filter === 'hot') return (c.attention || 0) >= median(chapters.map((x) => x.attention || 0))
          return true
        })
        if (sort === 'attention') list.sort((a, b) => (b.attention || 0) - (a.attention || 0))
        else list.sort((a, b) => a.t0 - b.t0)
        return list
      }, [chapters, query, filter, sort])

      const sideHead = h('div', { className: 'dsev-side-head' },
        '事件记录',
        h('span', { className: 'dsev-count' }, String(records.length)),
        h('span', { className: 'dsev-grow' }),
        h('button', {
          type: 'button', className: 'dsev-btn dsev-btn-ghost',
          onClick: () => { if (records.length) store.clear() },
        }, '清空'))
      const items = records.map((r) => h(RecordItem, {
        key: r.out,
        record: r,
        active: r.out === activeOut,
        onSelect: (out) => { setActiveOut(out); setChapterIndex(null) },
      }))
      const sideList = records.length === 0
        ? h('div', { style: { padding: '4px 14px', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, '还没有记录')
        : h('div', { className: 'dsev-records' }, items)
      const content = record === null
        ? h('div', { className: 'dsev-page' }, h(EmptyState, null))
        : h(PanelBody, {
          record, chapters, filtered,
          activeIndex: chapterIndex,
          setActiveIndex: setChapterIndex,
          query, setQuery, filter, setFilter, sort, setSort,
        })
      return h('div', { className: 'dsev dsev-panel' },
        h('div', { className: 'dsev-side' }, sideHead, sideList),
        h('div', { className: 'dsev-main' }, content))
    }

    function ReviewIcon(props) {
      const size = props.size || 20
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        style: { display: 'block', opacity: props.active ? 1 : 0.72 },
        'aria-hidden': true,
      },
      h('rect', {
        x: 2.6, y: 4.2, width: 18.8, height: 12.6, rx: 3.4,
        stroke: 'currentColor', strokeWidth: 1.6,
      }),
      h('path', { d: 'M10.1 8.1 15.3 11l-5.2 2.9V8.1Z', fill: 'currentColor' }),
      h('path', {
        d: 'M4.5 19.6h3.2M9.4 19.6h4.6M15.7 19.6h3.8',
        stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', opacity: 0.55,
      }))
    }

    function ReviewPlayer({ record, data }) {
      const event = data ? data.event : null
      const [annotations, setAnnotations] = useState((data && data.annotations) || [])
      const [vision, setVision] = useState((data && data.vision) || { descriptions: [] })
      useEffect(() => {
        setAnnotations((data && data.annotations) || [])
        setVision((data && data.vision) || { descriptions: [] })
      }, [data])
      const [pipelineInstruction, setPipelineInstruction] = useState('')
      const [pipelineState, setPipelineState] = useState({ running: false, message: '' })
      const [showAiTools, setShowAiTools] = useState(false)
      const [reviewTab, setReviewTab] = useState('chapters')
      const [note, setNote] = useState('')
      const [annotationFilter, setAnnotationFilter] = useState('open')
      const [replyTo, setReplyTo] = useState(null)
      const [replyText, setReplyText] = useState('')
      const runEvidencePipeline = () => {
        const instructions = pipelineInstruction
          .split(/[,，;；]/)
          .map((item) => item.trim())
          .filter(Boolean)
        if (instructions.length === 0) {
          setNote('先输入要定位的元素，例如：商品价格')
          return
        }
        setPipelineState({ running: true, message: '运行中：OCR + UI-TARS 融合，生成工单…', index: 0, total: 0, stage: 'start' })
        let timer = null
        const stopPolling = () => {
          if (timer) {
            clearInterval(timer)
            timer = null
          }
        }
        timer = setInterval(() => {
          fetch('/event-video/pipeline-progress?out=' + encodeURIComponent(record.out))
            .then((r) => r.json())
            .then((progress) => {
              if (progress && progress.running) {
                const index = Number(progress.index || 0)
                const total = Number(progress.total || 0)
                setPipelineState({
                  running: true,
                  message: progress.message || '运行中',
                  index,
                  total,
                  stage: progress.stage || '',
                })
              }
            }).catch(() => {})
        }, 800)
        fetch('/event-video/pipeline', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ out: record.out, instructions, samples: 3 }),
        }).then((r) => r.json()).then((value) => {
          stopPolling()
          if (value.ok) {
            const tickets = value.tickets || []
            const done = tickets.filter((item) => !item.error).length
            const failed = tickets.filter((item) => item.error).length
            setPipelineState({
              running: false,
              message: `完成：${done} 张工单${failed ? `，失败 ${failed}` : ''}（${value.seconds}s）`,
              index: done + failed,
              total: done + failed,
              stage: 'done',
            })
            setNote(`已生成 ${done} 张融合工单${failed ? `，失败 ${failed}` : ''}`)
          } else {
            setPipelineState({ running: false, message: value.error || '证据工单失败' })
          }
        }).catch(() => {
          stopPolling()
          setPipelineState({ running: false, message: '证据工单请求失败' })
        })
      }
      const describeKeyFrames = () => {
        fetch('/event-video/describe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ out: record.out, limit: 5, keyFrames: true, think: true }),
        }).then((r) => r.json()).then((value) => {
          if (value.ok) {
            setVision({ descriptions: value.descriptions || [], model: value.model })
            setNote(`关键帧思考完成：${value.count} 帧（${value.model}）`)
          } else {
            setNote(value.error || '关键帧思考失败')
          }
        }).catch(() => setNote('关键帧思考失败'))
      }
      const describeFrames = () => {
        fetch('/event-video/describe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ out: record.out, limit: 12 }),
        }).then((r) => r.json()).then((value) => {
          if (value.ok) {
            setVision({ descriptions: value.descriptions || [] })
            setNote(`已描述 ${value.count} 帧（失败 ${value.failed || 0}）`)
          } else {
            setNote(value.error || 'VLM 描述失败')
          }
        }).catch(() => setNote('VLM 描述失败'))
      }
      const exportWork = (kind) => {
        fetch('/event-video/work-items', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ out: record.out, kind }),
        }).then((r) => r.json()).then((value) => {
          if (value.dir) setNote('已导出（' + value.count + ' 条）：' + value.dir)
          else setNote(value.error || '导出失败')
        }).catch(() => setNote('导出失败'))
      }
      const addAnnotation = () => {
        const text = window.prompt('标注内容（当前时间点 ' + fmt(time) + '）')
        if (!text) return
        fetch('/event-video/annotations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ out: record.out, action: 'add', annotation: { t0: time, text } }),
        }).then((r) => r.json()).then((value) => {
          if (value.ok) setAnnotations(value.annotations)
          else setNote(value.error || '标注失败')
        }).catch(() => setNote('标注失败'))
      }
      const removeAnnotation = (id) => {
        fetch('/event-video/annotations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ out: record.out, action: 'delete', id }),
        }).then((r) => r.json()).then((value) => {
          if (value.ok) setAnnotations(value.annotations)
          else setNote(value.error || '删除失败')
        }).catch(() => setNote('删除失败'))
      }
      const sendReply = (annotation) => {
        const reply = String(replyText || '').trim()
        if (!reply) return
        fetch('/event-video/annotations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ out: record.out, action: 'reply', id: annotation.id, text: reply, author: 'user' }),
        }).then((r) => r.json()).then((value) => {
          if (value.ok) {
            setAnnotations(value.annotations)
            setReplyTo(null)
            setReplyText('')
            setNote('回复已添加')
          } else {
            setNote(value.error || '回复失败')
          }
        }).catch(() => setNote('回复失败'))
      }
      const toggleResolved = (annotation) => {
        fetch('/event-video/annotations', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            out: record.out,
            action: 'update',
            id: annotation.id,
            patch: { resolved: !annotation.resolved },
          }),
        }).then((r) => r.json()).then((value) => {
          if (value.ok) setAnnotations(value.annotations)
          else setNote(value.error || '状态更新失败')
        }).catch(() => setNote('状态更新失败'))
      }
      const review = data ? data.review : null
      const chapters = event && Array.isArray(event.chapters) ? event.chapters : []
      const units = event && Array.isArray(event.units) ? event.units : []
      const states = event && Array.isArray(event.states) ? event.states : []
      const span = Math.max(event && event.span_s ? event.span_s : 0,
        chapters.length ? chapters[chapters.length - 1].t1 : 0, 1)
      const [time, setTime] = useState(0)
      const [playing, setPlaying] = useState(false)
      const [speed, setSpeed] = useState(1)
      const videoRef = useRef(null)
      const raf = useRef(0)
      const seekRef = useRef(null)
      const dragging = useRef(false)
      const unitRefs = useRef(new Map())

      useEffect(() => {
        const v = videoRef.current
        if (!v) return undefined
        const tick = () => {
          if (!v.paused) setTime(v.currentTime)
          raf.current = requestAnimationFrame(tick)
        }
        raf.current = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf.current)
      }, [data])

      useEffect(() => {
        const v = videoRef.current
        if (v) v.playbackRate = speed
      }, [speed])

      const seek = (target) => {
        const v = videoRef.current
        const next = Math.max(0, Math.min(span - 0.1, target))
        if (v) {
          v.currentTime = next
          setTime(next)
        }
      }
      const toggle = () => {
        const v = videoRef.current
        if (!v) return
        if (v.paused) v.play().catch(() => {})
        else v.pause()
      }
      const chapterIndex = chapters.reduce((acc, c, i) => (c.t0 <= time ? i : acc), -1)
      const currentChapter = chapterIndex >= 0 ? chapters[chapterIndex] : null
      const currentState = states.find((s) => s.t0 <= time && time <= s.t1) || null
      const windowUnits = units.filter((u) => u.t1 >= time - 12 && u.t0 <= time + 40).slice(0, 16)
      const activeUnit = units.find((u) => u.t0 <= time && time <= u.t1) || null

      useEffect(() => {
        if (!activeUnit) return
        const node = unitRefs.current.get(activeUnit.t0)
        if (node && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' })
      }, [activeUnit && activeUnit.t0])

      useEffect(() => {
        const onKey = (e) => {
          const tag = e.target && e.target.tagName
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
          if (e.key === ' ') { e.preventDefault(); toggle() }
          else if (e.key === 'ArrowLeft') seek(time - 5)
          else if (e.key === 'ArrowRight') seek(time + 5)
          else if (e.key === 'j' || e.key === 'J') seek(time - 10)
          else if (e.key === 'l' || e.key === 'L') seek(time + 10)
          else if (e.key === 'k' || e.key === 'K') toggle()
          else if (e.key === 'f' || e.key === 'F') {
            const wrap = videoRef.current && videoRef.current.parentElement
            if (wrap && wrap.requestFullscreen) wrap.requestFullscreen().catch(() => {})
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [time])

      const seekRatio = (clientX) => {
        const node = seekRef.current
        if (!node) return null
        const rect = node.getBoundingClientRect()
        return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      }
      const onSeekPointer = (e) => {
        const ratio = seekRatio(e.clientX)
        if (ratio !== null) seek(ratio * span)
      }
      const maxAtt = Math.max(1, ...chapters.map((c) => c.attention || 0))
      const segs = chapters.map((c, i) => h('div', {
        key: 'ss' + i,
        className: 'dsev-seek-seg',
        title: `${fmt(c.t0)}–${fmt(c.t1)}`,
        style: {
          flex: Math.max(c.t1 - c.t0, 0.2),
          background: c.reason === 'url' ? 'rgba(124,140,255,0.95)' : `${ACCENT}${(0.28 + 0.55 * ((c.attention || 0) / maxAtt)).toFixed(2)})`,
          opacity: currentChapter === c ? 1 : 0.75,
        },
      }))
      const prevChapter = () => {
        const prev = chapterIndex > 0 ? chapters[chapterIndex - 1] : chapters[0]
        if (prev) seek(prev.t0)
      }
      const nextChapter = () => {
        const next = chapters[Math.min(chapterIndex + 1, chapters.length - 1)]
        if (next) seek(next.t0)
      }

      const src = review && review.video ? '/event-video/media?path=' + encodeURIComponent(review.video) : null
      const video = src
        ? h('video', {
          ref: videoRef,
          className: 'dsev-video',
          src,
          controls: true,
          preload: 'metadata',
          onPlay: () => setPlaying(true),
          onPause: () => setPlaying(false),
          onLoadedMetadata: () => setTime(videoRef.current ? videoRef.current.currentTime : 0),
        })
        : h('div', { className: 'dsev-video-empty' },
          record && record.thumb
            ? h('img', {
              className: 'dsev-video-empty-img',
              src: '/event-video/thumb?path=' + encodeURIComponent(record.thumb),
              alt: '',
            })
            : null,
          h('div', { className: 'dsev-video-empty-overlay' },
            h('div', { className: 'dsev-video-empty-title' }, '这条记录没有关联视频'),
            h('div', { className: 'dsev-video-empty-sub' }, '仍可查看帧、章节与转写；构建时保留源视频即可播放。')))

      const controls = h('div', { className: 'dsev-controls' },
        h('button', { type: 'button', className: 'dsev-btn dsev-btn-primary', onClick: toggle }, playing ? '暂停' : '播放'),
        h('button', { type: 'button', className: 'dsev-btn', onClick: () => seek(time - 5) }, '-5s'),
        h('button', { type: 'button', className: 'dsev-btn', onClick: () => seek(time + 5) }, '+5s'),
        h('button', {
          type: 'button',
          className: 'dsev-btn',
          onClick: () => {
            const out = record && record.out
            if (!out) return
            window.open('/event-video/frame?out=' + encodeURIComponent(out) + '&t=' + Math.round(time) + '&format=image', '_blank')
          },
        }, '看帧'),
        h('button', { type: 'button', className: 'dsev-btn', onClick: addAnnotation }, '标注'),
        h('button', { type: 'button', className: 'dsev-btn', onClick: () => setShowAiTools((value) => !value) }, showAiTools ? '收起智能工具' : '智能工具'),
        ...(showAiTools ? [
          h('button', { type: 'button', className: 'dsev-btn', onClick: describeFrames }, '描述画面'),
          h('button', { type: 'button', className: 'dsev-btn', onClick: describeKeyFrames }, '关键帧思考'),
          h('button', { type: 'button', className: 'dsev-btn', onClick: () => exportWork('tickets') }, '导出工单'),
          h('button', { type: 'button', className: 'dsev-btn', onClick: () => exportWork('sop') }, '导出 SOP'),
          h('input', {
            className: 'dsev-input',
            style: { maxWidth: 210 },
            placeholder: '要定位的元素，如 商品价格',
            value: pipelineInstruction,
            onInput: (e) => setPipelineInstruction(e.target.value),
          }),
          h('button', {
            type: 'button', className: 'dsev-btn', disabled: pipelineState.running, onClick: runEvidencePipeline,
          }, '证据工单'),
          pipelineState.message
            ? h('span', { style: { fontSize: 12, opacity: 0.75 } }, pipelineState.message)
            : null,
        ] : []),
        h('button', { type: 'button', className: 'dsev-btn', onClick: prevChapter }, '上一章'),
        h('button', { type: 'button', className: 'dsev-btn', onClick: nextChapter }, '下一章'),
        h('select', {
          className: 'dsev-select', value: String(speed),
          onChange: (e) => setSpeed(Number(e.target.value)),
        }, [0.75, 1, 1.25, 1.5, 2].map((v) => h('option', { key: v, value: String(v) }, `${v}x`))),
        h('button', {
          type: 'button', className: 'dsev-btn',
          onClick: () => {
            const wrap = videoRef.current && videoRef.current.parentElement
            if (wrap && wrap.requestFullscreen) wrap.requestFullscreen().catch(() => {})
          },
        }, '全屏'),
        h('span', { className: 'dsev-meta', title: '空格播放 · ←→ 5s · JKL · F 全屏' }, `${fmt(time)} / ${fmt(span)}`))

      const seekBar = h('div', {
        className: 'dsev-seek',
        ref: seekRef,
        onPointerDown: (e) => { dragging.current = true; if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId); onSeekPointer(e) },
        onPointerMove: (e) => { if (dragging.current) onSeekPointer(e) },
        onPointerUp: () => { dragging.current = false },
        onPointerLeave: () => { dragging.current = false },
      },
      h('div', { className: 'dsev-seek-track' }, segs),
      h('div', { className: 'dsev-seek-head', style: { left: Math.min(100, (time / span) * 100) + '%' } }))

      const now = h('div', { className: 'dsev-now' },
        h('div', { className: 'dsev-now-range' }, currentChapter ? `${fmt(currentChapter.t0)}–${fmt(currentChapter.t1)}` : '—'),
        h('div', { className: 'dsev-now-url', title: currentChapter && currentChapter.url ? currentChapter.url : '' },
          currentChapter && currentChapter.url ? currentChapter.url : '无地址栏'),
        h('div', { className: 'dsev-now-stats' },
          h('span', null, '本段 ', h('b', null, currentChapter ? `${Math.round(currentChapter.dwell)}s` : '—')),
          h('span', null, '关注度 ', h('b', null, currentChapter ? String(Math.round(currentChapter.attention)) : '—')),
          h('span', null, '画面 ', h('b', null, currentState ? String(currentState.attention ? Math.round(currentState.attention.dwell_s) + 's' : '进行中') : '—'))),
        h('div', { className: 'dsev-now-label' },
          currentState
            ? (currentState.label_hi || currentState.label || currentState.label_speech || '（该时刻无文字标签）')
            : '（这一时刻没有画面信息）'))

      const unitRows = windowUnits.map((u) => h('div', {
        key: 'u' + u.t0,
        ref: (node) => { if (node) unitRefs.current.set(u.t0, node) },
        className: 'dsev-unit' + (activeUnit === u ? ' dsev-unit-on' : ''),
        onClick: () => seek(u.t0),
        title: '点击跳到这句',
      },
      h('span', { className: 'dsev-unit-time' }, fmt(u.t0)),
      h('span', null, u.text)))

      const chapterRows = chapters.map((c, i) => h(ChapterRow, {
        key: 'rc' + i,
        chapter: c,
        active: i === chapterIndex,
        maxAtt,
        onSelect: () => seek(c.t0),
      }))

      const pipelinePct = pipelineState.total
        ? Math.min(100, Math.round(((pipelineState.index || 0) / pipelineState.total) * 100))
        : (pipelineState.running ? 10 : 100)
      const reviewFlags = (data && data.event && data.event.review && data.event.review.flags) || []
      const summaryStrip = h('div', { className: 'dsev-summary-strip' },
        [
          ['时长', fmt(span)],
          ['章节', chapters.length],
          ['台词', (data.event.units || []).length],
          ['待确认', reviewFlags.length],
        ].map(([label, value]) => h('div', { className: 'dsev-sum-chip', key: label },
          h('span', { className: 'dsev-sum-chip-label' }, label),
          h('span', { className: 'dsev-sum-chip-value' }, String(value)))))
      const reviewTabs = [
        ['chapters', `章节 ${chapters.length}`],
        ['transcript', `台词 ${windowUnits.length}`],
        ['annotations', `标注 ${annotations.filter((item) => !item.resolved).length}/${annotations.length}`],
        ['descriptions', `画面解读 ${(vision.descriptions || []).length}`],
        ['flags', `待确认 ${reviewFlags.length}`],
      ]
      const openAnnotations = annotations.filter((item) => !item.resolved)
      const doneAnnotations = annotations.filter((item) => item.resolved)
      const filteredAnnotations = annotationFilter === 'open'
        ? openAnnotations
        : annotationFilter === 'done'
          ? doneAnnotations
          : annotations
      const annotationFilterBar = annotations.length === 0
        ? null
        : h('div', { className: 'dsev-comment-filter' },
          [
            ['open', `未完成 ${openAnnotations.length}`],
            ['done', `已完成 ${doneAnnotations.length}`],
            ['all', `全部 ${annotations.length}`],
          ].map(([key, label]) => h('button', {
            key, type: 'button',
            className: 'dsev-filter-chip' + (annotationFilter === key ? ' dsev-filter-chip-on' : ''),
            onClick: () => setAnnotationFilter(key),
          }, label)))
      const annotationsPanel = annotations.length === 0
        ? h('div', { className: 'dsev-detail-empty' }, '没有标注：播放到某一刻点「标注」')
        : [
          annotationFilterBar,
          ...[...filteredAnnotations].sort((a, b2) => a.t0 - b2.t0).map((annotation) => h('div', {
            className: 'dsev-comment' + (annotation.resolved ? ' dsev-comment-done' : ''),
            key: annotation.id,
          },
          h('div', { className: 'dsev-comment-head' },
            h('button', {
              type: 'button', className: 'dsev-time dsev-time-btn',
              onClick: () => seek(annotation.t0),
            }, fmt(annotation.t0)),
            h('span', { className: 'dsev-comment-author' }, annotation.author || 'user'),
            h('span', { className: 'dsev-comment-status' }, annotation.resolved ? '已完成' : '待处理'),
            h('span', { className: 'dsev-grow' }),
            h('button', {
              type: 'button', className: 'dsev-btn dsev-comment-toggle',
              onClick: () => toggleResolved(annotation),
            }, annotation.resolved ? '重新打开' : '标记完成'),
            h('button', {
              type: 'button', className: 'dsev-btn',
              onClick: () => removeAnnotation(annotation.id),
            }, '删除')),
          h('div', { className: 'dsev-comment-body' }, annotation.text),
          (annotation.replies || []).length > 0
            ? h('div', { className: 'dsev-comment-replies' },
              annotation.replies.map((reply) => h('div', { className: 'dsev-comment-reply', key: reply.id },
                h('div', { className: 'dsev-comment-reply-author' }, reply.author || 'user'),
                h('div', { className: 'dsev-comment-reply-text' }, reply.text))))
            : null,
          h('div', { className: 'dsev-comment-actions' },
            h('button', {
              type: 'button', className: 'dsev-btn dsev-comment-reply-btn',
              onClick: () => {
                setReplyTo(replyTo === annotation.id ? null : annotation.id)
                setReplyText('')
              },
            }, `回复${(annotation.replies || []).length ? ` ${annotation.replies.length}` : ''}`)),
          replyTo === annotation.id
            ? h('div', { className: 'dsev-comment-reply-form' },
              h('input', {
                className: 'dsev-input', value: replyText, placeholder: '写一条回复…',
                onInput: (e) => setReplyText(e.target.value),
                onKeyDown: (e) => { if (e.key === 'Enter') sendReply(annotation) },
              }),
              h('button', { type: 'button', className: 'dsev-btn dsev-btn-primary', onClick: () => sendReply(annotation) }, '发送'))
            : null)),
          filteredAnnotations.length === 0
            ? h('div', { className: 'dsev-detail-empty' }, annotationFilter === 'open' ? '没有未完成的标注' : '没有已完成的标注')
            : null,
        ]
      const descriptionsPanel = (vision.descriptions || []).length === 0
        ? h('div', { className: 'dsev-detail-empty' }, '还没有画面解读：展开「智能工具」后点「描述画面」')
        : [...(vision.descriptions || [])].sort((a, b2) => a.t0 - b2.t0).map((item) => h('div', { className: 'dsev-sum-top', key: item.frame + item.t0 },
          h('button', { type: 'button', className: 'dsev-time dsev-time-btn', onClick: () => seek(item.t0) }, fmt(item.t0)),
          h('span', { className: 'dsev-sum-top-title', title: item.description }, item.description)))
      const flagsPanel = reviewFlags.length === 0
        ? h('div', { className: 'dsev-detail-empty' }, '没有需要人工复核的标记')
        : reviewFlags.slice(0, 30).map((flag, index) => h('div', { className: 'dsev-flag-row', key: (flag.code || 'flag') + index },
          h('span', { className: 'dsev-flag-code' }, flag.code || 'flag'),
          h('span', { className: 'dsev-sum-top-title', title: flag.detail || '' }, flag.detail || '')))
      const panel = reviewTab === 'transcript'
        ? h('div', { className: 'dsev-units dsev-panel-scroll' }, unitRows)
        : reviewTab === 'annotations'
          ? annotationsPanel
          : reviewTab === 'descriptions'
            ? descriptionsPanel
            : reviewTab === 'flags'
              ? flagsPanel
              : chapterRows
      return h('div', { className: 'dsev-review-layout' },
        summaryStrip,
        h('div', { className: 'dsev-player-hero' },
          h('div', { className: 'dsev-video-wrap' + (playing ? ' dsev-video-playing' : '') }, video),
          src ? seekBar : null,
          controls,
          note
            ? h('div', { className: 'dsev-inline-note' },
              h('span', null, note),
              h('button', { type: 'button', className: 'dsev-note-close', onClick: () => setNote('') }, '×'))
            : null,
          pipelineState.running || pipelineState.total
            ? h('div', { className: 'dsev-progress' },
              h('div', { className: 'dsev-progress-track' },
                h('div', { className: 'dsev-progress-fill', style: { width: `${pipelinePct}%` } })),
              h('div', { className: 'dsev-progress-label' },
                `${pipelineState.message || ''}${pipelineState.total ? `（${pipelineState.index || 0}/${pipelineState.total}）` : ''}`))
            : null),
        now,
        h('div', { className: 'dsev-review-tabs' },
          reviewTabs.map(([key, label]) => h('button', {
            key, type: 'button',
            className: 'dsev-review-tab' + (reviewTab === key ? ' dsev-review-tab-on' : ''),
            onClick: () => setReviewTab(key),
          }, label))),
        h('div', { className: 'dsev-review-panel' }, panel))
    }

    function ReviewPanel() {
      const [records, setRecords] = useState([])
      const [error, setError] = useState(null)
      const [activeOut, setActiveOut] = useState(null)
      const [data, setData] = useState(null)
      const [dataError, setDataError] = useState(null)

      useEffect(() => {
        let alive = true
        fetch('/event-video/records')
          .then((r) => r.json())
          .then((d) => {
            if (!alive) return
            const rows = d.records || []
            setRecords(rows)
            if (rows.length > 0) setActiveOut((prev) => prev || rows[0].out)
          })
          .catch((e) => { if (alive) setError(String(e)) })
        return () => { alive = false }
      }, [])

      useEffect(() => {
        if (!activeOut) return undefined
        let alive = true
        setData(null)
        setDataError(null)
        fetch('/event-video/data?out=' + encodeURIComponent(activeOut))
          .then((r) => r.json())
          .then((d) => { if (alive) setData(d) })
          .catch((e) => { if (alive) setDataError(String(e)) })
        return () => { alive = false }
      }, [activeOut])

      const active = records.find((r) => r.out === activeOut) || null
      const items = records.map((r) => h('div', {
        key: r.out,
        className: 'dsev-record dsev-review-rec' + (r.out === activeOut ? ' dsev-record-on' : ''),
        onClick: () => setActiveOut(r.out),
        title: r.out,
      },
      r.thumb
        ? h('img', { className: 'dsev-rec-thumb', src: '/event-video/thumb?path=' + encodeURIComponent(r.thumb), alt: '' })
        : h('div', { className: 'dsev-rec-thumb' }),
      h('div', { style: { minWidth: 0, flex: 1 } },
        h('div', { className: 'dsev-rec-name' }, r.title || r.name || r.dir),
        h('div', { className: 'dsev-rec-meta' }, `${r.chapters} 章 · ${fmt(r.duration || r.span || 0)}`),
        h('div', { className: 'dsev-rec-meta' }, r.source || (r.video ? '有视频' : '无视频')))))
      const sideHead = h('div', { className: 'dsev-side-head' }, '审阅记录', h('span', { className: 'dsev-count' }, String(records.length)))
      const content = error
        ? h('div', { className: 'dsev-page' }, h('div', { className: 'dsev-video-error' }, '无法加载记录：', error))
        : active === null
          ? h('div', { className: 'dsev-page' }, h('div', { className: 'dsev-empty' }, h('h3', null, '还没有视频'), h('div', null, '先到视频库添加一个视频。')))
          : h('div', { className: 'dsev-review-main' },
            h('div', { className: 'dsev-topbar' },
              h('span', { className: 'dsev-topbar-title' }, active.name),
              h('span', { className: 'dsev-badge' }, h('i', { className: 'dsev-badge-dot' + (active.gates ? '' : ' dsev-badge-dot-bad') }), active.gates ? 'PASS' : 'FAIL'),
              h('span', { className: 'dsev-meta' }, `${active.chapters} 章 · ${fmt(active.span)}`),
              h('div', { className: 'dsev-topbar-actions' },
                h('button', { type: 'button', className: 'dsev-btn', onClick: () => { if (layout) layout.selectPanel('event-video') } }, '打开总览'))),
            dataError ? h('div', { className: 'dsev-video-error' }, '无法加载事件数据：', dataError) : null,
            data ? h(ReviewPlayer, { record: active, data }) : h('div', { className: 'dsev-video-note' }, '加载中…'))
      return h('div', { className: 'dsev dsev-review' },
        h('div', { className: 'dsev-side' }, sideHead, h('div', { className: 'dsev-review-records' }, items)),
        h('div', { style: { flex: 1, minWidth: 0, overflowY: 'auto' } }, content))
    }

    function eventToOverview(event, out) {
      const states = event.states || []
      const chapters = event.chapters || []
      const top = [...states]
        .sort((a, b) => (b.attention ? b.attention.emphasis : 0) - (a.attention ? a.attention.emphasis : 0))
        .slice(0, 6)
        .map((s) => ({ t0: s.t0, t1: s.t1, emphasis: s.attention ? s.attention.emphasis : 0 }))
      return {
        kind: 'event-video-timeline',
        out,
        mode: event.mode || '',
        states: states.length,
        transitions: event.transitions ? event.transitions.length : 0,
        units: event.units ? event.units.length : 0,
        gaps: event.gaps ? event.gaps.length : 0,
        span: event.span_s || 0,
        gates: event.gates && event.gates.all_ok ? 'PASS' : 'FAIL',
        chapters,
        top,
      }
    }

    function OverviewBody({ record, event }) {
      const meta = useMemo(() => eventToOverview(event, record.out), [event, record.out])
      const chapters = meta.chapters
      const [query, setQuery] = useState('')
      const [filter, setFilter] = useState('all')
      const [sort, setSort] = useState('time')
      const [index, setIndex] = useState(null)
      const filtered = useMemo(() => {
        const list = chapters.filter((c) => {
          if (query) {
            const hay = (fmt(c.t0) + ' ' + fmt(c.t1) + ' ' + (c.url || '') + ' ' + c.reason).toLowerCase()
            if (!hay.includes(query.toLowerCase())) return false
          }
          if (filter === 'url') return c.reason === 'url'
          if (filter === 'hot') return (c.attention || 0) >= median(chapters.map((x) => x.attention || 0))
          return true
        })
        if (sort === 'attention') list.sort((a, b) => (b.attention || 0) - (a.attention || 0))
        else list.sort((a, b) => a.t0 - b.t0)
        return list
      }, [chapters, query, filter, sort])
      return h(PanelBody, {
        record: meta, chapters, filtered,
        activeIndex: index, setActiveIndex: setIndex,
        query, setQuery, filter, setFilter, sort, setSort,
      })
    }

    function LibraryView({ records, onOpen, onRefresh, buildRequest, onConsumeBuild }) {
      const [query, setQuery] = useState('')
      const [jobs, setJobs] = useState([])
      const [compare, setCompare] = useState([])
      const [form, setForm] = useState({ video: '', transcript: '', asr: false, hiLabels: false, mode: 'auto', duration: '' })
      const [busy, setBusy] = useState(false)
      const [note, setNote] = useState('')

      const [trash, setTrash] = useState([])
      const [showTrash, setShowTrash] = useState(false)
      const [selected, setSelected] = useState([])
      const [showBuild, setShowBuild] = useState(false)
      useEffect(() => {
        if (buildRequest) {
          setShowBuild(true)
          if (onConsumeBuild) onConsumeBuild()
        }
      }, [buildRequest])
      const [batchPolicy, setBatchPolicy] = useState({
        instructions: '商品价格',
        order: 'fifo',
        retry: 1,
        concurrency: 1,
        deadlineSeconds: 0,
        priorities: {},
      })
      const [batch, setBatch] = useState({ running: false, id: null, progress: null, note: '' })
      const batchTimer = useRef(null)
      useEffect(() => () => { if (batchTimer.current) clearInterval(batchTimer.current) }, [])
      const toggleSelect = (out) => {
        setSelected((prev) => prev.includes(out) ? prev.filter((item) => item !== out) : [...prev, out])
      }
      const startBatch = () => {
        const instructions = batchPolicy.instructions
          .split(/[,，;；]/)
          .map((item) => item.trim())
          .filter(Boolean)
        if (selected.length === 0) { setBatch({ running: false, id: null, progress: null, note: '先勾选记录' }); return }
        if (instructions.length === 0) { setBatch({ running: false, id: null, progress: null, note: '先填要定位的元素' }); return }
        const body = {
          records: selected,
          instructions,
          samples: 3,
          order: batchPolicy.order,
          retry: Number(batchPolicy.retry) || 0,
          concurrency: Number(batchPolicy.concurrency) || 1,
          deadlineSeconds: Number(batchPolicy.deadlineSeconds) || 0,
          priorities: batchPolicy.order === 'priority'
            ? selected.map((out) => Number(batchPolicy.priorities[out]) || 0)
            : undefined,
        }
        setBatch({ running: true, id: null, progress: null, note: '已提交，等待进度…' })
        fetch('/event-video/batch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }).then((r) => r.json()).then((value) => {
          if (!value.ok) {
            setBatch({ running: false, id: null, progress: null, note: value.error || '批量提交失败' })
            return
          }
          setBatch((prev) => ({ ...prev, id: value.id, note: '运行中…' }))
          batchTimer.current = setInterval(() => {
            fetch('/event-video/batch-progress?id=' + encodeURIComponent(value.id))
              .then((r) => r.json())
              .then((progress) => {
                const running = progress.status === 'running'
                setBatch((prev) => ({ ...prev, progress, running }))
                if (!running) {
                  if (batchTimer.current) clearInterval(batchTimer.current)
                  batchTimer.current = null
                  const rows = progress.records || []
                  const done = rows.filter((item) => item.status === 'done').length
                  const failed = rows.filter((item) => item.status === 'error').length
                  const skipped = rows.filter((item) => item.status === 'skipped').length
                  setBatch((prev) => ({
                    ...prev,
                    running: false,
                    note: `完成：${done} 成功${failed ? `，${failed} 失败` : ''}${skipped ? `，${skipped} 跳过` : ''}`,
                  }))
                  onRefresh()
                }
              }).catch(() => {})
          }, 800)
        }).catch(() => setBatch({ running: false, id: null, progress: null, note: '批量请求失败' }))
      }
      const loadTrash = () => {
        fetch('/event-video/trash').then((r) => r.json()).then((d) => setTrash(d.items || [])).catch(() => {})
      }
      const restoreTrash = (dir) => {
        fetch('/event-video/restore', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dir }),
        }).then(() => { loadTrash(); onRefresh() }).catch(() => {})
      }

      const loadJobs = () => {
        fetch('/event-video/jobs').then((r) => r.json()).then((d) => setJobs(d.jobs || [])).catch(() => {})
      }
      useEffect(() => {
        loadJobs()
        const timer = setInterval(loadJobs, 4000)
        return () => clearInterval(timer)
      }, [])
      const statusKey = jobs.map((j) => j.status).join('|')
      useEffect(() => {
        if (!jobs.some((j) => j.status === 'queued' || j.status === 'running')) onRefresh()
      }, [statusKey])

      const filtered = records.filter((r) => {
        const hay = ((r.title || '') + ' ' + (r.source || '') + ' ' + (r.tags || []).join(' ')).toLowerCase()
        return query === '' || hay.includes(query.toLowerCase())
      })
      const enqueue = () => {
        if (!form.video) { setNote('视频路径必填'); return }
        setBusy(true)
        fetch('/event-video/enqueue', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            video: form.video,
            transcript: form.transcript || undefined,
            asr: form.asr,
            hiLabels: form.hiLabels,
            mode: form.mode,
            duration: form.duration ? Number(form.duration) : undefined,
          }),
        }).then((r) => r.json()).then((d) => {
          if (d.error) setNote(d.error)
          else { setNote('已加入队列'); loadJobs() }
        }).catch((e) => setNote(String(e))).finally(() => setBusy(false))
      }
      const editTags = (record) => {
        const value = window.prompt('标签（逗号分隔）', (record.tags || []).join(','))
        if (value === null) return
        const tags = value.split(',').map((s) => s.trim()).filter(Boolean)
        fetch('/event-video/tags', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ out: record.out, tags }),
        }).then(() => onRefresh()).catch(() => {})
      }
      const toggleCompare = (out) => setCompare((prev) => (prev.includes(out) ? prev.filter((x) => x !== out) : [...prev.slice(-1), out]))
      const renameRecord = (record) => {
        const value = window.prompt('新的标题', record.title || record.name || record.dir || '')
        if (value === null || value.trim() === '') return
        fetch('/event-video/rename', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ out: record.out, title: value.trim() }),
        }).then(() => onRefresh()).catch(() => {})
      }
      const deleteRecord = (record) => {
        const label = record.title || record.name || record.dir
        if (!window.confirm(`删除「${label}」？记录会移到回收站，可恢复。`)) return
        fetch('/event-video/delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ out: record.out }),
        }).then(() => onRefresh()).catch(() => {})
      }
      const revealRecord = (record) => {
        fetch('/event-video/reveal', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ out: record.out }),
        }).catch(() => {})
      }
      const exportRecord = (record) => {
        fetch('/event-video/export', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ out: record.out }),
        }).then((r) => r.json()).then((data) => {
          setNote(data.dir ? '已导出：' + data.dir : (data.error || '导出失败'))
        }).catch(() => setNote('导出失败'))
      }

      const cards = filtered.map((r) => h('div', {
        key: r.out,
        className: 'dsev-lib-card' + (compare.includes(r.out) ? ' dsev-lib-card-on' : ''),
        onClick: () => onOpen(r.out),
      },
      h('input', {
        type: 'checkbox',
        className: 'dsev-lib-select',
        checked: selected.includes(r.out),
        title: '选中用于批量检查',
        onClick: (e) => e.stopPropagation(),
        onChange: () => toggleSelect(r.out),
      }),
      r.thumb
        ? h('img', { className: 'dsev-lib-thumb', src: '/event-video/thumb?path=' + encodeURIComponent(r.thumb), alt: '' })
        : h('div', { className: 'dsev-lib-thumb' }),
      compare.includes(r.out) ? h('span', { className: 'dsev-lib-check' }, '✓') : null,
      h('div', { className: 'dsev-lib-body' },
        h('div', { className: 'dsev-lib-title', title: r.title || r.name || '未命名视频' }, r.title || r.name || '未命名视频'),
        h('div', { className: 'dsev-lib-meta' }, `${fmt(r.duration || r.span || 0)} · ${r.chapters} 个章节`),
        h('div', { className: 'dsev-lib-meta' },
          h('span', { className: 'dsev-lib-status' + (r.gates ? ' dsev-lib-status-ok' : '') }, r.gates ? '已核对' : '需检查')),
        h('div', { className: 'dsev-tags' }, (r.tags || []).map((t) => h('span', { key: t, className: 'dsev-tag' }, t))),
        h('div', { className: 'dsev-lib-actions' },
          h('button', { type: 'button', className: 'dsev-btn dsev-btn-primary', onClick: (e) => { e.stopPropagation(); onOpen(r.out) } }, h(Icon, { name: 'play', size: 14 }), '查看'),
          h('details', { className: 'dsev-lib-more', onClick: (e) => e.stopPropagation() },
            h('summary', { className: 'dsev-btn' }, '更多'),
            h('div', { className: 'dsev-lib-menu' },
              h('button', { type: 'button', className: 'dsev-menu-item', onClick: (e) => { e.stopPropagation(); exportRecord(r) } }, '导出'),
              h('button', { type: 'button', className: 'dsev-menu-item', onClick: (e) => { e.stopPropagation(); renameRecord(r) } }, '改名'),
              h('button', { type: 'button', className: 'dsev-menu-item', onClick: (e) => { e.stopPropagation(); editTags(r) } }, '标签'),
              h('button', { type: 'button', className: 'dsev-menu-item', onClick: (e) => { e.stopPropagation(); toggleCompare(r.out) } }, '对比'),
              h('button', { type: 'button', className: 'dsev-menu-item', onClick: (e) => { e.stopPropagation(); revealRecord(r) } }, '目录'),
              h('button', { type: 'button', className: 'dsev-menu-item dsev-menu-danger', onClick: (e) => { e.stopPropagation(); deleteRecord(r) } }, '删除')))))))

      const buildCard = h('div', { className: 'dsev-build' },
        h('div', {
          className: 'dsev-build-head',
          onClick: () => setShowBuild((value) => !value),
          role: 'button',
          tabIndex: 0,
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') setShowBuild((value) => !value) },
        },
        h('div', { className: 'dsev-build-title' }, '添加新视频'),
        h('span', { className: 'dsev-meta' }, showBuild ? '收起' : '填写视频信息'),
        h('span', { className: 'dsev-grow' }),
        h('button', {
          type: 'button', className: 'dsev-btn',
          onClick: (e) => { e.stopPropagation(); setShowBuild((value) => !value) },
        }, showBuild ? '收起' : '添加')),
        showBuild
          ? h('div', null,
            h('div', { className: 'dsev-build-grid' },
              h('label', { className: 'dsev-field' }, '视频文件（本机路径）',
                h('input', { value: form.video, placeholder: 'D:\\...\\video.mp4', onChange: (e) => setForm({ ...form, video: e.target.value }) })),
              h('label', { className: 'dsev-field' }, '字幕/转写文件（可选）',
                h('input', { value: form.transcript, placeholder: 'D:\\...\\transcript.txt', onChange: (e) => setForm({ ...form, transcript: e.target.value }) })),
              h('label', { className: 'dsev-field' }, '内容类型',
                h('select', { value: form.mode, onChange: (e) => setForm({ ...form, mode: e.target.value }) },
                  ['auto', 'screen', 'action', 'talk'].map((m) => h('option', { key: m, value: m }, ({ auto: '自动识别', screen: '屏幕操作', action: '动作演示', talk: '对话讲解' })[m] || m)))),
              h('label', { className: 'dsev-field' }, '只分析前 N 秒（可选）',
                h('input', { value: form.duration, placeholder: '全部', onChange: (e) => setForm({ ...form, duration: e.target.value }) })),
              h('button', { type: 'button', className: 'dsev-btn dsev-btn-primary', disabled: busy, onClick: enqueue }, h(Icon, { name: 'sparkle', size: 15 }), busy ? '提交中…' : '开始分析')),
            h('div', { style: { display: 'flex', gap: 16, marginTop: 8, alignItems: 'center' } },
              h('label', { className: 'dsev-check' },
                h('input', { type: 'checkbox', checked: form.asr, onChange: (e) => setForm({ ...form, asr: e.target.checked }) }), '自动生成字幕（本地）'),
              h('label', { className: 'dsev-check' },
                h('input', { type: 'checkbox', checked: form.hiLabels, onChange: (e) => setForm({ ...form, hiLabels: e.target.checked }) }), '识别更多画面文字（含网址）'),
              h('span', { className: 'dsev-meta' }, note)))
          : null,
        h('div', { className: 'dsev-meta', style: { marginTop: 6 } }, '分析会排队进行，完成后会出现在上面的视频列表里。'))

      const runningJobs = jobs.filter((j) => j.status !== 'done')
      const jobsCard = jobs.length === 0 ? null : h('div', { className: 'dsev-jobs' },
        h('div', { className: 'dsev-build-title' }, '构建队列'),
        jobs.slice(0, 8).map((j) => h('div', { className: 'dsev-job', key: j.id },
          h('span', { className: 'dsev-job-status' }, j.status === 'done' ? '完成' : j.status === 'running' ? '进行中' : j.status === 'failed' ? '失败' : '排队'),
          h('span', { style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, (j.request && j.request.video ? j.request.video.split(/[\\/]/).pop() : '')),
          h('span', { className: 'dsev-meta' }, j.progress || ''),
          j.error ? h('span', { style: { color: 'var(--dsw-alias-state-error-primary)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: j.error }, j.error) : null)))

      const picked = compare.length === 2 ? compare.map((out) => records.find((r) => r.out === out)).filter(Boolean) : []
      const compareRows = [
        ['时长', (r) => fmt(r.duration || r.span || 0)],
        ['章节', (r) => String(r.chapters)],
        ['画面片段', (r) => String(r.states)],
        ['台词', (r) => String(r.units)],
        ['模式', (r) => r.mode || ''],
        ['核对', (r) => (r.gates ? '已核对' : '需检查')],
      ]
      const headCells = picked.map((r) => h('th', { key: r.out }, r.title || r.name || r.dir))
      const bodyRows = compareRows.map(([label, read]) => h('tr', { key: label },
        h('td', { style: { color: 'var(--dsev-text-3)' } }, label),
        ...picked.map((r) => h('td', { key: r.out }, read(r)))))
      const compareTable = h('table', null,
        h('thead', null, h('tr', null, h('th', null, '指标'), headCells)),
        h('tbody', null, bodyRows))
      const compareCard = picked.length === 2
        ? h('div', { className: 'dsev-compare' },
          h('div', { className: 'dsev-card-box' },
            h('div', { className: 'dsev-card-title' }, '记录对比'),
            compareTable))
        : null

      const trashCard = showTrash
        ? h('div', { className: 'dsev-card-box', style: { marginTop: 12 } },
          h('div', { className: 'dsev-card-title' }, `回收站（${trash.length}）`),
          trash.length === 0
            ? h('div', { className: 'dsev-meta' }, '回收站是空的')
            : trash.map((t) => h('div', { key: t.dir, style: { display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', borderTop: '0.5px solid var(--dsev-border)' } },
              h('span', { style: { flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t.name),
              h('span', { className: 'dsev-meta' }, t.origin || ''),
              h('button', { type: 'button', className: 'dsev-btn', onClick: () => restoreTrash(t.dir) }, '恢复'))))
        : null

      const selectedRecords = selected.map((out) => records.find((r) => r.out === out)).filter(Boolean)
      const batchProgress = batch.progress
      const batchRows = batchProgress && Array.isArray(batchProgress.records) ? batchProgress.records : []
      const batchTotal = batchRows.length || selected.length || 1
      const batchDone = batchRows.filter((item) => ['done', 'error', 'skipped'].includes(item.status)).length
        || batchRows.filter((item) => item.status === 'done').length
      const batchPct = batchProgress
        ? Math.min(100, Math.round((batchDone / batchTotal) * 100))
        : (batch.running ? 5 : 0)
      const priorityFields = batchPolicy.order === 'priority' && selectedRecords.length > 0
        ? h('div', { className: 'dsev-batch-priorities' },
          selectedRecords.map((r) => h('label', { key: r.out, className: 'dsev-check' },
            h('span', { style: { maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              r.title || r.name || r.dir),
            h('input', {
              type: 'number', min: 0, max: 99, className: 'dsev-input', style: { width: 64 },
              value: batchPolicy.priorities[r.out] ?? 0,
              onClick: (e) => e.stopPropagation(),
              onChange: (e) => setBatchPolicy((prev) => ({
                ...prev,
                priorities: { ...prev.priorities, [r.out]: e.target.value },
              })),
            }))))
        : null
      const batchCard = h('div', { className: 'dsev-card-box dsev-batch' + (batch.running ? ' dsev-batch-running' : '') },
        h('div', { className: 'dsev-card-title' }, `批量检查（已选 ${selected.length} 个视频）`),
        h('div', { className: 'dsev-batch-row' },
          h('input', {
            className: 'dsev-input', style: { flex: 1, minWidth: 200 },
            placeholder: '要检查什么？例如：价格、购买按钮',
            value: batchPolicy.instructions,
            onChange: (e) => setBatchPolicy((prev) => ({ ...prev, instructions: e.target.value })),
          }),
          h('select', {
            className: 'dsev-select', value: batchPolicy.order,
            onChange: (e) => setBatchPolicy((prev) => ({ ...prev, order: e.target.value })),
          }, h('option', { value: 'fifo' }, '按顺序'), h('option', { value: 'priority' }, '按优先级')),
          h('details', { className: 'dsev-advanced' },
            h('summary', null, '高级选项'),
            h('div', { className: 'dsev-advanced-row' },
              h('label', { className: 'dsev-check' }, '失败重试',
                h('input', {
                  type: 'number', min: 0, max: 3, className: 'dsev-input', style: { width: 54 },
                  value: batchPolicy.retry,
                  onChange: (e) => setBatchPolicy((prev) => ({ ...prev, retry: e.target.value })),
                })),
              h('label', { className: 'dsev-check' }, '同时处理',
                h('input', {
                  type: 'number', min: 1, max: 2, className: 'dsev-input', style: { width: 54 },
                  value: batchPolicy.concurrency,
                  onChange: (e) => setBatchPolicy((prev) => ({ ...prev, concurrency: e.target.value })),
                })),
              h('label', { className: 'dsev-check', title: '超过该秒数后不再开始新视频，剩余标记为跳过；0 表示不限制' }, '时间上限(秒)',
                h('input', {
                  type: 'number', min: 0, className: 'dsev-input', style: { width: 72 },
                  value: batchPolicy.deadlineSeconds,
                  onChange: (e) => setBatchPolicy((prev) => ({ ...prev, deadlineSeconds: e.target.value })),
                })))),
          h('button', { type: 'button', className: 'dsev-btn', onClick: () => setSelected(records.map((r) => r.out)) }, '全选'),
          h('button', { type: 'button', className: 'dsev-btn', onClick: () => setSelected([]) }, '清空'),
          h('button', {
            type: 'button', className: 'dsev-btn dsev-btn-primary',
            disabled: batch.running || selected.length === 0, onClick: startBatch,
          }, h(Icon, { name: 'check', size: 15 }), batch.running ? '检查中…' : '开始检查')),
        priorityFields,
        batch.running || batchProgress
          ? h('div', { className: 'dsev-progress' },
            h('div', { className: 'dsev-progress-track' },
              h('div', { className: 'dsev-progress-fill', style: { width: `${batchPct}%` } })),
            h('div', { className: 'dsev-progress-label' },
              batch.running
                ? `运行中 ${batchDone}/${batchTotal}${batchProgress && batchProgress.records ? ` · ${(batchProgress.records.find((item) => item.status === 'running') || {}).out || ''}` : ''}`
                : (batch.note || '完成')))
          : null,
        batch.note && !batch.running ? h('div', { className: 'dsev-meta', style: { marginTop: 8 } }, batch.note) : null)

      return h('div', { className: 'dsev-library' },
        h('div', { className: 'dsev-lib-hero' },
          h('div', { className: 'dsev-lib-hero-title' }, '我的视频'),
          h('div', { className: 'dsev-lib-hero-sub' }, '选一个视频查看画面、台词和需要确认的地方；也可以批量检查多个视频。')),
        h('div', { className: 'dsev-lib-toolbar' },
          h('input', {
            className: 'dsev-input', placeholder: '搜索视频标题或标签', value: query,
            onChange: (e) => setQuery(e.target.value),
          }),
          h('button', { type: 'button', className: 'dsev-btn', onClick: () => { loadJobs(); onRefresh() } }, '刷新'),
          h('button', { type: 'button', className: 'dsev-btn', onClick: () => { loadTrash(); setShowTrash(!showTrash) } }, '回收站'),
          h('span', { className: 'dsev-meta' }, `${filtered.length} / ${records.length} 个`)),
        records.length === 0
          ? h('div', { className: 'dsev-empty-start' },
            h('div', { className: 'dsev-empty-start-title' }, '还没有视频'),
            h('div', { className: 'dsev-empty-start-sub' }, '点下面的「添加新视频」，选择一个本机视频文件；分析完成后会出现在这里。'))
          : null,
        batchCard,
        buildCard,
        jobsCard,
        compareCard,
        h('div', { className: 'dsev-grid-cards' }, cards))
    }

    const CAMERA_EVENT_LABELS = {
      motion_start: '开始运动',
      motion_stop: '恢复静止',
      scene_change: '画面变化',
      subject_appear: '检测到主体',
      subject_disappear: '主体离开',
    }

    function CameraPanel() {
      const [state, setState] = useState(null)
      const [events, setEvents] = useState([])
      const [busy, setBusy] = useState(false)
      const [note, setNote] = useState('')

      const loadStatus = () => {
        fetch('/camera/status').then((r) => r.json()).then(setState).catch(() => {})
      }
      const loadEvents = () => {
        fetch('/camera/events?limit=20').then((r) => r.json()).then((d) => setEvents(d.events || [])).catch(() => {})
      }
      useEffect(() => {
        loadStatus()
        loadEvents()
        const statusTimer = setInterval(loadStatus, 300)
        const eventTimer = setInterval(loadEvents, 2500)
        return () => { clearInterval(statusTimer); clearInterval(eventTimer) }
      }, [])

      const start = () => {
        setBusy(true)
        setNote('正在打开摄像头…')
        fetch('/camera/start', { method: 'POST' }).then((r) => r.json()).then((s) => {
          setState(s)
          setNote('监控已启动')
          loadEvents()
        }).catch((e) => setNote(String(e))).finally(() => setBusy(false))
      }
      const stop = () => {
        setBusy(true)
        fetch('/camera/stop', { method: 'POST' }).then((r) => r.json()).then((s) => {
          setState(s)
          setNote('监控已停止')
        }).catch((e) => setNote(String(e))).finally(() => setBusy(false))
      }
      const capture = () => {
        setBusy(true)
        fetch('/camera/snapshot', { method: 'POST' }).then((r) => r.json()).then((d) => {
          setNote(d.ok ? '已抓拍一帧（模型可用 read_image 查看）' : '抓拍失败')
        }).catch((e) => setNote(String(e))).finally(() => setBusy(false))
      }

      const running = state !== null && state.monitor === true
      const frameSrc = running && state.latestFrame ? '/camera/stream' : null
      const chips = state === null ? [] : [
        ['监控', running ? '运行中' : '未启动', running],
        ['帧率', `${state.fps || 5}fps`, false],
        ['运动', state.motion ? '有' : '无', state.motion],
        ['亮度', String(Math.round(state.brightness || 0)), false],
        ['主体', state.subject ? '在场' : '无', state.subject],
        ['事件', String(state.events || 0), false],
      ].map(([label, value, on]) => h('span', { key: label, className: 'dsev-cam-chip' + (on ? ' dsev-cam-chip-on' : '') }, `${label} ${value}`))

      const eventRows = events.length === 0
        ? h('div', { className: 'dsev-cam-note' }, '还没有事件。启动监控后，本地感知在变化时写入事件和关键帧。')
        : events.slice().reverse().map((e) => h('div', { className: 'dsev-cam-event', key: e.seq },
          e.frame ? h('img', { src: '/camera/frame?path=' + encodeURIComponent(e.frame), alt: '' }) : h('div', { className: 'dsev-cam-event img' }),
          h('div', { style: { minWidth: 0 } },
            h('div', { className: 'dsev-cam-event-name' }, CAMERA_EVENT_LABELS[e.kind] || e.kind),
            h('div', { className: 'dsev-cam-event-meta' }, new Date((e.ts || 0) * 1000).toLocaleTimeString()),
            h('div', { className: 'dsev-cam-event-meta' },
              e.motionRatio !== undefined ? `运动比 ${e.motionRatio}` : '',
              e.skinRatio !== undefined ? `主体比 ${e.skinRatio}` : '',
              e.duration !== undefined ? `持续 ${e.duration}s` : ''))))

      return h('div', { className: 'dsev-page' },
        h('div', { className: 'dsev-topbar' },
          h('span', { className: 'dsev-topbar-title' }, '反射监控'),
          h('span', { className: 'dsev-badge' },
            h('i', { className: 'dsev-badge-dot' + (running ? '' : ' dsev-badge-dot-bad') }),
            running ? '运行中' : '未启动'),
          h('span', { className: 'dsev-meta' }, '本地 5Hz 感知，事件才唤醒模型'),
          h('div', { className: 'dsev-topbar-actions' },
            h('button', { type: 'button', className: 'dsev-btn dsev-btn-primary', disabled: busy || running, onClick: start }, '开始监控'),
            h('button', { type: 'button', className: 'dsev-btn', disabled: busy || !running, onClick: stop }, '停止'),
            h('button', { type: 'button', className: 'dsev-btn', disabled: busy, onClick: capture }, '拍一张'))),
        h('div', { className: 'dsev-cam' },
          h('div', null,
            h('div', { className: 'dsev-cam-frame' },
              frameSrc
                ? h('img', { src: frameSrc, alt: '摄像头预览' })
                : h('div', { className: 'dsev-cam-placeholder' },
                  h(Mark, { className: 'dsev-mark', size: 32 }),
                  h('div', null, '摄像头未启动'),
                  h('div', { style: { fontSize: 11.5 } }, '启动后这里显示 1fps 预览'))),
            h('div', { className: 'dsev-cam-chips' }, chips),
            h('div', { className: 'dsev-cam-note' },
              '隐私：只有当你点「开始监控」时本地才采集；画面在 Host 本地处理，不上传；事件关键帧保存在数据目录的 camera/events 下。',
              note ? h('div', { style: { marginTop: 4, color: 'var(--dsev-accent)' } }, note) : null)),
          h('div', { className: 'dsev-card-box' },
            h('div', { className: 'dsev-card-title' }, '事件流'),
            h('div', { className: 'dsev-cam-events' }, eventRows))))
    }

    function SummaryView({ onOpen }) {
      const [summary, setSummary] = useState(null)
      const [toast, showToast] = useToast()
      const [tagFilter, setTagFilter] = useState('')
      const [minDur, setMinDur] = useState('')
      const [maxDur, setMaxDur] = useState('')
      const [query, setQuery] = useState('')
      const [hits, setHits] = useState(null)
      const runSearch = () => {
        const text = query.trim()
        if (!text) return
        fetch('/event-video/search?q=' + encodeURIComponent(text) + '&limit=10')
          .then((r) => r.json())
          .then(setHits)
          .catch(() => showToast('检索失败'))
      }
      const load = () => {
        fetch('/event-video/summary').then((r) => r.json()).then(setSummary).catch(() => {})
      }
      useEffect(() => { load() }, [])
      const reveal = (dir) => {
        fetch('/event-video/reveal', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ out: dir }),
        }).catch(() => {})
      }
      const exportOne = (out) => {
        fetch('/event-video/export', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ out }),
        }).then((r) => r.json()).then((data) => {
          if (data.dir) { showToast('已导出 ' + data.dir); reveal(data.dir) } else showToast(data.error || '导出失败')
        }).catch(() => showToast('导出失败'))
      }
      const exportAll = () => {
        fetch('/event-video/export-summary', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }).then((r) => r.json()).then((data) => {
          if (data.dir) { showToast('已导出总览 ' + data.dir); reveal(data.dir) } else showToast(data.error || '导出失败')
        }).catch(() => showToast('导出失败'))
      }
      if (!summary) return h('div', { className: 'dsev-page' }, h('div', { className: 'dsev-video-note' }, '加载汇总…'))
      const allRecords = summary.records || []
      const allTags = [...new Set(allRecords.flatMap((record) => record.tags || []))]
      const filteredRecords = allRecords.filter((record) => {
        if (tagFilter && !(record.tags || []).includes(tagFilter)) return false
        if (minDur !== '' && record.duration < Number(minDur)) return false
        if (maxDur !== '' && record.duration > Number(maxDur)) return false
        return true
      })
      const totals = {
        records: filteredRecords.length,
        duration: filteredRecords.reduce((sum, r) => sum + r.duration, 0),
        chapters: filteredRecords.reduce((sum, r) => sum + r.chapters, 0),
        states: filteredRecords.reduce((sum, r) => sum + r.states, 0),
        units: filteredRecords.reduce((sum, r) => sum + r.units, 0),
        gatesOk: filteredRecords.filter((r) => r.gates).length,
        flags: filteredRecords.reduce((sum, r) => sum + r.flags.length, 0),
      }
      const cards = [
        ['记录', totals.records], ['总时长', fmtClock(totals.duration)], ['章节', totals.chapters],
        ['画面片段', totals.states], ['台词', totals.units],
      ].map(([label, value]) => h('div', { className: 'dsev-sum-card', key: label },
        h('div', { className: 'dsev-sum-label' }, label),
        h('div', { className: 'dsev-sum-value' }, String(value))))
      const flags = Object.entries(summary.flagsByCode || {}).sort((a, b) => b[1] - a[1])
        .map(([code, count]) => h('div', { className: 'dsev-flag-row', key: code },
          h('span', { className: 'dsev-flag-code' }, code),
          h('span', { className: 'dsev-flag-count' }, String(count))))
      const tops = (summary.topSegments || []).map((segment, index) => h('div', { className: 'dsev-sum-top', key: index },
        h('span', { className: 'dsev-num' }, String(index + 1)),
        h('span', { className: 'dsev-time' }, `${fmtClock(segment.t0)}–${fmtClock(segment.t1)}`),
        h('span', { className: 'dsev-sum-top-title', title: segment.title }, segment.title),
        h('span', { className: 'dsev-num' }, String(Math.round(segment.emphasis)))))
      const rows = filteredRecords.map((record) => h('tr', { key: record.out },
        h('td', null, h('span', { className: 'dsev-url', title: record.title }, record.title)),
        h('td', null, fmtClock(record.duration)),
        h('td', null, String(record.chapters)),
        h('td', null, String(record.states)),
        h('td', null, record.gates ? 'PASS' : 'FAIL'),
        h('td', null, String(record.flags.length)),
        h('td', null, h('div', { style: { display: 'flex', gap: 6 } },
          h('button', { type: 'button', className: 'dsev-btn', onClick: () => onOpen(record.out) }, '打开'),
          h('button', { type: 'button', className: 'dsev-btn', onClick: () => exportOne(record.out) }, '导出')))))
      const table = h('table', { className: 'dsev-table' },
        h('thead', null, h('tr', null,
          h('th', null, '记录'), h('th', null, '时长'), h('th', null, '章节'), h('th', null, '核对'), h('th', null, '审阅'), h('th', null, ''))),
        h('tbody', null, rows))
      return h('div', { className: 'dsev-page' },
        h('div', { className: 'dsev-topbar' },
          h('span', { className: 'dsev-topbar-title' }, '全部分析总览'),
          h('div', { className: 'dsev-topbar-actions' },
            h('button', { type: 'button', className: 'dsev-btn dsev-btn-primary', onClick: exportAll }, '导出总览'),
            h('button', { type: 'button', className: 'dsev-btn', onClick: load }, '刷新'))),
        h('div', { className: 'dsev-toolbar' },
          h('span', { className: 'dsev-meta' }, '标签'),
          h('div', { className: 'dsev-chips' },
            [['', '全部'], ...allTags.map((tag) => [tag, tag])].map(([value, label]) => h('button', {
              key: value || 'all',
              type: 'button',
              className: 'dsev-chip' + (tagFilter === value ? ' dsev-chip-on' : ''),
              onClick: () => setTagFilter(value),
            }, label))),
          h('input', {
            className: 'dsev-input', style: { maxWidth: 110 }, type: 'number', placeholder: '最短秒',
            value: minDur, onChange: (e) => setMinDur(e.target.value),
          }),
          h('input', {
            className: 'dsev-input', style: { maxWidth: 110 }, type: 'number', placeholder: '最长秒',
            value: maxDur, onChange: (e) => setMaxDur(e.target.value),
          }),
          h('span', { className: 'dsev-meta' }, `${filteredRecords.length} / ${allRecords.length} 条`)),
        h('div', { className: 'dsev-toolbar' },
          h('input', {
            className: 'dsev-input', style: { flex: 1, maxWidth: 420 }, placeholder: '跨库检索：登录、缩略图、导航…',
            value: query,
            onChange: (e) => setQuery(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') runSearch() },
          }),
          h('button', { type: 'button', className: 'dsev-btn dsev-btn-primary', onClick: runSearch }, '检索'),
          h('span', { className: 'dsev-meta' }, hits ? `${hits.hits.length} / ${hits.total} 条命中` : '带时间戳的引用')),
        hits && hits.hits && hits.hits.length > 0
          ? h('div', { className: 'dsev-card-box' },
            h('div', { className: 'dsev-card-title' }, '检索结果'),
            hits.hits.map((hit, index) => h('div', { className: 'dsev-sum-top', key: index },
              h('span', { className: 'dsev-num' }, String(index + 1)),
              h('span', { className: 'dsev-time' }, hit.at),
              h('span', { className: 'dsev-sum-top-title', title: hit.text }, `${hit.title} · ${hit.text}`),
              h('button', { type: 'button', className: 'dsev-btn', onClick: () => onOpen(hit.out) }, '打开'),
              h('button', {
                type: 'button', className: 'dsev-btn',
                onClick: () => window.open('/event-video/frame?out=' + encodeURIComponent(hit.out) + '&t=' + Math.round(hit.t0) + '&format=image', '_blank'),
              }, '看帧'))))
          : hits ? h('div', { className: 'dsev-detail-empty' }, '没有命中') : null,
        h('div', { className: 'dsev-sum-grid' }, cards),
        h('div', { className: 'dsev-columns' },
          h('div', null, h('div', { className: 'dsev-card-box' },
            h('div', { className: 'dsev-card-title' }, '记录'),
            table)),
          h('div', { className: 'dsev-rail' },
            h('div', { className: 'dsev-card-box' },
              h('div', { className: 'dsev-card-title' }, '需要确认的问题'),
              flags.length === 0 ? h('div', { className: 'dsev-detail-empty' }, '没有标记') : flags),
            h('div', { className: 'dsev-card-box' },
              h('div', { className: 'dsev-card-title' }, '跨记录注意力最高'),
              tops.length === 0 ? h('div', { className: 'dsev-detail-empty' }, '暂无数据') : tops))),
        toast ? h('div', { className: 'dsev-toast' }, toast) : null)
    }

    function Icon({ name, size = 16 }) {
      const paths = {
        home: h('path', { d: 'M3 10.7 12 3l9 7.7V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z' }),
        library: h('g', null, h('rect', { x: 3, y: 4, width: 7, height: 16, rx: 1.5 }), h('rect', { x: 14, y: 4, width: 7, height: 16, rx: 1.5 })),
        play: h('path', { d: 'M8 5.5v13l11-6.5Z' }),
        check: h('path', { d: 'm4 12.5 5 5L20 6.5' }),
        alert: h('g', null, h('path', { d: 'M12 3 2.5 20h19Z' }), h('path', { d: 'M12 9v5' }), h('path', { d: 'M12 17.5v.5' })),
        plus: h('path', { d: 'M12 4v16M4 12h16' }),
        sparkle: h('path', { d: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z' }),
        video: h('g', null, h('rect', { x: 3, y: 6, width: 13, height: 12, rx: 2 }), h('path', { d: 'm16 10 5-3v10l-5-3' })),
        menu: h('path', { d: 'M4 7h16M4 12h16M4 17h16' }),
      }
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, style: { flex: 'none' },
      }, paths[name] || paths.video)
    }

    function HomeView({ records, onOpen, onGoLibrary, onAdd }) {
      const [dismissed, setDismissed] = useState(() => {
        try { return window.localStorage.getItem('dsev-onboard-dismissed') === '1' } catch { return false }
      })
      const dismiss = () => {
        try { window.localStorage.setItem('dsev-onboard-dismissed', '1') } catch { /* private mode */ }
        setDismissed(true)
      }
      const needCheck = records.filter((record) => !record.gates).length
      const totalSeconds = records.reduce((sum, record) => sum + Number(record.duration || record.span || 0), 0)
      const recent = records.slice(0, 4)
      const steps = [
        { icon: 'plus', title: '添加视频', text: '选择一个本机视频文件，支持屏幕录制和对话视频。' },
        { icon: 'sparkle', title: '自动分析', text: '提取画面、台词和章节，整理成可浏览的时间线。' },
        { icon: 'check', title: '处理待确认', text: '查看系统标出的疑点，写标注或导出成工单。' },
      ]
      return h('div', { className: 'dsev-home' },
        h('section', { className: 'dsev-home-hero' },
          h('div', { className: 'dsev-home-hero-text' },
            h('h1', null, '把视频变成可核对的工作清单'),
            h('p', null, '添加一个视频，自动提取画面、台词和章节；需要你确认的地方会单独列出来。')),
          h('div', { className: 'dsev-home-actions' },
            h('button', { type: 'button', className: 'dsev-btn dsev-btn-primary', onClick: onAdd },
              h(Icon, { name: 'plus' }), '添加视频'),
            h('button', { type: 'button', className: 'dsev-btn', onClick: onGoLibrary },
              h(Icon, { name: 'library' }), '打开视频库'))),
        h('section', { className: 'dsev-home-stats' },
          [
            ['视频', records.length, 'library'],
            ['需检查', needCheck, 'alert'],
            ['总时长', fmt(totalSeconds), 'video'],
          ].map(([label, value, icon]) => h('div', { className: 'dsev-stat', key: label },
            h('span', { className: 'dsev-stat-icon' }, h(Icon, { name: icon, size: 18 })),
            h('span', { className: 'dsev-stat-value' }, String(value)),
            h('span', { className: 'dsev-stat-label' }, label)))),
        dismissed ? null : h('section', { className: 'dsev-onboard' },
          h('div', { className: 'dsev-onboard-head' },
            h('div', null,
              h('div', { className: 'dsev-onboard-title' }, '三步开始'),
              h('div', { className: 'dsev-onboard-sub' }, '第一次用？照下面做即可。')),
            h('button', { type: 'button', className: 'dsev-btn', onClick: dismiss }, '知道了')),
          h('div', { className: 'dsev-onboard-steps' },
            steps.map((step, index) => h('div', { className: 'dsev-step', key: step.title },
              h('span', { className: 'dsev-step-index' }, String(index + 1)),
              h('span', { className: 'dsev-step-icon' }, h(Icon, { name: step.icon, size: 18 })),
              h('div', null,
                h('div', { className: 'dsev-step-title' }, step.title),
                h('div', { className: 'dsev-step-text' }, step.text)))))),
        h('section', { className: 'dsev-home-section' },
          h('div', { className: 'dsev-home-section-title' }, '最近视频'),
          recent.length === 0
            ? h('div', { className: 'dsev-empty-start' },
              h('div', { className: 'dsev-empty-start-title' }, '还没有视频'),
              h('button', { type: 'button', className: 'dsev-btn dsev-btn-primary', style: { marginTop: 10 }, onClick: onAdd },
                h(Icon, { name: 'plus' }), '添加第一个视频'))
            : h('div', { className: 'dsev-home-recent' },
              recent.map((record) => h('div', { key: record.out, className: 'dsev-home-row', onClick: () => onOpen(record.out) },
                record.thumb
                  ? h('img', { className: 'dsev-home-thumb', src: '/event-video/thumb?path=' + encodeURIComponent(record.thumb), alt: '' })
                  : h('div', { className: 'dsev-home-thumb' }),
                h('div', { className: 'dsev-home-row-body' },
                  h('div', { className: 'dsev-home-row-title' }, record.title || record.name || '未命名视频'),
                  h('div', { className: 'dsev-home-row-meta' }, `${fmt(record.duration || record.span || 0)} · ${record.chapters} 个章节`)),
                h('span', { className: 'dsev-lib-status' + (record.gates ? ' dsev-lib-status-ok' : '') },
                  record.gates ? '已核对' : '需检查'),
                h('span', { className: 'dsev-home-row-open' }, h(Icon, { name: 'play', size: 15 })))))))
    }

    function UnifiedPanel() {
      const [records, setRecords] = useState([])
      const [error, setError] = useState(null)
      const [activeOut, setActiveOut] = useState(null)
      const [data, setData] = useState(null)
      const [dataError, setDataError] = useState(null)
      const [view, setView] = useState('home')
      const [buildRequest, setBuildRequest] = useState(false)

      const reloadRecords = () => {
        fetch('/event-video/records')
          .then((r) => r.json())
          .then((d) => {
            const rows = d.records || []
            setRecords(rows)
            if (rows.length > 0) setActiveOut((prev) => prev || rows[0].out)
          })
          .catch((e) => setError(String(e)))
      }

      useEffect(() => {
        reloadRecords()
      }, [])

      useEffect(() => {
        if (!activeOut) return undefined
        let alive = true
        setData(null)
        setDataError(null)
        fetch('/event-video/data?out=' + encodeURIComponent(activeOut))
          .then((r) => r.json())
          .then((d) => { if (alive) setData(d) })
          .catch((e) => { if (alive) setDataError(String(e)) })
        return () => { alive = false }
      }, [activeOut])

      const active = records.find((r) => r.out === activeOut) || null
      const renameActive = () => {
        if (!active) return
        const value = window.prompt('新的标题', active.title || active.name || active.dir || '')
        if (value === null || value.trim() === '') return
        fetch('/event-video/rename', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ out: active.out, title: value.trim() }),
        }).then(() => reloadRecords()).catch(() => {})
      }
      const deleteActive = () => {
        if (!active) return
        if (!window.confirm(`删除「${active.title || active.name || active.dir}」？记录会移到回收站，可恢复。`)) return
        fetch('/event-video/delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ out: active.out }),
        }).then(() => { reloadRecords(); setActiveOut(null); setData(null) }).catch(() => {})
      }
      const revealActive = () => {
        if (!active) return
        fetch('/event-video/reveal', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ out: active.out }),
        }).catch(() => {})
      }
      const items = records.map((r) => h('div', {
        key: r.out,
        className: 'dsev-record dsev-review-rec' + (r.out === activeOut ? ' dsev-record-on' : ''),
        onClick: () => setActiveOut(r.out),
        title: r.out,
      },
      r.thumb
        ? h('img', { className: 'dsev-rec-thumb', src: '/event-video/thumb?path=' + encodeURIComponent(r.thumb), alt: '' })
        : h('div', { className: 'dsev-rec-thumb' }),
      h('div', { style: { minWidth: 0, flex: 1 } },
        h('div', { className: 'dsev-rec-name' }, r.title || r.name || r.dir),
        h('div', { className: 'dsev-rec-meta' }, `${r.chapters} 章 · ${fmt(r.duration || r.span || 0)}`),
        h('div', { className: 'dsev-rec-meta' }, r.source || (r.video ? '有视频' : '无视频')))))
      const sideHead = h('div', { className: 'dsev-side-head' }, '视频库', h('span', { className: 'dsev-count' }, String(records.length)))
      const tabs = h('div', { className: 'dsev-tabs' },
        [['home', '首页', 'home'], ['library', '视频库', 'library'], ['review', '查看', 'play']].map(([key, label, icon]) => h('button', {
          key, type: 'button',
          className: 'dsev-tab' + (view === key ? ' dsev-tab-on' : ''),
          onClick: () => setView(key),
        }, h(Icon, { name: icon, size: 15 }), label)),
        h('select', {
          className: 'dsev-select dsev-more-view',
          value: ['overview', 'summary', 'camera'].includes(view) ? view : '',
          onChange: (e) => { if (e.target.value) setView(e.target.value) },
          title: '更多视图',
        },
        h('option', { value: '' }, '更多'),
        h('option', { value: 'overview' }, '总览'),
        h('option', { value: 'summary' }, '汇总'),
        h('option', { value: 'camera' }, '摄像头')))
      const header = h('div', { className: 'dsev-topbar' },
        records.length > 0 && view !== 'home'
          ? h('select', {
            className: 'dsev-record-select',
            value: activeOut || '',
            onChange: (e) => setActiveOut(e.target.value),
            title: '切换记录',
          }, records.map((r) => h('option', { key: r.out, value: r.out }, r.title || r.name || r.dir)))
          : h('span', { className: 'dsev-topbar-title' }, '我的视频'),
        tabs,
        active ? h('span', { className: 'dsev-badge' },
          h('i', { className: 'dsev-badge-dot' + (active.gates ? '' : ' dsev-badge-dot-bad') }),
          active.gates ? 'PASS' : 'FAIL') : null,
        (data && data.event && data.event.review && data.event.review.flags && data.event.review.flags.length > 0)
          ? h('span', { className: 'dsev-badge' }, `待确认 ${data.event.review.flags.length}`)
          : null,
        h('div', { className: 'dsev-topbar-actions' },
          view === 'review' ? h('button', { type: 'button', className: 'dsev-btn', onClick: () => setView('library') }, '← 库') : null,
          view !== 'home' && active ? h('button', { type: 'button', className: 'dsev-btn', onClick: renameActive }, '改名') : null,
          view !== 'home' && active ? h('button', { type: 'button', className: 'dsev-btn', onClick: revealActive }, '目录') : null,
          view !== 'home' && active ? h('button', { type: 'button', className: 'dsev-btn', onClick: deleteActive }, '删除') : null,
          data && data.review && data.review.video
            ? h('span', { className: 'dsev-meta' }, data.review.video.split(/[\\/]/).pop())
            : null))
      const content = error
        ? h('div', { className: 'dsev-page' }, h('div', { className: 'dsev-video-error' }, '无法加载记录：', error))
        : view === 'home'
          ? h('div', { className: 'dsev-page' }, h(HomeView, {
            records,
            onOpen: (out) => { setActiveOut(out); setView('review') },
            onGoLibrary: () => setView('library'),
            onAdd: () => { setView('library'); setBuildRequest(true) },
          }))
        : view === 'camera'
          ? h(CameraPanel, null)
          : view === 'summary'
            ? h(SummaryView, { onOpen: (out) => { setActiveOut(out); setView('review') } })
            : view === 'library'
          ? h('div', { className: 'dsev-page' }, h(LibraryView, {
            records,
            onOpen: (out) => { setActiveOut(out); setView('review') },
            onRefresh: reloadRecords,
            buildRequest,
            onConsumeBuild: () => setBuildRequest(false),
          }))
          : active === null
            ? h('div', { className: 'dsev-page' }, h('div', { className: 'dsev-empty' },
              h('h3', null, records.length > 0 ? '从视频库选择一个视频' : '视频库还是空的'),
              h('div', null, records.length > 0
                ? '点击视频卡片即可查看画面、台词和需要确认的地方。'
                : '先到「视频库」添加一个视频，分析完成后这里就会出现它。'),
              records.length > 0
                ? h('button', { type: 'button', className: 'dsev-btn dsev-btn-primary', onClick: () => setView('library') }, '去视频库')
                : null))
            : dataError
              ? h('div', { className: 'dsev-page' }, h('div', { className: 'dsev-video-error' }, '无法加载事件数据：', dataError))
              : data
                ? (view === 'review'
                  ? h(ReviewPlayer, { record: active, data })
                  : h('div', { className: 'dsev-page' }, h(OverviewBody, { record: active, event: data.event })))
                : h('div', { className: 'dsev-page' }, h('div', { className: 'dsev-video-note' }, '加载中…'))
      return h('div', { className: 'dsev dsev-review dsev-noside' },
        h('div', { className: 'dsev-main' },
          h('div', { className: 'dsev-topbar-wrap' }, header),
          content))
    }

    function PanelIcon(props) {
      const size = props.size || 20
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        style: { display: 'block', opacity: props.active ? 1 : 0.7 },
        'aria-hidden': true,
      },
      h('rect', { x: 3, y: 9, width: 4, height: 6, rx: 1, fill: 'currentColor' }),
      h('rect', { x: 9, y: 5, width: 4, height: 14, rx: 1, fill: 'currentColor' }),
      h('rect', { x: 15, y: 8, width: 4, height: 8, rx: 1, fill: 'currentColor', opacity: 0.6 }))
    }

    return {
      inject: ['slots', 'layout'],
      apply(ctx) {
        layout = ctx.get('layout')
        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-dsh-event-video', '')
          style.textContent = CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'event-video: styles')
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
          { name: 'tool.call.toolview', key: 'build_video_event' },
          Card,
        ))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
          { name: 'sidebar.panellist', id: 'event-video', order: 20, label: '视频审阅' },
          ReviewIcon,
        ))
        ctx.slots.inject('main', () => ctx.slots.register(
          { name: 'main', key: 'event-video' },
          UnifiedPanel,
        ))
      },
    }
  },
})
