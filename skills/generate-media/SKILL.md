---
name: generate-media
description: Build a timeline placeholder from still images or text cards, generate video from it, and recover or refetch generated clips. Use when asked to plan with stills, turn a placeholder into video, recover a failed generation, or establish duration with text cards.
---

# Connect generated media to the timeline

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

# Non-negotiable rules

These rules take precedence over detailed instructions.

1. **Obtain cost approval before paid generation.** Present an estimate and run with `--yes` only after explicit approval. Generate one clip at a time by default. For a batch, show the total estimated cost and obtain approval for that amount.
2. **Treat approval to start writing as separate from cost approval.** A planning decision never authorizes a paid generation request.
3. **Limit reference inputs to 20 MB per file.** Do not silently upload a larger file to external storage.
4. **Store outputs in `assets/generated/` with adjacent state and provenance in `<file>.meta.json`.** Do not add generation-only fields to edit.json.
5. **Use only registered connections and permitted models from [manage-connections](../manage-connections/SKILL.md).** Do not search for or use keys directly.
6. **Reject unsupported inputs.** Send model-specific inputs only when their names appear in `extra_allowed[]` in the capability catalog.

## Execution order and contents

1. Read [still.md](still.md) to create a still-image or text-card placeholder.
2. Read [video.md](video.md) when replacing a placeholder with generated video.
3. Read [chain.md](chain.md) for the still → video → resume sequence, failed or stale jobs, and export behavior.
4. Read [engines.md](engines.md) only when checking model capabilities, defaults, price, or accepted inputs.

Read the file for the current step; avoid reading later steps in advance.

## Terms

- **Placeholder:** A still-image clip with a duration and timeline position. It may also be the finished output.
- **Reference video:** Input that guides motion or camera work; it is not inserted directly as the generated clip.
- **Source video:** Input for extend, edit, motion, or frame-edit operations.
- **Cost approval:** The gate before paid generation.
- **Planning approval:** Permission to begin authoring, requested once at the start.
- **Fact strip:** A one-line summary of model choice, price, duration, inputs, audio, and calibration.

## References

- Generation contract: [contract-2026-09-13-generation-v0.md](../../docs/contract-2026-09-13-generation-v0.md)
- Connection, model permission, and doctor: [manage-connections](../manage-connections/SKILL.md)
- Cost presentation format: [edit-plan approvals and generation](../edit-plan/approvals-and-generation.md)
