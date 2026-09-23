# issue #80 — v2 narration ducking: before / after

Scratch project: one visual track, `a1` with one `role: "narration"` item (no `provenance`),
`a2` with one `role: "bgm"` item (`gain_db: -6`, `ducking: true`). fps 30. Media are synthetic
tones (narration 1 kHz, BGM 220 Hz) so the BGM level can be read with a narrow band-pass.

- `edit-overlap.json` — the reported layout with the BGM moved to `at: 0` so both items overlap.
  Real export (OSR, launcher tier 2). BGM is ducked by 12.1 dB inside the narration window
  both before and after the fix (default `duck_db` -12). Before: `speech_intervals: 0`.
  After: `speech_intervals: 1`. Audio output is identical before / after.
- `edit-reported-layout.json` — the reported timing (narration at 5 / 173 frames, BGM at 969 / 786 frames).
  The two items never overlap, so no ducking is expected. Before: `speech_intervals: 0`,
  `ducked_items: []`, no warning (matches the report). After: `speech_intervals: 1`, `ducked_items: []`,
  and a warning that the duck key intervals do not overlap the BGM clip.
- `edit-no-key.json` — `duck_keys: ["narration"]` with the narration muted. After: warning that no
  duck key intervals are available.
- `edit-no-ducking-overlap.json` — the reporter's shape: the BGM item has **no `ducking` property**
  (the default is `false`), and it overlaps the narration. Before and after the fix the envelope is
  `speech_intervals: 0`, `ducked_items: []` — exactly the envelope in the report — and the BGM is not
  ducked (real export: 220 Hz band -36.2 dB under the narration vs -36.1 dB alone). The audio mix
  command is identical before / after. After: export and preview warn that the BGM overlaps the duck
  key intervals but ducking is not enabled. `"ducking": false` or a non-overlapping BGM stays quiet.

Note: the first three fixtures added `"ducking": true` to the BGM, which the report's JSON does not have.

Numbers are in `before-after.json`. The preview schedule (`buildWebAudioSchedule`) returns the same
duck interval as the export and now emits the same warnings.
