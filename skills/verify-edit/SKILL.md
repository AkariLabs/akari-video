---
name: verify-edit
description: "Verify edit.json and optional analysis.json / captions.json / media with a deterministic CLI, then finish QA with frame inspection and reporting after PASS. Use immediately after writing or modifying edit.json, before export, and after applying review feedback.（旧名: edit-lint）"
---

# Lint edits and close QA

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

## Hard rules

1. **Deterministic**: Same input → same output. No LLM judgment, randomness, or current time in verdicts
   (`checked_at` may be recorded but not used for judgments).
2. **Zero external npm dependencies**. Invoke ffmpeg / ffprobe **directly**, never through wrapper libraries.
3. **Write only `.akari/lint.json` and `.akari/reports/`**. Never auto-fix edit.json;
   fixes are human/agent edits visible in git diff.
4. **No network** (fully local; headless-first invariant means no app required).
5. **Do not copy external candidates' code** (loudcheck, etc., are design references only).
   Regardless of survey copy conditions, this CLI is wholly original, consistent with zero dependencies.
6. **Missing analysis.json / captions.json / `.akari/intake.json` is not an error**: report skipped.
   Runs at every project maturity level.
7. **Default execution without `--media` does not decode media**, preserving speed for startup/CI use.
8. **Never put inspection keyframes, QA outputs, or ad-hoc temporary verification scripts directly in the project root.**
   Put the former in `.akari/reports/`, the latter in `.akari/work/`
   ([project-structure-v0 contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-25-project-structure-v0.md) §1, Japanese).
   Within `.akari/work/`, use `tmp/` for disposable files and `keep/` for irreplaceable ones.

## Procedure

### Resolve executables

First run `akari doctor --json`. Use `edit_lint.path` as `<edit-lint>` and
`cli.node.exec_path` as the node executable.
If `cli.node.runtime` is `electron`, include `cli.node.required_env` (`ELECTRON_RUN_AS_NODE=1`)
using `cli.node.invocation.sh` / `.cmd`; omitting it launches the GUI app.
`cli.node.electron_run_as_node` reflects only the diagnostic environment; do not use it to judge availability.
On older versions without `runtime`, treat an `exec_path` filename other than `node` / `node.exe` as Electron
and likewise set `ELECTRON_RUN_AS_NODE=1`. If these fields are absent, use the search below.

`ls` the following 3 forms top to bottom and use the first existing `<edit-lint>`:

| Form | macOS | Windows |
|---|---|---|
| (a) Desktop app bundle | `<App>/Contents/Resources/packages/edit-lint/bin/edit-lint.mjs` (default `<App>`: `/Applications/AKARI Video.app`) | `<install dir>\resources\packages\edit-lint\bin\edit-lint.mjs` |
| (b) `install.sh` installation | `~/.akari/app/packages/edit-lint/bin/edit-lint.mjs` | `%USERPROFILE%\.akari\app\packages\edit-lint\bin\edit-lint.mjs` |
| (c) Monorepo | `<repo>/packages/edit-lint/bin/edit-lint.mjs` | `<repo>\packages\edit-lint\bin\edit-lint.mjs` |

Users with only desktop app (a) have no `~/.akari/app`.

Node resolution: `AKARI_NODE_BIN` → PATH node (20+) → bundled Electron as node with
`ELECTRON_RUN_AS_NODE=1`. Below, `node` means the resolved executable and `<edit-lint>` the resolved script path.

Do not Read all of `edit.json` / `captions.json`; grep by ID and read matching lines only ([Reading edit.json](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/edit-json-access.md)).
Write through relevant-line Edit or edit-store's script API.

1. Immediately after saving edit.json, run:

   ```sh
   node <edit-lint> <project-root|edit.json>
   ```

   Resolve edit.json relative paths against the nearest ancestor with `.akari/`, or edit.json's directory if none.
   `akari capture --edit` uses the same base.

2. Check exit code and `<project>/.akari/lint.json`: `0` PASS, `1` FAIL, `2` input/environment error.
3. On FAIL, read `findings[]` top-down; fix indicated edit.json, referenced files, overlay HTML, captions.json
   with relevant-line Edit or edit-store's script API. Do not let the CLI auto-fix.
4. Rerun until no error findings and `verdict: "pass"`. Check `skipped[]` for inspections lacking analysis.json/captions.json.
5. Before export, rerun with `--engine gpu` or `--engine osr` according to the output engine.
   If export auto-selects, use `--engine auto`; engine compatibility must also PASS.
6. After PASS, follow [Launch and check the existing preview](preview.md) to open target `edit.json` and verify
   playback, seeking, and audio if present. Do not build a dedicated player. Report the checked entry point and
   unverified items. Then visually inspect cut boundaries and overlay start/end frames.
   **Also inspect intermediate times at 1/4, 1/2, and 3/4 of every interval**: exact beats/cut boundaries hit interval
   extremes (0% / 100% = off-screen / opacity 0), risking misdiagnosis of normal motion.
   `akari capture --auto` deterministically derives representative times including overlay/caption midpoints.
   Mechanical PASS does not replace semantic quality checks.
7. Reflect `<project>/.akari/reports/edit-lint-report.html` and frame-inspection results in the editing report;
   close checkpoint state/provenance according to actual results.

Add `--media` only when checking audio too. Silence/loudness values default to warnings;
only checks with these explicit thresholds can cause FAIL:

```sh
node <edit-lint> <project> --media
node <edit-lint> <project> --media --silence-error-seconds 2 --max-volume-error-db -0.1
```

For machine-readable stdout, add `--json`, e.g., `node <edit-lint> <project> --json`.
`.akari/lint.json` is always canonical; HTML is visualization only.

If `.akari/intake.json` exists (workflow-form storage; contract `packages/schemas/intake.schema.json`),
validate schema and consistency: unknown task IDs, simultaneous `duration_s`/`keep_length`,
`status: submitted` without `submitted_at`, etc. Invalid values are errors (FAIL);
`status: "draft"` (workflow undecided) is only a warning.
`decision-log.predict-missing` (warning): an item added in suggestions/direct mode lacks a `machine:director`
prediction row in `decision-log.md`.

## Outside scope and possible extensions

Black frames, freezes, beats, scenes, flash frames, gaps, duplicate clips, offline media, safe zones,
and frame-rate mismatches are future candidates; do not add guessed current PASS conditions.

## Music-grid checks (only with declarations)

Only when a declaration matching `audio.bgm.path` exists, build the timeline-seconds grid with
`musicGrid` from `packages/audio-library-setup/shared/beat-grid.mjs` and compare `audio.sfx[].t`.
Declaration resolution matches `suggest-bgm` / `beat-grid`:
`--declarations` → environment `AKARI_SOUNDS_DECLARATIONS` → `<ライブラリ>/declarations.json`
(existing library placeholder).

- `audio.sfx.music-grid` (warning): Warn if the difference from the truly nearest grid point, regardless of kind,
  exceeds ±0.12 seconds. Only on equal distance, prioritize hit > bar start > beat.
  Off-beat staging is valid, so this is not an error.
- `audio.sfx.music-grid-seam` (warning): Warn for SE firing within ±0.3 seconds of a BGM end-to-start loop seam.

Quietly skip if declarations/`audio.bgm` are absent, `audio.sfx` is empty, or ffprobe cannot obtain actual BGM duration.
Record reasons in `skipped[]`, without warnings. Declarations are optional; this differs from automatic media beat detection.

## Public contracts

Inspect edit.json fields defined by these public contracts. Do not infer checks for undeclared fields.
Contracted checks (structure, unique IDs, ranges, reference consistency) are already implemented.

- [edit.json v0](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-13-m1-m4.md) (Japanese)
- [Multi-source `sources[]` / `cuts[].src`](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-18-edit-json-v1-sources.md) (Japanese)
  — required `version: 1` form, mutual exclusion of `source`/`sources[]`, unique `sources[].id`, consistent `cuts[].src` references
- [Narration `audio.narration[]`](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-20-edit-json-v1-narration.md) (Japanese)
  — ID form/uniqueness, `t` timeline coordinates, `gain_db` range, provenance/credit
- [Highlight markers `beats[]`](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-22-edit-json-v1-beats.md) (Japanese)
  — id, `t` (source seconds), `kind`, `strength`, consistent `src` references (`src` is v1 only)
- [Direction declarations `direction`](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-23-edit-json-v1-direction.md) (Japanese)
  — required `preset`, `intensity` range, `overrides` type
- [Word-level direction `emphasis_words[]`](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-23-edit-json-v1-emphasis-words.md) (Japanese)
  — ID form/uniqueness, `t_end > t_start` (source seconds), consistent `src` references (`src` is v1 only)
- [Captions and cut editing](https://github.com/AkariLabs/akari-video/blob/main/docs/notes-2026-07-14-captions-and-cut-editing.md) (Japanese)
- [QA lint direction](https://github.com/AkariLabs/akari-video/blob/main/docs/notes-2026-07-16-qa-lint-and-transcript-ui.md) (Japanese)
- Canonical field-level engine compatibility:
  [`packages/schemas/engine-capabilities.json`](https://github.com/AkariLabs/akari-video/blob/main/packages/schemas/engine-capabilities.json).
  `--engine gpu|osr|auto` checks `ignored` / `partial` / missing compatibility-table entries.
