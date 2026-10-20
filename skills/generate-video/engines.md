
# Select a generation engine

`packages/schemas/gen-models.json` is authoritative for model capabilities and prices. Read the relevant catalog entry at execution time; do not rely on remembered model names or general assumptions about a provider. Never copy a model name or price into this skill or into a project record as a substitute for the ledger.

## Read these fields

- `id` / `kind` / `provider` / `endpoint`: Identifiers used by the CLI and connection registry. Look up the row for the kind you need (`image` for stills, `video` for clips).
- `inputs`: Whether first and last frames are required, optional, or unsupported; reference limits; camera format; and permitted extras.
- `duration` / `resolutions` / `aspects` / `audio_out`: Supported output settings, ranges, and the types and formats sent to the provider.
- `price`: Estimate derived from resolution, duration, and audio multiplier. `null` means no estimate is available.
- `as_of` / `source_url` / `price_url` / `verified`: Recency and evidence for the entry.
- `calibration[]`: Measured calibration records to show in the fact strip instead of subjective ratings.

Never send a value in an unsupported slot; fail instead. Do not invent a reference limit when the catalog does not state one. Pass only names allowed by `extra_allowed[]` through `extra`.

## Defaults

- Do not choose an engine from memory. The dry run and the connection registry show the default route the CLI will use; confirm it against the ledger row before generating.
- The still-image default and the video default can be different rows. Re-read the row for the kind in hand rather than reusing the other kind's settings.
- For a model with no price entry or `price: null`, show `見積不可 + 明示確認` ("estimate unavailable + explicit confirmation") and require that confirmation before execution. Always show `as_of` with a displayed price.
- Some video models generate audio even without an audio input field. Default the replaced timeline item to `mute: true`; narration and BGM stay authoritative.
- Save the provider's `expanded_prompt` in `result.expanded_prompt` separately from the submitted prompt, and evaluate the expanded version during calibration too.
