**English** | [日本語](./README.ja.md)

# Preview text-edit key isolation L1

Use a built Electron shell and Node with `fetch` and `WebSocket` support. This
runner follows the existing nudge/cycle/hover and multi-selection L1 scripts.

```sh
AKARI_CDP_PORT=9777 bash apps/shell/extensions/akari-preview/evidence/preview-edit-key-isolation-v1/scripts/run-l1.sh
```

The launcher rejects occupied ports, creates a disposable project and profile,
waits for Theia readiness, and cleans up its own process and directories.
`ELECTRON_BIN` overrides the executable; `AKARI_EVIDENCE_DIR` overrides the output.
It does not build, install dependencies or commit. For an already running isolated
shell, run `scripts/prepare-fixture.mjs <workspace>` before launching the app with
`<workspace>/project`, then `scripts/run-l1.mjs <port> <workspace> <output>`.
Never run against a real project: the positive control deletes a fixture item.

The fixture has two separate root leaves: a named HTML part and ordinary HTML,
both initially containing `あいう`. Native CDP mouse/key input drives selection
and editing. A host-window capture listener observes keydown, keyup and keypress,
including `isTrusted`; it does not consume or synthesize events.

1. Single-click the part, confirm it is also selected in the timeline, then
   double-click to enter text editing. Press Backspace at the end. Require `あい`,
   an unchanged edit.json and zero host events.
2. Type Space, `c`, `f`. Require `あい cf`, unchanged playback and timeline tool
   mode, a surviving item and zero host events.
3. After persistence checks, select the unedited ordinary leaf and press Backspace.
   Require exactly one host Backspace keydown and actual deletion of that leaf.
   A missing forwarding path fails this positive control.
4. Enter commits the part to `source.text` and ordinary HTML through its existing
   writeback path. The ordinary leaf uses the same single-click selection check
   and double-click editing gesture. This runs before step 3 so deletion cannot
   mask persistence.

All four cases must pass for exit 0. The output contains `run-log.json` plus
step/failure screenshots. Execution results are produced by the runner; script
creation or syntax checking alone does not establish an L1 pass.

Run the six existing regression runners with fresh outputs under this directory:

For each regression, prepare its own disposable workspace using its existing
`prepare-fixture.mjs`, launch the built shell with that workspace, and invoke its
`run-l1.mjs` with `<port> <workspace> <output>`. P0 (`preview-part-text-edit-v1`) and modifiers (`preview-modifier-keys-v1`)
additionally require the final argument `after`. Use an absolute output under
`preview-edit-key-isolation-v1/regression/<case>`; some older shell launchers
ignore `AKARI_EVIDENCE_DIR`, so do not use those launchers with their defaults.
The six cases are P1 (`preview-drill-in-v1`), P0 (`preview-part-text-edit-v1`),
modifiers (`preview-modifier-keys-v1`), P1.5a (`preview-drill-in-followups-v1`),
P1.5b (`preview-nudge-cycle-hover-v1`), and P4a (`preview-multi-select-v1`).

Unit coverage (Puppeteer, including native caret movement, deletion, selection,
undo, Enter/Escape, blur and IME passthrough, with and without a selection tree):

```sh
node --test packages/overlay-runtime/test-harness/edit-key-isolation-browser.test.mjs
```
