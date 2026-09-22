# Axis scale parity fixtures

Run `node run.mjs` from this directory (or use its absolute path). `--surface web|gpu|osr`
and `--case scale-x|scale-y|rotated|group-leaf|keyframes|legacy` select a subset.
`results/results.json` records actual measurements, exporter receipts, unavailable prerequisites,
PNG bounds and per-channel mean absolute difference. Each surface is attempted independently.
No unavailable surface counts as passing. Capture frames are 0, 15, 30, 45 and 59.

Build edit-store and regenerate frame-engine / overlay interaction bundles before running.
Export calls use the production `captureFramesWithGpu` / `captureFramesWithOsr` APIs and
require their tier 2 Electron launcher. Web capture uses preview-server and local Chrome;
`AKARI_CHROME_EXECUTABLE` can override its path. The source fixture files are read-only inputs.

For shell measurement, open a fixture's edit.json in an isolated built shell with CDP enabled,
then run `node shell-cdp.mjs http://127.0.0.1:9222 scale-x`. It measures the production
`interaction.fragmentBounds`, compensating for stage display scale. Repeat for the other static
fixtures. The browser must already display the named fixture. It does not launch or modify the shell.

For an automatic shell run, execute `bash run-shell.sh` outside the sandbox. It uses the already
built `apps/shell` and `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron` without
building or installing anything. Each of `scale-x`, `scale-y`, `rotated`, `group-leaf`, `keyframes`,
and the uniform-scale control `legacy-keyframes`
gets its own temporary workspace, copied project template, fixture files, Git baseline, user data,
and Electron process. Git initialization and commits run only inside those disposable projects.
The runner waits for Theia readiness, opens the output preview, and observes production runtime
ticks after seeking through the normal seek control. It measures frame 0 for each static fixture
and frames 0/30/45/58 for both keyframe fixtures, using `interaction.fragmentBounds` with a 1 px tolerance.
Frame 59 is recorded for both as a non-gating terminal-seek diagnostic. If it times out, the
last runtime clock seconds/sequence and seek min/max/value are saved for comparison.
Results go to `results/shell-results.json`; screenshots and Electron logs use a `shell-` prefix.
Processes and temporary workspaces are cleaned up on completion, failure, SIGINT, and SIGTERM.
An unkillable process is reported as a cleanup failure and its workspace is retained for diagnosis.
Optional environment variables: `NODE_BIN`, `ELECTRON_BIN`, `AKARI_CDP_PORT` (default 9837), and
`AKARI_SHELL_L1_TIMEOUT_MS` (default 600000). The port must be unused by other verification lanes.

The three standalone HTML cases are a centered 100 × 60 px green rectangle: horizontal ×2,
vertical ×0.5, and horizontal ×1.5 / vertical ×0.75 with 30° rotation. The group case adds a
uniform ×1.25 parent. The keyframe case moves effective X from 1 to 2 over 60 frames. The
legacy control uses only `scale: 1.25`; the script also checks canonical byte stability and group rejection.

PNG comparison passes when all four green pixel bounding-box values (left/top/width/height)
agree within 1 px; both rectangles must be nonempty. Difference PNGs and RGB MAD inside the
reference box are always recorded. MAD does not determine pass/fail. `madBaselines` records
legacy-control MAD per export surface (maximum over the available legacy frames), and each
comparison records `baselineMad` and `madWithinBaseline` (MAD ≤ baseline + 1). A missing
legacy capture leaves those diagnostics null until merging. OSR capture is raw capture,
not decoded H.264. Shell measurements remain a separate result; full parity requires every surface.

`--electron /absolute/path/to/Electron` explicitly supplies a tier 2 executable without modifying
installed dependencies. Each selected run writes a separate `results-<surface>-<case>.json`.

`node runtime-dom.mjs` is a supplementary Chrome check of the classic shell runtime and the
production export overlay sheet over all six fixtures and five frames. It records DOM bounds
and PNGs under `results/runtime-dom/`; this does not substitute for a full Electron capture.

## Contract boundary follow-up

The wrapper authorized the existing `src/common/frame-engine-render-scale.ts` pure function in
the second round. Pixel-based geometry now scales each explicit axis, while fit-based geometry
preserves its scale values and legacy uniform plans gain no new keys.
The shell's legacy media layout / hit-test calculations still consume a uniform scalar; only
axis dataset propagation was included there. That remaining scope question concerns media,
not the HTML fixtures measured by `run-shell.sh`; full shell media parity is not claimed here.

For a shell keyframe measurement, seek to the desired frame first, then pass that frame number
as the third argument to `shell-cdp.mjs`. This read-only check records the measured time and axes.

## Third-round diagnosis and split capture merge

The legacy `?frameEngine=0` seek handler previously clamped every overlay-only seek to zero
because the empty cut map supplied a zero duration. A production-app browser regression first
reproduced this with uniform `scale` keyframes, then verified uniform and axis curves after the
overlay-end duration fix. `fixtures/legacy-keyframes/` is this seek control; `fixtures/legacy/`
remains the unchanged static MAD baseline. Run the control with
`node run.mjs --surface web --case legacy-keyframes`.

Web capture now waits for an observed production runtime tick at the requested frame and records
its time/frame; visibility alone is insufficient. Shell capture uses `step=any` on its test seek
control to avoid rounding requested frame times down on the slider's millisecond grid.

After split `--surface` / `--case` captures, run `node merge-results.mjs` (optionally followed by a
results directory). It reads `results.json` and `results-<surface>-<case>.json`, selects the newest
attempt per fixture/surface, and recomputes all comparisons, diff images, and legacy MAD baselines.
A newer blocked attempt replaces an older success. Missing captures fail the merged result;
`pass` covers web/gpu/osr geometry and contract checks. The separate `shell-results.json` must
also pass. Capture/exit handling for GPU and OSR is unchanged.
