**English** | [日本語](./plan-from-scratch.ja.md)

# Plan from scratch

Even without footage yet, you can start from planning — ideation, research, and structuring.
The skill is `plan-video`. It handles the full pre-shoot pass (ideation → research → brief
→ storyboard → shot list).

## When to use it

- "I want to make something but need to decide on the topic first"
- You want to lock down the structure and shot list before shooting
- You want to assemble a video mostly from generated material (no shoot)

## Ways to start

There are two entrances.

- **From a blank page** — ask "I want to start from planning the video" or "Brainstorm topics for ◯◯".
  The agent runs the whole pass from ideation.
- **Start from a playbook** — if you have a Playbook on hand or in the channel, start from it. In Home, choose
  "Start from a playbook" in "<!-- F ui.home.startButton -->+ Start a new video<!-- /F -->", or run `akari new <dir> --from <playbook id>` in the CLI. The flow
  and settings carry over, and you get a timeline with open slots and planned lines in the script.
  `akari playbook list` shows which Playbooks you can pick.

A Playbook is a document of steps and checkpoints. If you want to decide the topic again from scratch,
start from a blank page.

## How this relates to a channel

When you create a project inside a channel, the channel's belongings are available to the plan.

- **Types** — drafts of a plan document. Choosing a channel's type puts it under `planning/`
- **People** — records of the people who appear (name, reading, photos, voice)
- **Memory** — people and the word book (`.akari/memory/word-book.json`). Words you fix in the Script
  panel are added to the word book too
- **<!-- F ui.library.channelSettings -->Channel settings<!-- /F -->** — the channel's rules for logo, fonts, and colors

If `.akari/connections.json` declares a memory connection, `plan-video` reads its entry point
(`INDEX.md` by default) at the start of planning. The files it read are kept in `sources[]` of
`research-plan.json`. Without a declaration, nothing is wrong and the pass continues.

## Flow

1. **Ideation (ideate)** — presents multiple candidate themes
2. **Research** — investigates target audience, competitors, and trends to back the ideas up. It can
   finish with free sources only
3. **Topic selection (topic-select)** — approve via a decision card
4. **Structure & storyboard (storyboard)** — proposes a structure and approves it with the
   structure-confirm decision card
5. **Shot list (shotlist)** — a list of what to shoot and how

There are only two places to approve: topic selection and structure confirmation. Candidates and their
rationale are laid out side by side, and picking one records the decision. You can also press "Confirm all
recommendations". The agent does not move on before an approval. Paid research APIs are called only
after the cost is shown and approved; a reply in chat alone does not authorize a charge.

To revise the structure, say so in chat or paste annotations back from the report's "copy annotations"
(`planning/plan-comments.json`).

## What gets generated

| File | Contents |
|---|---|
| `planning/research-plan.json` | The SSOT for the plan (topic / target / structure / shot_list) |
| `planning/research-plan-report.html` | The planning report (read-only), with five surfaces: ranked ideas, competitors, structure, storyboard, and shooting checklist |
| `planning/research-plan-report.html.decisions.json` | The record of the decision cards |

## Not shooting — placeholder clips

With zero footage, the canonical source is still the `edit.json` timeline from the beginning. A
placeholder is **a still-image clip on the timeline plus a neighboring `<path>.meta.json`**. The
still clip owns its duration and position, so it can remain in the finished video or be replaced by
video later without changing the clip identity.

Run `akari generate still <projectDir> --spec <beats.json>` to create still placeholders. To check
only timing and order before choosing the pictures, add `--placeholder` for free text cards. Select
only the clips that should move, then run `akari generate video <projectDir> --item <itemId>`. Paid
generation runs with `--yes` only after a cost estimate and explicit cost approval.

Planned lines in the script (what goes in at which second) also appear in the top row of the timeline.
See [Plan your edit](./plan-your-edit.md) for details.

## Next steps

- Once you have footage → [Analyze footage](./analyze-footage.md)
- Build placeholder clips and move to editing → [Plan your edit](./plan-your-edit.md)

<!-- BEGIN GENERATED facts:stamp -->
This page describes AKARI Video v1.5.1 (released 2026-10-19).
<!-- END GENERATED facts:stamp -->
