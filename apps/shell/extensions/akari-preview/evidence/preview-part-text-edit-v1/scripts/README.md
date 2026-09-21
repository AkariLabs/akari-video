**English** | [日本語](./README.ja.md)

# Preview part text editing L1 scripts

These scripts cover task instructions 1 (BEFORE) and 6 (AFTER). Run against an
already built Electron application with Node providing global `WebSocket` and
`fetch`. They do not build, install dependencies, or modify production source.
The shared `packages/edit-store/lib/canonical.js` must already be available.

```sh
bash apps/shell/extensions/akari-preview/evidence/preview-part-text-edit-v1/scripts/run-l1.sh before
bash apps/shell/extensions/akari-preview/evidence/preview-part-text-edit-v1/scripts/run-l1.sh after
```

The mode argument is required. `AKARI_CDP_PORT` defaults to **9747**;
`ELECTRON_BIN` overrides the default macOS Electron executable. The launcher
refuses an occupied port, waits up to 600 seconds for Electron/Theia readiness,
and cleans up only its own Electron PID and temporary workspace/user data.
It writes a fresh FAIL log on startup failure and returns the runner's exit code.
It never kills a process by name or modifies an existing project.

`prepare-fixture.mjs <workspace>` creates `<workspace>/project`, refusing to
replace an existing project. Like the P1 scripts, it copies
`templates/project-default`, overlays `object-tree-html-bag`, writes canonical
edit.json and an empty review.json, and initializes/commits Git **only inside
the disposable copy** (hooks/signing disabled). The only fixture layout change
is `s01.B.transform.y = 40`. At **0.5 seconds / frame 15**, A, B, C, and plain
are visible in separate text boxes; the unrelated `g1` starts at frame 30.
IDs, HTML bytes, the bag's `exclude: ["C"]`, explicit B, and scanned A remain
unchanged. The fixture and P1 evidence are read-only inputs.

Each of the four cases starts from the initial commit. The runner closes the
preview, restores tracked files with
`git restore --source=HEAD --staged --worktree -- .`, runs `git clean -fd`,
checks the baseline hashes, and opens a new preview through
`akari.preview.ensureVisible`. This is equivalent to checkout/clean for the
fixture and also clears staged changes. Git restoration is restricted to the
disposable project's repository. The preview is reconstructed again after each
edit, so corruption from one case cannot contaminate the next case.

Cases, in order:

1. Detached part `s01.C` → `L1-C-new`.
2. Explicit bag child `s01.B` → `L1-B-new`.
3. Scanned part `s01#A` → `L1-A-new`.
4. Ordinary HTML `plain` → `L1-plain-new`.

All tested gestures use the existing CDP helper from
`akari-annotations/evidence/timeline-tracks/scripts/cdp-lib.mjs`. Cmd/Ctrl click
selects the leaf through P1's deep-selection UI; double-click enters text
editing. Cmd/Ctrl+A selects the entire original text (the selection is checked),
`Input.insertText` supplies the replacement, and Enter commits it. The runner
checks focus, editable ownership, and non-overlapping hit boxes. It reads the
existing P1 interaction getters without adding or assigning interaction state.
The seek input at 0.5s and ordinary Theia open/close commands are setup only.
No write messages are posted by the harness.

The P1-style transparent `engine.overlayWrite` wrapper records unchanged
arguments at the outgoing message boundary, including type, overlay ID, full
patch, `hasHtml`, `hasText`, and the first 200 HTML characters. It delegates with
the original `this`, arguments, and promise. Actual incoming
`akari-preview-overlay-write-response` messages (including requestId and
ok/error) are recorded through a message listener. The engine generates requestId
after the wrapper; it is not fabricated in the recorded outgoing arguments.
Runtime bindings retain events even when the preview document is disposed.

Every case records both HTML files' before/after SHA-256, byte length, and first
200 bytes (UTF-8 preview plus a lossless numeric byte array), parsed edit.json and
`git diff HEAD -- edit.json`, live DOM, and reconstructed DOM. DOM evidence
contains the target textContent and A/B/C computed visibility in **each part's
own mount**, plus all sibling elements in every clone. Siblings hidden by the
normal clone mask are not mistaken for damage to their own rendered mounts.
AFTER also checks fixture hashes against the BEFORE log when available.

BEFORE records observations only: `reproduced` means the shared card changed
and contains a serialized part mask. `not-reproduced` is also a successful
observation when the experiment completed; response `ok:false` is retained.
Hidden own parts are recorded separately as the visible impact. Only startup,
setup, input, or observation failures produce exit 1 in BEFORE.

AFTER gives each case `ok`/`ng`. Part cases require an unchanged card and plain
file, one successful text-only write, the new target `source.text`, and no
unrelated edit.json changes (whole-document comparison plus the resolver's
existing `JSON.stringify` output bytes).
Scanned A must become the P1 explicit child `s01.A`, with `source.part: "A"`,
`at: 0`, the bag duration/path, and the new text. The rebuilt target must show
the replacement and all three own parts must remain visible. Plain requires
changed plain.html containing the new text, unchanged card.html and edit.json,
and the replacement in the rebuilt DOM. All four cases must pass for exit 0.
The multiple-text-elements rejection is outside this fixture's coverage: each
part contains exactly one text element.

Outputs go one directory above these scripts: `run-log-before.json` or
`run-log.json`, plus mode-prefixed initial/editing/rebuilt and failure PNGs.
AFTER does not overwrite BEFORE evidence. Logs include status, per-case
observations, raw events, and failure details; cases continue after a failure.

Syntax-only checks (no application launch):

```sh
node --check apps/shell/extensions/akari-preview/evidence/preview-part-text-edit-v1/scripts/prepare-fixture.mjs
node --check apps/shell/extensions/akari-preview/evidence/preview-part-text-edit-v1/scripts/run-l1.mjs
bash -n apps/shell/extensions/akari-preview/evidence/preview-part-text-edit-v1/scripts/run-l1.sh
```
