# shell-audio-chip-split evidence

This directory records a production-build Electron run driven through `webContents.debugger` (CDP).
The harness reads the repository's real `catalog/audio` metadata, writes the complete tag-based
classification, opens that catalog in an isolated profile, and measures the category chips and
filtered card IDs directly from the DOM rendered by `akari-role-buckets-widget.tsx`. On macOS it
starts the production Electron bundle through LaunchServices (`open --env`) so AppKit registration
succeeds while the profile stays isolated. Electron stdout and stderr are written beneath the
profile root and replayed after the child process exits.

## Reproduction

From the repository root, after `apps/shell/npm run build` and with the Electron distribution present:

```sh
AKARI_L1_ROOT="$(mktemp -d)"
AKARI_L1_APP="$PWD/apps/shell"
AKARI_L1_EVIDENCE="$PWD/apps/shell/extensions/akari-project/evidence/shell-audio-chip-split"
AKARI_L1_WORKSPACE="$AKARI_L1_ROOT/workspace"
AKARI_L1_PROFILE="$AKARI_L1_ROOT/profile"
mkdir -p "$AKARI_L1_WORKSPACE" "$AKARI_L1_PROFILE"
cp -R "$PWD/templates/project-default/." "$AKARI_L1_WORKSPACE/"
node "$AKARI_L1_EVIDENCE/run-l1.mjs" \
  "$AKARI_L1_APP/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" \
  "$AKARI_L1_APP" \
  "$AKARI_L1_WORKSPACE" \
  "$AKARI_L1_PROFILE" \
  "$AKARI_L1_EVIDENCE" \
  "$PWD/catalog"
```

`run-log.json` contains the chip order, DOM counts, and exact visible IDs for both selections.
`classification-results.txt` contains all 27 `id -> BGM/効果音` results derived from tags.

| file | observation |
|---|---|
| `01-bgm-chip-selected.png` | BGM chip active with its filtered audio cards |
| `02-sfx-chip-selected.png` | 効果音 chip active with its filtered audio cards |
| `run-log.json` | DOM chip counts (`BGM 10 + 効果音 17 = 27`) and selected item IDs |
| `classification-results.txt` | Full local audio classification |
