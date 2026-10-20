# Evidence — declarative 3D on `WebGPURenderer` (2026-10-21-three-webgpu-backend)

All images here use the public `assets/scene3d/smartphone-mockup` model and a
synthetic 1024x512 equirectangular PNG (HDR is not embeddable by render-cut).
No internal/unpublished scene asset is included.

## L1 — exports (1920x1080, 30 fps, 5 s)

- `l1/summary.json` — the four render receipts in brief, output SHA-256 values,
  and the main-vs-branch pixel-equality check.
- `l1/electron-webgpu-inspect.json` / `l1/electron-webgpu-probe.png` — the same
  runtime and scene in Electron 39.8.7: `inspect().renderer.backend = "webgpu"`,
  `sharedCore = true`, `videoTextures = 1`, `textBlocks = 2`.
- `l1/gpu-export-renderer-backend.json` — the page-side
  `inspect().renderer.backend` recorded **during an actual `--engine gpu`
  export** (150/150 frames, `threeError: null`, output SHA-256
  `cedb2686…703e161`). A temporary, uncommitted probe in
  `packages/gpu-export/src/page-runtime.js` captured it at frame 0; that file
  was restored byte-identically afterwards.
- `l1/frame-XXX-side.png` — WebGL (left) | WebGPU (right) at frames
  0, 30, 75, 120 and 149.
- `l1/frame-XXX-diff8x.png` — absolute difference amplified 8x.
- `l1/frame-075-flat-text-2x.png` — flat text crop, 2x nearest neighbour:
  troika SDF (left) vs opentype outline mesh (right).
- `l1/webgl-webgpu-metrics.json` — mean absolute difference, max difference,
  >8/255 pixel ratio and background RGB at those five frames.

Renderer-absent exports are byte-identical to `bf2d88145` (main) for both
engines: see `mainPixelEquality` in `l1/summary.json`.

## L2 — shell preview

The shell preview now runs on the branch itself, with **no built-file patch**.
The contract addendum (feedback r1 / task.md 訂正) puts
`apps/shell/extensions/akari-preview/src/common/three-scene-assets.ts` in scope:
`THREE_SCENE_KEYS` gained `'renderer'`, `apps/shell` was rebuilt from source,
and the parity test parses the runtime key set line-by-line (its earlier
substring regex also picked up the quoted `"webgl"` in a comment).

- `l2/screenshot-initial.png` — `inspect()` ready, `backend: "webgpu"`,
  `data-engine="three.js r186 webgpu"`, 720x405 canvas.
- `l2/screenshot-playing.png` — playback at ~1.5 s, 3D still ready.
- `l2/screenshot-outside-window.png` — seek to 2.5 s, outside the overlay
  window (`visibility: hidden`); no crash.
- `l2/screenshot-inside-window.png` — seek back to 1.0 s inside the window;
  visible again, still ready.
- `l2/screenshot-track-hidden.png` / `screenshot-track-shown.png` — track eye
  hide/show (`display: none` → `block`); no crash.
- `l2/screenshot-reopened.png` — preview tab closed (webview destroyed =
  dispose) and reopened from the project card; `inspect()` is ready again with
  `backend: "webgpu"`.
- `l2/runtime-steps-window.json` / `l2/reopen-after-close.json` — the measured
  step values (status, renderer, time, video currentTime, canvas engine,
  console/page errors).
