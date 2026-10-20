# Narration engine adapters

Use `akari narration generate` to create the narration audio:

```
akari narration generate \
  --project <projectDir> --engine <engine id> \
  --reading-file <読み原稿.txt> [--script-file <表示原稿.txt>] \
  --t <タイムライン秒> [--gain-db 0] [--id n-0001] \
  [--voice <声>] [--style <話し方>] [--text <原稿>] \
  [--speaker <id>]           # VOICEVOX 用。声は voices --json で選ぶ
  [--profile <id>]           # 自分の声（声プロファイル対応エンジンのみ）
  [--dry-run] [--yes] [--apply]
```

- `--reading-file` is required. Pass the prepared reading text described in [reading-text.md](reading-text.md) and the work's language pack.
- `--script-file` is optional. When supplied, its display text is stored as `script`.
- When `--id` is omitted, the CLI assigns one greater than the highest existing ID in `<projectDir>/edit.json` `audio.narration[]`, or `n-0001` if there are no entries.
- Audio is saved under `<projectDir>/out/narration/<id>.<wav|mp3>`. The container follows the selected engine; read the result JSON for the saved `path`.
- `--apply` adds an entry to `edit.json` `audio.narration[]`, creating `audio` or `narration` if needed. It immediately runs `packages/schemas/bin/validate-edit.mjs` and rolls back the write if validation fails.
- Without `--apply`, the CLI generates the file and prints the entry JSON to stdout but leaves `edit.json` unchanged, allowing manual review before insertion.

## Choose from the engine list, not from memory

Before choosing, run:

```sh
akari narration engines --json
```

Read the rows and select by their declared values. Do not rely on engine or voice names remembered from documentation or earlier sessions.

- `id`: the only valid `--engine` value.
- `languages`: must include the work's content language.
- `place` and `availability.state`: a cloud row is usable only when its key or connection is configured. Local rows may be `needs` when their runtime is installed but not started.
- `price`: the estimate basis. A null value means the cost cannot be estimated; the approval gate still applies.
- `supports`: `style`, `speed`, and the clone method determine which flags are valid.
- `candidate: true`: an unauditioned candidate. Do not select it by default, do not recommend it, and use it only when the user names it explicitly. The CLI prints a one-line candidate notice before sending anything.
- `default_voice`: the engine's default. Always list voices with `akari narration voices --engine <id> --json` before choosing another one.

Do not invent engine IDs, voice IDs, or locale fields. A candidate is never a substitute for an engine that has been auditioned with this material.

## Local engines

Local engines run on the user's computer and need no API key. Their exact availability and startup state come from `engines --json`.

### VOICEVOX adapter

- VOICEVOX runs locally and costs nothing. Use an engine already listening at `http://127.0.0.1:50021`; otherwise start vv-engine's `run` headlessly, wait up to 60 seconds for `/version`, and stop it after generation only if AKARI started it.
- Resolve the executable from `VOICEVOX_RUN` (an absolute path) first, then the platform default: `/Applications/VOICEVOX.app/Contents/Resources/vv-engine/run` on macOS or `%LOCALAPPDATA%\Programs\VOICEVOX\vv-engine\run.exe` on Windows (VOICEVOX 0.16+ installer). Other platforms require `VOICEVOX_RUN`.
- Call `/audio_query`, then `/synthesis` with the speaker ID, to obtain WAV.
- `--speaker` is a VOICEVOX style ID. List the available speakers with `akari narration voices --engine voicevox --json`; the CLI's default applies when `--speaker` is omitted. Provenance must include `provider: voicevox`, `voice: speaker:<id>(<話者名>)`, and `credit: VOICEVOX:<話者名>`. Character-specific credit is required by hard rule 6.
- Cost is zero, so no approval gate applies; a call without `--dry-run` proceeds directly.

### Irodori adapter (experimental)

The official Irodori-TTS-Server can run on macOS. In its working directory, run `uv sync --extra cpu` and `cp .env.example .env`, then start it as shown below. The first run downloads about 3.3 GB of model data. On an M1 Mac with 16 GB of memory, the September 24, 2026 measurement was 478 seconds for setup; later runs generated one 5.24-second sentence in about 15 seconds. Voice-clone quality has not been verified.

```sh
IRODORI_MODEL_DEVICE=mps IRODORI_CODEC_DEVICE=mps \
  uv run --no-sync python -m irodori_openai_tts --host 127.0.0.1 --port 8088
```

Register the canonical recording on the server with `akari voice copy --profile <id> --engine irodori`. Afterward, `akari narration generate --engine irodori --profile <id>` uses that registered voice ID without sending a caption.

- AKARI does not start the model. Connect to a separately running Irodori-TTS-Server through `--engine irodori --irodori-url <url>`. Resolve the URL from the option, then `AKARI_IRODORI_URL`, then `http://127.0.0.1:8088`. A server on another computer is also supported.
- Select a voice recipe with `akari narration voices --engine irodori --json` and pass its `id` to `--voice`. Use `--voice custom --style <声の指示>` for a custom caption. `--style` replaces the selected recipe's caption.
- Send `voice: "none"` and `irodori.caption` to `/v1/audio/speech` and save WAV. This route does not send reference audio or perform voice cloning. `--speed` ranges from 0.25 to 4.0. The default timeout is 600 seconds, configurable with `AKARI_IRODORI_TIMEOUT_MS`. A GPU is recommended; processing can be slow.
- Cost is zero. Record `provider: irodori`, the engine version from the response, `voice: recipe:<id>` or `caption:custom`, `experimental: true`, and `server: <host:port>` as provenance.

## fal engines

fal hosts several narration engines behind one key and one approval path. Pick an `id` from `engines --json` whose `languages` and `supports` match the work; do not enumerate them from memory.

- Read `FAL_KEY` only through [manage-connections](../manage-connections/SKILL.md) from `~/.akari/credentials.env` (the legacy `~/.config/akari-video/credentials.env` is also readable). Never call the API key directly. If absent, report the key name and storage location and exit 1 (hard rule 5).
- Before execution, show the estimate from the engine row on stderr. **Without an authorized `--yes`, send nothing and exit 2.** This enforces cost disclosure and explicit approval under hard rule 4.
- A `--profile` requires the owner's consent, cloud-upload consent, and script verification of at least 0.7. Engines whose clone method is `per-request` send the canonical WAV as a `data:audio/wav;base64` reference on every request; `registered` engines need `akari voice copy` first.
- Exit 2 before upload if the canonical recording exceeds 20 MB.
- The CLI enforces each engine's per-request character limit and reports it; do not hard-code limits in the script.
- Record `provider: fal`, the engine ID, the endpoint from the result, and `voice: profile:<name>` or the selected voice as provenance.

## Direct API providers

Two providers are called directly, without fal. Choose the row from `engines --json`; the CLI already knows its endpoint, model header, and request shape.

### Fish Audio

- Call `POST /v1/tts` with `FISH_AUDIO_API_KEY` from `~/.akari/credentials.env`.
- The model comes from the engine definition in the CLI, never from the script. Do not add a model name to `--text` or to `--style`.
- Pick a voice with `akari narration voices --engine <id> --json`, or use `--profile` to send the canonical WAV and recording script as MessagePack on every request. The profile path requires consent, cloud-upload consent, and script verification of at least 0.7.
- `--style` becomes a bracketed inline tag such as `[whispering]` before the text. Follow Fish's tag syntax; do not send a natural-language instruction sentence.
- A row marked `candidate: true` is unauditioned. Use it only when the user names it; otherwise choose the auditioned row.
- Show the estimate from the row and require authorized `--yes` before sending.

### Google AI (Gemini)

- Call the Interactions API with `GEMINI_API_KEY` from `~/.akari/credentials.env`.
- List the available ready-made voices with `akari narration voices --engine <id> --json`; the engine row declares the default. `--style` uses `speech_metadata.style`, separate from the script `text`; whether it can be spoken aloud remains unverified.
- Wrap 24 kHz, mono, 16-bit PCM in WAV; the API may also return a response that already has a RIFF header.
- Show the estimate from the row and require authorized `--yes` before sending.

## Do not mix reading instructions with the text

Do not put pronunciation or delivery instructions into `--text`, `--reading-file`, or `--script-file`; those fields contain words to speak. Create intonation through punctuation, word order, and the content-language pack's reading-text conversion. Send delivery instructions only through `--style` on a supported engine; the CLI routes them as shown below.

In the September 27, 2026 report (#94), a direct Google AI engine spoke the prepended instruction “Please read this brightly and briskly:” aloud. `systemInstruction` returned `HTTP 400 Developer instruction is not enabled for this model`. An English instruction also caused the model to translate and read the script in English.

| Provider | Destination of `--style` | Notes |
|---|---|---|
| Gemini via fal | `style_instructions` | Script text goes in `prompt`. |
| Gemini direct (Google AI) | `input[0].content[0].annotations[{type:"speech_metadata", style}]` | Script text goes in `text` in the same content item. **Whether the style annotation can be spoken aloud is unverified.** Use `akari narration verify` to check for leaked instructions. |
| Fish Audio | A bracketed inline tag such as `[whispering]` before the text | Follow the provider's tag syntax; do not send a natural-language instruction sentence. |
| Irodori | `caption` | Replaces the voice recipe. |
| Other engines | Do not send | `supports.style` is false in `engines --json`. |

## Engine and voice lists as JSON

- `akari narration engines --json` lists engines, connection status, price basis, supported flags, and the candidate mark without starting VOICEVOX.
- `akari narration voices --engine <id> --json` lists voices, starting VOICEVOX only if needed to fetch its speakers.
- `akari narration generate ... --json` prints one result JSON line to stdout and progress to stderr. When an engine needs cost approval, it exits 2 with `status: needs_approval`.

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

## `--dry-run`

This mode sends no request to any engine. It prints the prospective payload with the API key and Fish reference audio masked, the planned output path, and the estimated cost from the engine row (zero for local engines) as JSON on stdout, then exits 0. Use it to review a request and show the person a paid route's expected cost before execution.

## Engine selection and two-stage operation

See lang/<content-language>.md for voice selection and the appropriate draft-to-final workflow. Confirm the selected engine accepts the work's content language before generation.

For any draft-to-final replacement, keep the same reading file (adjust it only if needed) and timeline `--t`, create a new narration `id`, and have the editor remove the old draft entry. A free local engine is suitable for the draft; for the final take, choose the engine that satisfies the requirement (own voice, delivery control, or ready-made voice) from `engines --json` and get cost approval. Because the draft stage has no cost, its timing can be revised repeatedly for free.

## How to add engines (1 row in the table)

Save the provider's OpenAPI schema in `packages/akari-launcher/fixtures/narration/openapi/`, then add a row to the engine catalog in
`packages/akari-launcher/src/tts-engines.mjs` with its endpoint, price basis, voices,
default voice, supported flags, payload builder, and request builder. Check with
`tts-engines.test.mjs` that the payload satisfies the saved schema's required fields. When adding a clone method,
also check the consent, verification, and approval guards in `voice-command.mjs`.

A new engine that has not been auditioned is added with `candidate: true` and `callable: false` until its first listening check. Candidates are explicit-only; they are not added to the recommended sets or default choices.
