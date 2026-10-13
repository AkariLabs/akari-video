# Pass 2 — Create interpretation.json

## Contents

- [Principle](#principle)
- [Context to read](#context-to-read-surrounding-project-context)
- [Assembly procedure](#assembly-procedure)
- [Mandatory evidence, zero fabrication](#mandatory-evidence-zero-fabrication)
- [Mandatory flags scan](#mandatory-flags-scan)
- [open_questions are interview questions only](#open_questions-are-interview-questions-only-no-decision-questions)
- [Stop condition (80-point line)](#stop-condition-80-point-line)
- [arc is internal data (hidden from reports)](#arc-is-internal-data-hidden-from-reports)

## Principle

Pass 2 is **text reasoning by rereading pass-1 (analyze-footage) output side by side**; it creates no new facts.
Pass 1 extracts facts per asset without context. Pass 2 rereads all asset analyses together with surrounding context,
then produces cross-asset interpretations (roles, relations, outliers, proposed arc, interview questions).
Rewatch only locations pass 2 determines are necessary.

Separate the fact layer (analysis.json) and interpretation layer (interpretation.json) so incorrect context leaves
facts intact and only the inexpensive interpretation layer needs regeneration. There is 1 `interpretation.json`
per project, following v0 of [interpretation.schema.json](https://github.com/AkariLabs/akari-video/blob/main/packages/schemas/interpretation.schema.json).
Add no unknown fields. Omit optional keys entirely when valueless; do not use `null`.

## Context to read (surrounding project context)

Do not Read all of `edit.json` / `captions.json`; grep by ID and read only matching lines ([Reading edit.json](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/edit-json-access.md)).
This leaf does not write. In other stages that write, Edit relevant lines or use edit-store's script API.

Pass-2 inputs are not limited to analysis.json files gathered in `collect.md`. **If the project is within a known
AKARI project structure (a directory containing `intake.json` or `edit.json`), also read surrounding context**:

- `intake.json` (if present, summarize into `inputs.context.intake`)
- `edit.json` (if editing decisions already exist, grep by ID and read relevant decision, decision_log, and chapter lines as context)
- `planning/` and `README.md` (project background, intent, provenance)
- Past projects / third-party-format template references (not just AKARI Video: Premiere / DaVinci / CapCut project files
  also qualify; record in `inputs.context.past_projects[]`)

This is an important handoff confirmed by field validation (internal multiasset-dogfood run, 2026-07-22):
**analysis.json alone (keyframe notes/events) may not support confident orphan/unclear classification**.
If footage alone does not establish an asset's purpose, grep the originating project's `edit.json` by ID for relevant
lines and read `planning/`, `README.md` / `CLAUDE.md`; these can establish the classification.
If surrounding context is unavailable or still insufficient, do not force certainty: use `open_questions`
or record low confidence in flags.

Always retain read context as provenance in `inputs.context` so later readers can trace interpretation inputs.
Omit keys for absent context, except retain empty `past_projects`/`interview` arrays when inapplicable to indicate
that they were checked and absent. See schema descriptions for details.

## Assembly procedure

1. Build `inputs.analyses[]` directly from `collect.md`'s reference table (`ref`/`path`/`source` required).
2. Read surrounding context and fill `inputs.context` (omit absent keys; empty `past_projects`/`interview` arrays allowed).
3. Build `assets[]` per asset: `ref` / `role` (free-text narrative-role tag) / `summary` /
   optional `sections[]` (chapter-level role analysis; for a single asset it can resemble `arc`, but do not force
   that granularity on multi-asset projects) / `relations[]` (relations to other assets; honestly use an empty array
   for unrelated assets rather than inventing relations) / `flags[]` (see [Mandatory flags scan](#mandatory-flags-scan)).
4. Arrange all `assets[]` and build proposed `arc[]` (`order`/`title`/`refs[]`/`purpose`/`evidence`).
   Pass 2 first reorders/integrates multiple assets here; pass 1 remains chronological.
5. Build `open_questions[]` ([Interview questions only](#open_questions-are-interview-questions-only-no-decision-questions)).
6. Validate using [validate-and-render.md](validate-and-render.md).

## Mandatory evidence, zero fabrication

Write claims in `assets[].summary`/`role`/`relations[]`/`flags[]` and `arc[].purpose` only when evidence
can be shown (quoted transcript range or keyframe-note reference). Do not write unsupported claims.
If `relations[]`/`flags[]` are effectively empty (e.g., assets really are unrelated), that is an honest result;
do not fabricate entries to make them nonempty (field-validated principle).

`flags[].evidence` is mandatory too (schema-enforced). Do not write unsupported impressions such as “it somehow feels out of place”.

## Mandatory flags scan

Scanning `assets[].flags[]` is a pass-2 contractual obligation. **An empty array means checked and none found,
not unchecked**, as the schema description states. Consciously consider all 3 types for every asset:
`orphan` (no confirmed connection to the main story), `unclear` (connection clues exist but no concrete editing evidence),
and `trouble_overlap` (trouble/digression within the main story). Retain the conclusion after scanning.
If these 3 cannot describe a encountered state, the enum may be extended by addition only, without changing/deleting
existing 3 values (requires a schema addition).

## open_questions are interview questions only (no decision questions)

The AI must not ask “What should we do?” It may ask only “What is this?” / “Why are you doing this?” for
**primary information absent from both footage and the internet**. Interviewing collects facts; it does not seek
permission or decide direction. Decisions belong to the chat dialogue phase (`edit-plan`).

### Good examples (interview questions)

- “When was the park location shoot?” (`fills`: record as asset metadata)
- “Was `audio/missing.wav` an SFX intended for the edit, or a placement error?”
  (`fills`: establish the factual cause of a broken reference)
- “Was the microphone noise (300.0-306.5s) caused by outdoor ambient sound or recording equipment?”
  (`fills`: check primary information supporting flags trouble_overlap)

### Bad examples (decision questions; do not write)

- “Keep this trouble section in the main video, or cut it?” — Editing decision for `edit-plan` chat dialogue.
  analyze-project records only facts (what happened, whether self-resolved, relevance to the main story) in `flags[]`.
- “Keep the chapter title or rephrase it?” — Structural preference.
- “What mood should the video have?” — Direction itself, handled in dialogue.

Distinguish whether the answer **fills primary information outside the footage (date, intent, history, proper names)**
(→ interview question), or **delegates choosing among multiple valid alternatives to the human on the AI's behalf**
(→ decision question; do not write).

## Stop condition (80-point line)

The interview stop condition is not numeric: **can the arc form a coherent whole without fabricated facts?**
End interviewing when every `arc[]` entry's `purpose`+`evidence` can be drawn directly from transcript/keyframe notes,
without rewatching footage. Remaining questions (preference-sensitive choices or minor facts unimportant to report
readers) go to post-edit refinement (`edit-plan` chat), not interview questions.

For self-contained footage (e.g., presenter explains all history/intent), finishing with 0 `open_questions` is normal
(field-validated). 0 interview questions does not mean pass 2 was careless; it means scanning found no gaps.

## arc is internal data (hidden from reports)

`arc[]` is required in interpretation.json (`minItems: 1`) but excluded from
[analysis-report](https://github.com/AkariLabs/akari-video/blob/main/packages/analysis-report/README.md) display (2026-07-22 revision).
Arc is an editing proposal, not pre-dialogue analysis: it supplies seeds for the AI's chat proposals and interview questions.
Do not lower pass 2 effort because it is hidden from the report; apply the same mandatory-evidence discipline.
