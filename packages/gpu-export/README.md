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
is rasterized on first activation into at most two states, while word rectangles measured from the canonical
caption DOM drive per-frame color mixing, visibility, and affine transforms. Karaoke follows the DOM
color interpolation rather than a left-to-right wipe. Receipts report `sprite` or `words-native`
along with unit, word, raster, tile, and two-state layout-delta measurements.

Raster textures keep the full output width but crop vertically to the caption band. They are created
in start-time-ordered batches of up to eight units / 4096 band pixels with one data-URL decode per
batch; variant CSS is scoped per band and the embedded font occurs once per SVG. Measurements require
two consecutive exact results (at most 32 attempts), while GPU textures are still released per unit.
Blob and HTTP SVG URLs are forbidden because they taint the canvas and WebGL upload.

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

`render-cut --engine auto` uses GPU export on macOS only when the complete project is eligible;
otherwise it uses OSR. Explicit `--engine gpu` fails closed and prints every ineligibility reason.

The DOM layer launches with `--enable-features=CanvasDrawElement`, `--disable-gpu-vsync`, and
`--disable-frame-rate-limit`. Two-run frame and MP4 hashes matched for 450/678/900-frame exports,
but a 5,400-frame export with many large-text overlays showed probabilistic antialiasing changes
within about 180 frames of one overlay (MAD 0.0001–0.0003, 11–41 differing pixels); every sentinel
still matched, and rasterization flags did not remove the variance.

Caption cues are baked to individual SVG sprites at page startup: 30 cues added about 47 seconds
(roughly 52 ms/frame over 900 frames), making a short captioned GPU export slower than OSR; without
captions, the same material measured 19.2 ms/frame on GPU versus 40.9 ms/frame on OSR.

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
