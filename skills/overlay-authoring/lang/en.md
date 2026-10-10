# English content conventions

Use this pack for the language of the video, independently of the user's conversation language or the application's UI language. Keep renderer, layout, timing, and CSS contracts in the main authoring leaves.

## Capitalization and emphasis

- Use sentence case for spoken captions and subtitles. Preserve ordinary English capitalization, including proper nouns and acronyms. Mixed case is easier to read than a whole caption in capitals; reserve all caps in captions for shouting or screaming.
- A designed telop or thumbnail headline may use title case when the series style calls for it. Use sentence case when the line reads as a sentence. If you use all caps for display emphasis, apply it to one short keyword or number, not a whole spoken sentence. Keep the spelling faithful to the audio and the video's claims.
- Emphasize the word that carries the claim: a concrete noun, number, or action verb. Do not emphasize articles, prepositions, or every word. Keep the emphasized text readable without color alone.

## Subtitle line length and reading time

- For English subtitles, use **no more than two lines**. Netflix's English (USA) timed text specification sets **42 characters per line**. Treat this as a delivery specification and a useful initial guide, not an AKARI-wide hard limit. Check the actual output frame and safe area.
- Netflix's English (USA) translation guideline allows **up to 20 characters per second for adults** and **17 for children's programs**. Count spaces and punctuation in characters. DCMP's educational-caption targets use words per minute instead: **130 wpm for lower-level**, **140 wpm for middle-level**, and **160 wpm for upper-level** media. Pick a target for the audience and delivery specification; do not silently apply a children's target to adult short-form video or vice versa.
- Retain the essential meaning and the timing of speech. If the line cannot be read in its display time, first split it at a natural pause or condense nonessential repetition without changing the claim. Do not solve every overflow by shrinking type.

## Line breaks and punctuation

- Break at a syntactic or spoken pause. For two lines, Netflix advises breaks after punctuation and before conjunctions or prepositions. Do not separate an article from its noun, an adjective from its noun, a subject pronoun from its verb, an auxiliary or negation from its verb, or a prepositional verb from its preposition. Do not leave a short article or preposition stranded at line end.
- Keep punctuation consistent. Use sentence punctuation where the utterance ends. Do not add an ellipsis or dash merely because one sentence continues in the next subtitle. Netflix uses an ellipsis when dialogue trails off or a pause lasts **at least two seconds**. Follow the target platform's rule when it differs.
- For SDH, include speaker and meaningful sound information when required; place captions where they do not cover faces, on-screen evidence, or essential graphics.

## Captions for short-form video

- Short, timed phrases can follow spoken beats, but keep each phrase long enough to read and keep the line breaks grammatical. Do not fill every frame with a bouncing word. Use a designed telop for a selected emphasis; preserve an accurate caption track for the actual speech.
- Check the final frame on the intended phone-size display. Position captions around the platform's current interface overlays and the subject, using the safe-zone contract in `telop.md`. Do not substitute a subtitle character limit for a layout check.

## Thumbnail wording

- Use one brief phrase that adds a claim or question the image alone cannot convey. As a working **three-to-five-word** starting range, keep only words that survive a phone-size preview; this is a design heuristic, not a platform limit. The video title can carry context that would crowd the thumbnail.
- Pair the words with evidence in the frame. Do not promise a result, quote, emotion, or comparison the video cannot support. Use the same case style across a series, and use all caps only for a deliberately emphasized word or short label.

## Sources

- Netflix, *English (USA) Timed Text Style Guide* — character limit, reading speed, continuity, and English subtitle treatment.
- Netflix, *English (UK) Timed Text Style Guide* — maximum two lines and syntactic line breaks.
- DCMP, *Captioning Key* — mixed case, logical line breaks, caption placement, and educational presentation rates.
- BBC Research & Development, *White Paper 330* — a documented subtitle workflow using two lines of about 40 characters.
- YouTube Help, *Thumbnail & title tips* — concise, readable thumbnail text that complements the title.
- CTRpilot, *YouTube Thumbnail Text* — the three-to-five-word thumbnail heuristic.
