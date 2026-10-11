# English transcription and disfluencies

## Select English explicitly

Resolve the work's content language before transcription. For English footage, pass `--lang en`; do not rely on automatic language detection. The default SpeechAnalyzer path uses an English locale when supported and can transcribe English, including audible "um" and "uh." If that local backend is unavailable, whisper.cpp may be used; report the limitation if no local backend is available. A configured cloud backend still requires the normal decision-card approval before any audio is sent externally.

## Recognize candidates in context

Listen for filled pauses such as "um," "uh," "er," and "ah." Also consider discourse uses of "like," "you know," "I mean," "sort of," and "kind of," and opening transitions such as "so," "well," or "right." These words are candidates, not an automatic deletion list. A filler interval must be audible, have defensible source-time boundaries, and be removable without changing the speaker's intended meaning or distinctive delivery.

Keep lexical uses: "like" as a verb ("I like it") or a preposition ("like this"), and "you know" when the speaker is genuinely asking about or asserting knowledge. Keep "so," "well," or "right" when they connect an argument, answer a question, or carry emphasis. A pause alone does not prove a filler. Read the surrounding sentence and listen before assigning an event.

## Repetitions and false starts

A repeated fragment such as "I, I" or "that's, that's" may be an edit candidate when the first occurrence adds no meaning. A false start can include an abandoned word or clause followed by a corrected formulation. Mark only the audible span that can be removed while preserving the intended statement. Retain deliberate repetition, emphasis, contrast, or a correction that matters to the content. Do not infer a repetition solely because ASR timestamps overlap, and do not erase a speaker's characteristic phrasing indiscriminately.

## Recover evidence Whisper may omit

Whisper may suppress "um" and "uh" and collapse repeated words even when the rest of the transcript is accurate. When using whisper.cpp, pass `--keep-fillers` for the default English filler prompt, or `--whisper-prompt <text>` for a custom initial prompt. When the work's language is English and whisper.cpp is available, `akari media transcribe-cuts --filler on` regenerates an English whisper transcript with the filler prompt before producing candidates. Compare word-timestamp gaps with waveform regions that still show speech, then listen to the original audio around each candidate. A timestamp gap tells you where to check; it is not itself proof of a filler.

English filler and redo candidates use aligned SpeechAnalyzer word times when available; a word found only by Whisper is placed in the gap between aligned SpeechAnalyzer neighbors, and any extension toward the middle of a quiet span stops before other words. Cut boundaries must be quiet; a boundary in speech is tightened inward to a quiet point, and an `adjacent: true` candidate needs boundary review before applying the cut.

When verbatim coverage is necessary, use a separately verified verbatim ASR backend under the project's normal approval rules, or inspect the audio manually. Check each resulting event against the source recording. If only a cleaned transcript is available, report the limit on filler recall rather than fabricating missing words or event boundaries.
