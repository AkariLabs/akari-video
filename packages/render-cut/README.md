**English** | [日本語](./README.ja.md)

# render-cut

`@akari-video/render-cut` turns an approved AKARI Video `edit.json` into a verified deliverable. It
renders the project, verifies the resulting artifact, and writes the render state and HTML report
under `.akari/`.

```sh
render-cut /path/to/project --engine osr
```

You can also run it through the package binary:

```sh
node packages/render-cut/bin/render-cut.mjs <project-root>
```

## Project input paths

Declared input paths must stay inside the project after symbolic links are resolved. A symlink is
accepted when its resolved target is a regular file inside the real project root. A symlink that
resolves outside the project is rejected; use the declared asset-library fallback when an external
library asset is intended.

### Overlay fragment assets

Relative asset references inside an overlay fragment resolve from **the fragment file's directory**.
For example, `overlays/lower-third/fragment.html` resolves `../../assets/logo.png` to
`assets/logo.png` (`../assets/logo.png` resolves to `overlays/assets/logo.png`). During export,
images and fonts are embedded as data URIs; video and audio are served through `/media/`.
Existing `/media/…` and `data:` references are left unchanged. Inline HTML without a fragment
file path retains its existing behavior.
Preview resolves asset URLs from the same fragment directory.
`edit-lint` reports missing, escaping, and absolute local fragment asset references as errors.

Missing assets stop export with the overlay ID, fragment path, and reference in the error.
Embedded files must be at most 16 MiB; reduce larger assets or use video. Video and audio must
be inside the project, even when an asset-library fallback exists.

## Default output name

Without `--out`, render-cut writes to `exports/` and chooses the stem in this order:

1. `edit.name`, when it is a non-empty string
2. the project directory name
3. `render`

The stem is sanitized for use as a file name. Existing outputs are not overwritten: the next name
uses `-2`, then `-3`, and so on. An explicit `--out` remains unchanged, and an output path is never
allowed to replace a declared input.

## Blank-frame scan

Blank-frame verification is enabled by default for rendered video artifacts. One full-frame ffmpeg pass runs `signalstats,metadata=print` and estimates the background YMAX as the median of the lowest 5% of YMAX observations. A frame is background-stuck when `YMAX <= background + 8`; only continuous intervals of at least 0.3 seconds are reported.

The scan does not use `-skip_frame` or scaling, so every decoded frame is measured and the minimum reportable interval remains 0.3 seconds. Each interval is stored in `verify.declared.blank_frames` and shown in the HTML report with active overlay and cut IDs. An interval is a `warning` when at least one declared overlay or cut is active and `info` otherwise. These findings never change the verification verdict.

Use `--no-verify-blank` to disable this scan.

## Development-only GPU override

Set `AKARI_FORCE_GPU=1` only when running an explicit `--engine gpu` export to evaluate degraded overlays through the best-effort DOM layer. This override is strictly for verification, marks the output as GPU-forced, and must never be used for a deliverable.
