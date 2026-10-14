# Narration engine adapters

Use `akari narration generate` to create the narration audio:

```
akari narration generate \
  --project <projectDir> --engine <voicevox|gemini-tts|irodori|fal-qwen3|gemini-3.1-flash-tts|elevenlabs-v3|minimax-2.6-hd|chatterbox|index-tts-2|fish-s2.1-pro|gemini-3.8-flash-tts> \
  --reading-file <読み原稿.txt> [--script-file <表示原稿.txt>] \
  --t <タイムライン秒> [--gain-db 0] [--id n-0001] \
  [--voice <声>] [--style <話し方>] [--text <原稿>] \
  [--speaker 3]              # voicevox 用（既定 3 = ずんだもん/ノーマル）
  [--profile <id>]           # 自分の声（irodori / fal-qwen3 / minimax / chatterbox / index-tts-2 / Fish）
  [--dry-run] [--yes] [--apply]
```

- `--reading-file` is required. Pass the prepared reading text described in [reading-text.md](reading-text.md) and the work's language pack.
- `--script-file` is optional. When supplied, its display text is stored as `script`.
- When `--id` is omitted, the CLI assigns one greater than the highest existing ID in `<projectDir>/edit.json` `audio.narration[]`, or `n-0001` if there are no entries.
- Audio is saved under `<projectDir>/out/narration/<id>.<wav|mp3>`: WAV for voicevox, irodori, chatterbox, and Gemini 3.8; MP3 for Fish Audio and fal TTS.
- `--apply` adds an entry to `edit.json` `audio.narration[]`, creating `audio` or `narration` if needed. It immediately runs `packages/schemas/bin/validate-edit.mjs` and rolls back the write if validation fails.
- Without `--apply`, the CLI generates the file and prints the entry JSON to stdout but leaves `edit.json` unchanged, allowing manual review before insertion.

## VOICEVOX adapter

- VOICEVOX runs locally, costs nothing, and needs no API key. Use an engine already listening at `http://127.0.0.1:50021`; otherwise start vv-engine's `run` headlessly, wait up to 60 seconds for `/version`, and stop it after generation only if AKARI started it.
- Resolve the executable from `VOICEVOX_RUN` (an absolute path) first, then the platform default: `/Applications/VOICEVOX.app/Contents/Resources/vv-engine/run` on macOS or `%LOCALAPPDATA%\Programs\VOICEVOX\vv-engine\run.exe` on Windows (VOICEVOX 0.16+ installer). Other platforms require `VOICEVOX_RUN`.
- Call `/audio_query`, then `/synthesis` with the speaker ID, to obtain WAV.
- `--speaker` is a VOICEVOX style ID; the Japanese default is 3 (Zundamon/Normal). Resolve the speaker name through `/speakers`. Provenance must include `provider: voicevox` and `voice: speaker:<id>(<話者名>)` / `credit: VOICEVOX:<話者名>`, for example `{"provider":"voicevox","voice":"speaker:3","credit":"VOICEVOX:ずんだもん"}`. Character-specific credit is required by hard rule 6.
- Cost is zero, so no approval gate applies; a call without `--dry-run` proceeds directly.

## Irodori adapter (experimental)

The official Irodori-TTS-Server can run on macOS. In its working directory, run `uv sync --extra cpu` and `cp .env.example .env`, then start it as shown below. The first run downloads about 3.3 GB of model data. On an M1 Mac with 16 GB of memory, the September 24, 2026 measurement was 478 seconds for setup; later runs generated one 5.24-second sentence in about 15 seconds. Voice-clone quality has not been verified.

```sh
IRODORI_MODEL_DEVICE=mps IRODORI_CODEC_DEVICE=mps \
  uv run --no-sync python -m irodori_openai_tts --host 127.0.0.1 --port 8088
```

Register the canonical recording on the server with `akari voice copy --profile <id> --engine irodori`. Afterward, `akari narration generate --engine irodori --profile <id>` uses that registered voice ID without sending a caption.

- AKARI does not start the model. Connect to a separately running Irodori-TTS-Server through `--engine irodori --irodori-url <url>`. Resolve the URL from the option, then `AKARI_IRODORI_URL`, then `http://127.0.0.1:8088`. A server on another computer is also supported.
- Select a recipe with `--voice`: `narrator-male` (the default, calm male narrator), `bright-female` (bright young woman), or `slow-explainer` (lower, slower explanation). Use `--voice custom --style <声の指示>` for a custom caption. `--style` replaces the selected recipe's caption.
- Send `voice: "none"` and `irodori.caption` to `/v1/audio/speech` and save WAV. This route does not send reference audio or perform voice cloning. `--speed` ranges from 0.25 to 4.0. The default timeout is 600 seconds, configurable with `AKARI_IRODORI_TIMEOUT_MS`. A GPU is recommended; processing can be slow.
- Cost is zero. Record `provider: irodori`, `engine: irodori-tts-v4-small`, `voice: recipe:<id>` or `caption:custom`, `experimental: true`, and `server: <host:port>` as provenance.

## fal-qwen3 adapter (own-voice clone)


- Read `embedding_source_url` and `reference_text` from `~/.config/akari-video/voice-profiles/<profile>/meta.json`. POST `text`, `language:"Japanese"`, `speaker_voice_embedding_file_url`, `reference_text`, and `max_new_tokens:2048` to `https://fal.run/fal-ai/qwen-3-tts/text-to-speech/1.7b`. The current Japanese language value is an implementation fact; follow the content-language pack before using this route for another language.
- If no voice profile exists, complete [voice-profile-setup.md](voice-profile-setup.md) first.
- Read `FAL_KEY` only through manage-connections from `~/.akari/credentials.env` (the legacy `~/.config/akari-video/credentials.env` is also readable). Never call the API key directly. If absent, report the key name and storage location and exit 1 (hard rule 5).
- Before execution, show the estimate (character count × $0.09 per 1,000 characters) on stderr. **Without an authorized `--yes`, send nothing and exit 2.** This enforces cost disclosure and explicit approval under hard rule 4.
- Record `provider: fal`, `engine: qwen-3-tts-1.7b`, and `voice: profile:<name>` as provenance.

## gemini-tts adapter (via fal)

- The default is `--engine gemini-tts --voice Leda`. Choose among 30 voices with `--voice` and set delivery style with `--style <text>`.
- The estimated price `$0.05 / 1000 字` is provisional because it has not been verified. Therefore both list `price.verified` and provenance `price_verified` remain `false`; do not send without approved `--yes`.
- Gemini does not support `--speed`; warn and ignore it. For VOICEVOX, pass speed to `speedScale` in `/audio_query`.
- Supply text directly with `--text <原稿>`, or use `--reading-file` to distinguish the display script from spoken text. `--caption-ref c-0001 --apply` records the source caption ID.
- `--t` is mandatory with `--apply`. Without `--apply`, generation or cost preview may omit it; the default is timeline time zero.

## Do not mix reading instructions with the text

Do not put pronunciation or delivery instructions into `--text`, `--reading-file`, or `--script-file`; those fields contain words to speak. Create intonation through punctuation, word order, and the content-language pack's reading-text conversion. Send delivery instructions only through `--style` on a supported engine; the CLI routes them as shown below.

In the September 27, 2026 report (#94), `gemini-3.8-flash-tts` spoke the prepended instruction “Please read this brightly and briskly:” aloud. `systemInstruction` returned `HTTP 400 Developer instruction is not enabled for this model`. An English instruction also caused the model to translate and read the script in English.

| engine | Destination of `--style` | Notes |
|---|---|---|
| `gemini-tts` / `gemini-3.1-flash-tts` (fal) | `style_instructions` | Script text goes in `prompt`. |
| `gemini-3.8-flash-tts` (direct Google AI) | `input[0].content[0].annotations[{type:"speech_metadata", style}]` | Script text goes in `text` in the same content item. **Whether the style annotation can be spoken aloud is unverified.** Use `akari narration verify` to check for leaked instructions. |
| `fish-s2.1-pro` | A bracketed inline tag such as `[whispering]` before the text | Follow Fish's tag syntax; do not send a natural-language instruction sentence. |
| `irodori` | `caption` | Replaces the voice recipe. |
| `voicevox` / `fal-qwen3` / `elevenlabs-v3` / `minimax-2.6-hd` / `chatterbox` / `index-tts-2` | Do not send | `supports.style = false` |

## Engine and voice lists as JSON

- `akari narration engines --json` lists engines and connection status without starting VOICEVOX.
- `akari narration voices --engine <id> --json` lists voices, starting VOICEVOX only if needed to fetch its speakers.
- `akari narration generate ... --json` prints one result JSON line to stdout and progress to stderr. When Gemini needs cost approval, it exits 2 with `status: needs_approval`.

## Start and stop persistent VOICEVOX

- `akari narration start --engine voicevox --json` starts vv-engine as a detached process when needed and stores its PID in `~/.akari/run/voicevox.pid`. If an engine is already running, it reports that version and leaves the existing app alone.
- `akari narration stop --engine voicevox --json` stops only a live PID whose command matches VOICEVOX `run`. It removes stale PID files and never stops a VOICEVOX app started by the user.
- VOICEVOX `availability.detail` in `engines --json` includes `running`, `version`, `app_found`, and `managed`. Enable the settings-screen `止める` ("Stop") control only when `managed` is true.
- A temporary engine started by `generate` is still stopped after generation. Generation does not stop an engine kept alive by `start`.

## Verify generated speech by listening and transcription

- `akari narration verify --project <root> (--id n-0001 | --audio <path> --text <字幕の文字>) [--reading <読み原稿>] [--backend auto|speechanalyzer|whisper] --json` transcribes the generated audio locally with SpeechAnalyzer or whisper.cpp and compares it with caption text. It sends nothing to the cloud and writes nothing to analysis, captions, or edit. With no available backend, it exits 3 with `status: unavailable` and an explanation.
- Normalize caption and recognized text with NFKC, lowercase Latin letters, and removal of punctuation, symbols, and spaces. Compare character-level edit distance. Return `score = 1 - 編集距離 / max(文字数)` to three decimals and group consecutive differences in `diffs`. Preserve the reading script in the result without comparing it.
- Verdicts are `ok` at 0.9 or higher, `check` from 0.7 up to 0.9, and `ng` below 0.7. **These are unvalidated starting thresholds; calibrate them in calibration/.**
- Only with `--record <dir>`, append one JSON line to that directory's `narration-verify.jsonl`, including expected text, reading text, recognition, score, verdict, engine, voice, backend, and time. Do not set this option from the popup.

## Five additional fal engines

Select the engine with `--engine`. These routes require a fal key and authorized `--yes`. A `--profile` also requires the owner's consent, cloud-upload consent, and script verification of at least 0.7. `chatterbox` and `index-tts-2` send the canonical WAV as a `data:audio/wav;base64` reference on every request. For `minimax-2.6-hd`, register a copy first with `akari voice copy --profile <id> --engine minimax-2.6-hd --yes`. Exit 2 before upload if the canonical recording exceeds 20 MB.

| Engine | fal endpoint | Default voice and basis | Clone | Price input and verification |
|---|---|---|---|---|
| `gemini-3.1-flash-tts` | `fal-ai/gemini-3.1-flash-tts` | Leda; retains the same 30 voices as the existing Gemini adapter. | None | Only a token-based research price is available; character-based estimation is unavailable. verified false. |
| `elevenlabs-v3` | `fal-ai/elevenlabs/tts/eleven-v3` | Rachel, the schema default; Japanese requests use `language_code: ja`. | None | Research figure $0.10 per 1,000 characters, verified false; 5,000 characters maximum per request. |
| `minimax-2.6-hd` | `fal-ai/minimax/speech-2.6-hd` | Wise_Woman, the schema default in `voice_setting`; current `language_boost: Japanese`. | registered | The research figure "$0.85 per generation" has an unknown billing unit, so no estimate is possible; verified false. |
| `chatterbox` | `fal-ai/chatterbox/text-to-speech/multilingual` | `japanese`, the multilingual schema's voice language code. | per-request | Research figure $0.025 per 1,000 characters, verified false; 300 characters maximum per request. |
| `index-tts-2` | `fal-ai/index-tts-2/text-to-speech` | No default voice; `--profile` is required. | per-request | Research figure $0.002 per second, verified false; estimate using five characters per second. |

The multilingual Chatterbox schema uses `voice: japanese`. For reference audio, pass its data URI in `voice` and set `custom_audio_language: japanese`. Index TTS 2's schema includes `emotional_audio_url`, but this implementation does not send it. The reference data URI has the same format as the existing fal Qwen3 clone, and the schema does not prohibit it. Do not upload the recording separately to fal storage.

## Two direct API engines

| Engine | Route and key | Voice and Japanese behavior | Price and cloning |
|---|---|---|---|
| `fish-s2.1-pro` | Fish Audio `POST /v1/tts`; obtain `FISH_AUDIO_API_KEY` at https://fish.audio/app/api-keys/ | Five public Japanese voices; default "energetic woman." `--style` becomes a bracketed tag. | $15 per million UTF-8 bytes, about $0.045 for 1,000 Japanese characters. With `--profile`, send the canonical WAV and recording script as MessagePack on every request. |
| `gemini-3.8-flash-tts` | Google AI Interactions API; obtain `GEMINI_API_KEY` at https://aistudio.google.com/api-keys | Supports Japanese; 30 ready-made voices with Leda as default. `--style` uses `speech_metadata.style`, separate from script `text`; whether it can be spoken aloud remains unverified. | Output $9 per million tokens, with 25 tokens per audio second through 2026-12-31, rising to $18 on 2027-01-01. Input rises from $0.50 to $1.00. Voice cloning is not covered by this table. |

Both read credentials from `~/.akari/credentials.env` and refuse paid calls without authorized `--yes` after the estimate. Fish reference audio additionally requires the owner's consent, cloud-upload consent, and script verification of at least 0.7. Gemini wraps 24 kHz, mono, 16-bit PCM in WAV and accepts a response that already has a RIFF header. Detailed API evidence is in `packages/akari-launcher/fixtures/narration/direct/`.

## How to add engines (1 row in the table)

Save fal's OpenAPI schema in `packages/akari-launcher/fixtures/narration/openapi/`, then add
`row(id, label, endpoint, { price, voices,
default_voice, supports, buildPayload })` to
`packages/akari-launcher/src/tts-engines.mjs`. Check with `tts-engines.test.mjs` that
`buildPayload` satisfies the saved schema's required fields. When adding a clone method,
also check the consent, verification, and approval guards in `voice-command.mjs`.

## `--dry-run`

This mode sends no request to any engine. It prints the prospective payload with the API key and Fish reference audio masked, the planned output path, and estimated cost (zero for voicevox; approximate USD for fal-qwen3) as JSON on stdout, then exits 0. Use it to review a request and show the person a paid route's expected cost before execution.

## Engine selection and two-stage operation

See lang/<content-language>.md for voice selection and the appropriate draft-to-final workflow. Confirm the selected engine accepts the work's content language before generation.

For any draft-to-final replacement, keep the same reading file (adjust it only if needed) and timeline `--t`, create a new narration `id`, and have the editor remove the old draft entry. The Japanese pack's example uses `--engine voicevox` for a free draft and then `--engine fal-qwen3 --profile <name> --yes --apply` for the final voice (for example, `--profile owner-ja`); its language-specific choice belongs in lang/ja.md. Because the draft stage has no cost, its timing can be revised repeatedly for free.
