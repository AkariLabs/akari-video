# English narration and voice choice

## Choose an available English voice

Do not use `VOICEVOX` or its speaker 3 default for English narration; those are Japanese voice choices. First confirm that the selected engine path accepts English in its current implementation. Of the engines currently defined in the repository, the direct `gemini-3.8-flash-tts` request has real listed voices and does not force a Japanese language field, so audition it first for an English draft. Other current paths explicitly hard-code Japanese through `language_code`, `language`, `language_boost`, or the Chatterbox voice. Wait for the locale interface and verify its output before treating any of those paths as an English production default. Do not invent voice IDs or locale flags.

Start auditions with actual voices listed in the engine definitions:

- **Calm explanation:** Try `Charon` (Informative) or `Schedar` (Even). Choose by listening for clarity and a tone that suits the audience.
- **Bright announcement:** Try `Zephyr` (Bright) or `Autonoe` (Bright). Check that excitement does not reduce intelligibility.
- **Slower explanation:** Try `Achernar` (Soft) or `Vindemiatrix` (Gentle), with a concise pacing instruction through the supported `--style` field if needed. These are voice candidates, not guaranteed slow-speed settings; verify the rendered pace by ear.

`Leda` is also a real listed voice and the current Gemini default, but that software default is not proof that it is the best English voice. Audition against the use-case choices above. If the direct path cannot produce acceptable English in the current environment, report the limitation and keep the narration at the script or draft stage rather than silently falling back to a Japanese-only path.

## Plan pace and pronunciation

Use roughly **125–150 words per minute** as an initial script-length estimate, then time the generated audio and adjust for information density and the desired delivery. This is a planning range, not a quality threshold or a promise about a TTS engine's actual speed. A dense explanation may need more pauses; a short announcement can be brisker if every word remains clear.

Keep `script` as the displayed English text and `reading` as the exact text sent to TTS. Listen for numbers, dates, units, abbreviations, and proper names. Expand or respell only the terms the engine actually misreads, and preserve the original display text for subtitles and review. Choose US or UK accent to match the work's target audience; audition the actual voice and use the supported style field for delivery guidance rather than inserting instructions into spoken text.

## Voice-profile recording text

There is no approved English canonical recording script corresponding to the fixed Japanese [reading-script-v1.md](../assets/reading-script-v1.md). Do not translate that Japanese text and claim it matches `reference_text`. Before cloud cloning for an English profile, obtain an approved English recording script and a verification path that checks the reference recording against that exact text.
