---
name: analyze-project
description: Read project assets (analysis.json) together with surrounding context (intake.json, edit.json, planning/, README, and past projects), create the interpretation layer interpretation.json, and render a read-only analysis report limited to facts and readings of the material. Use to understand a multi-asset project across sources, integrate completed analyze-footage results, or identify missing primary information for interviews before choosing a direction. plan-edit reads this output before deciding direction.
---

# Analyze a project

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

Do not Read all of `edit.json` / `captions.json`; grep by ID and read only matching lines ([Reading edit.json](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/edit-json-access.md)).
In other stages that need writes, Edit the relevant lines or use edit-store's script API.

## Recommend a playbook after source material arrives

Only immediately after new material is placed, read `.akari/intake.json` and existing `analysis.json`
records for speakers, duration, orientation, and media kinds, then run `akari playbook list --json`.
Compare `category`, `tags.form`, `tags.length`, `tags.materials`, and `requires` to the observed material.
Offer at most three ranked matches in chat, with a specific reason and any missing required tool for each.
Portrait material with a target at or below 60 seconds favors vertical explainers or short dramas;
talking head plus screen capture favors an explainer; music-led material favors an MV.
Point to an existing review sheet or to `.akari/reports/playbook-apply.html` as the sheet produced on
application. Do not apply a playbook until the user selects one. Do not repeat this recommendation later
in the analysis workflow.

## Hard rules

- **Do not rerun pass 1.** Delegate per-asset fact extraction (heavy processing such as STT/frame analysis) to existing
  [analyze-footage](../analyze-footage/SKILL.md) analysis.json files. Run only for missing assets, 1 asset = 1 execution.
  Use existing analysis.json without modifying it.
- **Display absent ledger chapters as “unobserved”.** Do not imply they did not exist or fill them by inference
  from assets/other chapters. Keep those report chapters visible and marked unobserved; use `observations[]`
  execution history as evidence when present.
- **Do not rewatch footage in pass 2.** Limit it to text reasoning over pass-1 outputs (transcript, keyframe notes, events).
  Return to footage only at pinpointed locations pass 2 determines are necessary.
- **Pass-2 inputs are not limited to analysis.json files.** Read surrounding project context (intake.json,
  `planning/`, README, and referenced past projects), and grep edit.json by ID to read relevant lines only.
  Field validation (internal multiasset-dogfood run, 2026-07-22) confirmed cases where analysis.json alone
  could not establish asset provenance (orphan/unclear, etc.) confidently.
- **Include `memory` connections when reading surrounding project context.** If `.akari/connections.json`
  declares `memory` ([contract-2026-07-25-memory-connection-v0.md](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-25-memory-connection-v0.md), Japanese),
  start at `entry` (default `INDEX.md`) and read only the `include`/`exclude` scope.
  Record referenced file paths as sources in `interpretation.json`'s `inputs.context`. Full-text ingestion is forbidden.
  Do nothing if undeclared; this is not an error.
- **Every interpretation claim requires evidence**: all `assets[].summary`/`role`/`relations`/`flags` and `arc[]`.
  Evidence is limited to quoted transcript ranges or keyframe-note references. Fabricate nothing.
  Do not write unsupported claims; send remaining gaps to open_questions.
- **open_questions are interview questions only.** Do not ask users to make decisions. Ask only for primary information
  absent from both footage and the internet. See [interpretation.md](interpretation.md) and
  [references/open-questions-examples.md](references/open-questions-examples.md).
- **Stop condition (80-point line): can the proposed arc form a coherent whole without fabricated facts?**
  If so, end interviewing. Send later questions to post-edit refinement (`plan-edit`).
- **Do not display arc in the report.** Keep it as schema data in `interpretation.json` (source of interview
  questions and seeds for AI proposals during dialogue). Removal from display was settled in the 2026-07-22 revision.
- Do not add helper fields absent from [interpretation.schema.json](https://github.com/AkariLabs/akari-video/blob/main/packages/schemas/interpretation.schema.json).
  Finalize only JSON that passes `validate-interpretation.mjs`.
- **No decision UI in reports** (choices, knobs, or finalize buttons). Decide direction in chat.
  The AI proposes with evidence instead of asking “What should we do?”
- **Connect decision records to existing decision_log conventions (plan-edit).** Do not invent a format.
  See [decision-record.md](decision-record.md).
- Use OpenMontage only as structural inspiration; do not copy AGPL text or code.

## Execution order and contents

1. Read [collect.md](collect.md), list project assets, and check for analysis.json.
   Run analyze-footage only for missing assets, 1 asset = 1 execution.
2. Read [interpretation.md](interpretation.md); read all analysis.json files with surrounding project context,
   then create `interpretation.json` with mandatory evidence and zero fabrication.
3. Read [validate-and-render.md](validate-and-render.md), confirm `validate-interpretation.mjs` PASS,
   generate a report using renderer `--analysis <ref>=<path>`, and open it.
   Verify absent analysis.json chapters display as unobserved.
4. Only if open_questions remain, read [interview.md](interview.md) and interview in chat
   (no decision delegation). Promote answers to interview context and regenerate interpretation/report (return to steps 2–3).
5. Read [decision-record.md](decision-record.md); record interview Q&A and major pass-2 decisions in the decision log.

Read only the file for the current stage, without reading ahead.
