# English narration and voice choice

## Choose an available English voice

Do not choose an engine or voice from memory. Run `akari narration engines --json` and select a row whose `languages` includes English and whose `availability.state` is usable. Then run `akari narration voices --engine <id> --json` and audition only the voices it actually returns. Do not invent voice IDs or locale flags.

A row marked `candidate: true` is unauditioned. Use it only when the user names it; never make it the default or a recommendation. Some rows may reject English through a fixed locale field or provider limit. Verify the rendered output before treating any row as an English production default; if no row produces acceptable English in the current environment, report the limitation and keep the narration at the script or draft stage rather than silently falling back to a Japanese-only path.

Audition by requirement, not by remembered voice names:

- **Calm explanation:** choose voices whose listed description suggests a calm or even tone, then confirm clarity by ear.
- **Bright announcement:** choose voices described as bright or upbeat, then check that excitement does not reduce intelligibility.
- **Slower explanation:** choose a voice whose description suggests a gentle or soft delivery, and use a concise pacing instruction through the supported `--style` field if the row declares `supports.style`. Verify the rendered pace by ear; a description is not a speed guarantee.

The engine row's `default_voice` is the software default, not proof that it is the best English voice. Audition against the use case before accepting it.

## Plan pace and pronunciation

Use roughly **125–150 words per minute** as an initial script-length estimate, then time the generated audio and adjust for information density and the desired delivery. This is a planning range, not a quality threshold or a promise about a TTS engine's actual speed. A dense explanation may need more pauses; a short announcement can be brisker if every word remains clear.

Keep `script` as the displayed English text and `reading` as the exact text sent to TTS. Listen for numbers, dates, units, abbreviations, and proper names. Expand or respell only the terms the engine actually misreads, and preserve the original display text for subtitles and review. Choose US or UK accent to match the work's target audience; audition the actual voice and use the supported style field for delivery guidance rather than inserting instructions into spoken text.

## Voice-profile recording text

There is no approved English canonical recording script corresponding to the fixed Japanese [reading-script-v1.md](../assets/reading-script-v1.md). Do not translate that Japanese text and claim it matches `reference_text`. Before cloud cloning for an English profile, obtain an approved English recording script and a verification path that checks the reference recording against that exact text.
