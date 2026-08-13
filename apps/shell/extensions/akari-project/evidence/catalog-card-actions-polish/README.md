# catalog-card-actions-polish evidence

This directory records a production-build Electron run driven through `webContents.debugger` (CDP).
The harness serves an `akari-assets-catalog/v0` document from a loopback HTTP server with two paid
items and one free item. An isolated user catalog contributes one uninstalled local item, so the same
run observes locked, available, and local action branches without credentials.

## Reproduction

From the repository root, after `apps/shell/npm run build` and with the Electron distribution present:

```sh
AKARI_L1_ROOT="$(mktemp -d)"
AKARI_L1_APP="$PWD/apps/shell"
AKARI_L1_EVIDENCE="$PWD/apps/shell/extensions/akari-project/evidence/catalog-card-actions-polish"
AKARI_L1_WORKSPACE="$AKARI_L1_ROOT/workspace"
AKARI_L1_PROFILE="$AKARI_L1_ROOT/profile"
mkdir -p "$AKARI_L1_WORKSPACE" "$AKARI_L1_PROFILE"
cp -R "$PWD/templates/project-default/." "$AKARI_L1_WORKSPACE/"
node "$AKARI_L1_EVIDENCE/run-l1.mjs" \
  "$AKARI_L1_APP/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" \
  "$AKARI_L1_APP" \
  "$AKARI_L1_WORKSPACE" \
  "$AKARI_L1_PROFILE" \
  "$AKARI_L1_EVIDENCE"
```

`run-log.json` contains the measured card/action/button rectangles. The harness asserts every button
right edge stays within its card, each action row's left/right margin difference is at most 2px, and
the compact locked label fits a single line. It also checks the wider list label and confirms preset
cards remain read-only.

| file | observation |
|---|---|
| `01-grid-locked-available-local.png` | Three-column grid with compact locked, available, and local actions |
| `02-list-purchase-action.png` | Wider purchase label remains at the list row's right edge |
| `03-preset-read-only.png` | Preset cards still have no action buttons |
| `run-log.json` | DOM geometry, labels, titles, and assertion inputs from the Electron run |
