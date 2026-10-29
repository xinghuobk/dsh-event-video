# Interface design: industry practice and our rules

This note records what the plugin's review UI borrows from professional video-review tools, AI tooling conventions and calm productivity UIs, then maps each rule to shipped behavior.

## Sources

- Frame.io comment panel: comments are **anchored to timecode**, default sort is Timecode, cards can be filtered/searched, marked complete, and exported ([Frame.io Help](https://help.frame.io/zh-CN/articles/9105278-评论面板概述)).
- Linear design refresh: **"don't compete for attention you haven't earned"** (dim navigation, compact tab bars, smaller icons) and **"structure should be felt, not seen"** (fewer, softer separators, calmer palette) ([Linear](https://linear.app/now/behind-the-latest-design-refresh)).
- NN/g video usability: users need **control**, must be told **what the video contains and how long it is**, and need an **alternate path (transcript/chapters)** because video cannot be skimmed ([NN/g](https://www.nngroup.com/articles/video-usability/)).
- Mux Player: standard transport controls, themable chrome, timeline hover previews; the player itself is the anchor and chrome stays out of the way ([Mux](https://www.mux.com/docs/guides/player-customize-look-and-feel)).
- Raycast UI: a small design-system vocabulary (List / Grid / Detail / Form), a single primary action plus an **ActionPanel**, and immediate loading state ([Raycast](https://developers.raycast.com/api-reference/user-interface.md)).

## Rules we adopt

1. **Timecode is the spine.** Every annotation, description and chapter shows a timecode chip; clicking it seeks the player. Review panels are sorted by time.
2. **One task per screen.** Library is a chooser; Review is a player plus one tabbed panel (`章节 / 转写 / 标注 / 描述 / 标记`). Secondary views live in **更多**.
3. **Chrome recedes.** Neutral surfaces, one accent, no glowing cards or shimmering bars; borders are soft and few. The player has the highest visual weight.
4. **The transcript is always one click away.** NN/g's control/alternate-path rule maps to the 转写 tab; no AI output is the only copy of a fact.
5. **AI output is evidence, not command.** OCR/VLM/UI-TARS results carry a source, model and confidence; contradictions are explicit; humans confirm with 标注 / 导出.
6. **No modal interruptions.** AI actions report inline (`dsev-inline-note`) instead of `window.alert`; failures keep the user on the frame.
7. **Time is legible.** Current time, duration and progress are monospaced/tabular; progress is a calm accent fill, not decoration.
8. **Keyboard and focus are first-class.** Space/←→/JKL/F work in the player; focus rings are visible; reduced motion is respected.
9. **Density without noise.** 8pt-ish spacing, type scale ~12/13/14/17, 12–16px radii, secondary actions in overflow menus.

## Mapping to the UI

| Rule | Where |
|---|---|
| timecode chips seek | annotations / descriptions rows |
| one panel | `reviewTabs` (章节/转写/标注/描述/标记) |
| secondary views | 更多 menu (总览/汇总/摄像头) |
| evidence-first AI | fusion confidence + conflicts, `source` on every evidence item |
| inline feedback | `note` state under player controls |
| calm chrome | `.dsev-*` token overrides at the end of the client stylesheet |

## Deliberate departures

- We keep a dark, compact layout rather than a pure media-player layout because the job is review plus export, not playback.
- We keep the model/confidence text visible; a consumer video player would hide it, but a review tool must not.
