# Decision records

## Principle

Always preserve chat decisions and interview Q&A in markdown. This applies intake v2's invariant that file contracts
are canonical and chat is an injection route; records feed style learning, past-project references, and future-session
context. **Do not invent a format**: use [plan-edit's decision_log convention](../plan-edit/report-guide.md#decision_log).

## What to record

- **Major pass-2 decisions**: Asset roles, relations, flag classifications (especially distinctions such as
  `orphan`/`unclear`, where evidence exists but interpretation remains open). Evidence fields and the reason for
  the decision itself are separate; record the latter in the decision log.
- **Interview Q&A**: Questions and answers from [interview.md](interview.md), already reflected in
  `interpretation.json`'s `inputs.context.interview[]`. Also record why the question was asked and how the answer
  affected interpretation.
- **Stop-condition judgment**: The decision to end interviewing and why a coherent arc without fabrication was possible.

## Location and format

**Reuse unchanged** the `decision_log` convention in [plan-edit/report-guide.md](../plan-edit/report-guide.md#decision_log):
chronological append keyed by `(category, subject)`, ISO 8601 timestamp, category, subject, decision, rationale,
decider, and related checkpoint. For analyze-project, use categories `analysis` (pass-2 decisions) /
`interview` (interview Q&A).
Write the decision and reason cell contents in the user's language. For a new file, use the exact table header for the user's language:

- English: `| Time | category | subject | Decision | Reason | Decided by | Related checkpoint |`
- Japanese: `| 日時 | category | subject | 決定 | 理由 | 決定者 | 関連 checkpoint |`

When appending to an existing file, keep its header language and append rows without changing its header or earlier rows.

The assumption of embedding in one `editing-report.html` was removed from plan-edit in the 2026-07-22 revision
(consolidation into an analysis-only report; see the opening revision note in [plan-edit/report-guide.md](../plan-edit/report-guide.md)).
analyze-project and plan-edit therefore append project decisions to a **shared independent file**,
`<project>/decision-log.md`. analyze-project may start it; later plan-edit stages continue appending.
1 project = 1 log, a single SSOT. Create the file if absent; write the decision-row table header for the user's language once. Never change/delete existing rows; append new rows at the end.

This location change (embedded HTML → standalone markdown) is a **minimal addition** following plan-edit's
removal of fixed-report generation. Recording conventions and field structure remain completely unchanged.

Render with the shared decision-record report (`packages/decision-log-report`). Optional after analyze-project
appends, but mandatory at every plan-edit Checkpoint.

## Record example

```markdown
| Time | category | subject | Decision | Reason | Decided by | Related checkpoint |
|---|---|---|---|---|---|---|
| 2026-07-22T10:40:00+09:00 | analysis | asset:bg-cm-prototype/flags | Classified as unclear | The originating edit.json and planning/production-notes.md identify a prototype ad for the same product, but the main transcript never mentions it and offers no concrete editing basis, so unclear fits better than orphan | AI (pass 2) | - |
| 2026-07-22T10:55:00+09:00 | interview | oq-01: purpose of audio/missing.wav | Added to open_questions for interview | The source cannot establish its purpose, and fieldtest/planning has no record; this requires first-hand information unavailable from the media or web | AI → owner | - |
```

## Common mistakes

- Inventing a decision-record format without checking existing decision_log conventions.
- Leaving decisions only in chat instead of markdown (do not let them disappear).
- Updating `interpretation.json`'s `inputs.context.interview[]` but omitting the decision record explaining
  why the question was asked and how the answer affected interpretation.
- Overwriting past decision rows with new judgments (violates append-only discipline).
