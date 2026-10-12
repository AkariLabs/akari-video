# Evaluate events and score hooks

## Principles

An event is evidence for later decisions about cuts, chapters, or the opening, not merely a point that an automated detector might find. Record times in source seconds. Every interval event must satisfy `end > start`. Leave uncertain candidates out; an empty array is valid.

## Identify the five event types

| Type | Record when | Set boundaries using | Do not record for |
|---|---|---|---|
| `filler` | A hesitation, repetition that adds no meaning, or restart can be removed without changing the speaker's intent. | The actual speech boundaries in the transcript, checked against the audio; record `start` / `end`. | A meaningful pause, emphatic repetition, or a guess based only on an ASR error. |
| `trouble` | Audio drops out, video freezes, an operation fails, recording goes wrong, or a retake is explicitly requested. | The source interval from the start of the problem until normal recording resumes. | Silence or a transcript gap alone, or a difficult topic without a recording problem. |
| `chapter` | The topic, goal, procedure, or screen state changes to a new coherent section. | The source time `t` that best represents the transition. | Dividing every sentence or marking a fleeting visual cut with no substantive change. |
| `highlight` | An important statement, such as a decision, conclusion, result, number, strong claim, or quotable line, provides evidence for an editorial choice. | The actual `start` / `end` of the transcript segment containing that statement. | A mere topic summary, a screen change that does not support the statement, or a long explanation with no key point. |
| `hook` | A short segment can stand alone and gives viewers a reason to keep watching. | The shortest opening needed for comprehension through the point where its value or payoff is clear. | A fragment that depends heavily on context or works only if exaggerated. |

In `trouble.note`, explain what happened and cite the evidence. Make `chapter.title` a short noun or action phrase grounded in the transcript; never attribute words the speaker did not say. Do not add a `note` field outside the schema to `filler` or `hook`.

Some transcription backends normalize away fillers. Prefer a backend transcript that retains them when available. If only transcripts likely to omit them are available, state the resulting recall limit in the completion report.

## Identify highlights: important statements

This section follows the [M5 contract addendum (2026-07-14)](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-13-m5-analysis-report.md). A hook supports a short opening or excerpt; a highlight captures an important statement useful to broader editorial decisions. The same interval may be both when it serves both purposes.

- Write `quote` **faithfully to the actual transcript**. Do not summarize, paraphrase, or invent words. Formatting is limited to adding punctuation.
- In `reason`, explain why the statement matters and name the evidence category, such as "states a release date (decision)" or "quantifies an implementation result (number/result)."
- `importance` is optional and takes an integer from 1 to 5: 3 means a reason to keep the statement in the edit; 4 means a possible on-screen title or chapter heading; 5 means a possible centerpiece for a thumbnail or short clip. Avoid registering 1–2, which would inflate the list.
- As an initial, unverified guideline, a roughly 60-minute source should yield about 5–15 highlights. Do not copy every statement into the list.
- Do not create a highlight when the transcript is empty, because `quote` is required. Use `chapter` or `hook` for important visual-only moments.
- Confirmed highlight times feed transcript-driven keyframe extraction; see [keyframes-and-review.md](keyframes-and-review.md).

## Score hooks on five axes

### Record only windows that were scored

Even at L2, do not score the entire source or every possible window. Evaluate only windows requested by the user or a later skill, or short candidates selected from the transcript and viewed imagery. Record only scored windows as `hook` events. An unscored window is unassessed, not a zero.

Follow this order:

1. Before viewing downstream measurements such as views or retention, fix the candidate window, predicted scores on all five axes, and reason for selecting it.
2. Score only those fixed windows against the rubric below and record the scores in the ledger.
3. If measurements arrive later, compare them with the predictions separately. Do not revise the original predicted scores retroactively to fit the outcomes.

**Fix the prediction before measuring the outcome.** You may predict scores without measured performance, but never describe predictions as measured results.

`analysis.json` v0 requires integer scores from 1 to 5. The anchors below are initial working guidance, **not official platform metrics**, and require validation. Choose the nearest description, including scores 2 and 4.

| Axis | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| `hook` — strength | An introduction with no point of interest | Some interest, but little reason to continue | A problem, question, or surprise is clear | A result, conflict, or strong benefit appears quickly | An instantly understandable surprise or high stakes makes continuation compelling |
| `self_contained` — independence | Incomprehensible without surrounding context | References and assumptions need substantial explanation | A short introduction makes the point understandable | Situation and value are almost clear on their own | Situation, claim, and destination are clear without context |
| `emotion` — emotional intensity | No observable emotional change | Only a small reaction | Clear joy, surprise, urgency, or similar emotion | A strong, natural reaction drives the interval | Image, voice, and content converge at the source's emotional peak |
| `density` — value density | Mostly waiting or repetition | The preamble is longer than the useful part | Information or change continues throughout | Nearly every moment advances understanding or anticipation | Dense and economical while remaining comprehensible |
| `punch` — payoff | No destination | Only a weak conclusion | A clear conclusion, result, or lesson | A memorable result or decisive statement | A vivid reversal, demonstration, or closing line rewards rewatching |

Volume alone does not raise `emotion`, and information quantity alone does not raise `density`. Score each axis independently.

## Initial threshold for registering candidates

The v0 contract treats adoption thresholds as adjustable operating values. Initially, register an interval as a hook candidate only when it satisfies all three conditions:

- `hook >= 3`
- `self_contained >= 3`
- Five-axis total `>= 16 / 25`

These are **unvalidated starting thresholds**, not official platform success criteria. If the source genre or distribution channel warrants changing one, report the original value, new value, and reason. If a below-threshold interval still merits human review, keep the threshold intact and report that the candidate is an exception.

Rank candidates by total score; break ties using `hook`, then `self_contained`, then `density`. This ranking rule also requires validation and is not an absolute measure of quality.

The scale comes from the [M5 analysis.json v0 contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-13-m5-analysis-report.md).

## Supply evidence for highlight extraction

Later work in [edit-plan's beats.md](../edit-plan/beats.md) derives highlight markers in `edit.json` `beats[]` from the `hook`, `chapter`, and `highlight` events and hook scores recorded here; see the [data contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-22-edit-json-v1-beats.md). Keep the extraction method above and meet these two additional quality conditions:

- **Do not emit an unscored highlight.** If `importance` is absent, later stages cannot determine its strength and will use a default. When a statement is important enough to guide an edit, assign an integer from 1 to 5; omit candidates too weak to assess.
- **Use source seconds for event time.** The event's `t` and any interval `start` / `end` refer to the uncut source. Beat markers persist source-time anchors, so mixing in timeline seconds creates errors later stages cannot detect.

## Event consistency

- Sort events by source time. For equal times, the order may be `trouble`, `filler`, `chapter`, `highlight`, then `hook`.
- Do not register the same interval as both filler and trouble; choose the primary cause.
- A highlight may overlap a hook because they serve different purposes. Review any overlap between highlight and filler before registering it.
- Remove a hook that overlaps trouble unless the trouble itself is valuable content.
- A chapter may start at the beginning of the source, but that is not mandatory.
- With an empty transcript, do not create speech-dependent fillers or highlights. Assess only visually verifiable trouble, chapters, and hooks, with evidence.

## Common mistakes

- Removing a speaker's characteristic phrasing or meaning by labeling every habitual expression a filler.
- Treating a blank ASR result as proof of an audio failure.
- Generating chapters at fixed intervals.
- Giving all five hook axes the same score based on an overall impression.
- Dividing the full source into fixed windows and scoring them all regardless of the request.
- Rewriting predicted scores after seeing measured results.
- Assuming strong emotion can compensate for a hook that makes little sense alone.
- Describing working thresholds as official platform success criteria.
- Summarizing or paraphrasing a highlight in `quote` instead of preserving the actual statement.
- Inflating highlights by automatically registering every topic with importance 1 or 2.
- Omitting decisions and numerical statements as highlights because they are less flashy than hooks.
