# Editing procedure by autonomy level

## 1. Determine the mode

Before making a video, read `akari.md` at the workspace (CreatorRoot) root. If absent, do nothing. Then read `<project>/.akari/intake.json`.

Precedence is **one-line instruction > intake > akari.md > product default**.

- If intake is absent, `status: "draft"`, or `autonomy` is missing, treat the mode as `checkpoint` ("with suggestions"; Japanese UI label `提案つき`) and proceed to §3. Do not follow a draft's `tasks` / `target` / `autonomy`.
- With `status: "submitted"` and `autonomy: "full-auto"` ("as requested"; Japanese UI label `そのまま`), follow §2.
- With `status: "submitted"` and `autonomy: "checkpoint"` ("with suggestions"; Japanese UI label `提案つき`), follow §3.
- With `status: "submitted"` and `autonomy: "collaborative"` ("create together"; Japanese UI label `一緒に作る`), follow §6.
- Apply a one-line mode instruction and preferences in `akari.md` according to the precedence above.

**offer-once**: On first encountering work absent from akari.md's procurement-preference table, ask exactly one question and offer to add one line with the answer to the `聞かれて答えたこと` (answers to questions) section of akari.md. Do not ask a second time. **Do not rewrite any other section of akari.md.**

## 2. Full auto (Japanese UI: `そのまま`)

In `full-auto`, follow this order without asking for chat approval during the run, except at the gates in §4. Apply the referenced output rules, not their approval procedures.

1. Fix the request and `intake.tasks` as the list of things to include. **Do not add anything absent from the list.** Do not propose B-roll, BGM, effects, or thumbnail ideas.
2. For analysis, the analyze-project report (`analysis-report.html`) **need not be read**. Read only the factual `analysis.json` (`transcript` / `events`). If absent, run the [analyze-footage](../analyze-footage/SKILL.md) defaults (L0 + L1).
3. Do not present the direction or asset plan in chat. Append each chosen default (reading tail, cut intensity, caption preset, etc.) as one row to `decision-log.md` with decider `machine:director`. Follow the [decision_log table format](report-guide.md#decision_log): use the user's language for a new file's header and preserve an existing file's header language. Do not change or delete earlier rows.
4. Read [execution.md](execution.md) and write v2 `edit.json` / `captions.json` / overlays. Use `akari captions <project-dir>` for captions (execution.md §4). Build captions from word times; do not tile them continuously. The default reading tail is 0.3 seconds. Consult output rules in [beats.md](beats.md), [beat-sync.md](beat-sync.md), [emphasis-detection.md](emphasis-detection.md), and [expression-selection.md](expression-selection.md) only if needed for the requested output. Do not write `beats` / `emphasis_words` into v2 `edit.json`; put word-level emphasis in `captions.json` `emphasis_words[]`. Do not alter originals. Only one director writes `edit.json`; preserve provenance in `<file>.meta.json` for generated assets.
5. Run [edit-lint](../edit-lint/SKILL.md) immediately after writing. Fix and rerun on FAIL; do not export with FAIL. If it cannot be fixed, stop and report (§4). Save lint results in `.akari/reports/`.
6. Use [render-cut](../render-cut/SKILL.md)'s executable-resolution and export steps, following duration and output specifications in `intake.target`. Make a one-line declaration in chat, then proceed without awaiting approval.
7. After export, save one or two `akari capture` frames in `.akari/reports/` (at the first caption and midpoint). Without captions, use the beginning and midpoint. Call `akari capture -p <project> -t <先頭の字幕が出る秒> <中盤の秒> --separate --out <project>/.akari/reports/` (the Japanese placeholders mean the seconds of the first caption and midpoint).
8. The final report must include the output mp4 path, capture paths, lint-result path and result (PASS / finding count), and number of rows added to `decision-log.md`. This is the only chat output except the one-line declaration in step 6 and stop notices under §4.

## 3. Checkpoint (default; Japanese UI: `提案つき`)

1. Choose inclusions from the request, `intake.tasks`, and akari.md preferences. **You may add useful items beyond those requested** (B-roll, diagrams, caption effects, BGM, SFX, chapters); follow akari.md's procurement-preference table when adding them.
2. Read only factual `analysis.json`. Reading the analysis report is not mandatory. If absent, run the [analyze-footage](../analyze-footage/SKILL.md) defaults (L0 + L1).
3. Do not present the direction or asset plan in chat or request approval.
4. **For each added item, write one prediction row to `decision-log.md`** in the same turn as adding it to the timeline. Use the [decision_log table format](report-guide.md#decision_log) with ISO 8601 time, `category = proposal`, an item id or caption id as subject, what was added as the decision, why it is useful as the reason (citing a location in analysis.json or a line in akari.md), `machine:director` as decider, and the source asset id and means in the related checkpoint cell. Write the decision and reason in the user's language. The related cell must include `sha:<first eight hex digits of the proposal-time item or record's canonical JSON SHA-256>`. Canonical JSON is JSON.stringify of recursively sorted object keys, retaining array order. Example: `source-01 / HTML overlay sha:1a2b3c4d`; calculate the hash from actual proposal-time data. Do not write prediction rows for requested items themselves. Missing prediction rows produce only an edit-lint warning.
5. Write v2 `edit.json` / `captions.json` / overlays under [execution.md](execution.md)'s output rules, then immediately run [edit-lint](../edit-lint/SKILL.md). Fix FAIL and rerun; if it cannot be fixed, stop under §4. Do not change originals. Only one director writes `edit.json`; keep generated-asset provenance in `<file>.meta.json`. Use `akari captions <project-dir>` for captions (execution.md §4).
6. **Do not export (do not call render-cut)**. Finally report the number N of included items (M proposed, with M record rows), lint result, and **"Preview the edit and remove anything you do not want. Use the header's Export button to export."** This report is the only chat output except §1's offer-once and §4 stop notices. The user-facing wording follows the user language pack (see SKILL.md).
7. `akari decision-log settle` (called automatically by the render-cut CLI) appends **outcome rows at export time** for human deletions, revisions, and unchanged exports. Calling it from shell export is a separate task.

## 4. Gates and stop conditions

These gates apply in all three autonomy modes. Work that stays inside the project and can be undone may proceed without waiting. After each such change, append one `agent-action` JSON file to `.akari/events/` (`version: 1`, unique `id`, `type`, ISO `occurredAt`, `actor: partner | external | unattended`, one-line `summary`, and `files` containing the changed project-relative paths). Use a unique `<ISO-time-digits>-<id>.json` filename and never edit an existing event. The app records this action as a git milestone.

Before crossing any gate below, append a `gate-requested` event with the same common fields plus `gate`, `requestId`, `summary`, and optional `detail` (such as cost estimate, recipient, or affected files). Wait for a `gate-resolved` event with that `requestId` and `decision: approved` before performing the gated action. On `declined`, do not perform it. Continue unrelated reversible work while waiting. **Never write `gate-resolved` yourself**; only a human action or its app/chat interface may do that.

| Gate | Stop before |
|---|---|
| `publish` | Publishing or posting, including creating a shared link. |
| `lab-submit` | Submitting to Lab or a store. |
| `paid` | Paid generation or purchase; include an estimate in `detail`. This replaces the former paid-generation stop. |
| `external-send` | Sending assets or documents to an external service; identify the recipient in `detail`. This replaces the former external-transmission stop. |
| `delete-original` | Deleting or overwriting imported original assets. |
| `license` | Proceeding despite uncertain provenance, commercial rights, or tool terms. |
| `playbook-checkpoint` | A checkpoint declared by a playbook step. |
| `human-asked` | A point where the human explicitly requested confirmation (the former human-confirmation stop). |

Checkpoint and collaborative modes may ask for their ordinary confirmations outside these gates; full-auto does not. If an edit-lint FAIL cannot be fixed, report its remaining findings and reason. A lint failure is **not** a gate. Export itself is reversible unless it overwrites an original, so do not invent an export gate.

## 5. Prohibitions

These apply to checkpoint as well as full-auto.

- Do not require the analysis report; it need not be read.
- Do not pass through Checkpoints 1–3.
- Do not wait for `plan-comments.json`.
- Do not present recommendations or alternatives, except the generation declaration in §4.
- Do not request `HUMAN_APPLY_GATE`.
- Do not wait for cut candidate bridge review. If `intake.tasks` includes `silence-cut`, apply default thresholds without candidate review and record the thresholds and results in `decision-log.md`.

## 6. Collaborative (Japanese UI: `一緒に作る`)

Follow steps 1–11 in [SKILL.md](SKILL.md) and the three-stage checkpoints in [approvals-and-generation.md](approvals-and-generation.md) unchanged. Also use the `HUMAN_APPLY_GATE` and `plan-comments.json` procedures in this mode.

## 7. Records

Appending to the ledger (`decision-log.md`) is mandatory. Use the existing table format and `machine:director` as decider. Append execution results (generated-asset list, provenance, execution time) as well as decision values and reasons. Regenerating the decision-record report is optional.

Prediction rows for additions in checkpoint mode follow §3-(4). Append outcome rows for human actions at export time.
