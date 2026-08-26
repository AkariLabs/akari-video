**English** | [日本語](./README.ja.md)

# @akari-video/frame-engine

`frame-engine` evaluates one edit-store-resolved timeline instant into one completed WebGL2 surface. The same `CompositedFrame` is consumed by the canvas preview exit and the PBO raw-frame exit; `evaluateFrame` has no preview/export mode.

Phase 1a supports hard cuts only. Speed, framing, transforms, freeze frames, and transitions remain outside this package version.

## Local verification

The golden harness needs Chromium's WebCodecs and WebGL2 implementations. It first launches the repository's Electron binary; if the host cannot register a GUI app, it runs the same renderer bundle in Playwright Chromium. It generates its H.264 fixture with ffmpeg and keeps all media and evidence under the ignored `test/golden/.generated/` directory.

```sh
cd packages/frame-engine
npm run typecheck
npm run test:unit
npm test
```

`npm test` builds the package, runs unit tests, launches Electron, compares preview/export RGBA and PNG hashes, proves the comparator rejects an injected one-pixel mutation, encodes an MP4, and verifies extracted frames are not static. Stage summaries are written to `test/golden/.generated/metrics.json`.

The Electron/WebCodecs test is intentionally local-only when a CI runner has no GPU/WebCodecs-capable Chromium. Unit tests and typechecking remain suitable for such CI runners.

See [av-cliper maintenance status](./docs/av-cliper-status.md) for the pinned demux/decode dependency assessment.
