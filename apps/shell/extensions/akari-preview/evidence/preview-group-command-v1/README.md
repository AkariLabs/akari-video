**English** | [日本語](./README.ja.md)

# Preview group command L1

The launcher creates a disposable project and Electron profile, sends real CDP pointer and keyboard input, then writes `run-log.json` and `step-*.png` here. The wrapper runs it after the shell build; these scripts alone do not claim a passed L1 run.

```sh
bash apps/shell/extensions/akari-preview/evidence/preview-group-command-v1/scripts/run-l1.sh
```

`AKARI_CDP_PORT` defaults to `9762`; `ELECTRON_BIN` and `AKARI_EVIDENCE_DIR` may override the executable and output directory. `prepare-fixture.mjs` copies the existing `preview-multi-select-v1` style fixture into a disposable workspace, with three root leaves, a group with two nested leaves, and an HTML bag. The runner checks the eight contract scenarios: timeline mirror, ⌘G with one undo, ⌘⇧G without SCM opening, nested Delete with one undo, right-click grouping and single-item hiding, bag refusal without a file change, one-item footer text, and shortcut isolation while editing text. Tested gestures use native CDP input; setup, undo and observations use application commands or read-only state.

The timeline check reads selection marks on both tree rows and strip clips. When an edit recreates the preview execution context, the runner reconnects to the webview and seeks back to 1.5 s. After grouping, Shift+Enter climbs from the retained drill-in scope to the group and notifies the timeline. For ⌘⇧G, the runner records the DEFAULT keymap order of AKARI and SCM and verifies that the real shortcut ungroups while SCM stays closed; `scmView:toggle` cannot be used here because its view container is disposed. Bag parts are selected with deep ⌘ clicks, and their set must remain a single timeline selection.

On macOS, Theia opens a modal native context menu rather than a DOM menu. The runner captures the visible menu template produced by `electronMenuFactory.createElectronContextMenu` and suppresses the popup. It invokes the chosen template item's `execute` callback, which is the path a native click runs; **this is not a physical click on the OS menu**. A DOM menu remains the fallback on other platforms.

After this runner, the wrapper also runs these existing L1 regressions separately; their results are not inferred from this run:

```sh
for suite in preview-multi-select-v1 preview-edit-key-isolation-v1 preview-context-menu; do
  bash "apps/shell/extensions/akari-preview/evidence/$suite/scripts/run-l1.sh" || exit "$?"
done
```
