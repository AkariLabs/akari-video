**English** | [日本語](./README.ja.md)

# Preview multi-selection L1

This runner uses real Electron/CDP pointer and keyboard input in a disposable project copy and an isolated profile. It writes `run-log.json` and screenshots here (or to `AKARI_EVIDENCE_DIR`). The scripts are prepared for the wrapper to execute; their presence does not claim a successful L1 run.

Build the current edit-store, preview-server runtime bundle and shell before running:

```sh
npm --prefix packages/edit-store run build
npm --prefix packages/preview-server run build
npm --prefix apps/shell run build
bash apps/shell/extensions/akari-preview/evidence/preview-multi-select-v1/scripts/run-l1.sh
```

`AKARI_CDP_PORT` defaults to `9758`; `ELECTRON_BIN` can override the macOS Electron executable. The launcher refuses an occupied port, cleans up only its own process and temporary directories, and records startup failures. No original project is modified. `scripts/prepare-fixture.mjs <empty-workspace>` creates three disjoint root siblings and a group containing one leaf at 1.5 seconds, each root item on its own visual track. The fixture unit test prepares the actual project, resolves a three-item transform batch and checks both documents with edit-lint.

The eight scenarios check:

1. Shift addition, union geometry, member marks, and no resize handles.
2. Addition and removal of the third sibling.
3. A three-item drag, equal saved displacement, one host batch message, zero single messages, one lint and one physical edit.json write.
4. Right × 3 and Shift+Down: all items move +3/+10 and save as one batch after idle.
5. Shift+deep selection into another scope replaces the set; a plain Shift click outside that scope replaces it again. A root click on a nested leaf resolves its group under the existing scope rules.
6. Escape collapses to the last-added representative, then clears selection.
7. Double click narrows the set before text editing or group drill-in.
8. A one-shot invalid candidate sent to the real host lint service produces a `references.files` rejection, restores all live poses, and leaves edit.json byte-identical.

Host probes delegate to the existing handlers and file service. The preview service is replaced with a facade that wraps only `lintEditCandidate` and delegates all other members to the original JSON-RPC service with its original receiver. Installation and each arming verify service and method identity; installation checks are recorded in the event log. The probes observe batch/single messages, read/lint/write counts and actual lint results. In scenario 8 only the lint request candidate is modified: item c points to `overlays/__l1_missing_c__.html`. The original service performs the real check, and the runner requires its `references.files` error. No failing result is fabricated; the input batch, project files and other candidate items are unchanged by the probe. File-watcher reads can increase the total read count after a successful save. The structural unit test additionally checks that the batch handler itself reads once. Tested selection gestures always use native CDP input; setup commands, seeking, probes and state reads are instrumentation. The representative remains `string | null`; the new `selectedIds` and `selectionKind` getters are also checked.

Run these existing L1 launchers separately after this runner, using the same current build. Each must exit 0; none is implicitly marked passed by this runner:

```sh
for suite in preview-drill-in-v1 preview-part-text-edit-v1 preview-modifier-keys-v1 preview-drill-in-followups-v1 preview-nudge-cycle-hover-v1; do
  bash "apps/shell/extensions/akari-preview/evidence/$suite/scripts/run-l1.sh" || exit "$?"
done
```

Focused unit checks (browser tests need headless Chrome):

```sh
node --test packages/edit-store/test/preview-item-write-batch.test.mjs packages/overlay-runtime/test-harness/selection-scope.test.mjs packages/overlay-runtime/test-harness/multi-selection-browser.test.mjs apps/shell/extensions/akari-preview/test/preview-overlay-write-batch.test.mjs apps/shell/extensions/akari-preview/test/preview-multi-select-fixture.test.mjs
```
