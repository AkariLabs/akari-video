# OSR export stacks media and DOM layers in track order — L1 evidence (task 2026-09-26-osr-track-z-order)

## How it was captured

- fixture: `scripts/gen-fixture.mjs` (1280×720, 30 fps, v2 edit.json; `tracks[]` bottom → top)
  - (a) V1 main video / V2 shape (orange) / V3 B-roll photo (green, centre 50%) — the photo should cover the shape
  - (a-rev) V2 and V3 swapped (control: shape in front)
  - (b) V2 caption item (`kind: 'caption'`, placed text c-0002, the bag excludes it) / V3 photo / V4 caption bag
  - (c) V2 caption bag (spoken caption at the bottom) / V3 photo covering the bottom half — the caption should be hidden
  - (d) V2 HTML overlay with `blend: multiply` / V3 photo — the photo must not be multiplied
  - (d-top) photo V2 / multiply band V3 (control: today's look must not change)
  - (e) ordinary project: photo V2, shape V3, HTML V4, caption bag V5 (everything above the media = one band), 8 s
  - (f) (a) + a caption bag V4 with 200 cues (performance check for multi-band pages)
- export: `scripts/export.sh` = `render-cut <project> --engine osr|gpu` with a dedicated `AKARI_HOME` and `AKARI_EXPORT_ALLOW_DESKTOP=0`; `render.json` `provenance.osr.provenance.launcher_tier` was 2 for every OSR run. Frame = 2.0 s
- preview: development build of the shell (`apps/shell` `npm run build`, base commit), dedicated `--user-data-dir` / `THEIA_CONFIG_DIR` / `AKARI_HOME`, CDP port 9629 (`scripts/relaunch.sh`, `scripts/shot.mjs`). The preview code is not changed by this task, so the same preview captures are used on both sides
- `*-compare-osr.png` / `*-compare-gpu.png`: left = preview, right = export at the same time. `sheet-*.png` stacks them
- set `OSR_Z_WORK` to a scratch directory before running the scripts

## BEFORE (base) — cause found in step 0

| fixture | preview | OSR export |
|---|---|---|
| (a) | photo over shape | **shape over photo** (all frames identical to (a-rev)) |
| (b) | caption item over photo (known preview issue: caption items are not barriers — separate ticket) | caption item over photo |
| (c) | caption hidden under photo | **caption over photo** |
| (d) | band under photo | **band multiplies the photo** (all frames identical to (d-top)) |
| (d-top), (e) | match | match |

Cause: `page-builder.mjs` put one frame-engine canvas (`#akari-engine`, z 0, all photos and videos) under one overlay iframe (`#akari-overlays`, z 1, every HTML overlay / caption). Blend overlays got individual iframes, but their z was only their order among overlays, so no overlay could go below any media.

GPU export (`before/sheet-gpu-c-d-dtop.png`): (a)(b)(e) are refused (shape svg xmlns / caption font), (c) draws the caption over the higher photo, (d) and (d-top) produce identical frames (multiply ignored, band always on top). Not in track order either — recorded, not fixed (separate ticket; gpu-export is outside this task).

## AFTER

| fixture | result |
|---|---|
| (a) | photo over shape — same as preview (`after/a-compare-osr.png`) |
| (b) | caption item hidden under the photo (track order). The preview still draws it in front (preview-side issue, separate ticket) |
| (c) | caption hidden under the photo — same as preview |
| (d) | band multiplies only the main video; photo in front — same as preview |
| (a-rev), (d-top) | every frame identical to BEFORE |
| (e) | page HTML identical to base (apart from the inlined runtime); every frame identical; 12.22 s vs 11.60 s mean (+5.3 %, interleaved 3 runs each) |
| (f) | photo over shape; caption region identical to base on every frame; 12.51 s vs 13.44 s mean |

Numbers: `summary.json`.
