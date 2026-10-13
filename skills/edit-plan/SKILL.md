---
name: edit-plan
description: Read the analyze-project analysis report (interpretation.json and analysis-report.html) as primary evidence, obtain explicit chat approval for direction, asset planning, and execution, then produce edit.json and overlay HTML. Use for multi-asset edit planning, planning from no media through question dialogue and a provisional plan.json timeline, or choosing cuts, BGM, SFX, and B-roll from analysis.
---

# Integrate editing decisions

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

Read lang/<content-language>.md for language-specific rules (content language: --lang → intake.json "language" → transcript language → ja; see https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-10-11-content-language.md). If that file does not exist, read lang/en.md.
For report, decision-record, and approval-prompt writing, read the section in the user's language pack, regardless of the content language; if that pack does not exist, read lang/en.md.

> **2026-07-22 revision**: This skill no longer generates the editing decision report (fixed six-chapter HTML plus decision cards). The only formal report is the analysis report produced by [analyze-project](../analyze-project/SKILL.md); develop the direction in chat. See the opening of [report-guide.md](report-guide.md) for details and the reason for the change.

> **edit.json v2 vocabulary**: The v2 top level is exact: do not write fields other than `version` / `output` / `sources` / `tracks` / `audio` / `captions` / `thumbnail`. Do not write `beats` / `emphasis_words` / `direction` into v2 `edit.json`. Write word-level emphasis to `emphasis_words[]` at the object root of the caption SSOT, `captions.json`.

## Output rules for every mode

- Before showing the result, read [launching and checking the existing preview](../edit-lint/preview.md). Use the existing feature; do not build project-specific playback HTML, a playback UI, or audio synchronization (unless the user explicitly requests a standalone page). State the preview entry point you checked in the report.

- Base decisions on validated `analysis.json`; do not invent transcripts, frames, assets, or approvals without evidence.
- Record decisions in `decision-log.md`. For a new file, use the exact table header for the user's language; when appending to an existing file, keep its header language. Write decision and reason cells in the user's language (see [report-guide §decision_log](report-guide.md#decision_log)). Never change or delete existing rows; always append. The read-only HTML decision-record report derived from `decision-log.md` is a copy of the record without a decision UI and is no exception.
- Save still images as generated assets and include them with provenance in the report. Run i2v, avatar, and other video generation only after the corresponding still is on the timeline (for paid work, see [autonomy.md](autonomy.md) §4).
- **Save generated assets in `<project>/assets/generated/` (covered by the asset panel; revised 2026-08-12)**. Do not put them outside the project or under `<plan-dir>/`. Generate only within the project (technical enforcement is out of scope; this is a stated rule).
- Attach `<file>.meta.json` to generated assets so their origin can be reverified, recording `provenance.origin` and `provenance.generator`.
- **Place still images directly on the timeline**: put png / jpg / webp / bmp / gif images in visual-lane `items[]` as media clips (see [execution.md](execution.md), "Handling still assets"). Do not concatenate stills into a single video with ffmpeg merely to sequence them: that loses per-image editability and breaks the `edit.json` SSOT.
- Before paid or heavy generation, declare the method, reason, alternatives, and impact. Wait for an answer only for paid generation or external transmission; for free local generation, write the declaration to `decision-log.md` and proceed (in `collaborative` mode, continue to wait for an answer). Consider Codex image generation first, then Akari Cloud. Do not call OpenAI, Gemini, or similar API keys directly.
- Write **only v2 (`sources[]` + `tracks[].items[]`)** to `edit.json`. Represent lanes with `lane` and array order, and clip content with `source.kind`. Do not create the old `cuts` / `layers` / `overlays` keys. Add only fields defined by the public v2 contract.
- Use the highlight markers derived under [beats.md](beats.md) for analysis and decisions, but do not write `beats` into v2 `edit.json`.
- Derive word-level emphasis under [emphasis-detection.md](emphasis-detection.md) and write it to `emphasis_words[]` at the object root of `captions.json`. Do not write it into v2 `edit.json`.
- Use the [overlay-authoring](../overlay-authoring/SKILL.md) skill for final overlays. If it is unavailable, do not skip the rules: use the authoring rules in [CLAUDE.md](https://github.com/AkariLabs/akari-video/blob/main/CLAUDE.md) as canonical and record that choice.
- Use OpenMontage only as a reference for structural patterns. Do not copy AGPL text or code.

## Approval rules (only when autonomy is collaborative / Japanese UI: `一緒に作る`)

- **Use the analyze-project analysis report as primary evidence for editing decisions**. edit-plan itself must not generate a new decision HTML report. Decide the direction (thumbnail ideas, cut intensity, caption policy, chapter structure, etc.) in chat and record decisions in `decision-log.md`. Never change or delete existing rows; always append. The read-only HTML decision-record report derived from `decision-log.md` ([report-guide §decision_log](report-guide.md#decision_log)) is a copy without a decision UI and is no exception.
- **Stop at each direction → asset plan → execution checkpoint**. Do not treat inaction, a timeout, or blanket approval from an earlier occasion as approval now.
- After explicit approval of semantic keep/drop at Checkpoint 1, use the cut candidate bridge in [workflow.md](workflow.md) only if pause candidates are needed. Every bridge candidate is `REVIEW_REQUIRED`; it only creates a report with `approved_to_apply:false`. Do not automatically update `edit.json` or `decision-log.md`, and stop after candidate review until Checkpoint 3 execution approval. After application, do not call the work complete until a human has checked post-cut ASR, information retention, UI timing, and audio boundaries from [execution.md](execution.md) in the same version and explicitly approved `HUMAN_APPLY_GATE`.

## Execution order and contents

0. Read [autonomy.md](autonomy.md) and choose the mode from the workspace akari.md and `.akari/intake.json`. For `full-auto` ("as requested"; Japanese UI label `そのまま`) and `checkpoint` ("with suggestions"; default; Japanese UI label `提案つき`), follow autonomy.md; do not read approval steps 1–11 below. Only `collaborative` ("create together"; Japanese UI label `一緒に作る`) starts at step 1.
1. Read [workflow.md](workflow.md) to choose the analysis collection, parallel execution, and integration mode. When footage exists, read the [analyze-project](../analyze-project/SKILL.md) analysis report as primary evidence (request its creation first if absent). When there is no media, read [plan-json.md](plan-json.md) now and first complete the question dialogue → `plan.json` provisional timeline ([contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-20-plan-json-v0.md)).
2. Read [report-guide.md](report-guide.md) and build a recommended direction and alternatives for thumbnail ideas, cut intensity, caption policy, and chapter structure from the analysis evidence. Before presenting the direction, run [recipe.md](recipe.md)'s recall procedure on `~/.akari/recipes/` (`workflow: "edit"`) and include any recommendation with its source; it must not override this request. As part of that same step before presenting the direction, also check the `memory` declaration in `.akari/connections.json` ([contract-2026-07-25-memory-connection-v0.md](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-25-memory-connection-v0.md)). If present, start at `entry` (default `INDEX.md`), read only the `include`/`exclude` scope, and record referenced paths as provenance in `decision-log.md`. Full-text injection is forbidden. If absent, do nothing; this is not an error.
3. Present the direction in chat to the human, showing the recommendation, alternatives, reasons, and tradeoffs. Do not leave the decision at "What would you like?" Obtain explicit approval or revision instructions and append the settled decision to `decision-log.md`.
4. Read [approvals-and-generation.md](approvals-and-generation.md) and apply generation declarations, provenance, and three-stage approval. Do not execute the edit at Checkpoint 1 until explicit chat approval arrives.
5. If considering silence reduction after Checkpoint 1 approval, build the dedicated keep plan from [workflow.md](workflow.md) and present a review-only report with `bin/propose-cut-candidates.mjs`. Confirm candidate acceptance, rejection, and classification changes in chat, then append to `decision-log.md` based on human approval. Do not let the helper append records itself.

Do not read all of `edit.json` / `captions.json`; grep by id and read only matching lines ([how to read edit.json](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/edit-json-access.md)). Write with a targeted edit or the edit-store script API.

6. Only after Checkpoint 3 execution approval, read [execution.md](execution.md), create v2 `edit.json` and overlay HTML, and validate them. As completion work, check the freeze procedure in [recipe.md](recipe.md) and offer to save a recipe once (offer-once) if this project has not already received that offer.
7. When deriving highlight markers, read [beats.md](beats.md) and derive candidates from `analysis.json` events / transcript. Do not write them to v2 `edit.json`; leave the mapping and evidence in the decision record.
8. When connecting approved highlights to effects, read [beat-sync.md](beat-sync.md) and build audio-lane media clips under its projection, SFX trigger, chapter-turn snap, density guardrail, and default SFX rules.
9. When choosing an expressive means for each scene, read [expression-selection.md](expression-selection.md) and follow its meaning-to-means mapping, the hard filter from the effect card's `allowed_means`, catalog search (`when_to_use` / `tags` and license check), and evidence-recording rules. This selects candidates; the asset-plan approval gate still applies.
10. When creating word-level emphasis, read [emphasis-detection.md](emphasis-detection.md), derive candidates from `analysis.json` `transcript[].words`, and write them to `emphasis_words[]` at the object root of `captions.json`. Do not write them into v2 `edit.json`; record target tier, highlight linkage, density, and evidence in the decision record.
11. When asked to insert a person or character (avatar), read [avatar-resolution.md](avatar-resolution.md) and follow staged L0/L1/L2 reading, rendition resolution, decision cards, and recording.

Read only the leaf needed for the current stage. Do not execute later stages ahead of time.
