---
name: generate-narration
description: Generate narration from a script and add it to edit.json audio.narration[]. Read `akari narration engines --json` to choose an engine and voice; use a candidate row only when the user names it. Use for a draft voiceover, final narration, a new voice profile, or replacing an existing voice or engine.
---

# Generate narration audio

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

Read lang/<content-language>.md for language-specific rules (content language: --lang → intake.json "language" → transcript language → ja; see https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-10-11-content-language.md). If that file does not exist, read lang/en.md. Pass the work's content language to the TTS engine when its locale interface is available.

Read only the relevant lines of `edit.json` and `captions.json` by id, following [the edit.json access guide](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/edit-json-access.md). Write through the Edit operation or the edit-store script API.

# FORBIDDEN-level hard rules

These rules take precedence over detailed instructions.

1. **Clone only the profile owner's own voice.** Never use a profile without a consent record.
2. **Verify reference audio locally before external upload.** Run the local Whisper script-matching guard. Skip it only on the owner's explicit instruction and record that exception.
3. **Generate from prepared reading text.** Store both the display script and the exact reading text in edit.json through Edit or the edit-store script API. Follow the content-language pack for language-specific pronunciation.
4. **Declare the cost, then run paid lanes only after explicit approval.** This applies to fal, direct Google AI Gemini, and Fish Audio. Even when a price cannot be estimated, the CLI must stop at exit 2 unless `--yes` was authorized.
5. **Never call an API key directly; use only [setup-connections](../setup-connections/SKILL.md).** fal (including Gemini via fal) uses `FAL_KEY`, direct Google AI Gemini uses `GEMINI_API_KEY`, and Fish Audio uses `FISH_AUDIO_API_KEY`. [setup-connections](../setup-connections/SKILL.md) is authoritative for names, sources, and doctor status. Keys live in <!-- F paths.credentials -->`~/.akari/credentials.env`<!-- /F --> (the legacy <!-- F paths.credentials.legacy -->`~/.config/akari-video/credentials.env`<!-- /F --> is readable). Do not offer a lane whose doctor status is not `ok`.
6. **Record provenance.provider.** For example, `"provenance": {"provider": "voicevox", "credit": "VOICEVOX:ずんだもん"}`. Use `"provider": "fal"` for fal and `"provider": "human"` for recorded speech. VOICEVOX voices also require character credit.
7. **Send the canonical WAV as a data URI for fal reference audio.** Stop before upload if that file exceeds 20 MB.
8. **Never mix pronunciation or delivery instructions into spoken text.** Put only words to be spoken in `--text`, `--reading-file`, or `--script-file`; do not prefix them with an instruction such as “Read this cheerfully:”. A direct Gemini engine has read an instruction prefix aloud. Create intonation through the script's punctuation, word order, and reading-text conversion; send delivery guidance only through `--style` on engines that support a separate API field. See [engines.md](engines.md).

## Execution order and leaf files

1. Read [engines.md](engines.md) to choose a supported adapter and generate the narration. Read the content-language pack before selecting a voice or a draft-to-final workflow.
2. Only if an own-voice clone is requested and no profile exists, read [voice-profile-setup.md](voice-profile-setup.md). Present the fixed script, record the voice, check the script match locally, obtain any needed approval, create the clone, save it, and audition it.
3. Read [reading-text.md](reading-text.md) to prepare the exact spoken text from the display script, using the content-language pack for pronunciation rules.
4. For an avatar, read [avatar-voice.md](avatar-voice.md) and resolve `lane` and `ref` from `voice/voice.json` to an engine.
5. If word timing is needed for the generated audio, for example to align screen motion with words, run `akari media transcribe <音声>` through the same silence-aligned L1 path as analyze-footage. Pass the work's language; do not call whisper-cli directly.

Read only the leaf for the current step.

## References

- Narration data contract: [docs/contract-2026-07-20-edit-json-v1-narration.md](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-20-edit-json-v1-narration.md)
- Audio contract for BGM, SFX, and ducking: [docs/contract-2026-07-14-edit-json-v1-audio.md](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-14-edit-json-v1-audio.md)
- Connections, doctor checks, and cost approval (read only; do not edit it): [setup-connections](../setup-connections/SKILL.md)
- Existing cloud-transcription implementation: [transcribe-cloud.mjs](../analyze-footage/bin/transcribe-cloud.mjs)
