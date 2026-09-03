# @akari-video/edit-lint

`edit-lint` validates an AKARI Video `edit.json` project and writes the canonical result to
`.akari/lint.json` plus a human-readable report under `.akari/reports/`.

```sh
node packages/edit-lint/bin/edit-lint.mjs <project-root|edit.json> [--json]
```

Exit code `0` means PASS, `1` means lint findings include an error, and `2` means the lint command
could not run.

## Overlay fragment checks

- `overlays.html-root`: errors unless a referenced overlay HTML fragment has exactly one balanced
  root element.
- `overlays.data-attributes`: errors when a fragment root's `data-start` or `data-duration` does not
  match `edit.json`.
- `overlays.root-data-attributes`: warns whenever a fragment root declares `data-start` or
  `data-duration`; `edit.json` is the source of truth, and animation delays inside a fragment use
  local seconds starting at clip time 0.

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

## Engine compatibility (`--engine`)

Before export, check v2 projects against the selected renderer. Use `auto` when engine selection is
also automatic.

```sh
node packages/edit-lint/bin/edit-lint.mjs <project-root> --engine gpu
node packages/edit-lint/bin/edit-lint.mjs <project-root> --engine auto
```

The field-level source of truth is
[`packages/schemas/engine-capabilities.json`](../schemas/engine-capabilities.json). Its statuses mean:

- `consumed`: the selected engine consumes the field.
- `partial`: support is approximate or limited; `engine.partial-field` emits a warning.
- `ignored`: the field is not rendered; `engine.unsupported-field` emits an error.
- `other-subsystem`: a subsystem outside the visual engine consumes the field.

If a canonical field has no matching row for an item's projection, `engine.capability-unknown` emits
a warning so table drift is visible. With `--engine auto`, identical GPU and OSR conclusions are
collapsed under a `gpu/osr:` prefix; different conclusions are reported separately.

```text
engine.unsupported-field [error] gpu/osr: tracks[].items[].perspective is not consumed
  (tracks[0].items[1]; it will not affect rendering). hint: move it to the layers path or remove it
```

Without `--engine`, the capability table is not read and the default findings, skipped checks, and
`.akari/lint.json` remain on the existing compatibility path.
