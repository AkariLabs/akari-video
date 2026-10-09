# Caption typewriter position probe

`probe.mjs` launches a locally built shell with temporary home and configuration directories. It seeks the preview, saves stage screenshots, and records caption DOM rectangles and webview errors as JSON. Point `--project` at a disposable copy of a project; the probe never edits that copy. Keep `--out` outside this repository because captured images and JSON are verification records.

```sh
node evidence/caption-typewriter-position/probe.mjs \
  --repo "$PWD" --project /tmp/caption-demo-copy --out /tmp/caption-probe \
  --times 1.1,1.5,2.0,2.5 --focus caption-1 \
  --replay caption-1:typewriter
```

The JSON contains `rows[].plate` and `rows[].glyph` rectangles, replay visible-character counts, and webview errors. Compare the plate rectangle at the same output times with and without typewriter. During replay, the script records `replay.maxPlateDeltaPx` and fails if the plate moves or changes size by more than 1 px. For export comparison, sample the exported frames at the same output times and compare the text bounds in pixels.

To compare an export, run the repository CLI against the same disposable project copy. The `--out` path must stay inside that project. `AKARI_EXPORT_ALLOW_DESKTOP=0` excludes an installed desktop app so the checkout's exporter is used.

```sh
PROJECT_COPY=/tmp/caption-demo-copy
AKARI_EXPORT_ALLOW_DESKTOP=0 node packages/render-cut/bin/render-cut.mjs \
  "$PROJECT_COPY" --engine auto --out "$PROJECT_COPY/exports/typewriter-check.mp4"
```

Read `$PROJECT_COPY/.akari/render.json` and confirm `provenance.gpu.provenance.launcher_tier` is `2` when the GPU path is selected. Extract export frames at the same output times used by the preview probe. At a time before the first character appears, the plate should already be visible; after all characters exit, it should remain visible until the cue ends. Compare its pixel bounds with the preview after scaling both to the same frame size.
