**English** | [日本語](./README.ja.md)

# Caption drag, scale, and rotation L1

The wrapper builds and runs Electron. Run this script from the repository root against a pre-fix bundle (`before`), then a corrected bundle (`after`):

```sh
bash apps/shell/extensions/akari-preview/evidence/preview-caption-drag-rotate-v1/scripts/run-l1.sh before
bash apps/shell/extensions/akari-preview/evidence/preview-caption-drag-rotate-v1/scripts/run-l1.sh after
```

The launcher follows `preview-caption-handles-v1`: it checks the CDP port (default 9768), prepares the same isolated caption fixture, starts Electron with a separate profile, and removes only its own process and temporary directories. It imports the existing CDP helper and uses real mouse input. `ELECTRON_BIN`, `AKARI_CDP_PORT`, and `AKARI_FFMPEG` may be overridden. The isolated fixture has two overlapping cues at 0.5 s and a third cue at 3 s. Preparation checks the existing edit-lint gate. To check just fixture preparation, use `prepare-fixture.mjs <temporary-workspace> --lint-only`.

Both modes log seven steps. On c-0001, two back-to-back Shift rotations should accumulate to 30 degrees after scaling to 1.25, then a body drag must change position while retaining both transforms. On c-0002, scale is immediately followed by body drag. On c-0003, body drag is immediately followed by rotation. The runner waits for each write response and disk persistence, and observes `akari-preview-captions-update` messages during the sequence. The observer logs each incoming payload and the model value when it receives the message. Before the second handle gesture or a body drag, the runner compares `window.akari.previewCaptions` with disk and logs whether the model is naturally stale. If it has already caught up, the runner removes only the relevant transform fields from the in-memory cue, leaving the displayed DOM and saved file intact. This creates the exact stale-model state that caused the original race and is recorded as an injection, never described as natural timing. It also wraps `captionWrite` transparently to log the actual patch and model values at the call boundary. The `before` mode requires the old `plateTransform` payload and observed transform loss; the `after` mode requires a position-only payload and preservation. A wrong bundle, failed stale-model setup, absent regression, or unrun step cannot become PASS.

The webview registers its caption-update `window` message listener before the L1 gate. In the observed run, `modelBeforeBlock` already matched `blockedPayload`; the later listener recorded eight blocked events but ran after the model update. The gate count alone therefore did not establish a stale model. In `before`, after proving that consecutive rotations reuse a stale baseline, recovery aligns the model baseline with the displayed angle, moves toward 30 degrees, and checks disk and DOM after each of at most four corrections. Step 4 runs only after both show 30 degrees.

`../run-log-before.json` and `../run-log.json` contain the observed `text_style`, write responses, seek records, gate state, and command logs. Screenshots are named `before-*` or `after-*`. The existing `preview-caption-handles-v1` (1)–(7) and `preview-modifier-keys-v1` regression suites are separate wrapper runs; this runner does not claim to execute them.
