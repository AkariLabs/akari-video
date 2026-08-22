# Shell field report reproduction fixture

This directory regenerates a local v2 project and drives the production Electron build through raw CDP. The generated project contains two cuts of one source, with source seconds 5–7 removed and a one-second output gap between the cuts. Its accepted `captions.json` contains four cases: each retained cut, a cue spanning the removed interval, and a cue whose numeric window matches the output gap. The project also contains the `laptop-slim-aluminum` 3D model, the `telop-chapter-tag` HTML fragment, a simple HTML comparison item, and an unbaked built-in telop comparison item.

The private 3D binary is copied only into the ignored generated project. It is never part of the tracked fixture.

## Prerequisites

- Node.js 22 or newer
- `ffmpeg`
- A built shell under `apps/shell`
- An asset library directory containing `scene3d/laptop-slim-aluminum/model.glb` and `overlay/telop-chapter-tag/fragment.html`

Build the shell once:

```sh
cd apps/shell
PYTHON=/usr/bin/python3 npm ci --no-workspaces
npm run build
```

## Regenerate the project

Set the asset-library root through the environment; do not copy its machine-specific path into tracked files.

```sh
AKARI_INTERNAL_ASSETS_DIR=<ASSET_LIBRARY_ROOT> \
  node dev-fixtures/shell-field-report-repro/make-repro.mjs
```

The command replaces `generated-project/`. That directory is ignored because it contains generated media and a private 3D binary.

## Run L1 observation

```sh
node dev-fixtures/shell-field-report-repro/run-l1.mjs
```

The driver copies the generated project to an isolated temporary workspace, starts the production Electron build with a dedicated profile and CDP port, reads the real timeline and nested preview DOM, and writes sanitized JSON and screenshots under `runs/`. It opens the output preview through the internal `akari.preview.ensureVisible` command, which returns only the primitive result `opened`, `revealed`, or `unavailable` to CDP. If that route is unavailable, it falls back to the visible `edit.json` card using the required sequence: one click to select, then a double click to open. Before every preview evaluation it re-resolves the deepest `#preview-video` execution context from a fresh frame tree, and it retries timeline clicks with freshly measured rectangles. The target scanner never attaches to the directly connected main page, browser targets, or service workers, and never attaches to the same target ID twice. Each run includes `summary.json` with a `reproduced`, `not-reproduced`, or `not-observed` verdict and evidence for all five symptoms. The driver terminates the exact spawned Electron PID and removes the isolated workspace. Re-running it creates a new timestamped run directory.

If the execution sandbox blocks macOS GUI registration before Electron creates a window, the production overlay runtime can still be exercised through CDP in headless Chromium:

```sh
node dev-fixtures/shell-field-report-repro/run-headless-cdp.mjs
```

This fallback is a preview-runtime diagnostic aid, not a substitute for the Electron L1 run and not evidence for timeline selection or drag behavior. It loads the copied production overlay runtime, records DOM rectangles and console stacks, and closes the exact spawned browser PID.
