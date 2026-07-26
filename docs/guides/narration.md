**English** | [日本語](./narration.ja.md)

# Add narration

Generates audio from a script and wires it into `edit.json`. The skill is `generate-narration`.

## When to use it

- When you want to add narration to an explainer video or vlog
- When you want a quick scratch narration (to check duration) fast
- When you want to generate narration from a clone of your own voice

## Two engines

| Engine | Characteristics | Cost |
|---|---|---|
| VOICEVOX | Runs locally, character voices | Free |
| Cloud TTS (supports voice cloning) | Generates from your own voice profile | Paid (requires connection setup and approval) |

Paid engines only run after passing `manage-connections`'s cost approval policy. You won't be
charged without your knowledge.

## How to ask

- "Add narration with this script"
- "I just want to check the duration with a scratch narration first" (→ generated immediately
  via VOICEVOX)
- "I want to make it in my own voice" (→ walks you through creating a voice profile)

## What gets generated

- An audio file (placed inside the project)
- A registration in `edit.json`'s `audio.narration[]` (which audio covers which range)

After generation, [edit-lint](./review-and-fix.md) checks duration, overlaps, and broken
references.

## Voice profiles

If you use your own voice clone, the voice profile is stored outside the project (under
`~/.config/akari-video/`) and can be reused across projects.

## Next steps

- Add BGM and SFX too → [Plan your edit](./plan-your-edit.md) (audio planning is handled by
  edit-plan)
- Set up connections → [Connections & API keys](../how-to/connections.md)
