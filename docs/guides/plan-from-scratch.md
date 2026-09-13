**English** | [日本語](./plan-from-scratch.ja.md)

# Plan from scratch

Even without footage yet, you can start from planning — ideation, research, and structuring.
The skill is `research-plan`. It handles the full pre-shoot pass (ideation → research → brief
→ storyboard → shot list).

## When to use it

- "I want to make something but need to decide on the topic first"
- You want to lock down the structure and shot list before shooting
- You want to assemble a video mostly from generated material (no shoot)

## How to ask

"I want to start from planning the video" / "Brainstorm topics for ◯◯"

## Flow

1. **Ideation (ideate)** — presents multiple candidate themes
2. **Research** — investigates target audience, competitors, and trends to back the ideas up
3. **Topic selection (topic-select)** — approve via a decision card
4. **Structure & storyboard (storyboard)** — proposes a structure and confirms it via structure-confirm
5. **Shot list (shotlist)** — a list of what to shoot and how

Approval is decision-card style. Candidates and their rationale are laid out side by side; picking
one records the decision in `planning/research-plan.json`.

## What gets generated

| File | Contents |
|---|---|
| `planning/research-plan.json` | The SSOT for the plan (topic / target / structure / shot_list) |
| `research-plan-report.html` | The planning report (with a record of decisions) |

## Not shooting — placeholder clips

With zero footage, the canonical source is still the `edit.json` timeline from the beginning. A
placeholder is **a still-image clip on the timeline plus a neighboring `<path>.meta.json`**. The
still clip owns its duration and position, so it can remain in the finished video or be replaced by
video later without changing the clip identity.

Run `akari generate still <projectDir> --spec <beats.json>` to create still placeholders. To check
only timing and order before choosing the pictures, add `--placeholder` for free text cards. Select
only the clips that should move, then run `akari generate video <projectDir> --item <itemId>`. Paid
generation runs with `--yes` only after a cost estimate and explicit cost approval.

## Next steps

- Once you have footage → [Analyze footage](./analyze-footage.md)
- Build placeholder clips and move to editing → [Plan your edit](./plan-your-edit.md)
