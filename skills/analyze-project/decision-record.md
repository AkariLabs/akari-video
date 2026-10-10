# Decision records

## Principle

Always preserve chat decisions and interview Q&A in markdown. This applies intake v2's invariant that file contracts
are canonical and chat is an injection route; records feed style learning, past-project references, and future-session
context. **Do not invent a format**: use [edit-plan's decision_log convention](../edit-plan/report-guide.md#decision_log).

## What to record

- **Major pass-2 decisions**: Asset roles, relations, flag classifications (especially distinctions such as
  `orphan`/`unclear`, where evidence exists but interpretation remains open). Evidence fields and the reason for
  the decision itself are separate; record the latter in the decision log.
- **Interview Q&A**: Questions and answers from [interview.md](interview.md), already reflected in
  `interpretation.json`'s `inputs.context.interview[]`. Also record why the question was asked and how the answer
  affected interpretation.
- **Stop-condition judgment**: The decision to end interviewing and why a coherent arc without fabrication was possible.

## Location and format

**Reuse unchanged** the `decision_log` convention in [edit-plan/report-guide.md](../edit-plan/report-guide.md#decision_log):
chronological append keyed by `(category, subject)`, ISO 8601 timestamp, category, subject, decision, rationale,
decider, and related checkpoint. For analyze-project, use categories `analysis` (pass-2 decisions) /
`interview` (interview Q&A).
Write the decision and reason cell contents in the user's language. Keep the header's exact machine-read column names
`日時` (time), `決定` (decision), `理由` (reason), `決定者` (decider), and `関連 checkpoint` (related checkpoint)
regardless of that language. Preserve any existing header and rows unchanged.

The assumption of embedding in one `editing-report.html` was removed from edit-plan in the 2026-07-22 revision
(consolidation into an analysis-only report; see the opening revision note in [edit-plan/report-guide.md](../edit-plan/report-guide.md)).
analyze-project and edit-plan therefore append project decisions to a **shared independent file**,
`<project>/decision-log.md`. analyze-project may start it; later edit-plan stages continue appending.
1 project = 1 log, a single SSOT. Create the file if absent; write the decision-row table header 1 time
(`日時`, category, subject, `決定`, `理由`, `決定者`, `関連 checkpoint`). Never change/delete existing rows;
append new rows at the end.

This location change (embedded HTML → standalone markdown) is a **minimal addition** following edit-plan's
removal of fixed-report generation. Recording conventions and field structure remain completely unchanged.

Render with the shared decision-record report (`packages/decision-log-report`). Optional after analyze-project
appends, but mandatory at every edit-plan Checkpoint.

## Record example

```markdown
| 日時 | category | subject | 決定 | 理由 | 決定者 | 関連 checkpoint |
|---|---|---|---|---|---|---|
| 2026-07-22T10:40:00+09:00 | analysis | asset:bg-cm-prototype/flags | unclear と判定 | 由来元 edit.json・planning/production-notes.md から同一プロダクトの CM 試作と確認できたが、本編 transcript に直接言及が無く編集上の具体的根拠が無いため orphan ではなく unclear とした | AI（2 パス目） | - |
| 2026-07-22T10:55:00+09:00 | interview | oq-01: audio/missing.wav の意図 | 取材質問として open_questions に採用 | source からは確定不能（fieldtest/planning に記録なし）。素材にもネットにも無い一次情報のため取材質問の要件を満たす | AI → オーナーへ回付 | - |
```

## Common mistakes

- Inventing a decision-record format without checking existing decision_log conventions.
- Leaving decisions only in chat instead of markdown (do not let them disappear).
- Updating `interpretation.json`'s `inputs.context.interview[]` but omitting the decision record explaining
  why the question was asked and how the answer affected interpretation.
- Overwriting past decision rows with new judgments (violates append-only discipline).
