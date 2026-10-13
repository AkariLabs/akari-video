---
name: compile-review-session
description: Transcribe recorded review-session audio.wav, events.jsonl, edit.snapshot.json, and session.json using analyze-footage's same 3-layer STT. Segment utterances, resolve references from the interaction trace, normalize imperative instructions, and produce open review.json annotations plus a compilation report. Use to turn spoken QA sessions into tickets, compile recorded/transcribed sessions, or explicitly recompile compiled sessions. Also triggered by requests like "レビューの録音 s-0003 を文字起こしして、コメントにまとめて" or "Transcribe review recording s-0003 and turn it into comments".
---

# Compile a review session

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

## Hard rules

1. Do not modify `audio.wav`, `events.jsonl`, `strokes.json`, or `edit.snapshot.json`.
2. Reject missing snapshots. Do not infer sourceT from current edit.json or recT.
3. Reuse `analyze-footage`'s 3 STT layers; do not create separate provider settings. Reject results without word
   timestamps; never send to cloud without decision cards and explicit approval.
4. Never silently discard ambiguous utterances or assert their references. Fall back to `[要確認]`
   (machine marker meaning needs confirmation) + low confidence.
5. Append atomically to review.json without changing existing annotation bytes. No overwrite, deletion, or ID reuse.
6. Skip compiled sessions by default. Even with `--force`, keep old annotations and compiledAnnotations and add new IDs.
7. 1 damaged session must not stop the batch. Report damaged manifests as skip, missing snapshots as reject;
   continue others.

## Execution order

1. Read [compilation-rules.md](compilation-rules.md) for clocks, STT, utterance segmentation, reference resolution,
   application, and degraded behavior.
2. Read project `review/sessions/` and `review.json`; identify targets and the maximum existing annotation ID.
3. For real projects, first create proposals for judgment:

   ```sh
   node skills/compile-review-session/bin/compile-review-session.mjs <project-root> \
     --session <s-XXXX> --prepare-only --json
   ```

4. Compare `compile-proposals.json`'s original text, recRange, reference candidates, and provisional acceptance/
   normalization with audio, events, and snapshot. Fill each `decision` with `action: "annotate" | "discard"`,
   `reason`, imperative annotation `text`, and `confidence: "high" | "low"`.
   If references need changing, verify evidence and update `reference`. If ambiguous, choose low rather than discard.
5. Apply judged proposals:

   ```sh
   node skills/compile-review-session/bin/compile-review-session.mjs <project-root> \
     --session <s-XXXX> --apply-proposals --json
   ```

   To prepare/apply recompilation of compiled sessions, add `--force` to both commands.

6. Apply provisional judgments directly only when automatic batch processing was explicitly requested:

   ```sh
   node skills/compile-review-session/bin/compile-review-session.mjs <project-root> --json
   ```

7. Read CLI results and each `compile-report.md`; report N utterances, M applied annotations, K requiring
   confirmation, discarded content/reasons, backend, and warnings. Verify existing review.json lines,
   the 4 session originals, and skipped targets are unchanged.

## Options

- `--session s-XXXX`: Process only 1 session.
- `--force`: Recompile compiled sessions too, adding new IDs.
- `--allow-cloud-stt`: Evaluate doctor-ok cloud candidates up to decision cards. Sending additionally requires
  `--cloud-provider scribe|groq --cloud-approved`.
- `--json`: Print machine-readable totals to stdout.

## Outputs

- `review/sessions/s-XXXX/transcript.json`: Segments with backend provenance and word timestamps.
- `review/sessions/s-XXXX/compile-proposals.json`: Judgment surface from prepare.
- `review/sessions/s-XXXX/compile-report.md`: Utterance-to-annotation mapping, confirmation needs, discards, degradation, division of responsibilities.
- `review.json`: Appended v0 annotations.
- `review/sessions/s-XXXX/session.json`: Append-style status/compiledAnnotations updates.

Known synchronization gap: `packages/schemas/review.schema.json`'s `input` enum and the current `apps/shell`
reader do not yet allow `"session"`. Enum/UI-reader extension is a separate task outside this skill's boundary.
Write `input: "session"` as the accepted contract requires.
