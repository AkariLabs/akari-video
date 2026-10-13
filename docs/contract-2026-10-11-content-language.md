# Content language contract

The content language belongs to a project and is independent of the UI and conversation language. A Japanese interface can edit a video with English captions and narration.

Store an optional BCP 47 language tag at `.akari/intake.json` as `language` (root `intake.json` is a fallback for readers). Transcription may record an optional tag at the root of `analysis.json` as `transcript_language`. The `transcript` field stays an array; the language is a sibling field because JSON arrays cannot carry named properties without breaking existing readers.

`resolveContentLanguage()` in `packages/content-language` is the single resolver. Project readers supply it with an explicit CLI `--lang`, `intake.language`, and the `transcript_language` in the root `analysis.json` or `.akari/sidecars/assets/**/*.analysis/analysis.json` with the longest transcript (ties use root first, then asset path order), in that order; if none is valid it returns `ja`. It returns both the normalized `language` and the chosen `source`. A valid BCP 47 style tag is reduced to its lowercase primary language, for example `en-US` becomes `en`. Invalid and empty tags are skipped.

`packLanguage()` selects a matching available pack. Japanese always uses `ja`; another language without its own pack uses `en`, or the first available pack if `en` is missing. Each consuming package owns its language keyed data packs. Agent skill packs live at `skills/<skill>/lang/<code>.md`; Japanese packs retain Japanese rules, and English packs are authored for English conventions.

## Transcription backend language

Transcription passes an explicit `--lang` to the backend, otherwise uses `intake.language`, and otherwise requests automatic detection. SpeechAnalyzer receives a matching BCP 47 locale (for example, `en-US` or `ja-JP`). A language without a supported SpeechAnalyzer locale uses whisper.cpp. Transcript sidecars and analysis data record the language used. English filler detection uses a separate pack; context-dependent phrases remain low-confidence suggestions. The optional whisper.cpp filler prompt can be enabled with `node packages/akari-tools/src/media/transcribe.mjs <target> --lang en --whisper-prompt on` (with optional `--in` and `--out` seconds); `transcribe-cuts --filler on` enables it when regenerating an English whisper transcript.
