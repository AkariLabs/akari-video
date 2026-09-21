**English** | [日本語](./README.ja.md)

# Preview drill-in followups L1

Use an already built Electron application and Node with global `WebSocket` and
`fetch`. The runner performs no build or dependency installation.

```sh
AKARI_CDP_PORT=9747 bash apps/shell/extensions/akari-preview/evidence/preview-drill-in-followups-v1/scripts/run-l1.sh
```

`ELECTRON_BIN` overrides the macOS executable path. The launcher rejects an
occupied port, waits up to 600 seconds, and cleans up only its own process and
temporary workspace/profile. Startup failures also replace the log with FAIL.

The fixture copies `project-default` and `object-tree-html-bag`, wraps g1 in
outer, separates its children, and adds an untouched three-part HTML bag called
lazy. It changes only the disposable copy and initializes git there. The source
fixtures and user settings are unchanged.

The four scenarios use CDP pointer/keyboard input, with DOM/widget state reads:

1. Cmd/Ctrl click g1.first from default collapsed outer/g1. Both ancestors open,
   the leaf row is selected, and timeline focus stays at root. No setup toggles.
2. Double click the g1 timeline row, click the preview leaf, then press Esc three
   times: clear the leaf at g1, leave g1 for outer, leave outer for root.
   Each key records both documents' focus/active elements and the shell's active
   and current widgets. Dispatch follows the observed focus (preview or main);
   no clicks or focus activation occur between these three keys.
3. The lazy bag has one mount outside its scope, three inside, and one again
   after clicking plain. Repeat for double click, Enter, and Cmd/Ctrl click.
4. Explicit/excluded s01 keeps its two mounts throughout. Selection never writes
   edit.json or fixture HTML; file fingerprints must remain unchanged.

Each step first restores root through the timeline breadcrumb when necessary,
closes/reopens the preview through the ordinary shell route, seeks to the sample
time, then clicks plain and clears its selection with Esc. These preparations
are recorded separately and do not expand outer/g1 before step 1. A failed step
therefore does not leave a focus floor or active text editor in the next step.

Results are `run-log.json` and step/failure PNGs in this evidence directory. The
runner exits 0 only when all four scenarios pass. The existing P1, P0, and
modifier-key regression runners are separate. For an already running isolated
application, pass `<port> <workspace> <evidence-output>` to `run-l1.mjs` directly.
Syntax-only checks: `node --check` for both `.mjs` files and `bash -n` for the
launcher. No production-source substring is executed by the tests.
