**English** | [日本語](./README.ja.md)

# GPU export

`@akari-video/gpu-export` is the GPU-direct H.264 export path for eligible AKARI Video projects.
It evaluates the shared frame engine sequentially, composites supported DOM-derived sprites on a
WebGL2 canvas, passes that canvas to `VideoFrame` and WebCodecs, and writes encoded Annex B samples
directly to MP4 with mp4box. Raw frame pixels are not transferred to Node or piped to ffmpeg.

## Eligibility

The GPU path accepts static HTML sprites, supported caption motion, declarative Three.js scenes,
and frame-engine layers. Dynamic HTML, embedded contexts, external resources, and clip-path caption
motion are not supported.

### Word-level captions (v2)

Karaoke, pop, reveal, reveal-word, and supported `emphasis_words` are GPU-native. Each caption unit
is rasterized on first activation into at most two states, while word rectangles measured from the canonical
caption DOM drive per-frame color mixing, visibility, and affine transforms. Karaoke follows the DOM
color interpolation rather than a left-to-right wipe. Receipts report `sprite` or `words-native`
along with unit, word, raster, tile, and two-state layout-delta measurements.

Raster textures keep the full output width but crop vertically to the caption band. They are created
when a unit first becomes active, the CPU canvas is discarded after upload, and the GPU texture is
released when the unit ends.

Mixed karaoke color and geometric emphasis, vertical word captions, and unknown word styles remain
ineligible and fail closed with a concrete reason.

`render-cut --engine auto` uses GPU export on macOS only when the complete project is eligible;
otherwise it uses OSR. Explicit `--engine gpu` fails closed and prints every ineligibility reason.

## Development

```sh
npm test
npm run assert-zero-readback
npm run bundle:frame-engine
npm run check:frame-engine-drift
```

The frame-engine bundle is generated. Do not edit `generated/frame-engine.js` directly.
Frame hashing is available only through the isolated verification module and cannot be combined
with the runtime readback trap.
