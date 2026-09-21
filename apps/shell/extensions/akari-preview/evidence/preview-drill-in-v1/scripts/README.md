**English** | [日本語](./README.ja.md)

# Preview drill-in L1 scripts

Run against an already built Electron application, with Node providing global
`WebSocket` and `fetch`. No build or dependency installation is performed here.

```sh
AKARI_CDP_PORT=9737 bash apps/shell/extensions/akari-preview/evidence/preview-drill-in-v1/scripts/run-l1.sh before
AKARI_CDP_PORT=9737 bash apps/shell/extensions/akari-preview/evidence/preview-drill-in-v1/scripts/run-l1.sh after
```

The argument overrides `L1_MODE`; the default is `after`. `ELECTRON_BIN` can
override the default macOS Electron executable. The launcher refuses an occupied
CDP port, waits up to 600 seconds for readiness, and cleans up its own Electron
PID and temporary workspace/user data on exit. Its exit code follows the runner.
Use `node --check` for each `.mjs` and `bash -n run-l1.sh` for syntax checks only.

`prepare-fixture.mjs <workspace>` creates `<workspace>/project` and refuses to
replace an existing project. It copies the default project and the read-only
`object-tree-html-bag` fixture, then wraps `g1` with `outer` in the same edit.json.
Only in the copy, rotations/scales and translations are adjusted to separate
the text hit areas, and `g1.second.at` is set to 0. Both group children are visible
at the sample time, 1.5 seconds. The original IDs, HTML, bag masks, and scanned A
versus explicit B distinction are preserved. All copy adjustments precede the
initial git commit in the disposable project. The product repository is never
committed. Fixture edit hashes must match when comparing BEFORE and AFTER.

BEFORE runs only instruction 0, using ordinary clicks and real pointer drags on
`g1.first` and `s01#A`. It observes selection, writes, received
`akari-preview-overlay-write-response` messages, and cumulative `git diff HEAD --
edit.json` before/after each gesture. An observed `ok:false` with no saved edit is
a successful BEFORE observation. No new interaction state API is needed.

AFTER records all 11 numbered steps separately with `ok`/`ng` observations.
Step 1 uses Cmd/Ctrl click to reach the same leaf write targets; plain clicks now
select ancestors. It embeds the corresponding BEFORE cases if that log exists.
Creating the A override in step 1 may give A an explicit ID; later steps resolve
that ID by `source.part === 'A'`. Steps 2–5 use `outer` as the group, step 8 uses
the full `outer > g1 > g1.first` path, and step 10 double-clicks the actual `g1`
timeline row. Step 8 checks the widget's `focusScope.rootId`, selection ID, and
selected row IDs immediately before and after **each** Esc. Step 10 checks
four preview Esc keys at the timeline floor, including keys after deselection.

Stage 2 must implement the exact `EXPECTED_STATE_API` at the top of
`run-l1.mjs`: read-only `window.akari.interaction.selectedId`, `scopeId`,
`floorScopeId` (string or null), and `activeEdit` (boolean or object/null).
Missing getters fail AFTER; the script never supplies them or changes selection
state through an API. Pointer/key gestures use CDP Input. CDP evaluation only
reads state, opens the existing UI, seeks the sample time, and installs observers.
The existing `engine.overlayWrite` gets a transparent observation wrapper that
returns the original promise unchanged; a window message listener captures the
actual responses. Both are installed at runtime, without modifying source files.

Outputs live one directory above these scripts: `run-log-before.json` or
`run-log.json`, plus selected step/failure PNGs. AFTER preserves the BEFORE log.
Each log includes status, per-step observations, raw message events, file
snapshots/diffs, and failure details. PASS exits 0; FAIL exits 1. Startup failure
also produces a fresh FAIL log. These scripts cover instruction 0 and instruction
9; the separate regression suite in instruction 10 is not invoked by this runner.

AFTER checks saved leaf geometry with the shared `readInternalEdit` →
`expandBagOverlays` path. Only groups compose; bag/part transforms override by key.
For each saved leaf drag, it records the live DOM CSS using the old mounted ID,
closes the matching output widget through `ApplicationShell.closeWidget`, reopens
it with `akari.preview.ensureVisible`, seeks to 1.5s, and checks the rebuilt DOM
CSS using the persisted ID. It never waits for the host's suppressed own-write
file event. `git diff` is evidence; the save verdict uses target transform values.

Each AFTER step starts by leaving any timeline focus through its root breadcrumb
and rebuilding the preview. Steps 8 and 10 expand `outer` and `g1` with real clicks
on `data-akari-tree-toggle` buttons. These actions and before/after states are
recorded under `observations.preparation`. This is explicit test setup, not a
claim that production preview selection auto-expands collapsed timeline rows.
