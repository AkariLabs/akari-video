

# still → video → resume

## End-to-end sequence

1. Create still-image placeholders with `akari generate still <projectDir> --spec <beats.json>`. Use `--placeholder` when the visual is undecided.
2. Review timing, order, and whether the stills already work as finished images on the timeline.
3. Choose one clip to animate. Run `akari generate video <projectDir> --item <itemId> --dry-run --json` to inspect the outgoing request, duration rounding, estimate, and external transfer.
4. Add `--yes` to the same command only after cost approval.
5. Confirm that the CLI saved the `job` and `status: "generating"` metadata before sending the request.
6. On success, replace that item's source with video. On failure, retain the still image.

## Resume an existing job

After a process exits or the connection drops, retrieve the job by its saved request ID. Do not silently start a new one.
```sh
akari generate resume <projectDir> --item <itemId> --json
```
Omit `--item` to check all items with generation jobs.

A job is stale when it still has `status: "generating"` after `stale_after_s` seconds from `started_at` (900 seconds by default). The UI shows `応答なし・再取得` ("no response / retrieve again"). Stale does not mean failed: use resume to query the existing provider job first.

## Status and appearance

- `planned`: Show a text card with a small planned badge. Export the text card itself.
- `generating`: Show progress over the still image. Export the still image while generation continues.
- stale: Show the UI label `応答なし` ("no response") and continue exporting the still image.
- `failed`: Show the failure, retain the original still, and record the reason in history.
- `done`: Replace the still with video and return to the normal display.

The upper-left badge, bottom strip, dotted outline, and progress indicator appear only while editing. They disappear entirely on export (0 px). A failed or unresponsive job leaves the still clip in place, preserving the timeline and export.
