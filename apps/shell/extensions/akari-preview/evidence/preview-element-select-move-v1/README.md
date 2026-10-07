# Preview element selection L1

`scripts/run-l1.sh before` records the unmodified shell's behavior for five gestures. `scripts/run-l1.sh after` checks the 14 contract cases using real CDP pointer and key events. `scripts/fixtures.mjs` holds the four HTML fragments as strings. `scripts/prepare-fixture.mjs` writes disposable flat, grouped, and scaled/rotated projects outside the repository.

Build the shell first (`cd apps/shell && npm run build:ext && npm run build`), then run from the repository root:

```sh
AKARI_SHELL_DIR="$PWD/apps/shell" \
ELECTRON_BIN="$PWD/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" \
AKARI_CDP_PORT=9737 AKARI_PESM_OUT_DIR=/tmp/pesm-codex \
apps/shell/extensions/akari-preview/evidence/preview-element-select-move-v1/scripts/run-l1.sh after
```

For `before`, point `AKARI_SHELL_DIR` at the separately built baseline shell and `ELECTRON_BIN` at its Electron executable. Fixture files still come from this script directory. The CDP port must be unused; the launcher refuses to attach to an occupied port. `AKARI_EXPORT_ALLOW_DESKTOP=0` is set for tier 2 captures.

The after run checks steps 1–9, then 12, 13, 14, 10, and 11. Step 7 checks that a blank click clears the frame and breadcrumb; step 11 checks that adding a second overlay with Cmd/Ctrl clears element focus. This keeps the text edit and export on the flat fixture before switching to the scaled and grouped projects. The output directory contains `run-log-before.json` or `run-log.json`, the Electron log, and GPU/OSR frame captures when the export check runs. Every numbered check records `ok` or `ng` and measured values. A startup failure writes a fresh FAIL log. PASS exits 0; FAIL exits 1. Output defaults to `/tmp/pesm-codex` and is not part of the repository.
