

# Analysis workflow

## Principles

Treat the source footage as evidence and `analysis.json` as an appendable ledger. Use automated observation to suggest candidates; do not fill in facts you cannot confirm. A missing key means "unobserved," not necessarily "absent." The authoritative input, output, and update rules are in the [`akari media` contract §1 / §3](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-08-29-media-inspect-cli-v0.md).

## 1. Confirm the source and requested level

Check the following first.

- The input is a readable regular file.
- `akari media probe <target>` returns JSON on exit 0 and `duration_s` is a finite positive number.
- The authoritative [analysis.schema.json](https://github.com/AkariLabs/akari-video/blob/main/packages/schemas/analysis.schema.json) is readable.
- The source's absolute path is distinguished from the relative path stored in JSON.
- The highest level requested by the user or a later skill, from L0 to L3, has been identified. Default to L0 + L1 if none is stated.

If `probe` fails, do not mark the analysis complete. Report why and where the workflow stopped.

## 2. Decide the output destination

For a source in a workspace with `.akari/`, the canonical output is `.akari/sidecars/<source-relative-path>.analysis/`, preserving its workspace-relative path.
```text
<workspace-root>/
├── assets/IMG_4606.MOV
└── .akari/sidecars/assets/IMG_4606.MOV.analysis/
    ├── analysis.json
    ├── proxy.mp4          # L2 以上で必要な場合だけ
    ├── keyframes/         # L2 で採用画像がある場合だけ
    ├── matte/             # L3 で要求された場合だけ
    └── vision/            # L3 で要求された場合だけ
```
For a standalone source with no identifiable `.akari/` workspace, use `<source-dir>/analysis/<source-stem>/`. `<source-stem>` is the filename without its final extension.

Reuse an output directory only if it refers to the same source. For a different source, append `<source-stem>-<ext>`; if that still collides, append the first eight characters of the normalized absolute path's SHA-256 hash. Apply the same rule to the final `<name>.analysis` directory in the standard AKARI layout.

Calculate `source`, `keyframes[].path`, and person-sidecar paths relative to the directory containing analysis.json. Store an absolute path only when the target cannot be represented within the same file tree.

## 3. Decide the scope with four questions

Do not add a case-type field to intake. Use these questions to request only the observations needed:

1. **Is there speech?** — Use L1 if yes or unknown. Proceed to transcription only when `speech_likely` is true.
2. **Must you select visual content?** — If you need evidence for cut decisions, cropping, B-roll selection, and screen changes, use L2.
3. **Will you use person-based effects?** — L3 only for sections that use cutouts of people, eyes, fingertips, posture, and facial expressions.
4. **Has the person already chosen a direction?** — If so, only look at the specified window. Never expand to full-length L2/L3 merely because the direction has not been decided.

If clarification is needed, ask one question: **"Should I stop after the default audio analysis (L0 + L1), or do you need visual review (L2) or person-based effects (L3)?"**


## 4. Example scopes

These examples guide scope selection; they do not define a fixed set of project types.

| Example | Guideline | Reason |
|---|---|---|
| Only subtitles | L0 + L1 | Requires utterances and time, no need to select pictures. |
| Dialogue/Radio | L0 + L1 | Understand the sound first, and add L2 only when asked to judge the picture. |
| Fifteen-second excerpt | L0 + L1 + L2 in the specified window | Check the candidate statement and its visuals; do not score every window. |
| B-roll promo | L0 + L1, then L2 if needed | Use the waveform to check for speech; add L2 only when visual selection is requested. |
| Person-based effect | L0 + L1 + required windows of L2 / L3 | Generate only the person-track types and intervals needed for the effect. |
| First pass over long footage | Start with L0 + L1 | Do not inspect every visual frame preemptively; add L2 for relevant windows once the direction is known. |
| Timeline already drafted | L0, with L1 / L2 only for needed windows | Limit observation to the cuts a person has selected. |

## 5. Run in order of levels

1. L0: `akari media probe <target>`.
2. L1: If there is audio, `akari media waveform <target>`. `akari media transcribe <target>` only when `speech_likely` is true.
3. L2: Only when requested, use `filmstrip` / `grab` to propose frames and view the images before deciding on keyframes, events, or hooks. A 720p proxy, if needed, belongs here; never create it for L0 or L1.
4. L3: Generate only the person sidecars needed for the requested effect and interval.
5. At each stopping point, validate the temporary JSON against the schema and semantic rules without deleting existing untargeted sections, then atomically write only valid results to `analysis.json`.

Within a project, each `akari media` call adds to the ledger by default. Assemble a minimal document from the stdout results outside the project. When re-executing, update only the target range without deleting or rearranging `observations[]`.

## 6. Completion report

- Source, finalized `analysis.json`, reached level, and reason for stopping.
- Each `akari media` subcommand run, its observed interval, and counts returned on stdout.
- Counts of transcript segments, keyframes, and events. Label an unobserved section "unobserved," not "zero items."
- Transcription backend and reasons for selection or fallback. For `transcript: []`, distinguish no speech, no available backend, and not observed.
- For L3, generated type, interval, processing time, and output size; otherwise state that L3 was not generated.
- Images that could not be viewed, checks not performed, and any changes to default options with their reasons.

Do not add a field outside the schema merely to record a degraded result.

## Common mistakes

- Running full-length L2 or L3 before deciding the requested scope.
- Transcribing the entire source despite `speech_likely: false`.
- Interpreting a missing key as "not applicable" rather than possibly unobserved.
- Combining several source files in one `analysis.json`.
- Deleting existing untargeted sections or `observations[]` during a repeat analysis.
- Inventing words from images when no transcript exists.
- Relying on schema validation alone and skipping `end > start` or referenced-file checks.
