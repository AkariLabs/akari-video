---
name: generate-image
description: Generate still images with an AI model and place them on the timeline as assets or placeholders. Use when asked to create or generate an image, make a still, or fill a slot with a generated picture.
---

# Generate images for the timeline

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

This skill is deliberately thin: it owns the AI image generation step. Durations, text-card placeholders, the still → video chain, and recovery live in [generate-video](../generate-video/SKILL.md).

# FORBIDDEN-level hard rules

These rules take precedence over detailed instructions.

1. **Obtain cost approval before paid generation.** Present an estimate and run with `--yes` only after explicit approval. The image route may be free or paid; read the ledger instead of assuming.
2. **Reserve the approval stamp for the single export; never use it for generation.** Call the paid-generation gate "cost approval."
3. **Limit reference inputs to 20 MB per file.** Do not silently upload a larger file to external storage.
4. **Store outputs in `assets/generated/` with adjacent state and provenance in `<file>.meta.json`.** Do not add generation-only fields to edit.json.
5. **Use only connections resolved through the [manage-connections](../manage-connections/SKILL.md) registry and models on its allowed list.** Never search for keys or call an unregistered connection directly.
6. **Never send inputs the capability catalog does not support; fail instead.** Send model-specific inputs only when their names appear in `extra_allowed[]` in the capability catalog.

## Execution order and contents

1. Read [image.md](image.md) for the AI image generation procedure.
2. Read [generate-video's still.md](../generate-video/still.md) when the image becomes a timed placeholder on the timeline.
3. Read [generate-video's engines.md](../generate-video/engines.md) only when checking model capabilities, defaults, price, or accepted inputs.

Read only the file for the current step; do not read later steps in advance.

## Terms

- **Generated still:** A PNG produced by an AI image model, with adjacent metadata in `<file>.meta.json`.
- **Placeholder:** A still image or text card with a duration and timeline position. A generated still can be a placeholder or the final visual.
- **Cost approval:** The gate before paid generation.
- **Fact strip:** A one-line summary of model choice, price, dimensions, inputs, and calibration; it replaces subjective scores and radar charts.

## References

- Generation contract: [contract-2026-09-13-generation-v0.md](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-09-13-generation-v0.md)
- Connection, model permission, and doctor: [manage-connections](../manage-connections/SKILL.md)
- Cost presentation format: [edit-plan approvals and generation](../edit-plan/approvals-and-generation.md)
