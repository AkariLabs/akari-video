**English** | [日本語](./narration.ja.md)

# Add narration

Generates audio from a script and wires it into `edit.json`. The skill is `generate-narration`.
You can also put your own voice in directly with voiceover recording, which records
from the microphone while the preview plays.

## When to use it

- When you want to add narration to an explainer video or vlog
- When you want a quick scratch narration (to check duration) fast
- When you want to generate narration from a clone of your own voice
- When you want to record your own voice while watching the footage (→ [Voiceover recording](#voiceover-recording))

## Engines

| Engine | Characteristics | Cost |
|---|---|---|
| VOICEVOX | Runs locally, character voices, no key needed | Free |
| Gemini TTS | 30 ready-made voices. Through fal (`gemini-tts`, `gemini-3.1-flash-tts`) or called directly on Google AI (`gemini-3.8-flash-tts`) | Paid |
| Fish Audio | Public Japanese voices; your own voice can be used as a reference | Paid |
| fal Qwen3-TTS | Clone of your own voice | Paid |

There are also ElevenLabs v3, MiniMax Speech 2.6 HD, Chatterbox multilingual, and Index TTS 2
through fal, and Irodori-TTS (experimental), which connects to a server you run yourself. See
which engines are usable and their connection status with `akari narration engines --json`.

A paid engine shows an estimate and runs only after you approve it explicitly (without
approval nothing is sent and it stops). Keys (`FAL_KEY`, `GEMINI_API_KEY`, `FISH_AUDIO_API_KEY`)
are handled through `setup-connections`, and an engine that is not connected cannot be chosen.
You won't be charged without your say-so.

## How to ask

- "Add narration with this script"
- "First a scratch narration to check the length" (→ VOICEVOX, generated immediately)
- "I want it in my own voice" (→ starts with creating a voice profile)
- "Replace the scratch narration with a Fish Audio voice" (rebuilt from the same script at the same position, with a new id)

You can also make it from "Add narration" in the app's inspector. For a cloud voice, a single
cost approval comes before the preview.

## What it produces

- An audio file (placed under the project's `out/narration/`)
- An entry in `audio.narration[]` of `edit.json` (which audio goes where). It carries the display
  script (`script`), the reading text used for speech (`reading`), and the provenance
  (`provenance`; VOICEVOX voices also carry the character credit)

After generation, [verify-edit](./review-and-fix.md) checks duration, overlaps, and broken references.
How the reading text is prepared and how a voice is chosen depend on the work's language
(Japanese, English, and so on).

Do not mix reading or delivery instructions ("Read this cheerfully:") into the text. The engine
can read them aloud. Build intonation with punctuation and word order, and send delivery guidance
through the style option of an engine that supports it.

## Check the voice by listening

```sh
akari narration verify --project <project> --id n-0001 --json
```

This transcribes the generated audio on this computer (SpeechAnalyzer or whisper.cpp) and compares
it with the caption text. Nothing is sent to the cloud. The "ok", "check", and "ng" rating helps
you catch misreadings and spoken instructions.

## Voice profiles (your own voice)

You can use only your own voice. Another person's voice, or a voice cut out of a video, cannot be used.

1. Record yourself reading a fixed script (`quick-v1`, about 20 seconds, or `extended-v1`, about 60 seconds)
2. Check the script match, length, and level on this computer (a required check before anything is sent to the cloud; a match of at least 70%)
3. Record your consent and create the voice profile. Creating the voice in the cloud needs separate consent to send the recording

Voice profiles are stored outside the project (under `~/.akari/avatars/<person>/voice/`) and can
be reused across projects.

```sh
akari voice scripts --json
akari voice check --audio <recording> --script quick-v1 --json
akari voice create --avatar <person> --id <voice-id> --label <name> --audio <recording> --script quick-v1 --consent-self --json
akari voice profiles --json
```

## Voiceover recording

Use the 🎙 (Dubbing) at the top right of the timeline (left of the magnifier) to record your voice and place
it on the timeline.

- **Record while playing**: press the red circle to record while the preview plays from the playhead. When you stop, the recording is placed where you started
- **Mute the project audio while recording**: the video's sound and BGM can be paused only while recording. Turn it off if you listen on earphones
- **Record from a script line**: use the 🎙 on a script line (the "🎙 Voiceover" in the bar when a line is selected) to record from that line's start while reading its text. A recorded line gets a "🎙 Recorded" mark. The placed voice keeps the line's text as its `script`
- **Remove noise**: apply noise reduction to the placed voice. The voice stays as is and only the noise in silent parts drops. It uses the same methods as the audio clip's noise removal (NLM keeps the voice and is recommended; FFT is light and fast) and does not rewrite the original audio
- You can choose the microphone and its level, and a level meter shows whether it is recording

## Relationship to BGM

With `ducking` enabled on the BGM, the BGM lowers during narration and voice sections. Preview and
export use the same rule.

## Next steps

- Add BGM and SFX too → [Plan and run an edit](./plan-your-edit.md) (plan-edit handles the audio plan)
- Connection setup → [Connections and API keys](../how-to/connections.md)

<!-- BEGIN GENERATED facts:stamp -->
This page describes AKARI Video v1.5.1 (released 2026-10-19).
<!-- END GENERATED facts:stamp -->
