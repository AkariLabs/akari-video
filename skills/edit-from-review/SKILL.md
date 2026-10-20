---
name: edit-from-review
description: "Edit edit.json to address open review.json annotations, with ticket updates in the prescribed sequence. Use for requests such as “Address a-0002 and a-0003” or “Address all open tickets”. The consumer side of the QA loop; bin/respond.mjs atomically enforces open → addressed with mandatory response, immutable resolved tickets, and no silent dismissal.（旧名: address-review）"
---

# Address open tickets

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

Canonical source: private internal contracts (`akari-video-internal`): review-annotations §1/§3/§5 (state machine)
+ review-session §6 (additional session-derived fields).

## Hard rules

1. **Strictly follow the state machine**: `open → addressed` always requires `response` (`summary` + `action` +
   `respondedAt`). **Never write to `resolved`** (human-only approval gate). Do not re-handle `addressed`.
   `bin/respond.mjs` rejects these programmatically; never bypass guards with manual review.json edits.
2. **Never silently dismiss**: For tickets you choose not to/cannot address, always `respond` with `declined` and
   a reason in `summary`. When uncertain, do not leave open; use `declined` with a question in summary.
3. **Target `[要確認]` only when explicitly named**: Annotations whose `text` starts with `[要確認]`
   (machine marker: needs confirmation) are excluded by `--all-open`; `bin/list.mjs` automatically skips and reports them.
   Include only when their IDs are explicitly specified through `--ids`. `[要確認]` is a question for the owner,
   not something the agent may independently interpret and process.
4. **Pass edit-lint after implementing edit.json changes, before respond**: Caption instructions follow the
   caption contract ([Captions and cut editing](https://github.com/AkariLabs/akari-video/blob/main/docs/notes-2026-07-14-captions-and-cut-editing.md), Japanese:
   gap principle, actual speech intervals, minimum 1.0s). Run `respond` only after
   `node packages/edit-lint/bin/edit-lint.mjs <project> --media` PASS; never mark addressed before PASS.
5. **The agent judges interpretation/implementation; bin handles only mechanical listing/state transitions.**
   Do not make bin decide how to fix edits.

## Execution order

1. List targets:

   ```sh
   node skills/edit-from-review/bin/list.mjs <project-root> --ids a-0002,a-0003
   node skills/edit-from-review/bin/list.mjs <project-root> --all-open
   ```

   Human-readable output includes `sourceT` / `sourceRange` / `target` (e.g., `cut:<index>`) / `text` / `input`;
   for session-derived annotations (§6 additions), also formatted `session` (id, recRange, confidence) and
   `strokes` (with sessionRef). `--all-open` automatically skips `[要確認]` annotations (machine confirmation marker)
   and includes skipped IDs/count in output.

Do not Read all of `edit.json` / `captions.json`; grep by ID and read matching lines only ([Reading edit.json](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/edit-json-access.md)).
Write through relevant-line Edit or edit-store's script API.

2. Read each ticket's `text` instructions (including source seconds/target) and decide the response.
   - If addressing: Edit relevant edit.json (captions.json if needed) lines or use edit-store's script API;
     pass `node packages/edit-lint/bin/edit-lint.mjs <project-root> --media`.
   - If not addressing: Clearly establish the reason; never silently dismiss.
3. Execute state transitions for each judged ticket:

   ```sh
   node skills/edit-from-review/bin/respond.mjs <project-root> \
     --id a-0002 --action edited --summary "captions.json に c-0009〜c-0013 を追加。edit-lint --media PASS 確認済み。"

   node skills/edit-from-review/bin/respond.mjs <project-root> \
     --id a-0003 --action declined --summary "参照素材が assets/ に無いため見送り。素材が揃ったら再度チケットを切ってください。"
   ```

   `respond` rejects targets not `open` (`resolved` / `addressed` / unknown ID), and empty `summary`.
   All rejections leave review.json completely unchanged.
   Exit codes: success 0 / guard rejection 1 / input/environment error 2.
4. After all responses, give 1 response summary: action (edited/declined) and summary gist per handled ID,
   skipped `[要確認]` IDs (machine confirmation marker), and reasons for any rejections.

## Options

- `list.mjs --ids <id,id,...>`: List specified IDs only, including `[要確認]` (machine confirmation marker).
- `list.mjs --all-open`: List all `status: "open"`, skipping/reporting `[要確認]` (machine confirmation marker).
- `list.mjs --json` / `respond.mjs --json`: Machine-readable stdout.
- `respond.mjs --id --action edited|declined --summary "..."`: State-transition executor.
  `respondedAt` is generated automatically from execution time (ISO8601, cannot override).

## Outputs

- `bin/list.mjs`: Target ticket list (human-readable or `--json`); no file writes.
- `bin/respond.mjs`: Atomic `review.json` state transition (`open → addressed` + `response`).
  Nontarget annotations and other target fields remain byte-identical.

## Applying to real projects

This skill executes the prescribed open-ticket response pattern. Judging which edit.json changes count as addressing
a ticket (exact caption ranges, cuts to remove, etc.) is the agent's job, based on project-specific primary information
(audio, footage, transcript); bin does not substitute for that judgment.
