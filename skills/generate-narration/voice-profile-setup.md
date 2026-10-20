# Set up an own-voice profile (v2)

Follow the content-language pack selected in SKILL.md for recording text and voice choice. The legacy procedure below uses a fixed Japanese script; it is not an English canonical script.

Store the owner's canonical voice recording under `<AKARI_HOME>/avatars/<人>/voice/<声の id>/`. `AKARI_HOME` defaults to `~/.akari`. The canonical assets are `ref-recording.wav` (48 kHz, mono) and `meta.json`, which records consent and script verification. Put the default voice ID in the avatar's `voice/voice.json`.

An Irodori server registration or fal Qwen3 voice is a copy that can be recreated from the canonical recording. Record only the owner's own voice and their consent. Create a cloud copy only with that person's consent to upload, a local script match of at least 70%, and explicit cost approval represented by `--yes`. Never upload from a computer that cannot perform the local listening check.

```sh
akari voice scripts --json
akari voice check --audio <録音> --script quick-v1 --json
akari voice create --avatar <人> --id <声のid> --label <表示名> --audio <録音> --script quick-v1 --consent-self --json
akari voice rename --profile <声のid> --label <新しい表示名> --json
akari voice extend --profile <声のid> --audio <追加録音> --script extended-v1 --json
akari voice copy --profile <声のid> --engine irodori --json
akari voice try --profile <声のid> --engine irodori --text 'こんにちは。' --json
akari voice profiles --json
```

- `quick-v1` is about 20 seconds; `extended-v1` is about 60 seconds. Read exactly the text returned by `scripts`. `check` verifies duration, level, background noise, and the match to the script. Background noise is a warning rather than a creation blocker.
- Add `--consent-cloud` to `create` only when the owner consents to cloud upload. Creation itself makes no copies.
- `rename` changes only the display name in the new storage layout; the voice ID and directory name stay fixed. Run `migrate-legacy` for an old voice first.
- `extend` checks an `extended-v1` recording, joins it to the canonical recording, and verifies the full script again. It keeps one previous generation as `ref-recording.prev.wav`. Existing copies become `stale: true`; follow the JSON warning and recreate them with `voice copy`. The `copies` field in `voice profiles --json` reports each copy's `stale` flag; a recreated copy becomes `stale: false`. Recreating a cloud copy requires fresh cost approval.
- For Irodori `copy`, resolve the server URL from `--irodori-url`, then `AKARI_IRODORI_URL`, then `http://127.0.0.1:8088`. Send the recording as multipart and register it as `akari-<id>`. Local server registration is free.
- For fal, run `akari voice copy --profile <id> --engine fal-qwen3 --yes --json`. It uploads the recording and makes a small paid call; show the estimate from the command before asking for approval. Without `--yes`, it returns an estimate only; fal generation through `try` also requires `--yes`.
- `akari narration generate --engine irodori|fal-qwen3 --profile <id>` prefers the new location but can also read the legacy `~/.config/akari-video/voice-profiles/<id>/`. Register an Irodori copy with `voice copy` before using an own-voice profile there.
- `akari voice delete --profile <id> --json` deletes the canonical recording and Irodori server copy; the fal-side voice remains. With `--keep-server`, the Irodori registration also remains.
- `akari voice migrate-legacy --profile owner-ja --avatar <人> --json` copies an old profile without deleting its directory or changing the recording format.

## Legacy procedure

The following procedure describes the older fal-only profile. Use the v2 CLI above for new profiles.

### 1. Present the script

Present the included Japanese [assets/reading-script-v1.md](assets/reading-script-v1.md) verbatim. Do not paraphrase or shorten this canonical text: it must exactly match `reference_text`. Tell the person to expect about 330 characters and 45–60 seconds. For an English work, follow lang/en.md; no equivalent fixed English text exists yet.

### 2. Record by either route

Either route is acceptable.

- **Route A (default):** Ask the owner to read the script into Voice Memos on iPhone or Mac, then export it to `~/Downloads`, including by AirDrop. This matches common recording habits and needs no additional tool permissions.
- **Route B (automated):** Record directly from a microphone with `ffmpeg -f avfoundation -i ":<device>"`. List devices with `ffmpeg -f avfoundation -list_devices true -i ""`; the first run may request microphone permission.

### 3. Pick up the recording

Record the setup start time. In `~/Downloads`, choose the newest m4a, WAV, or MP3 file **modified after that time**. Voice Memos filenames may reflect the recording location rather than their contents, so select by modification time rather than guessing from the filename.

### 4. Mandatory guard before upload (hard rule 2)

Before uploading to fal, transcribe the selected recording locally with Whisper. Compare it with the fixed script from §1 and confirm a duration of 30–300 seconds. This guard is meant to prevent accidental upload of the wrong recording, another person's voice, or private audio; it is not a benchmark of transcription quality.

- Reuse the executable and model discovery order and call convention described in the “Layer 2: whisper.cpp” section of [../analyze-footage/media-and-transcript.md](../analyze-footage/media-and-transcript.md). Do not create a new discovery path.
- If the script match is too low or duration is outside the range, **stop before upload** and ask the owner to record again.
- Skip verification only on the owner's explicit instruction. If skipped, put a reason and date such as `"skipped by owner instruction (<日付>)"` in `meta.json` `reference.verification`. Keep verification as the default.

### 5. Clone with fal `clone-voice/1.7b`

Read `FAL_KEY` only through setup-connections from `~/.akari/credentials.env`; the legacy `~/.config/akari-video/credentials.env` is also readable (hard rule 5). Encode the reference audio as a data URI and pass the exact §1 script as `reference_text` to `fal-ai/qwen-3-tts/clone-voice/1.7b`. Save the returned `speaker_embedding.url` as the profile asset `embedding_source_url`. **This is paid and uploads audio.** Before sending, explain the target, method, reason, alternatives, cost, wait time, external transfer, and provenance, then obtain explicit approval under the Decision Communication Contract in [../setup-connections/SKILL.md](../setup-connections/SKILL.md). Cloning is normally a small, one-time cost per voice, but the declaration remains mandatory.

### 6. Save

Save the following under the legacy profile path `~/.config/akari-video/voice-profiles/<name>/`. Prefer `~/.akari/credentials.env` for the key. Both locations are user-level and outside git.

- `embedding.safetensors`, or store `embedding_source_url` in meta.json and leave the asset at the fal URL. The fal-qwen3 adapter in `akari narration generate` reads `embedding_source_url` from `meta.json`.
- `ref-recording.<ext>`: The exact reference audio uploaded.
- `meta.json`:
  - `profile`: Profile name.
  - `created_at`: ISO 8601 timestamp.
  - `reference.sha256`: Hash of the reference audio.
  - `reference.script_version`: Script version, such as `v1`.
  - `reference.verification`: Whisper match result or documented skip (§4).
  - `consent`: Record that the owner explicitly requested a profile of their own voice (**required**, hard rule 1).
  - `reference_text`: Exact text sent to fal, matching the §1 script.
  - `embedding_source_url`: URL of the speaker embedding returned by fal.

### 7. Audition and accept

Generate one short sentence of a few dozen characters with the fal-qwen3 adapter; show the estimate from the command and get approval for the small paid call. Play it with `afplay` or an equivalent tool and ask the owner to listen. Accept the profile if they approve. If similarity is weak, first record another 30–60 seconds of narration in a quiet room and recreate the profile; judge whether it fails only after that retry.
