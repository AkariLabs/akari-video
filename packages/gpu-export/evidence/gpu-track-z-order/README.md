# GPU export stacks media and HTML / caption sprites in track order — L1 evidence (task 2026-09-27-gpu-track-z-order)

## How it was captured

- fixture: `scripts/gen-fixture.mjs` (the osr-track-z-order fixture plus GPU-eligible cases; 1280×720, 30 fps, v2 edit.json, `tracks[]` bottom → top)
  - (c) V2 caption bag / V3 photo covering the bottom half — the caption should be hidden
  - (d) V2 HTML overlay with `blend: multiply` / V3 photo — the photo must not be multiplied; (d-top) swapped
  - (e-gpu) ordinary project that GPU accepts: photo V2, HTML V4, caption bag V5 (one band), 8 s. The OSR fixture (e) has a shape, which GPU refuses (`absolute-external-url`), so it cannot be exported with `--engine gpu`
  - (g) multi-band page with many sprites: caption bag V2 with 200 cues of 0.04 s / photo V3 / HTML V4, 8 s (performance check)
  - (d-&lt;mode&gt;, d-top-&lt;mode&gt;) `--blend-only`: (d)/(d-top) with a gradient band for screen / add / difference / darken / lighten / overlay / hardlight / softlight
- export: `scripts/export.sh` = `render-cut <project> --engine gpu|osr` with a dedicated `AKARI_HOME` and `AKARI_EXPORT_ALLOW_DESKTOP=0`; `launcher_tier` was 2 for every run (the worktree code, not an installed app). Frame = 2.0 s. Hash = md5 of ffmpeg `framemd5` over all video frames
- OSR frames come from the base commit (OSR already in track order); OSR is not changed by this task
- `*-compare-osr-gpu.png`: left = OSR, right = GPU at the same time. `sheet-osr-vs-gpu.png` stacks (c) (d) (d-top) (e-gpu) (g)
- `after/sheet-blend-modes.png`: one row per mode = OSR (d) | GPU (d) | OSR (d-top) | GPU (d-top)
- set `GPU_Z_WORK` to a scratch directory before running the scripts

## BEFORE (base) — cause found in step 0

| fixture | OSR | GPU |
|---|---|---|
| (c) | caption hidden under the photo | **caption over the photo** |
| (d) | band multiplies only the main video, photo in front | **opaque pink band over the photo**; all frames identical to (d-top) |
| (d-top) | band multiplies the photo | **opaque pink band** (multiply ignored) |
| (e-gpu), (g) at 2 s | match | match |

Cause 1 (order): the export loop in `page-runtime.js` evaluated every photo / video into one frame-engine canvas (`GpuFrameEngineRuntime`, one WebGL2Compositor) and passed it as the base of `spriteCompositor.compose(frame.surface.canvas, draws)`; every sprite (static HTML, DOM runs, three, vgpu, captions) was sorted by z and drawn on top of that base, so no sprite could go below any media.
Cause 2 (blend): `page-builder.mjs` never put `overlay.blend` into the sprite manifest, `SpriteCompositor` only does source-over, and eligibility did not look at `blend`, so every blend mode was silently drawn as normal (all blend fixtures: (d-x) and (d-top-x) identical).

## AFTER

| fixture | result |
|---|---|
| (c) | caption hidden under the photo — same as OSR (PSNR vs OSR 25.8 → 52.6 dB) |
| (d) | band multiplies only the main video; photo in front — same as OSR (11.1 → 48.8 dB) |
| (d-top) | band multiplies the photo — same as OSR (11.6 → 47.8 dB); (d) and (d-top) hashes now differ |
| blend modes | all 8 other modes match OSR (45.2–49.9 dB), under and over the photo |
| (e-gpu) one band | page HTML identical to base (apart from the inlined runtime); every frame identical (565c286c); 4.30 s vs 4.16 s mean (+3.4 %, interleaved 3 runs each) |
| (g) multi-band | caption hidden under the photo; 14.72 s vs 14.48 s mean (+1.7 %) |

The reference level: ordinary GPU vs OSR differ by ~47.6 dB (different rasterisers). Numbers: `summary.json`.
