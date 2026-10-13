# plan.json — Confirm a provisional timeline with no media

Canonical contract: [contract-2026-07-20-plan-json-v0.md](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-20-plan-json-v0.md).
Read this leaf only from the "No media" branch of [workflow.md](workflow.md) §2. When recorded footage exists, do not create plan.json; proceed from integrated analysis to presenting the direction in chat as before (one pipeline that can skip steps according to confidence; provisional slots help only when the direction is uncertain).

## 1. Develop the direction through questions

- Ask one multiple-choice (ABC) question at a time to settle purpose, duration, tone, and structural beats. One question must represent one decision; do not blur answers with compound questions.
- Use the existing [decision-cards](https://github.com/AkariLabs/akari-video/tree/main/packages/decision-cards) dialogue surface unchanged: create the separate pair `<plan-dir>/plan-dialogue.html` + `<plan-dir>/plan-dialogue.html.decisions.json` and present it with `node packages/decision-cards/report-helper.mjs`. If the helper is unavailable, substitute explicit chat approval and record that substitution (the same fallback as the Checkpoints in [approvals-and-generation.md](approvals-and-generation.md)).
- Keep this decisions.json exclusive to plan-dialogue and separate from the `decision-log.md` decision record. Do not mix them: decisions.json holds raw dialogue data; decision-log.md summarizes settled decisions.

## 2. Write plan.json

- Place it at `<plan-dir>/plan.json` (the same directory as `decision-log.md`; AKARI projects default to the `planning/` role).
- Put dialogue-approved structural beats in `slots[]` (array order is timeline order; do not write `start`) and decisions (duration ceiling, fixed duration, and positioned instructions) in `constraints[]`. Follow the field table in contract §1 for format, required keys, and null rules.
- A slot may start during dialogue as `confidence: "proposed"` + `fill.method: null`. Mark only items confirmed by the human in dialogue as `locked`. **Never lock by AI judgment.**
- Update the same file incrementally, adding only confirmed facts as with append-only `decision-log.md`. The dialogue decisions.json holds decision history; write only outcomes to plan.json.
- Validate after every write:
  `node packages/schemas/bin/validate-plan.mjs <plan-dir>/plan.json`
  (Maintain zero errors. Warnings are allowed for immature provisional slots, but list them in the completion report.)

## 3. Confirm and connect

- When the direction is confirmed (dialogue decisions.json has non-null `completedAt`, or explicit chat approval), record the `plan-confirmed` gate event in `.akari/events/`.
- In later work ("Decide the direction in chat" in [report-guide.md](report-guide.md)), cite plan.json slot ids as evidence when presenting the edit direction. Do not turn the script or structure back into free text in chat (2026-07-22 revision: report generation moved to analyze-project; plan.json's role did not change).
- The three-way asset choices (propose / generate / reject) for BGM, SFX, B-roll, etc. remain under [report-guide.md's Asset plan section](report-guide.md#asset-plan). Do not move them into plan.json (contract §5).

## 4. Connect provisional clips

For zero media, do not use plan.json's provisional-slot role. Proceed to [generate-media's still.md](../generate-media/still.md) and put text cards or Codex stills on the timeline as edit.json v2 media items. A placeholder consists of a still clip on the timeline plus `<path>.meta.json` beside the asset; cuts hold its duration. A still may be the finished result. Proceed to generate-media's video.md only for clips that will become video.
