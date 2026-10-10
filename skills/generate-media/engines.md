

# Select a generation engine

`packages/schemas/gen-models.json` is authoritative for model capabilities and prices. Read the relevant catalog entry at execution time; do not rely on remembered model names or general assumptions about a provider.

## Read these fields

- `id` / `kind` / `provider` / `endpoint`: Identifiers used by the CLI and connection registry.
- `inputs`: Whether first and last frames are required, optional, or unsupported; reference limits; camera format; and permitted extras.
- `duration` / `resolutions` / `aspects` / `audio_out`: Supported output settings, ranges, and the types and formats sent to the provider.
- `price`: Estimate derived from resolution, duration, and audio multiplier. `null` means no estimate is available.
- `as_of` / `source_url` / `price_url` / `verified`: Recency and evidence for the entry.
- `calibration[]`: Measured calibration records to show in the fact strip instead of subjective ratings.

Reject an input with a value in an unsupported slot rather than silently dropping it. Do not invent a reference limit when the catalog does not state one. Pass only names allowed by `extra_allowed[]` through `extra`.

## Defaults

- Still image: `codex:image`, treated as free.
- Video: `fal:h3-i2v`, which is paid and sends data externally; estimate the cost and obtain approval first.

For a model with no price entry or `price: null`, show that an estimate is unavailable and require explicit confirmation before execution. Always show `as_of` with a displayed price.

H3 may generate audio even without an audio input field. Default the replaced timeline item to `mute: true`. Save the provider's `expanded_prompt` in `result.expanded_prompt` separately from the submitted prompt, and evaluate the expanded version during calibration too.
