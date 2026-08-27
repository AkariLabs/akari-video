**English** | [日本語](./README.ja.md)

# @akari-video/frame-engine

`frame-engine` evaluates one edit-store-resolved timeline instant into one completed WebGL2 surface. The same `CompositedFrame` is consumed by the canvas preview exit and the PBO raw-frame exit; `evaluateFrame` has no preview/export mode.

The cuts path supports hard cuts, speed, static crop and linearly interpolated zoom framing, cut transform/opacity, duration-extending freeze frames, and five GPU transitions (`dissolve`, `fade-black`, `fade-white`, `reveal-down`, and `reveal-up`). Freeze expansion lives in the resolved timeline layer and shifts every later sequential cut before transition overlap is resolved.

## Local verification

The golden harness needs Chromium's WebCodecs and WebGL2 implementations. It first launches the repository's Electron binary; if the host cannot register a GUI app, it runs the same renderer bundle in Playwright Chromium. It generates its H.264 fixture with ffmpeg and keeps all media and evidence under the ignored `test/golden/.generated/` directory.

```sh
cd packages/frame-engine
npm run typecheck
npm run test:unit
npm test
npm run bench:cuts
```

`npm test` builds the package, runs unit tests, launches Electron, compares preview/export RGBA and PNG hashes at 28 fixed feature/transition points, proves the comparator rejects an injected one-pixel mutation, checks two freeze frames are identical, and verifies the encoded 11-second MP4 duration with ffprobe. Stage summaries are written to `test/golden/.generated/metrics.json`.

`npm run bench:cuts` runs the permanent 1920×1080, 30fps, 13-second cuts benchmark. It compares decode/full-cache/fixed-frame controls, GOP-distance Warmup and Lookahead, 8MB IPC over invoke/MessagePort/shared memory, raw ffmpeg and WebCodecs encoders, and the read-only render-cut control. A successful run updates [the cuts path report](./docs/cuts-path-report.md) with measured p50/p95 values and the final `v2/render-cut` ratio.

The Electron/WebCodecs test is intentionally local-only when a CI runner has no GPU/WebCodecs-capable Chromium. Unit tests and typechecking remain suitable for such CI runners.

See [av-cliper maintenance status](./docs/av-cliper-status.md) for the pinned demux/decode dependency assessment.
