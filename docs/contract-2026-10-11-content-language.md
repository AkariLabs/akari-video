# Content language contract

The content language belongs to a project and is independent of the UI and conversation language. A Japanese interface can edit a video with English captions and narration.

Store an optional BCP 47 language tag at `.akari/intake.json` as `language` (root `intake.json` is a fallback for readers). Transcription may record an optional tag at the root of `analysis.json` as `transcript_language`. The `transcript` field stays an array; the language is a sibling field because JSON arrays cannot carry named properties without breaking existing readers.

`resolveContentLanguage()` in `packages/content-language` is the single resolver. It checks, in order, an explicit CLI `--lang`, `intake.language`, and `analysis.transcript_language`; if none is valid it returns `ja`. It returns both the normalized `language` and the chosen `source`. A valid BCP 47 style tag is reduced to its lowercase primary language, for example `en-US` becomes `en`. Invalid and empty tags are skipped.

`packLanguage()` selects a matching available pack. Japanese always uses `ja`; another language without its own pack uses `en`, or the first available pack if `en` is missing. Each consuming package owns its language keyed data packs. Agent skill packs live at `skills/<skill>/lang/<code>.md`; Japanese packs retain Japanese rules, and English packs are authored for English conventions.
