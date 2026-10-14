# open_questions examples — Interview versus decision questions

Additional examples for [interpretation.md](../interpretation.md#open_questions-are-interview-questions-only-no-decision-questions).
When unsure, ask whether the answer supplies **primary information** or **a choice among valid alternatives**.
Write only the former.

## Interview questions (allowed) — Fill primary-information gaps

| Situation | Question | fills (why ask) |
|---|---|---|
| Referenced SFX file does not exist | “Was `audio/missing.wav` intended for placement, or is the reference wrong?” | Establish the factual cause of the broken reference |
| Shoot date absent from transcript and originating project | “When was this B-roll filmed?” | Strengthen flags/relations evidence |
| Real name / publication consent unverified | “Has the person shown agreed to publication under their real name?” | Inform privacy considerations (the decision itself belongs to editing) |
| Proper name/reference unclear due to hesitation | “Do you know the exact date meant by ‘the last Sunday in July (month 7)’ as the release date?” | Verify factual accuracy; ask only if essential to a coherent arc |
| Technical cause of trouble unclear | “Is the cause of the screen freeze (44:34-44:49) known? Did it resolve itself?” | Establish facts supporting flags trouble_overlap |

## Decision questions (do not write) — Delegate choices to the human

| Bad question | Why it is a decision question | Do instead |
|---|---|---|
| “Keep this trouble section in the main video, or cut it?” | Choice among valid alternatives | Record only facts (contents, self-resolution, main-story relevance) in `flags[]`; send inclusion decisions to edit-plan chat |
| “Keep the chapter title or rephrase it?” | Preference | If the pass-1 title does not represent the whole chapter, pass 2 directly corrects it with evidence (factual correction, not preference, is allowed) |
| “What mood should the video have?” | Direction itself | Handled by edit-plan dialogue; analyze-project only presents facts |
| “Which thumbnail proposal is best?” | Choice among alternatives | analyze-project does not create that report; edit-plan presents thumbnail proposals in chat |
| “Which BGM should we use?” | Choice among alternatives | Asset planning (edit-plan); analyze-project records only relevant facts such as existing audio tracks |

## Ambiguous boundary cases

- “Why is this asset here?” — **Valid interview question** (primary provenance/intent information).
  First inspect the originating project's `edit.json`/`planning/`/`README.md` if they can establish it;
  interviewing is the last resort for information absent from footage and the internet.
- “Are these 2 assets related?” — Pass 2 first attempts a factual judgment (same person/place/time or overlapping
  contents) from transcript/keyframe notes. If impossible, leave `relations[]` empty or interview only for the
  primary information needed (e.g., shoot date/location). Avoid “Should we treat these as related in the structure?”
  because that asks for a decision.
