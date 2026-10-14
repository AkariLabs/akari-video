# Content language

The content language controls transcription, captions, filler detection, narration, and language packs. It is separate from the interface and conversation language.

`resolveContentLanguage()` chooses the first valid tag from `cliLang`, `intake.language`, and `analysis.transcript_language`, then defaults to `ja`. Tags use the lowercase primary language (`en-US` → `en`). `packLanguage()` uses the requested pack if available, always retains `ja` for Japanese, and otherwise uses `en` (or the first available pack). The `transcript` field remains an array; its language belongs in the sibling `transcript_language` because JSON arrays cannot carry named properties without breaking existing readers.

As with `edit-store`, downstream packages use relative imports so the same path works in the checkout, npm vendor mirror, and app bundle: a file in `src/` of `akari-tools`, `render-cut`, `akari-launcher`, `edit-lint`, or `overlay-runtime` imports `../../content-language/src/index.mjs` (add `../` for each deeper directory). Node consumers that read files import `../../content-language/src/node.mjs` from `src/`. Workspace exports are also available as `@akari-video/content-language` and `@akari-video/content-language/node`.

`readContentLanguage(projectRoot)` checks `.akari/intake.json` first, then root `intake.json` as a fallback, and root `analysis.json`. Missing or malformed files are ignored.
