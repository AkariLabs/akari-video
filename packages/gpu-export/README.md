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

Embedded contexts, self-driving JavaScript clocks, media elements, runtime scripts, external
resources, and CSS 3D that uses `backface-visibility: hidden` fail closed. CSS 3D geometry is
eligible, including `transform-style: preserve-3d`; however, preserve-3d occlusion follows DOM
order on the GPU path. Authors must avoid overlapping its descendants. A detector warns when
screen-space overlap conflicts with Z order and records the conflict in the receipt. Karaoke and
other word-level captions and emphasis words remain outside v1.

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

### Declarative 3D entrances (v3)

Declarative Three.js scenes keep CSS entrances on the GPU path even when they use transitions,
`@property`, multiple animations, intermediate keyframes, alternate directions, rotation, or skew.
The existing two-endpoint grammar remains the `curve` fast path. Other entrances confined to the
root-to-Three-canvas ancestor chain use the `sampled` path: paused WAAPI animations are sought with
composition time, and computed opacity and the 2D transform chain from the overlay container to the
Three canvas are measured on every active frame. Axis-aligned transforms become sprite draw state when
the canvas fills the output; rotation, shear, and non-full-frame canvases are drawn through an
intermediate 2D canvas. Three.js itself continues to use the engine's local clock.

Registered custom-property keyframes are accepted into the sampled path, but the export sheet's WAAPI
clone currently leaves those properties at their initial values in both GPU and OSR; directly declared
opacity and transform keyframes still interpolate, so engine parity is preserved. Custom-property
interpolation remains a separate export-sheet issue.

The sampled path admits `three-or-canvas-runtime` and `animation-timing`. When method A cannot describe the fragment
from its root-to-canvas chain, method B classifies it as `three-scene-sampled-composite`. Three.js still renders in
the overlay sheet; each frame copies that canvas into the matching canvas in the DOM-layer clone, hides
`[data-akari-3d-fallback]`, then transfers the whole fragment with `drawElementImage`. This preserves DOM order and
z-index around the canvas, while overlays remain ordered by track z and declaration index.

Composite scenes admit CSS 3D geometry and `advanced-css` both inside and outside the canvas chain. They reuse the
DOM layer's CSS 3D policy: depth transforms pass, preserve-3d order conflicts pass with a warning, and
`backface-visibility:hidden` with depth remains degraded as `css-3d-backface-hidden`. `@property` remains fail-closed
as `three-composite-property` until sheet/DOM custom-property interpolation parity is measured. Other conditions
outside the composite entry set report `three-sampled-condition:<condition>`. The method-A scan retains
`three-sampled-chain-css:<property>` as its own guard.

Composite scenes now fail closed as `three-composite-preserve-3d-siblings` when a `preserve-3d` element has both the
Three-canvas chain child and an off-chain child with a depth transform. GPU paints those siblings in DOM order, so it
diverged from OSR (measured 2026-09-04: bounding-box MAD 5.0082; OSR put only z>0 siblings in front of the canvas).
Extending `preserve3dOrderConflicts` to sibling pairs can re-enable this shape in a later round. Parent-child conflicts
continue to pass with a warning (measured parity 0.6374).
Manifests record `entranceMode`, and receipts record
`curve` / `sampled` / `composite`, sampling cost, plus composite DOM-element and p50/p95 copy/DOM-layer costs.
Scenes without CSS animation remain `three-scene-canvas-direct`.

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

The export samples the working set of every Electron process every 10 seconds and shares the OSR
memory budget (`packages/osr-export/src/memory.mjs`): warning 768 MiB / hard stop 1,024 MiB at 1080p on
the GPU profile (`--soft`: 1,536 / 2,048 MiB). The default hard stop is "resolution scale + physical-memory
25% floor / 50% cap": the base values scale with the output pixel count above 1080p (4K = 4×), the hard stop
is never below 25% of physical memory (a 16 GiB machine gets 4,096 MiB even at 720p / 1080p, because large
inputs such as long 4K HEVC sources grow RSS regardless of the output size — issue #28; the warning is then
75% of the hard stop), and it never exceeds 50% of physical memory. `AKARI_OSR_MEMORY_WARN_MIB` /
`AKARI_OSR_MEMORY_HARD_STOP_MIB` override both as absolute MiB values that receive neither the scale nor
the floor / cap. run.json and the receipt record `memory.budget_scale`, `machine_floor`, `machine_capped`, and
`total_memory_bytes`.

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

### Hybrid GPU laptops (Intel iGPU + NVIDIA / AMD dGPU)

Facts (measured 2026-09-01 on an RTX 5060 Laptop + Intel UHD machine, Electron 39): Windows starts the
export child process — the npm `electron.exe` (tier 2) and the installed `AKARI Video.exe` (tier 1)
alike — on the power-saving iGPU by default, and the Media Foundation H.264 encoder that WebCodecs
`prefer-hardware` needs is then unavailable at every resolution (4K and 1080p both report
`unsupported`). Chromium switches such as `--force_high_performance_gpu` or `--use-adapter-luid` move
only ANGLE / WebGL to the dGPU; the encoder stays on the iGPU. The only setting that works is the
per-app GPU preference Windows keeps under `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`
(value name = full executable path, data `GpuPreference=2;`), which is evaluated when the process is
created.

The launcher (`packages/osr-export/src/gpu-preference.mjs`, shared by the GPU and OSR exits) therefore
writes that value for the export executable right before `spawn` and restores it after the child
closes — deletes it when there was none, or writes the previous value back — on every exit code and
even when the spawn itself fails. No restart, no administrator rights, and nothing is left behind, so
the app keeps its previous GPU assignment. With the default `auto` this happens for the **GPU exit only**
(`--engine gpu`, and capture through the GPU runtime): the OSR exit encodes with ffmpeg, gains nothing from
the dGPU, and on the RTX its offscreen paint returned an empty frame 0 in a share of runs (current code 1 of 4,
pre-T5 code 3 of 4, never on the iGPU), so it keeps the default adapter (`reason: not-gpu-exit`) unless
`force` is given. Before the registry write a sidecar
`<AKARI_HOME or ~/.akari>/gpu-preference-override.json` (`{ version, executable, previous, written_at }`)
is written and it is deleted after the restore; if the parent dies in between, the next export restores
from the sidecar first (`recovered_stale: true`). The receipt records the decision under
`provenance.gpu_preference` (`policy / exit / applied / previous / restored / reason / recovered_stale`) and the
child's `run.json` records the adapter it actually ran on under `gpu.devices`
(`vendor_id / device_id / device_string / active / gpu_preference` from `app.getGPUInfo("complete")`,
cut off after 3 seconds).

| Setting | Value | Effect |
|---|---|---|
| `AKARI_EXPORT_GPU_PREFERENCE` / `render-cut --gpu-preference` | `auto` (default) | GPU exit only. Write `GpuPreference=2;` only when the executable has no per-app value. A value the user pinned in Windows "Graphics settings" (for example power saving, `GpuPreference=1;`) is respected and left alone (`reason: user-preference-respected`). The OSR exit is skipped (`reason: not-gpu-exit`). |
| | `off` | Never touch the registry (`reason: policy-off`). |
| | `force` | Write `GpuPreference=2;` even over a pinned value and write the pinned value back afterwards — on both exits (the only way to put the OSR exit on the dGPU). |
| `AKARI_EXPORT_ALLOW_DESKTOP=0` | | Development escape hatch: skip the installed desktop app (tier 1) so the repository's runtime runs through the npm `electron.exe` (tier 2). An explicit `allowDesktop` argument wins over the variable. |

The override is a no-op on macOS and Linux (`reason: platform`) and on `--soft` runs (`reason: soft`).

Reading the failure line: when the hardware encoder is still unavailable, render-cut prints one
Japanese line as its last stderr line (`render-cut execution error: ...`) that names the adapter the
export ran on, why no switch happened, and what to do next, ending with the original English error in
parentheses (`（原因: WebCodecs H.264 config is unsupported: ... renderer=<UNMASKED_RENDERER>）`):

- `内蔵 GPU（<iGPU>）で動作しています ... 省電力に固定されているため自動切り替えしませんでした` — the user pinned power saving; change it in Graphics settings or rerun with `--gpu-preference force`.
- `... 高パフォーマンス GPU（<dGPU>）への自動切り替えが off です` — rerun with `AKARI_EXPORT_GPU_PREFERENCE=auto`.
- `GPU 設定（<executable>）を書き込みましたが反映されませんでした` — the value was written but Windows still chose the iGPU; set that executable to high performance in Graphics settings.
- `高パフォーマンス GPU（<dGPU>）で動作していますが ... 応答しません` — the dGPU was used but its encoder does not answer; update the driver or use `--engine osr`.
- `この GPU（<adapter>）にはハードウェア H.264 エンコーダがありません` — not a hybrid machine; use `--engine osr` (`GPU 情報は取得できませんでした` is appended when `app.getGPUInfo` timed out).

The failed run is kept at `.akari/gpu-run-failed.json` with `gpu.renderer`, `gpu.encoder_support`, and
`gpu.devices` filled in.

## CLI (`akari-gpu-export`)

The low-level CLI exports one eligible project directly. Without `--audio`, it writes a video-only
MP4 with no audio track and reports that choice on stderr. With `--audio <path>`, it checks that the
file exists and contains an audio stream before export, then copies that stream into the final MP4.
An absent or audio-less source exits with code 2 before creating output; it does not create a silent
track.

```sh
node packages/gpu-export/bin/akari-gpu-export.mjs <project-dir> --out <output.mp4> --duration <seconds> [options]
```

| Flag | Description |
|---|---|
| `--out <path>` | Output MP4 path (required). |
| `--fps <number>` | Frame rate; default 30. |
| `--width <pixels>` | Output width; default 1920. |
| `--height <pixels>` | Output height; default 1080. |
| `--duration <seconds>` | Output duration (required). |
| `--frames <count>` | Frame count; defaults to `duration × fps`. |
| `--queue-depth <count>` | Encoder queue depth; default 4. |
| `--quality <name>` | Quality preset; default `high`. |
| `--bitrate <bps>` | Explicit video bitrate. |
| `--audio <path>` | Source whose audio stream is copied. |
| `--soft` | Request the software encoder preference. |
| `--trap-readback` | Reject product-path pixel readback. |
| `--verify-frames` | Enable verification-only raw-frame hashing. |
| `--help`, `-h` | Print usage. |

| Exit code | Meaning |
|---|---|
| `0` | Export or help completed successfully. |
| `1` | Export failed. |
| `2` | Arguments or an input precondition were invalid. |

The product path is `render-cut --engine gpu`: it mixes the audio declared by `edit.json` before
calling GPU export. The low-level `akari-gpu-export` CLI does not read or mix `edit.json` audio.

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
