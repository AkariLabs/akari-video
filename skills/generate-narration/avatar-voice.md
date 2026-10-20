

# Resolve an avatar's voice to a narration TTS lane (S2)

When [plan-edit/avatar-resolution.md](../plan-edit/avatar-resolution.md) has resolved the script's speaker to an avatar, read that avatar's `voice/voice.json` (L2) and pass its `lane`, `ref`, and `credit` to one of the three existing lanes in [engines.md](engines.md). Read this file only for the selected avatar; do not inspect other avatars' `voice/` directories. **Do not invent avatar-specific engines or fields.** This is only a resolver from registered avatar values to the existing voice-TTS contract.

## Resolution steps

1. Read `lane`, `ref`, and `credit` from `voice/voice.json`; if absent, use the equivalent `voice` object in `avatar.json`.
2. Build the arguments for the engine command from `lane` using the table below.
3. After generation, if `credit` is non-null, check that `provenance.credit` reflects it using [credit transfer](#credit-transfer).
4. Do not change the `edit.json` schema. Store the avatar's `voice.ref`, such as `speaker:3(ずんだもん/ノーマル)` or `profile:owner-ja`, directly in `audio.narration[].provenance.voice`. It is the existing narration-TTS reference format; do not add a new avatar-ID field.


## Resolve each lane

| `voice.lane` | Engine arguments | Approval gate | Notes |
|---|---|---|---|
| `voicevox` | `--engine voicevox --speaker <ref から取り出した id>` | None: it costs zero and is declaration only, so hard rule 4's paid gate does not apply. | Extract the leading integer from `speaker:<id>(<名前>)` and pass it to `--speaker`. |
| `fal-clone` | `--engine fal-qwen3 --profile <ref から取り出した profile 名>` | **Required:** disclose the cost and execute only after explicit approval under hard rule 4. | Show the estimate with `--dry-run` first, then run with `--yes --apply` after approval. Hard rule 1 prohibits using another person's voice without consent. |
| `recorded` | No TTS call | Not applicable | Put the person's supplied audio file in `audio.narration[].path` and record `provenance.provider: "human"`; do not call `akari narration generate`. |

Extract `ref` as follows:

- `voicevox`: For `speaker:3(ずんだもん/ノーマル)`, the digits between `speaker:` and the next `(` give `--speaker`.
- `fal-clone`: For `profile:owner-ja`, the part after `profile:` gives `--profile`.


## Credit transfer

Transfer a non-null `voice.credit` to the narration's `provenance.credit`.

- **`voicevox` lane:** On each call, `akari narration generate` queries `/speakers` and automatically adds `credit: "VOICEVOX:<話者名>"` to `provenance`; see [engines.md](engines.md#voicevox-adapter). It should match the avatar's registered `credit` for the same speaker ID. Verify the match and that the value is non-empty; no manual rewrite is needed.
- **`fal-clone` lane:** The fal route does not automatically add `credit` to `provenance`, because an own-voice clone usually needs no character credit. In the exceptional case where the avatar's `voice.credit` is non-null, such as an exceptional third-party clone, add it manually to `entry.provenance.credit` before applying the entry to `edit.json`, then rerun `validate-edit.mjs`.

## Check the output

Without `--apply`, inspect `voice` and `credit` in the stdout `entry` JSON, including `provenance`, against the avatar's registered values. When using `--apply`, follow the checkpoint procedure in [approvals-and-generation.md](../plan-edit/approvals-and-generation.md).
