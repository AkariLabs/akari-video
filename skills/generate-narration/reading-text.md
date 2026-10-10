# Reading-text preparation (display script → spoken text)

Pass the prepared **spoken text** to TTS and keep the display script separately in `edit.json` (hard rule 3; [narration data contract](../../docs/contract-2026-07-20-edit-json-v1-narration.md) §5). The two fields can differ, so neither can be reconstructed reliably from the other.

- `script`: The text shown to people and available for subtitle linking.
- `reading`: The exact text sent to the speech engine.

Do not put delivery instructions into the text to be spoken. Send supported delivery instructions through `--style` as a separate API field. Language-specific pronunciation and spelling rules are in the content-language pack named by SKILL.md; see [engines.md](engines.md) for the separate style field.

## Conversion targets

See lang/<content-language>.md. The display `script` and spoken version may differ for names, abbreviations, numbers, dates, and units. Change only terms that a listening check shows the selected engine misreads.

## Procedure

1. Prepare `script` from the approved display copy or captions.
2. Apply the content-language pack to create `reading`, preserving the intended meaning.
3. Pass `reading` to `--reading-file` and `script` to `--script-file`.
4. Listen to the generated audio. Correct individual mispronounced terms and regenerate; do not rewrite the whole script without a reason.

## Why save both?

The conversion may be manual or depend on the engine, so `reading` does not determine `script`. Keep the display script as the readable record for review and `reading` as the record of what was actually generated. Both are required when changing engines or revising the audio later.
