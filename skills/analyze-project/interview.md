# Interview — Fill primary-information gaps in chat

## Principle

Enter this stage only when `interpretation.json` still has `open_questions[].status: "open"`.
Interviewing collects facts, not permission. **Do not use “What should we do?” or wording that effectively
hands decisions to the user** (same discipline as [interpretation.md](interpretation.md#open_questions-are-interview-questions-only-no-decision-questions)).
This does not conflict with the design principle of completing work without asking for direction:
interviewing collects facts rather than seeking approval for a direction.

## 1. Ask in chat

Present `open_questions[]`'s `question` unchanged in chat. You may bundle multiple questions, but preserve
1 question = 1 decision (1 question = 1 information gap). Add the premise (why you ask = `fills`) to make answers easier.

Good wording:

> “`audio/missing.wav` is referenced by edit.json's SFX, but I could not find the file.
> Was it an SFX intended for placement, or an incorrect reference?”

Avoid (decision delegation; do not write):

> “Keep this trouble section in the main video? Cut it? What should we do?”

The latter is outside analyze-project's remit. Record facts (trouble contents, whether self-resolved, relevance to the
main story) in `flags[]`; send inclusion decisions to `edit-plan`'s chat dialogue phase.

## 2. Incorporate answers

After receiving an answer, update the corresponding `open_questions[]` entry:

- Set `status` to `"answered"`.
- Add the answer in `answer` (omitted while `open`).

Also promote it to a `{ q, a }` pair in `inputs.context.interview[]`.
Retaining interview provenance in `inputs.context` makes interpretation evidence traceable later.

If the answer supplies new evidence (e.g., facts supporting flag evidence), you may update corresponding
`assets[].flags[]`/`relations[]`/`arc[]` with those facts. Continue to follow
[Mandatory evidence, zero fabrication](interpretation.md#mandatory-evidence-zero-fabrication);
do not extend interpretations beyond facts obtained in the interview.

## 3. Regenerate

After updating `interpretation.json`, rerun [validate-and-render.md](validate-and-render.md)
(validate → render → open) to refresh the report and interview ledger. Even when all `open_questions` are `answered`,
that does not itself mean interviewing is exhausted: separately check the
[Stop condition (80-point line)](interpretation.md#stop-condition-80-point-line), whether a coherent arc is possible
without fabrication. If not, add newly arising `open_questions` and repeat.

## 4. Cases needing no interview

Self-contained footage (e.g., presenter explains all history/intent) may meet the
[stop condition](interpretation.md#stop-condition-80-point-line) with 0 `open_questions` from the start.
This is normal; do not force interview questions.

## Common mistakes

- Asking users to decide through “What should we do?” / “Which is better?” wording.
- Copying answers only into `arc`/`flags` evidence without promotion to `inputs.context.interview`
  (loses provenance traceability).
- Setting `status: "answered"` before even 1 answer is received.
- Declaring interviewing exhausted because open_questions reached 0 (the stop condition is a coherent arc
  without fabrication, not the `open_questions` count).
