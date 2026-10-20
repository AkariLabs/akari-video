# Compilation rules

## Contents

- [Clocks and cut mapping](#clocks-and-cut-mapping)
- [Transcription and utterance segmentation](#transcription-and-utterance-segmentation)
- [Reference resolution](#reference-resolution)
- [Stroke pairing](#stroke-pairing)
- [UI event resolution](#ui-event-resolution)
- [Acceptance and normalization](#acceptance-and-normalization)
- [Application and degradation](#application-and-degradation)

## Clocks and cut mapping

Read `events.jsonl` in recT order; retain `playing`, `anchorTimelineT`, `anchorRecT`, and `rate`.
While stopped, use anchor timelineT; while playing, use `anchorTimelineT + (recT - anchorRecT) * rate`.
`tick` corrects drift by resetting the anchor to measured values and always overrides estimates.
Exclude only damaged JSONL lines, with warnings.

Use the lowest track in `edit.snapshot.json` as primary. Arrange cut
`duration = (out - in) / (speed ?? 1)` in array order. Without `at`, connect to the previous end.
Ranges are `[timelineStart, timelineEnd)`; an exact boundary belongs to the next cut.
Invert via `sourceT = in + (timelineT - timelineStart) * speed`.
Reject absent snapshots; do not infer sourceT from current edit.json or recT.

## Transcription and utterance segmentation

Reuse `analyze-footage`'s 3 layers:

1. Call `skills/analyze-footage/bin/transcribe-sa.mjs` after `--check`.
2. If unavailable/failing, find existing `whisper-cli` and multilingual `ggml-*.bin`, create mono 16 kHz WAV,
   and normalize full JSON. Do not automatically install tools/models.
3. Call `transcribe-cloud.mjs` only with `--allow-cloud-stt`, doctor-ok candidates checked through decision cards,
   and explicit `--cloud-provider ... --cloud-approved`. Never send before explicit approval.

Accept only backends returning word timestamps; retain provenance in `transcript.json`'s `backend`.
Correct backend leading offsets using long audio silence, then merge adjacent segments with gaps under 0.3 seconds.
Within merged segments, split after word-attached `。！？!?` (machine-matched punctuation) if further words remain.
If every backend fails, save `backend: "unavailable"`, `segments: []`, and reasons; continue with zero utterances,
without asserting no speech occurred.

## Reference resolution

Priority:

1. If a seek occurs during the utterance, first candidate is the landing point at utterance end.
   Staying there for ≥1 second means cross-utterance scrubbing stopped; set `confidence: high`.
2. If stopped at utterance start, use the stopped frame with `confidence: high`.
   For consecutive seeks while stopped, the final landing point is the anchor.
3. During playback, list cut boundaries between the actual trace 3 seconds before utterance start and its start
   position. With 1 candidate, use that boundary; with 0, use the instantaneous position; with multiple, retain candidates.
4. For 0/multiple candidates, use `confidence: low`; put candidates and a question in `[要確認]`
   (machine marker: needs confirmation). Never silently discard or mechanically assert 1 of multiple candidates.

Map resolved timelineT through snapshot cuts to obtain `target: "cut:<元配列index>"`
(existing original-array-index placeholder) and sourceT.

## Stroke pairing

If `strokes.json` exists, deterministically choose a stroke whose recT overlaps the utterance or whose interval
is within 3 seconds. Prioritize overlap, then stroke endpoint closest to utterance start, then recT/ID to break ties.
Reference priority: **stopped utterance > stroke pair > rewind playback > playing utterance**.
For stopped utterances, retain the stopped-frame anchor and attach only the stroke; otherwise use the stroke frame
as sourceT / timelineT / cut-target anchor.

Embed a deterministically simplified polyline of at most 100 points, always preserving first/last points.
Reference originals with `sessionRef`; never modify `strokes.json`. Missing files are normal; damaged JSON/elements
produce warnings. Exclude only damaged elements and degrade to the existing no-stroke route.

## UI event resolution

Bundle `events.jsonl` `ui.click` / `ui.tab` / `ui.panel` (`https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-08-11-review-session-ui-events.md`
§1–§2) into a recT-ordered trace. Apply this additional stage **last** to the reference obtained from the existing
4 stages (stopped utterance > stroke pair > rewind playback > playing utterance). Do not change their meanings or priority.

Only `ui.click` is targeted. `ui.tab` / `ui.panel` are not applied; their possible future use as disambiguation context
is reserved, unused here. Warn and skip events without targets; never silently drop them.

### Narrow candidates

Use a fixed window of 5 seconds before/after utterance `[start, end]`. Ignore all `ui.click` outside it.

1. Exactly 1 `intent: true` (explicit selection-tool click) in-window: use it regardless of naming.
   Intent clicks express stronger intent than passive recording; label match is not required.
2. Multiple `intent: true`: narrow to clicks whose `label` occurs in the utterance (substring match after removing
   whitespace and lowercasing). If exactly 1 remains, use it.
3. Not even 1 `intent: true`: consider only in-window clicks whose labels occur in the utterance.
   With 0, silently do nothing (even 1 passive click is insufficient without mention). With 1, use it.
4. If multiple candidates remain at any stage, leave the target unchanged, lower `confidence` to `low`, and retain
   `reference.uiCandidates` (list of `target` / `label`). Also append the candidate list to applied `[要確認]`
   text (machine marker: needs confirmation; hard rule 4 forbids assertions).

### Apply

Map only uniquely resolved `ui.click.target` vocabulary into existing review.json fields (no schema change).

- `timeline:cut:<n>` → `target: "cut:<n>"`. Compute `sourceT` / `timelineT` directly from
  `edit.snapshot.json` `cuts[n]` (`cuts[n].in` and cut-map `timelineStart`), not playback position.
  If `n` is not a primary-track cut, treat as unresolved and do nothing.
- `timeline:item:<id>` → resolve v2 `tracks[].items[].id` through its correspondence with compatibility-projected
  `cuts[]` index to `target: "cut:<n>"`. Compute `sourceT` / `timelineT` directly from the corresponding cut.
  If it matches no v2 cut item, treat as unresolved and do nothing.
- `timeline:overlay:<id>` → `target: "overlay:<id>"`. Find the matching ID in `edit.snapshot.json`
  `overlays[]`; map `start` (timeline seconds) through the cut map to source seconds.
  Missing ID or nonfinite `start` means unresolved; do nothing.
- `asset:<path>` → leave `target` / `timelineT` / `sourceT` unchanged; add only
  `refs: [{ "path": "<path>" }]` (existing v1 field; asset clicks have no timeline position).
- Other vocabulary such as `panel:` / `tab:`, or unresolved references, is not applied; keep prior resolution
  unchanged. Applying `ui:` targets belongs to the next implementation contract.

Sessions without UI events (`uiClicks` default `[]` when omitted) always have 0 candidates;
this stage is entirely no-op and does not change existing behavior (additive).

## Acceptance and normalization

bin provisionally judges using conservative editing-word, request-word, and system-check heuristics.
Normalize editing instructions to imperatives; retain originals in `transcript`. Tests, audio checks, self-talk,
corrections, and casual conversation do not become annotations; retain original text, recT, and reasons in the report.
Do not discard borderline utterances; fall back to `[要確認]` (machine marker: needs confirmation).

For real projects, generate `compile-proposals.json` with `--prepare-only`, then inspect/fill each
`proposals[].decision`. First inspect reference candidates, originals, audio recRange, and snapshot structural data.
View frames only as a last resort for visual references absent from data. After finalization, apply with
`--apply-proposals`. This is the compiler's internal agent-judgment stage, not an added pre-application approval gate.
Fixtures or explicitly requested automatic batches may apply unedited provisional judgments directly.

## Application and degradation

If existing `transcript.json` violates schema, warn and regenerate.

Never reserialize existing review.json annotation lines. Add minified JSON as a new line just before closing `]`,
then rename from a temporary file. IDs are maximum existing `a-` number +1; never reuse deleted IDs.
Annotations use `status: "open"`, `input: "session"`; write resolved timeline seconds to `timelineT`
(reference only; sourceT is canonical). Include audio, transcript, session ID, recRange, confidence.

Only after success, mark session.json `compiled` and append current IDs to `compiledAnnotations`; retain existing IDs.
Skip compiled by default; even with `--force`, add new IDs without deleting existing annotations.
Report damaged manifests/missing snapshots per session and continue others.

Synchronizing `session` into `packages/schemas/review.schema.json`'s `input` enum and `apps/shell`'s annotation
reader is a separate task outside this skill's boundary. Write `input: "session"` as contracted;
do not distort values to fit out-of-boundary implementations.
