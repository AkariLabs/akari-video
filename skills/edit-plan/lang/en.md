# English language pack

Read the content-language sections when the video's spoken or written content is English. Read the report-and-record section when the user's conversation language is English, regardless of the video's language.

## Emphasis word selection

Select content words that carry the point of a sentence, especially a key noun or verb, a number, a negation, or a contrast. Do not select hesitation fillers such as um, uh, erm, uhm, or hmm. Treat like, you know, I mean, sort of, and kind of as context-dependent suggestions, since they may carry meaning. Do not emphasize function words such as so, and, or the merely because they are short or occur at a beat. Preserve the general candidate tier, timing, evidence, and density rules in emphasis-detection.md. The filler examples match the English pack in `packages/akari-tools/src/media/filler-lexicon.mjs`.

For English `transcribe-cuts` filler and redo candidates, align Whisper words with SpeechAnalyzer words for timing; place Whisper-only disfluencies in the gap between aligned SpeechAnalyzer neighbors, and keep any quiet-span extension clear of other words. Keep cut boundaries in quiet spans, tightening inward when they land in speech; review `adjacent: true` candidates, and check the exported boundary by listening when an approved short `transition_out` uses render-cut's audio crossfade.

## English captions and title text

Break lines where English syntax and speech naturally pause. When a two-line subtitle is needed, prefer a break after punctuation or before a conjunction or preposition; keep an article with its noun, an adjective with its noun, a subject pronoun with its verb, and an auxiliary or negation with its verb. Prefer one line when it fits. Do not change the CLI's configured `--max-chars` default or timing rules based on these editorial conventions. Review the actual rendered frame for readability. For title text, keep a meaningful phrase together, use natural English capitalization, and avoid breaks that separate a modifier from the word it describes. Sources: Netflix English Timed Text Style Guide; DCMP Captioning Key, Text.

## Report and record writing (user language)

When the user writes in English, write recommendations, approval prompts, and the decision and reason cells in clear English. State the recommendation, alternatives, reasons, benefits, and costs; ask for approval, revision, or rejection rather than an open-ended choice. Use the exact English decision-log header from report-guide.md for a new file; when appending to an existing file, preserve its header language and earlier rows. Keep approval prompts concise and explicit.
