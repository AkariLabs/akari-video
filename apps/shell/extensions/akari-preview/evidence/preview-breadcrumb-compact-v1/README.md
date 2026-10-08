# Preview breadcrumb compact L1

Electron tier 2 / CDP. Run the scripts outside the sandbox, with a built shell in each checkout:

```sh
AKARI_SHELL_DIR=<branch-point-shell> scripts/run-l1.sh before
scripts/run-l1.sh after
```

`before` uses the `c9c720dfc` shell and has **3 steps**:

- (0) Drag all four edges and four corners of the outermost selectable child (`.outer-card`). Record every transmitted `translate` and footer error. Reproducing the rejection is `ok`: the measured left-edge write sent the one-value `"46.1292px"` and was rejected, while the top edge sent `"0px 46.133px"` and saved.
- (7) Measure the old breadcrumb against the context bar and other visible controls, record its height, and measure row count at about 260 px in the deeply nested project.
- (4) Record the old breadcrumb click behavior as the comparison for `after` step (4).

`after` has **7 steps**: (0b), (1), (2), (3), (4), (5), (6). Step (0b) wraps the webview write entry point to record the transmitted style without changing product code. Each record contains `ok`/`ng` and measurements. Only a complete run can report PASS; `AKARI_PBC_ONLY` is for diagnosis and cannot produce PASS.

Screenshots capture the **whole shell window** through the top-level page's `Page.captureScreenshot`: `step1.png`, `step2.png`, seven `step3-<level>.png` images, and `step7.png` / `step7-narrow.png` for `before`. `run-log.json` and `electron-<mode>.log` also go to the output directory.

The runner resizes the real shell pane by dragging the left and right `.lm-SplitPanel-handle` splitters with pointer input, measuring and adjusting in a loop. It records each method and width in `paneResizes` / `paneRestores`. Only when the splitters cannot reach the target does it temporarily set `.preview-pane` CSS width and record that fallback. `Browser.getWindowForTarget` does not work on this Electron webview iframe target.

The context bar lives in the shell layer, outside the webview. The runner translates the breadcrumb rectangle by the preview iframe's shell position before testing intersections. For a leaf inside groups, resizing the pane removes element focus in both the branch point and this build (`before` step (7) records `narrowText`). Step (2) re-enters the element after resizing; flat-project step (6) checks folding and unfolding directly across pane-width changes. Step (5) also clicks a breadcrumb button above the stage in a project without a selection tree.

Environment variables: `AKARI_SHELL_DIR`, `ELECTRON_BIN`, `AKARI_CDP_PORT` (default `9748`), `AKARI_PBC_OUT_DIR` (default `/tmp/pbc-codex`), and `AKARI_PBC_ONLY`. Screenshots and logs remain under `/tmp`, not in the repository.
