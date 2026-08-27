# @akari-video/edit-lint

`edit-lint` validates an AKARI Video `edit.json` project and writes the canonical result to
`.akari/lint.json` plus a human-readable report under `.akari/reports/`.

```sh
node packages/edit-lint/bin/edit-lint.mjs <project-root|edit.json> [--json]
```

Exit code `0` means PASS, `1` means lint findings include an error, and `2` means the lint command
could not run.

## Media checks (`--media`)

Media decoding is opt-in. Without `--media`, edit-lint does not probe or decode media for these
checks and records `media checks require --media` in `skipped[]`.

```sh
node packages/edit-lint/bin/edit-lint.mjs <project-root> --media --json
```

With `--media`, edit-lint inspects every `sources[]` entry referenced by a visual or audio media
item. Each source is probed once, and media finding paths include the source ID.

- `media.silence`: detects audio intervals at or below -50 dB for at least 0.5 seconds. Findings are
  warnings unless `--silence-error-seconds` promotes long intervals to errors.
- `media.volume`: reports mean and maximum volume. Findings are warnings unless
  `--max-volume-error-db` promotes an over-limit maximum to an error.
- `media.audio-shorter-than-out`: warns for each visual media item whose effective source `out`
  exceeds that source's audio-stream duration. The message includes the missing duration.
- `media.caption-silence-coverage`: warns when more than 30% of caption display time overlaps a
  silence interval of at least one second. `--caption-silence-warn-percent` changes the threshold.
- `audio.narration.trim`: warns when a narration media item's `in` is at or beyond its audio-stream
  duration. Invalid or reversed narration `in`/`out` values are errors even without `--media`.

Silence and volume checks are skipped for a source without an audio stream or when ffprobe cannot
inspect it. Duration-dependent checks are skipped when the audio-stream duration is unavailable.
Caption/silence coverage runs only when the captions can be associated with exactly one referenced
visual source: either every caption declares the same `src`, or the timeline references a single
visual source and captions do not contradict it. Missing, empty, or multi-source/ambiguous captions
are skipped with a reason.

`timeline.items.order` is a default-path warning when a track's `items[]` are not stored in
non-decreasing `at` order. It does not change the render meaning or fail lint.
