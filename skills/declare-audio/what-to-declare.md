# What to mark in a track

Use this guidance when the person asks what to mark. They do **not** need to annotate every detail. Prioritize the items with the greatest effect.

## Priority order

| Priority | Mark | Why it matters | Guideline |
|---|---|---|---|
| 1 | **Chorus (`drop`) range** | The start of the first `drop` is the chorus cue and can be used directly as `audio.bgm.in` in `edit.json`. A single annotation here changes the way a BGM suggestion appears. | One per song, or more when it has multiple choruses. |
| 2 | **BPM and first downbeat** | They anchor beat-aligned cuts and image changes, and are used as measured values in suggestions. | Mark for every track that has a beat; verify by listening with the click. |
| 3 | Intro and outro | They indicate whether to skip the beginning or close out the ending. | Mark roughly before and after the chorus. |
| 4 | Accent hits (hit_points) | They identify beats worth matching with an image or cut change. | A sparse set is enough: roughly 1–7 per track. |
| 5 | Build, bridge, and break | They refine the structure and improve suggestions but are optional. | Add when useful. |

**Do not place pins on every beat.** In one production pass across ten songs, 1–7 accent pins per song were enough. Sections and the beat grid carry the main structure; pins supplement them.

## Quality checks for a usable declaration

- Play at least 30 seconds with the click enabled. The click should stay aligned with the track's kick. Drift in the latter half suggests a slightly wrong BPM; an offset near the beginning suggests the first downbeat is misplaced.
- Start playback at the marked chorus: it should immediately sound like the chorus. Use `選択区間をループ` ("loop selected section") to check.
- Sections are ordered in time without unintended overlap.

## When the structure is ambiguous

- **Several choruses:** Mark each as `drop`; the first is used for the cue.
- **No chorus, as in ambient audio:** Do not invent a `drop`. If there is no beat, BPM may remain empty. A declaration containing sections alone is still valid.
- **Tempo changes midway:** v0 stores one BPM for the entire track. Align it with the main part (the chorus), and note where it does not fit.
- **Variable tempo, common in generated music:** Do not aim for perfect alignment. Alignment around the chorus is sufficient.

## Be candid about automatic estimates

- Automatic BPM comes from autocorrelation of sound onsets. It can be off by about 1–2 BPM, especially with weak transients such as lo-fi or ambient music, or with variable tempo.
- It can choose double or half the true tempo, such as estimating ♩170 for a ♩85 song. A click that aligns only on every other beat is a clue; halve or double BPM and listen again.
- An unverified estimate may be saved, but label it as an estimate in the report. Keep it distinct from a value confirmed by listening, as required by hard rule 2.
