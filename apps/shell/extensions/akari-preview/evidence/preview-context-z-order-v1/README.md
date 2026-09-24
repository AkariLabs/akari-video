**English** | [日本語](./README.ja.md)

# Preview z-order L1 measurement

After building the Electron shell, run `bash scripts/run-l1.sh` from this directory.
The runner creates and removes an isolated workspace and user-data directory. It writes `run-log.json` and six screenshots here.

The six checks cover: a rear overlapping leaf moved to the front and restored by one undo; a group child moved forward from the context menu; the same move with `]` on a timeline row; the front-edge footer and unchanged edit; hidden z-order items for a multi-selection; and hidden z-order items for a bag part.

On macOS, the runner captures Theia's native context-menu template from `electronMenuFactory.createElectronContextMenu`, suppresses the modal popup, and invokes the selected item's `execute` callback. It reads a DOM menu on other platforms. For `]`, it asks Theia's `KeybindingRegistry.resolveKeybinding` for the physical `code` and `keyCode` before sending CDP key events; on a JIS Mac this can be `Backslash`. After a write, it waits for the timeline footer's completion message before issuing undo, so the history entry has settled.

The wrapper reported all six scenarios passing with a disposable copy of the final runner patch. The wrapper owns the Electron measurement and its run log.
