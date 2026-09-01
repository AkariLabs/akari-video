**English** | [日本語](./README.ja.md)

# GPU export

`@akari-video/gpu-export` is the GPU-direct H.264 export path for eligible AKARI Video projects.
It evaluates the shared frame engine sequentially, composites supported DOM-derived sprites on a
WebGL2 canvas, passes that canvas to `VideoFrame` and WebCodecs, and writes encoded Annex B samples
directly to MP4 with mp4box. Raw frame pixels are not transferred to Node or piped to ffmpeg.

## Eligibility

The GPU path accepts static HTML sprites, supported caption motion, declarative Three.js scenes,
frame-engine layers, and declarative dynamic HTML driven by CSS animations, transitions,
keyframes, Web Animations, or `@property`. Dynamic HTML is mounted under a runtime-created
`canvas[layoutsubtree]`, fixed to the engine clock, copied with `drawElementImage`, and uploaded as
a compositor texture without product-path pixel readback.

Embedded contexts, CSS 3D transforms, self-driving JavaScript clocks, media elements, runtime
scripts, and external resources fail closed. Karaoke and other word-level captions and emphasis
words remain outside v1.

### Word-level captions (v2)

Karaoke, pop, reveal, reveal-word, and supported `emphasis_words` are GPU-native. Each caption unit
is rasterized into at most two states, while word rectangles measured from the canonical
caption DOM drive per-frame color mixing, visibility, and affine transforms. Karaoke follows the DOM
color interpolation rather than a left-to-right wipe. Receipts report `sprite` or `words-native`
along with unit, word, raster, tile, and two-state layout-delta measurements. They also include
`gpu.captionStartup`, with `totalMs`, `fontEncodeMs`, `fontBase64Bytes`, and detailed `measure.*` and
`raster.*` startup timings and counts.

Raster textures keep the full output width but crop vertically to the caption band. They are created
in start-time-ordered batches of up to eight units / 4096 band pixels. Batches are prefetched before
export starts, with one data-URL decode into an intermediate sheet canvas followed by band blits;
only batches beyond the 256 MB `CAPTION_PREFETCH_MAX_BYTES` budget remain for deferred rasterization
inside the frame loop. Variant CSS is scoped per band and the embedded font occurs once per SVG.
GPU textures are still released per unit. Blob and HTTP SVG URLs are forbidden because they taint
the canvas and WebGL upload.

Stable measurements are reused only for an exact normalized content key: output width and height,
the cue CSS variables, cue HTML, unit index, and the ordered CSS variants. Results from
`document.fonts.check` are cached. The measurement path applies the same settle CSS as rasterization,
scoped to `.akari-measure-root`, so measurements no longer depend on wall-clock animation progress.
Measurements require two consecutive exact results in at most 32 attempts. If one unit does not
converge, only that unit degrades to a sprite; export completes with `gpu.captions[].mode = "sprite"`
and a receipt warning rather than failing closed.

Mixed karaoke color and geometric emphasis, vertical word captions, and unknown word styles remain
ineligible and fail closed with a concrete reason.

### Declarative 3D entrance curves (v3)

A declarative Three.js scene may keep one root-element entrance animation on the GPU path. It must
use the paired `[data-akari-active] .root, [data-no-timeline] .root` selector, exactly one two-endpoint
keyframe animation, a known CSS timing function, a non-negative delay, one iteration, normal direction,
and `both` or `forwards` fill. Keyframes may animate only opacity and 2D translate/scale; supported CSS
variables and `calc(var(...) + Npx)` / `calc(var(...) * N)` are resolved from overlay variables and
x/y/scale transforms before export. The manifest records absolute opacity, translation, and scale
endpoints, and the compositor evaluates the same curve on every frame while Three.js continues to use
the engine's local clock.

Transitions, `@property`, multiple animations or animated elements, intermediate keyframes, alternate
directions, rotate/skew/3D transforms, filter, and clip-path fail closed with a concrete
`three-entrance-*` reason. A declarative 3D scene without CSS animation retains the existing
`three-scene-canvas-direct` manifest shape and behavior.

`render-cut --engine auto` considers GPU export on macOS and Windows, using it when the complete
project is eligible and otherwise using OSR. On Linux, `auto` remains legacy and GPU export is
evaluated only for an explicit `--engine gpu`. Explicit selection fails closed and prints every
ineligibility or launcher reason.

The DOM layer launches with `--enable-features=CanvasDrawElement`, `--disable-gpu-vsync`, and
`--disable-frame-rate-limit`. Two-run frame and MP4 hashes matched for 450/678/900-frame exports,
but a 5,400-frame export with many large-text overlays showed probabilistic antialiasing changes
within about 180 frames of one overlay (MAD 0.0001–0.0003, 11–41 differing pixels); every sentinel
still matched, and rasterization flags did not remove the variance.

When the output resolution is larger than the physical display (for example 3840×2160 on a
1920×1080 screen), the operating system clamps the hidden `BrowserWindow` to the display, so
`vw` / `vh` / `vmin` / `vmax` in DOM-layer overlays would resolve against the clamped window instead of
the output. After the page loads, the Electron main measures `innerWidth` / `innerHeight` /
`devicePixelRatio`, and when they differ from the requested output it pins the viewport to the output
resolution with `webContents.enableDeviceEmulation` and measures again. An environment where the
viewport still cannot be pinned fails closed with the requested / measured / primary display sizes in
the error. run.json and the receipt record `viewport: { requested, measured, emulated, display }`.

Per-frame composition now uses one base draw plus instanced draws for contiguous sprite kinds, so the
draw-call count does not grow with the number of captions, DOM layers, or 3D sprites. With three
simultaneous caption cues, incremental GPU time over no captions fell to +1.65 ms/frame: total draw GPU
time was 3.12 ms/frame versus 1.47 ms/frame without captions.

On the 5,999-frame real PV (44 cues, 88 bands, six batches), five #120h runs measured caption startup
at 8.7–12.3 seconds total: `captionStartup.totalMs` was 2.75–5.01 seconds and
`captionRasterTotalMs` was 5.90–7.34 seconds. All six batches completed before export, so the frame
loop recorded zero `captionRasterBatch` stages and `stages.captions` was p50 0 ms / p95 0.1 ms.
Absolute export speed under a quiet load remains unverified: the 2026-08-30 runs never observed the
required one-minute load below 20. Under high load, the dynamic fixture measured GPU 71.1–80.7 seconds
versus OSR 93.6–97.8 seconds (1.2–1.3 times), RSS stayed within 531–914 MB, and trapped readbacks were zero.

## Windows setup

The npm Electron launcher (tier 2) is the supported measurement path on Windows:

```sh
git clone https://github.com/AkariLabs/akari-video
cd akari-video
npm install --ignore-scripts
node node_modules/electron/install.js
node -e "require('node:fs').writeFileSync('node_modules/electron/path.txt', 'electron.exe')"
node packages/akari-launcher/bin/akari.mjs doctor
```

The expected doctor row is `gpu_export ok (npm-electron launcher tier 2)`. The one-line
`node_modules/electron/path.txt` value is platform-specific: `electron.exe` on Windows,
`Electron.app/Contents/MacOS/Electron` on macOS, and `electron` on Linux.

The installed desktop app launcher (tier 1) is currently excluded fail-closed; see
`GPU_DESKTOP_TIER_UNWIRED_REASON`. Packaged tier 1 support also requires `packages/gpu-export` to be
bundled through the shell's `extraResources`. Starting with v0.1.29, Windows `--engine auto` uses GPU
when eligible and OSR otherwise; Linux still requires explicit `--engine gpu` selection.

## Development

```sh
npm test
npm run assert-zero-readback
npm run bundle:frame-engine
npm run check:frame-engine-drift
```

The frame-engine bundle is generated. Do not edit `generated/frame-engine.js` directly.
Frame hashing is available only through the isolated verification module and cannot be combined
with the runtime readback trap. DOM frame verification uses an isolated texture sentinel and
records the selected settle policy (`raf2-paint-event` or `sync-layout`) in the receipt.
