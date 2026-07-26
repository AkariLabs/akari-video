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

## Not shooting — the placeholder timeline (plan.json)

When you assemble a video with zero footage, edit-plan builds a **plan.json (placeholder
timeline)** through conversation. It's a sequence of slots each carrying a confidence level, and
each slot gets filled by one of three means:

- **generate** — generate it (image, video, 3D bake, etc.)
- **record** — shoot or record it
- **import** — bring in existing material

Once all slots are filled, plan.json compiles into `edit.json`, and the project joins the normal
editing flow from there.

## Next steps

- Once you have footage → [Analyze footage](./analyze-footage.md)
- Fill the slots and move to editing → [Plan your edit](./plan-your-edit.md)
