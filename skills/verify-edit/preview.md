# Open and check the existing preview

For production/QA, use the existing output preview of project `edit.json`.
Do not implement project-specific playback HTML, playback UI, seeking, audio synchronization, or edit-data conversion
just to provide a preview. If the user explicitly requests a standalone playback page, create it within that request's scope.

## Launch and connect

1. Confirm the target project's absolute path. Reuse an existing preview if it has the same project open;
   an open port alone does not establish a project match.
2. **Desktop app**: Open the target folder and Output Preview from the timeline.
   For the browser, use the left Menu → Browser Preview and open the URL shown after launch.
   This is bundled functionality; do not require `~/.akari/app` or a separate Node installation.
3. **`install.sh` / source version**: Use an existing `akari.sh`; in another terminal run
   `./akari.sh --preview /absolute/path/to/project --port 4567`.
   For installation into `~/.akari/app`, use its `akari.sh` by full path.
   Check Project and URL in launch logs; open that URL. On port collision, choose another available port.
   Never invent unverified CLI commands or installation paths.
4. Verify the screen shows the target video. HTTP 200 or server startup logs alone do not mean completion.
   On launch/load failure, record entry point, target path, operation/command, and error.
   Keep diagnosis minimal; do not develop a replacement player.

## Check and report

- Play/stop in the existing screen; seek into intervals and verify display changes.
  Inspect start/end and intermediate 1/4, 1/2, 3/4 times. Check audio playback if audio exists.
- Report preview checked only after those actions. Record app versus existing browser, target project,
  checked times, playback/seeking/audio results, and evidence.
- Record `akari capture` frame inspection or standalone component comparison as those specific checks.
  Do not reinterpret another page's rendering match as verification of app entry, asset classification,
  loading, or playback. Explicitly mark unchecked routes/audio as unverified.
