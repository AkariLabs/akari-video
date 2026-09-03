**English** | [日本語](./README.ja.md)

# render-cut

`render-cut` renders an approved AKARI Video `edit.json`, verifies the resulting artifact, and writes the render state and HTML report under `.akari/`.

Run it through the package binary:

```sh
node packages/render-cut/bin/render-cut.mjs <project-root>
```

## Blank-frame scan

Blank-frame verification is enabled by default for rendered video artifacts. One full-frame ffmpeg pass runs `signalstats,metadata=print` and estimates the background YMAX as the median of the lowest 5% of YMAX observations. A frame is background-stuck when `YMAX <= background + 8`; only continuous intervals of at least 0.3 seconds are reported.

The scan does not use `-skip_frame` or scaling, so every decoded frame is measured and the minimum reportable interval remains 0.3 seconds. Each interval is stored in `verification.declared.blank_frames` and shown in the HTML report with active overlay and cut IDs. An interval is a `warning` when at least one declared overlay or cut is active and `info` otherwise. These findings never change the verification verdict.

Use `--no-verify-blank` to disable this scan.
