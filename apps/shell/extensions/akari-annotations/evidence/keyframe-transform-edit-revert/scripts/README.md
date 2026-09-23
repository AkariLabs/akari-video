**English** | [日本語](./README.ja.md)

# Keyframe transform reproduction

From this directory, run `./run-l1.sh before`. The runner creates an isolated temporary workspace from `templates/project-default`, adds one HTML item and one PNG still image, launches the built Electron shell, connects to Theia and the nested preview webview with the shared CDP helper, and writes `../run-log-before.json` plus `../before-*.png`. `AKARI_CDP_PORT` overrides the default port 9493. The shell build and Electron binary must already be available. No external media tool or Playwright is used. Only the Electron PID started by this script is stopped. Temporary workspace, user data, Theia configuration, and AKARI home are removed on exit.

After the product fix, run `./run-l1.sh after`. It writes `../run-log-after.json` and `../after-*.png`, and exits nonzero unless every case passes. The `before` run completes every case and exits zero even when expected values differ; a startup or connection failure still exits nonzero.

The runner writes full logs at the paths above; move those full logs to `/tmp` and keep only the compact summary JSON in the repository.

Each item (`html-item`, `still-item`) is measured independently:

| Case | Measurement |
| --- | --- |
| `a-prepare-*` | Change X, Y, overall scale, rotation, width and height in the inspector, then use resize, move and rotate handles, starting without keyframes. |
| `a-toggle-*` | At 1 s (frame 30), toggle a missing transform point; in `after` mode, observe an existing point without deleting it. Capture screen, preview CSS variables and selection corners, inspector values, and the saved item before and after. |
| `b-*` | With keyframes active, edit with preview handles and inspector fields; check the value again after settling. |
| `c-seed-two-points` | Set two distinct keyframes at frames 30 and 90 directly in the temporary fixture. |
| `c-on-*`, `c-between-*`, `c-outside-*` | Repeat handle and numeric edits at 1, 2 and 4 s; test an existing point, interpolation, and the hold range outside the last point. |
| `d-single-undo` | Make one move, invoke one Theia keyboard undo, and compare the item before, after the move, and after undo. |
| `e-seek-away-return` | Seek away and back and compare displayed values. |

The runner's full operation records include `expected`, `observed`, `status`, item snapshots, base transform and per-frame keyframe differences, preview write journal and response delta, and a diagnosis separating no write from a saved base value hidden by evaluation. On a failed handle write, `error` also includes the webview Promise rejection, host response, and visible error banner. The committed summary keeps case ID, item, status, relevant saved transform/keyframe changes, on-screen values, and the first error line. Numeric values are rounded to six decimal places; keyframe changes retain only changed transform properties. Screenshot names in the full log are relative to the evidence directory. The runner records individual failures and continues.

For a still cut on the frame-engine surface, `#preview-video` may retain stale transform data while the active selection box and inspector show the current frame. The full log keeps the raw dataset and a `datasetStale` flag; the summary retains the flag when true. Cut seek-return checks use the inspector values and four selection corners. HTML move starts at a hit-tested fragment point. Resize uses the `se` corner for both items.
