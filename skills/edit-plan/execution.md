# Execute after approval

Do not read all of `edit.json` / `captions.json`; grep by id and read only matching lines ([how to read edit.json](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/edit-json-access.md)). Write with a targeted edit or the edit-store script API.

> **edit.json v2**: The top level is exact; no fields other than `version` / `output` / `sources` / `tracks` / `audio` / `captions` / `thumbnail` are allowed. `beats` / `emphasis_words` / `direction` were retired in v2; put them in the decision record, not `edit.json`. Consumer code has also removed them; do not restore them.

## Principle

Read this file after explicit Checkpoint 3 approval for `autonomy: collaborative`; for other autonomy modes, read it before writing edit.json. Translate the approved manifest faithfully into `edit.json` and authoring rules under the [M1–M4 contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-13-m1-m4.md) by targeted edit or edit-store script API. Do not invent fields for an unrepresentable plan. Only fields defined in the public contract may be used ([SKILL.md](SKILL.md) hard rule).

A cut candidate report is not execution approval. Do not copy `decision:"REVIEW_REQUIRED"` candidates directly into cuts; use only those explicitly accepted or rejected by the human for this report and appended to the append-only decision log. If final-edit fps is not 30, speed is not 1, track is not 0, or a timeline `at` is added, invalidate the report's pause-frame proposal, recalculate, and review again. Do not change `edit.json` before Checkpoint 3.

Do not automatically mark completion after applying candidates. For the same preview/render version, a human must check `POST_CUT_ASR_REVIEW` (retranscription and comparison with original audio), `POST_CUT_INFORMATION_RETENTION` (surrounding context and required information), `POST_CUT_UI_TIMING_REVIEW` (clicks, transitions, loading waits, result display), and `POST_CUT_AUDIO_BOUNDARY_REVIEW` (clicks, word starts/ends, breathing, reverb, silence). Finally, do not call it complete until `HUMAN_APPLY_GATE` is explicitly approved. If any item is revised, recheck all items in the new version and append results to append-only `decision-log.md`.

## 1. Settle sources and tracks

**Write every new `edit.json` as v2, regardless of the source count.** Declare assets in `sources[]` and clips in `tracks[].items[]`. Do not create old `cuts` / `layers` / `overlays` keys.

- Tracks have only `lane: "visual" | "audio"` and `tracks[]` array order. Later visual tracks appear in front. Do not divide tracks by "main video" or "layer" types.
- Write output position `at` / `duration` in integer frames and media source range `source.in` / `source.out` in seconds.
- Represent asset type by `source.kind` (`media` / `html` / `telop` / `filter`), not by track.
- Keep declared tracks with empty `items[]`; do not auto-delete them when a move empties them.
- Leave v0/v1 conversion on open to the reader layer's proposal followed by explicit approval; this skill must not convert on its own.

### Music placement defaults to clips (2026-08-18 decision)

**When music covers only part of the video, the standard is a media clip on an audio track.** `source.in` / `source.out` are source seconds; `at` / `duration` are integer frames. Move and trim it like a visual clip.

```json
{
  "id": "music-1",
  "at": 360,
  "duration": 480,
  "source": { "kind": "media", "src": "music", "in": 48.0, "out": 64.0 }
}
```

At 30fps, this example plays source seconds 48.0–64.0 starting at output second 12.0. Declare `{ "id": "music", "path": "assets/audio/theme-song.m4a" }` in `sources[]`.

`audio.bgm` **remains for backward compatibility as the shortest expression of a whole-video music bed** (new projects default to clips). Use `bgm` when a song should start at its beginning, loop automatically, and follow video duration without writing `t`/`out`. For a partial interval, switching among songs, or explicit trimming at any position, write music as `sfx[]` clips.

### Notes for writing v2

- **Tracks with empty `items[]` stay empty.** Even for a whole source, declare a media clip explicitly.
- **Anchor captions, annotations, and analysis results by (`src`, source seconds).** A source interval may recur on the timeline, so source-to-timeline mapping is one-to-many; do not persist a timeline-second conversion. Every caption (`captions.json`) and annotation (`annotations[]` in `review.json`) writes `sources[].id` in `src`. Omitting `src` means single-source compatibility; with two or more sources, the item is skipped with a warning.
- **Sequential `s1`, `s2`, … values are recommended for `sources[].id`.** References use stable ids, not paths, so replacing an asset or changing its path does not break cut or sidecar references. Ids must be unique within the file.
- Use `version` 2, `sources[]` for the asset table, and `tracks[].items[]` for clips.
- `at` / `duration` are output frames; media `source.in` / `source.out` are source seconds.

### Handling still assets (2026-08-12)

- **Put stills directly on a visual track as media clips.** Use one item per image; do not concatenate with ffmpeg. Use `at` / `duration` / `transform` / `crop` / `perspective` / `keyframes` as for other visual clips.
- **Library `still` assets are images by default (2026-10-12).** Place the single image directly in the asset folder (not `preview.png`, e.g. `bg.png`) as a media clip via `sources[]`. Use the asset's `fragment.html` (an HTML overlay) only when the user asks for one of its knobs (hue, brightness, vignette, …) or when the folder has no single image.

### Timing basis for overlaid media clips

For cutout people, B-roll, and other media overlaid on another visual track, **a drift of a dozen or more frames is easy to introduce**. The canonical rules are `https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-08-02-preview-parity.md` §2.4 and `https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-22-render-basics.md` §2-3.

- A media clip declares its source interval with `source.in` / `source.out` and output interval with `at` / `duration`. **Do not trim by guessing** that, for example, because a panel appears earlier the source must contain preroll. Guessing shifts the source beginning earlier and exhausts the source at the end when `duration` is shortened, leaving a moment where the overlay disappears and only the underlying video remains.
- If a source was pre-cut, **always leave its provenance (original / in / out / speed / fps) beside it**. Otherwise the next editor must guess what time its beginning represents and may repeat the same error.
- For per-track color changes, declare a filter item using `source.kind: "filter"`.
- When **measuring** timing alignment later, do not use absolute `blend=difference`. Color differences dominate and flatten that measure, making an arbitrary lag look minimal. Take the **time series of inter-frame difference energy** (`format=gray,tblend=all_mode=difference` → YAVG from `signalstats`) for the source and cut, normalize, then **cross-correlate**. This identifies lag independently of color. If the cut uses `speed`, correlation can also distinguish whether speed was baked into the asset or it remains at the original source rate.

## 2. Create edit.json

Put approved values into the following form. Do not reuse sample numbers as defaults.

**v2 (30fps, video plus HTML clip)**

```json
{
  "version": 2,
  "output": { "width": 1280, "height": 720, "fps": 30 },
  "sources": [
    { "id": "s1", "path": "source/master.mp4", "proxy": "source/master-proxy.mp4" }
  ],
  "tracks": [
    {
      "id": "v1", "lane": "visual", "name": "インタビュー",
      "items": [
        { "id": "clip-1", "at": 0, "duration": 150,
          "source": { "kind": "media", "src": "s1", "in": 5.0, "out": 10.0 } }
      ]
    },
    {
      "id": "v2", "lane": "visual", "name": "タイトル",
      "items": [
        { "id": "title-1", "at": 30, "duration": 120,
          "source": { "kind": "html", "path": "overlays/chapter-setup.html",
            "vars": { "--color": "#ffffff" } } }
      ]
    }
  ]
}
```

- `sources[].path` is the original; `proxy` is its matching 720p preview. Do not replace the original with the proxy.
- Track and item ids must be unique in the document.
- Visual stacking follows only `tracks[]` array order; do not add another z field.
- Media must satisfy `0 <= source.in < source.out`; every item must have integer `at >= 0` / `duration >= 0`.

### Speech snapping and breathing room for extracted clips

For short clips moved ahead, such as trailers, opening hooks, or quotations, **set `source.in` / `source.out` by identifying the speech inside the clip from measured word-level `analysis.json` data (`transcript[].words`) and snapping to that speech**. Hard rules:

- **Window = first speech word minus 0.25s / last speech word plus 0.25s** (0.5s total breathing room, owner guideline 2026-07-24). Do not cut tightly at speech boundaries; leave quiet breathing room to avoid abrupt transitions.
- Do not use coarse segment times (Whisper's two-second quantization or punctuation boundaries) or **cut directly at a machine window around the highlight score**. Such a window can miss the intended speech.
- **Do not create an extracted window without speech.** If the highlight score points to no speech, use the measured speech interval as the source of truth and choose a new window.
- **Do not create a clip whose caption can be fully displayed for less than 1.0 second.** Extend the window until the caption is readable or omit the caption; do not show unreadable captions.
- `words` used for snapping are in source seconds. Write the media window (`source.in` / `source.out`) in source seconds too.

Record the selected 0.5s breathing room (0.25s at the start / 0.25s at the end) in `decision-log.md`.

## 3. Create overlay HTML

First read [overlay-authoring](../overlay-authoring/SKILL.md), then only the needed leaves. If unavailable, read the [CLAUDE.md authoring rules](https://github.com/AkariLabs/akari-video/blob/main/CLAUDE.md) and append the fallback to `decision-log.md`.

- Give the fragment exactly one root element.
- Make adjustable values CSS variables such as `--x`, `--y`, `--scale`, `--font-size`, and `--color`.
- Treat HTML item `at` / `duration` as the SSOT; do not create an independent clock in the fragment.
- Base animation on transform / opacity; do not use `filter: blur()` or `backdrop-filter` over 4K video.
- Avoid wall-clock dependence; seeking via Web Animations API `currentTime` must reproduce the same frame.
- If 3D is needed, use Three.js plus glTF; use the proxy for video textures.
- Escape variable strings such as transcript for their HTML or CSS context.

Do not reuse thumbnail HTML typography unconditionally as a timed video overlay.

## 4. Create caption display intervals (captions.json)

For a plan with captions, create display intervals with the following CLI. Do not build intervals manually.

```sh
akari captions <project-dir>
```

- **`caption.start` = measured start of first word (`words[0]`) / `caption.end` = measured end of last word (`words[-1]`) plus reading tail**. `--readout` defaults to **0.3 seconds** (record the adopted value in `decision-log.md`). Clip only if it would pass the next caption's start.
- **Do not extend to the next caption's start** (no tiling). **Speechless intervals have no caption**; do not fill gaps. Extend short captions to the default 1.0-second floor only without crossing the next caption; check warnings if the floor cannot be reached.
- Caption start/end are anchored in source seconds (§1); `words[]` use the same source seconds.

`--max-chars` defaults to 20, and --split phrase is the default. The CLI splits at phrase boundaries in this order: sentence-ending punctuation > pause > comma > character count / seconds. `--split none` restores the old behavior. For multiple sources, select one with `--source <sources[].id>`. The CLI contains the apportionment fallback: without word times, it splits at sentence-ending punctuation and apportions segment time by character count before adding reading tail. Decide whether captions are included and what style to use in the caption slot of [report-guide.md](report-guide.md)'s Asset plan; this section defines only interval creation.

### Apply caption style

If the user names a preset or style family (for example, "use this style"), find the corresponding preset id in `presets/textstyle/INDEX.md` or `presets/textstyle/index.jsonl`. For project-wide application, run the following from the repository root.

```sh
node packages/render-cut/bin/akari-apply-textstyle.mjs <project-dir> <preset-id>
```

To apply only to certain caption rows, pass a zero-based index or caption id to `--caption` (repeatable).

```sh
node packages/render-cut/bin/akari-apply-textstyle.mjs <project-dir> <preset-id> --caption <index|id>
```

Add `--dry-run` to either command to inspect the JSON diff before writing. Preset fields merge into existing `default_text_style` or `captions[].text_style`; existing fields absent from the preset remain. For adjustments outside preset vocabulary or without a preset, write to `captions.json` by targeted edit of the `text_style` row or the edit-store script API.

## 5. Validate and close the decision record

- Run [edit-lint](../edit-lint/SKILL.md), fixing findings until v2 structure, unique track/item ids, source references, integer-frame timing, and HTML root all PASS.
- Check overlay CSS variables and prohibited CSS against overlay-authoring rules.
- If an intermediate master was created, check boundaries with a per-source mapping table and actual frames.
- Append execution results (generated-asset list, provenance, execution time) to `decision-log.md` and record that Checkpoint 3 was executed. Do not change earlier log rows.
- After appending, regenerate the decision-record report and present its path in chat.

## Common mistakes

- Manually building display intervals instead of using `akari captions` (§4).
- Creating a new `edit.json` as v0/v1 instead of v2.
- Concatenating stills with ffmpeg instead of using visual items.
- Adding old `cuts` / `layers` / `overlays` keys or custom v2 top-level fields.
- Writing a media `source.src` id absent from `sources[].id`.
- Adding custom z for visual stacking; only `tracks[]` order controls it.
- Persisting captions, annotations, or analysis in timeline seconds instead of (`src`, source seconds).
- **Tiling caption intervals at segment boundaries (`end = 次の caption の start`) and leaving captions over speechless gaps**; captions end with speech (§4).
- Using apportionment fallback to extend an interval beyond the last word's estimated end to the next caption (§4).
- **Cutting extracted clips at machine windows around highlight scores (quantized segment times), omitting intended speech or showing a caption for less than 1.0s**; snap to speech with 0.5s breathing room (§2).
- Writing item `at` / `duration` in seconds rather than integer frames.
- Writing media `source.in` / `source.out` in output frames rather than source seconds.
- Measuring overlay-to-cut lag with absolute `blend=difference`; color differences flatten it and mislead. Use inter-frame difference cross-correlation (§1, timing basis for overlaid media).
- Creating an intermediate master or overlay before execution approval.
- Skipping authoring rules because the authoring skill is unavailable.
- Treating sample edit.json values as unapproved output specifications.
