# 3D video texture clock

`generate-video-fixture.mjs` creates a neutral 4-second video with red, green, blue, yellow one-second quarters and places a 3D screen item at timeline second 2. Video bytes stay in a dedicated temporary workspace.

Before the fix, the export seek expression used timeline seconds: at timeline 2.5/3.5 it requested video 2.5/3.5 seconds (blue/yellow). The preview runtime uses item-local 0.5/1.5 seconds (red/green). After the fix, the detached video element carries its item's start time, and the generated seek function requests 0.5/1.5 seconds.

OSR tier 2 captured frames 25 and 35 (10 fps) with stamp matched. The actual screen was red then green. PNG MD5s: frame 25 `e4176be59c9ae987b7bfbba46f94b79f`, frame 35 `7e34b6037830970c881b4dc0764c796a`. The two retained PNGs show those colors. The child wrote a completed capture run but did not exit; only its own PID was stopped. Round-2 screenshots from the rebuilt shell preview show the same red/green content and the expected `currentTime` values; see `preview-video-r2.md`.

The existing live preview video-texture browser test passed (1/1). It exercises preview playback/seek with a different fixture; the item-start comparison above uses the export fixture and the shared local-clock rule.

Trim/speed read-through: `packages/overlay-runtime/src/overlay-runtime.js` computes `localTimeMs = (timelineTime - overlay.start) * 1000` in its overlay tick and passes only that value to `runtime.render`. `packages/preview-server/public/app.js` uses the same `t - o.start` rule. `packages/overlay-runtime/src/three-runtime.js` passes that local value to `syncVideoTextures` / `videoSeekTarget`; neither path applies an overlay `in` or `speed`. Media-cut trim/speed handling in the shell is separate from HTML overlay video textures. The export seek now follows the preview's start-only rule.
