**English** | [日本語](./README.ja.md)

# Preview Escape and modifier keys: L1

This runner reuses the P0 part-text and P1 drill-in CDP connection, isolated Electron launch, preview reopen, and real input approach. It does not start Electron during syntax checking.

Prerequisites: a built `apps/shell`, its Electron binary, Node with WebSocket support, ffmpeg, and Git. The wrapper owns builds and execution. No extra browser automation dependency is installed. The fixture copies `templates/project-default` and the HTML bag fixture into a fresh temporary project, adds two PNG media sources and two caption cues, and commits only that disposable project for resets. Existing projects are refused.

```sh
# From the repository root; the wrapper runs this after building.
AKARI_CDP_PORT=9757 bash apps/shell/extensions/akari-preview/evidence/preview-modifier-keys-v1/scripts/run-l1.sh after
```

Set `ELECTRON_BIN` if the default root node_modules Electron path differs. The launcher checks that the port is free, uses isolated user data/config, waits up to 600 seconds for readiness, and cleans up only its own process and temporary directories.

The eight records in `../run-log.json` are:

1. Ordinary HTML and named-part text: double-click, replace, Escape; original display, zero write calls, selection remains, edit.json/HTML/captions SHA-256 hashes unchanged.
2. Repeat with Enter; ordinary fragment and part `source.text` persist and display after reopening.
3. Caption text Escape cancels with zero writes and unchanged files; Enter saves and displays after reopening.
4. Overlay movement near the left edge: modifiers 0 → Alt → Shift → Alt → 0, during one drag.
5. The same movement and modifier sequence for a native layer.
6. Layer rotation: Shift on/off/on during the drag; live and persisted angles checked against 15° multiples.
7. Alt at caption pointerdown preserves the all-caption `groupPosition` write; group defaults change and both cues display at the shared position.
8. At 150% zoom, Alt at pointerdown over the selected native layer pans the preview and produces no object writes or file changes.

Every gesture uses CDP `Input.dispatchMouseEvent`; modifiers are carried on each move (`Alt=1`, `Shift=8`), never simulated only through keyboard state. Text uses `Input.dispatchKeyEvent` and `Input.insertText`. Seek and zoom setup use their existing input handlers. The observation wrapper delegates original engine methods and records real responses; it does not manufacture writes. Each step starts from the fixture baseline. Failed or unreached steps remain in the eight-record log; any failure returns exit 1. Screenshots accompany reached steps.

P1 regression (run separately by the wrapper):

```sh
AKARI_CDP_PORT=9737 bash apps/shell/extensions/akari-preview/evidence/preview-drill-in-v1/scripts/run-l1.sh after
```

Only P1's editing-Escape expectation changes from commit to cancel; its other steps are unchanged.

Syntax checks, without Electron:

```sh
node --check apps/shell/extensions/akari-preview/evidence/preview-modifier-keys-v1/scripts/prepare-fixture.mjs
node --check apps/shell/extensions/akari-preview/evidence/preview-modifier-keys-v1/scripts/run-l1.mjs
bash -n apps/shell/extensions/akari-preview/evidence/preview-modifier-keys-v1/scripts/run-l1.sh
```
