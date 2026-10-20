---
name: generate-video
description: "Build a timeline placeholder from still images or text cards, generate video from it, and recover or refetch generated clips. Use when asked to plan with stills, turn a placeholder into video, recover a failed generation, or establish duration with text cards.（旧名: generate-media）"
---

# Connect generated video to the timeline

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

# FORBIDDEN-level hard rules

These rules take precedence over detailed instructions.

1. **Obtain cost approval before paid generation.** Present an estimate and run with `--yes` only after explicit approval. Generate one clip at a time by default. For a batch, show the total estimated cost for every target and obtain one cost approval. Never automatically turn every placeholder into video.
2. **Reserve the approval stamp for the single export; never use it for generation.** Call the paid-generation gate "cost approval."
3. **Limit reference inputs to 20 MB per file.** Do not silently upload a larger file to external storage.
4. **Store outputs in `assets/generated/` with adjacent state and provenance in `<file>.meta.json`.** Do not add generation-only fields to edit.json.
5. **Use only connections resolved through the [setup-connections](../setup-connections/SKILL.md) registry and models on its allowed list.** Never search for keys or call an unregistered connection directly.
6. **Never send inputs the capability catalog does not support; fail instead.** Send model-specific inputs only when their names appear in `extra_allowed[]` in the capability catalog.

## Execution order and contents

1. Read [still.md](still.md) to create a still-image or text-card placeholder with a duration.
2. Read [video.md](video.md) when replacing a placeholder with generated video.
3. Read [chain.md](chain.md) for the still → video → resume sequence, failed or stale jobs, and export behavior.
4. Read [engines.md](engines.md) only when checking model capabilities, defaults, price, or accepted inputs.

When the picture itself should be made by an AI image model, use the thin [generate-image](../generate-image/SKILL.md) skill first and come back here to give it a duration and, later, motion.

Read only the file for the current step; do not read later steps in advance.

## Terms

- **Placeholder:** A still-image clip with a duration and timeline position. It is also a finished output.
- **Reference video:** Input that guides motion or camera work; it is not inserted directly as the generated clip.
- **Source video:** Input for extend, edit, motion, or frame-edit operations.
- **Cost approval:** The gate before paid generation.
- **Export stamp:** The one-time approval used only for export.
- **Fact strip:** A one-line summary of model choice, price, duration, inputs, audio, and calibration; it replaces subjective scores and radar charts.

## References

- Generation contract: [contract-2026-09-13-generation-v0.md](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-09-13-generation-v0.md)
- Connection, model permission, and doctor: [setup-connections](../setup-connections/SKILL.md)
- Cost presentation format: [edit-plan approvals and generation](../edit-plan/approvals-and-generation.md)
