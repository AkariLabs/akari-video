**English** | [日本語](./README.ja.md)

# @akari-video/frame-engine

`frame-engine` evaluates one edit-store-resolved timeline instant into one completed WebGL2 surface. The same `CompositedFrame` is consumed by the canvas preview exit and the PBO raw-frame exit; `evaluateFrame` has no preview/export mode.

The cuts path supports hard cuts, speed, static crop and linearly interpolated zoom framing, cut transform/opacity, duration-extending freeze frames, and five GPU transitions (`dissolve`, `fade-black`, `fade-white`, `reveal-down`, and `reveal-up`). Freeze expansion lives in the resolved timeline layer and shifts every later sequential cut before transition overlap is resolved.

## MP4 source loading

The default video source reads only `ftyp`/`moov` metadata and the compressed sample byte ranges needed by the current GOP. It builds the sample index with mp4box, shares a bounded 64 MiB Range cache across decoder forks, and sends indexed AVC/HEVC chunks directly to WebCodecs. Opening a source therefore does not copy the complete asset into OPFS. Set `AKARI_FRAME_ENGINE_SOURCE=mp4clip` to retain the previous whole-stream MP4Clip path as a one-release escape hatch.

## Web preview evaluation mode

Open preview-server with `?frameEngine=1` to use the frame-engine canvas. The flag is off by default; without it, the existing Web UI and its network/DOM behavior remain byte-equivalent. The engine canvas is a cuts-path evaluation surface only. Layers, overlays, captions, and audio are not rendered, and the UI always shows an unsupported-features banner rather than silently omitting them.

The measurement overlay reports presented fps, late frames, latest seek arrival time, Lookahead cold-versus-cache seek timing, and cut-boundary late counts before and after Warmup. Run its isolated L1 browser check from the repository root:

```sh
npm --prefix packages/preview-server run test:frame-engine-browser
```

The default run is headless. Headless Chromium's animation-frame supply can limit the displayed fps independently of engine evaluation time, so that run validates playback progress, measurements, seeking, rendering, and error containment without applying the headed fps threshold. Measure displayed performance with a headed browser:

```sh
AKARI_FRAME_ENGINE_HEADED=1 npm --prefix packages/preview-server run test:frame-engine-browser
```

## Local verification

The golden harness needs Chromium's WebCodecs and WebGL2 implementations. It first launches the repository's Electron binary; if the host cannot register a GUI app, it runs the same renderer bundle in Playwright Chromium. It generates its H.264 fixture with ffmpeg and keeps all media and evidence under the ignored `test/golden/.generated/` directory.

```sh
cd packages/frame-engine
npm run typecheck
npm run test:unit
npm test
npm run bench:cuts
```

`npm test` builds the package, runs unit tests, `test:seek`, and the complete Electron golden suite. The required coverage is base 28, layers 36, matte at least 3, transitions 90, transition semantics 30, LUT 20, GOP tail 9, B-frame 160 sampled rows, and B-frame tail 24 rows. It also covers 1,000 lifetime frames and 300 matte-sync frames with zero mismatches, and proves that an injected one-pixel mutation fails. Stage summaries are written to `test/golden/.generated/metrics.json`.

The GitHub Actions job **`frame-engine-golden` is required**. It installs Electron with postinstall enabled, forces SwiftShader, and runs `npm run ci:required` under Xvfb on Ubuntu. The CI alias intentionally delegates to the unchanged `npm test` suite, so build, unit, seek, and every golden point must all pass; the job is not allowed to continue on error.

`npm run bench:cuts` runs the permanent 1920×1080, 30fps, 13-second cuts benchmark. It compares decode/full-cache/fixed-frame controls, GOP-distance Warmup and Lookahead, 8MB IPC over invoke/MessagePort/shared memory, raw ffmpeg and WebCodecs encoders, and the read-only render-cut control. A successful run updates [the cuts path report](./docs/cuts-path-report.md) with measured p50/p95 values and the final `v2/render-cut` ratio.

Local runs may use the repository Electron or the documented Chromium fallback. CI does not skip the Electron/WebCodecs path: the required Ubuntu job supplies Xvfb and SwiftShader and fails closed if Electron, WebCodecs, WebGL2, or a golden comparison is unavailable.

See [av-cliper maintenance status](./docs/av-cliper-status.md) for the pinned demux/decode dependency assessment.
