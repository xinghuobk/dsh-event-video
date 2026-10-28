# Changelog

## 0.2.0

- deterministic `review` block embedded in every build (gates, OCR URL anomalies, unlabeled states, long gaps, alignment outliers, chapter length)
- `dominant_url`: deterministic chapter URL choice (count, then longest capture, then first appearance)
- export module: Markdown / CSV / JSON / Word / Excel (`event-build.export_office`)
- DSH bundle: review tool, export tool, cross-record summary tool and views, tag/duration filters
- portable configuration: data home, python path, whisper model, camera device and allowed roots
- JS library indexer (no Python script dependency for the UI)
- timeline annotations: `annotate_video_record` / `list_video_annotations` with `annotations.json` sidecar (atomic write, frame anchor, export section, `enableAnnotations` switch, acceptance test)`n- library search: `search_video_library` / `ask_video_library` (local BM25-style index, CJK bigrams, videoId duplicate collapsing, `enableSearchTool` switch, acceptance tests)`n- `read_video_frame` tool + `/event-video/frame` route (on-demand frame, scene context, on-demand ffmpeg extraction, `enableFrameTool` switch, acceptance test)`n- synthetic demo video and README timeline assets
- CI workflow (engine pytest + Node syntax/manifest checks), issue and PR templates, roadmap

## 0.1.0

- initial engine: frame state machine, OCR labels, transcript alignment, semantic chapters, attention proxy, completeness gates
- DSH tool plugin and review workbench bundle
- reflex camera monitor
