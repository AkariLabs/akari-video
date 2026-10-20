# Analysis collection and integration workflow

## Principle

Separate per-asset observation from editing decisions across assets. Each analysis covers only its own asset; only the integration agent compares thumbnails, direction, cuts, and asset plans.

Do not read all of `edit.json` / `captions.json`; grep by id and read only matching lines ([how to read edit.json](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/edit-json-access.md)). Write by targeted edit or the edit-store script API.

## 1. Fix inputs and output location

List asset paths, existing `analysis.json` files, and the requested output location. If none is specified, propose `edit-plan/` directly under the assets' shared project directory and explain the choice in the completion report. Do not mix in reports or `decision-log.md` from another project.

Use this standard output structure (2026-07-22 revision: do not generate `editing-report.html`. The analysis report is `analysis-report.html`, created by [analyze-project](../analyze-project/SKILL.md) directly under the project; edit-plan reads it).

```text
<plan-dir>/
├── decision-log.md            # analyze-project と共有・追記専用（判断記録）
├── edit.json                  # collaborative では実行承認後・それ以外は出力ルールで書く
└── overlays/                  # collaborative では実行承認後・それ以外は出力ルールで書く
```

`decision-log.md` is shared with analyze-project and is append-only. Write `edit.json` and `overlays/` after execution approval in collaborative mode; in other modes, follow the output rules.

Place the derived decision-record rendering at `<project>/.akari/reports/decision-log-report.html` (the project-structure-v0 report layer; [report-guide §decision_log](report-guide.md#decision_log)).

Place originals of generated stills and other assets in `<project>/assets/generated/` (under project-root `assets/`, outside `<plan-dir>/`). This 2026-08-12 revision brings them within the asset panel's scope. It replaces `<plan-dir>/generated/` for new assets; do not move existing projects' `<plan-dir>/generated/`. Keep provenance re-verifiable. Use analyze-project's read-only, self-contained HTML analysis report as evidence for the direction and asset plan. Always generate inside the project; do not write to paths outside it.

## Cut candidate bridge after Checkpoint 1

Copy the human-approved semantic keep order from Checkpoint 1 to the dedicated derived input `.akari/work/semantic-keep-plan.json`. This is neither `edit.json` nor a new editing SSOT. v0 uses one source and `id:null`; v1 uses unique string ids. Record `explicit` or `full_source` ranges, with `occurrences[]` order as output order. Do not invent speed, track, or timeline `at`.

Call the following helper directly from the resolved edit-plan skill.

```sh
node <resolved-edit-plan-skill>/bin/propose-cut-candidates.mjs \
  --project <project-root> \
  --keep-plan .akari/work/semantic-keep-plan.json \
  --decision-log edit-plan/decision-log.md \
  --approval-ref checkpoint-1/<subject>/<yyyy-mm-dd> [--write]
```

Without `--write`, print the canonical report to stdout. `--write` preserves identical stdout bytes and places a content-addressed copy at `.akari/reports/cut-candidates/<sha256>.json`. There is no `--apply`. Every `semantic_event_review` and `pause_shortening_review` in the report is `REVIEW_REQUIRED`; 0.10 / 0.166667 / 0.30-second classifications are evidence-backed candidates, not acceptance decisions.

Present the report and confirm keep/drop for each candidate, classification corrections, information retention, and waits for UI actions. Separately append accept/reject decisions to append-only `decision-log.md` based on explicit human answers. Helper success, report existence, and earlier blanket approvals do not constitute Checkpoint 3. Even for a version with candidates applied after Checkpoint 3, do not advance to completion until a human checks `POST_CUT_ASR_REVIEW`, `POST_CUT_INFORMATION_RETENTION`, `POST_CUT_UI_TIMING_REVIEW`, and `POST_CUT_AUDIO_BOUNDARY_REVIEW` from [execution.md](execution.md) in the same version and explicitly approves `HUMAN_APPLY_GATE`.

## 2. Branch by media availability

### When recorded footage exists

For each asset, search for existing analysis in this order.

1. User-specified `analysis.json`
2. `<source-dir>/analysis/<source-stem>/analysis.json`
3. `<source-dir>/analysis/analysis.json` only when the directory is confirmed to be dedicated to that asset

Resolve relative `source`, `keyframes[].path`, and `tracks.person_matte` against the directory containing each `analysis.json`. Do not re-resolve those strings relative to the analysis report or `decision-log.md`.

For assets without valid analysis, run `analyze-footage` with one subagent per asset. For multiple assets, assign them concurrently to available subagents and then wait for all. Give each request the source's absolute path, repository root, and [analyze-footage](../analyze-footage/SKILL.md); do not let it edit other assets or shared outputs. If switching to sequential execution, report why.

When reusing analysis, verify that `source` refers to the target asset. The v0 schema lacks hashes and analysis times for freshness checks; do not guess freshness. If an asset may have changed, reanalyze it or show the difference to the human.

### When there is no media

Do not invent `analysis.json`. Use a "research → script → generation plan" mode; present the absence of recorded media, evidence used, and script version in chat and record them in `decision-log.md` (analyze-project assumes asset analysis.json and is not used in this zero-media branch). Once structural beats are decided, proceed to [generate-video's still.md](../generate-video/still.md) and create placeholders with text cards or stills; when the still itself should be AI-generated, use [generate-image](../generate-image/SKILL.md) first. A placeholder is a still media item on the edit.json v2 timeline plus `<path>.meta.json` beside the asset; cuts hold its duration. Stills may remain the final result. Send only clips needing motion to [generate-video's video.md](../generate-video/video.md). If generation yields multiple clips, apply the source-structure rules in [execution.md](execution.md) §1 at execution.

## 3. Validate each analysis.json

Validate against [analysis.schema.json](https://github.com/AkariLabs/akari-video/blob/main/packages/schemas/analysis.schema.json) with a Draft 2020-12-capable validator. Do not install a validator over the network without permission. Also check:

- `source` and every keyframe path resolve.
- Every interval has `end > start`, with times within source duration.
- Face boxes satisfy `x + width <= 1` and `y + height <= 1`.
- Speaker IDs in transcripts, events, and tracks are consistent.
- The analysis agent's report distinguishes whether `transcript: []` means no speech or transcription not obtained.

Do not silently repair and integrate invalid analysis. Explain the tradeoffs of reanalysis, excluding the asset, or limited use with insufficient evidence, and append the human's choice to `decision-log.md`.

## 4. Build a cross-asset evidence index

Build a table relating asset ID, source path, duration, transcript intervals, keyframes, and events. Assign stable IDs usable from chat and `decision-log.md`, making each evidence citation unambiguous.

For each source, create keep/drop cut candidates with supporting events. Do not create `edit.json` yet. Include the order of multiple assets on one timeline in direction approval.

## 5. Advance through checkpoints

The stage sequence is unchanged, but at each stage read the analyze-project analysis report and present evidence in chat instead of updating a report (see [report-guide.md](report-guide.md)).

Before preparing the Checkpoint 1 presentation, check `~/.akari/recipes/` (`workflow: "edit"`) using [recipe.md](recipe.md)'s recall procedure. If found, include a sourced recommendation without overriding this direction; adoption requires an explicit human declaration.

1. Present thumbnail ideas, edit direction, and cut proposals in chat; stop at Checkpoint 1 (direction).
2. Present the asset plan (three-way BGM/caption/SFX/B-roll choices) and still preview in chat according to the approved direction; stop at Checkpoint 2 (asset plan).
3. Present output specifications, source-structure choice (v1 multi-source / v0 single source / conform to an intermediate master), and the execution list for generation, conform, and overlays; stop at Checkpoint 3 (execution).
4. Create `edit.json` and final overlays only after approval. As completion work, check [recipe.md](recipe.md)'s freeze procedure and offer to save a recipe once (offer-once) if this project has not received that offer.

Append approval details and revisions for every checkpoint to `decision-log.md` (never change or delete existing rows; add new rows at the end). Record the cut-decision list (asset ID, source start/end, keep/drop, supporting event, reason) and asset-plan three-way choices (propose if available / generate if absent / do not use) under the relevant `decision-log.md` category (`cut`/`material`) as primary evidence when generating `edit.json`.

## 6. Output-location details

Place ad hoc validation scripts and temporary comparisons or experimental outputs for integrated decisions under `.akari/work/`, not directly in the project root or `<plan-dir>/` ([project-structure-v0 contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-25-project-structure-v0.md) §1). Put disposable intermediates in `.akari/work/tmp/`; put plans, generators, hand-edited files, and other irreplaceable work in `.akari/work/keep/`. Formal output locations for `decision-log.md`, `edit.json`, `overlays/`, etc. (§1) remain unchanged. Originals of generated stills and similar assets go in `<project>/assets/generated/` (2026-08-12 revision; see §1).

## Common mistakes

- Assigning multiple assets to one subagent and losing per-asset evidence boundaries.
- Opening paths relative to `analysis.json` as though they were relative to the analysis report or `decision-log.md`.
- Treating `transcript: []` as proof of silence.
- Inventing analysis events when there is no media.
- Creating `edit.json` or final overlays before presenting the plan in chat.
- Building a direction without reading the analyze-project analysis report, resulting in unsupported recommendations.
