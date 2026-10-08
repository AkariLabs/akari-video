# Preview element box and rotation — shell L1

Build the shell, then run the L1 script:

```sh
cd apps/shell
npm run build
extensions/akari-preview/evidence/preview-element-box-rotate-v1/scripts/run-l1.sh after
```

The script prepares isolated projects, launches Electron with CDP, and runs 16 measured steps. A complete PASS exits 0; a failed or incomplete run exits 1.

Environment variables: `AKARI_SHELL_DIR`, `ELECTRON_BIN`, `AKARI_CDP_PORT` (default 9747), and `AKARI_PEBR_OUT_DIR` (default `/tmp/pebr-codex`). For diagnosis, `AKARI_PEBR_ONLY=9,10` runs only those steps; a partial run does not count as PASS. Output in `AKARI_PEBR_OUT_DIR` includes `run-log.json`, `electron-after.log`, and one-frame captures under `export-gpu` and `export-osr`.

The temporary root `project` holds steps 1–4 and 6–7. Subprojects isolate the remaining work: `sub-corner` (5), `sub-scaled-a` and `sub-scaled-b` (8, two zooms), `sub-small` (9), `sub-inline` (10 and 16), `sub-svg` (11), `sub-cancel` (12, 14, and 15), and `sub-export` (13). Their actual directory names have a `-project` suffix. Execution order is 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 11, 12, 14, 15, 13.

The script measures element and frame corners independently with CDP `DOM.getBoxModel` border quads, including transforms. Handle positions come from the centers of their `getBoundingClientRect()` results. GPU and OSR checks read one-frame PNGs and locate the green bar and red value label by pixel bounds.

Two existing shell behaviors affect these steps. Shift is pressed **after** pointer-down on a handle; Shift, Cmd, or Ctrl held at pointer-down changes the selection. Undo checks in steps 3, 4, and 6 run in the root project because only the first timeline project receives preview writes in its undo history. The `sub-…` names let the root `edit.json` be discovered first.

The E2 L1 script (`preview-element-select-move-v1`) is unchanged. On this build it reports 9/14: steps (1), (2), (4), (5), and (6) still require zero handles while an element is focused. This L1 checks the corresponding behavior with current expectations in (1) for focused handles, (2) and (9) for handles after a write, (11) for SVG, (10) for telop text, and (15) for ten item handles after Esc.
