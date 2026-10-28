# Roadmap

Direction is "make every second verifiable", not "summarize more".

## Now (v0.2)

- [x] deterministic build: frames → states → transitions → gates
- [x] speech units aligned to transitions
- [x] semantic chapters (page switch + topic minima)
- [x] attention proxy and top segments
- [x] deterministic review flags (OCR URL anomalies, unlabeled states, gaps, alignment, chapter outliers)
- [x] export: Markdown / CSV / JSON / Word / Excel
- [x] cross-record summary view with tag and duration filters

## Next

- [ ] publish `event-build` on PyPI and `dsh-event-video` on npm
- [ ] self-contained HTML export (offline viewer with frames and transcript)
- [ ] PDF export (ticket / handoff format)
- [ ] snapshot tests for the UI card and review layout
- [ ] better chapter boundaries: embedding-based topic segmentation behind a flag
- [ ] OCR URL normalization: recover `=` / `&` from address-bar reads

## Later

- [ ] multi-language UI copy
- [ ] speaker diarization for meeting recordings
- [ ] batch re-build across a library with diff
- [ ] local VLM reflex layer for the camera (event-triggered description)

## Non-goals

- buying stars, growth hacks, or generic "AI summarize your video" positioning
- cloud upload of recordings; everything stays local
