**English** | [日本語](./plan-your-edit.ja.md)

# Plan your edit and execute it

The central step: based on the analysis, the agent proposes an editing direction and, after
approval, commits it to `edit.json` (the editing save file). The skill is `edit-plan`.

## When to use it

- After footage analysis ([analyze-footage / analyze-project](./analyze-footage.md)) is done
- When you want to decide cut structure, BGM, SFX, B-roll, and caption plans all together
- When assembling from zero footage via generation (→ first see
  [Plan from scratch](./plan-from-scratch.md))

## How to ask

"Draft an editing direction" / "Trim this down to 60 seconds based on the analysis report" /
"Cut for pacing"

## Three approval gates

edit-plan doesn't run straight through to the end — it pauses for chat approval at three
milestones (auto-approved when `autonomy: full-auto`):

1. **Direction** — overall structure, tone, and duration allocation. Presents the analysis
   report as primary evidence
2. **Asset plan** — which part of which clip to use, and how to fill any gaps (generate /
   shoot more / reuse existing material)
3. **Execution** — writes to edit.json and generates overlays

Every decision is appended to `decision-log.md`, so "why did it end up this way" can always
be traced afterward.

## What gets generated

| File | Contents |
|---|---|
| `edit.json` | The SSOT for the edit: cut sequence, overlay references, audio (BGM/SFX/narration), beats, direction |
| Overlay HTML fragments | Captions, subtitles, shapes, etc. (referenced from `edit.json`'s `overlays[]`) |
| `captions.json` | Caption data |
| `decision-log.md` | A record of decisions |

## The essentials of edit.json

This file is the canonical record of the editing state. The exact schema is defined in each
contract under [Reference](../README.md#reference), but day to day, what matters is:

- **cuts[]** — which part of which clip (`src`), from what second to what second. Times are
  always persisted in **the clip's original seconds**, so reordering cuts doesn't break
  references
- **overlays[]** — references to overlay HTML and their timing
- **audio** — sound effects and music as clips (`audio.sfx[]`: same `t`/`in`/`out` model as
  `cuts[]`, trim by dragging the ends on the timeline bar), plus narration
  (`audio.narration[]`). `audio.bgm` still exists as a shorthand "bed" for looping one track
  under the whole video — reach for it only when you don't need to trim or place it partway
  through; everything else (music over just part of the video, switching tracks) is a clip

You're free to edit it by hand (git diff will track the changes). Just remember to run
[edit-lint](./review-and-fix.md) afterward.

## Asking for part of it

You don't have to hand off the whole plan — you can also ask for individual pieces:

- Just captions, figures, or 3D → [Make titles, captions, figures, and 3D](./overlays-and-captions.md)
- Just narration → [Add narration](./narration.md)

## Next steps

- Inspect the result → [QA, review, and fix](./review-and-fix.md)
- Export → [Export](./export.md)
