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

If you prefer to assemble and trim the timeline yourself first, save `edit.json` and ask “How does
this feel so far?” or “Take a look at this cut.” [critique-cut](../../skills/critique-cut/SKILL.md)
will inspect only the source ranges used by the timeline plus one contact sheet of the composited
result, then return observations without rewriting the edit. Route broad structural changes back
through edit-plan; for a point fix, add an annotation and continue with
[QA, review, and fix](./review-and-fix.md).

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
| `edit.json` | The SSOT for the edit: sources, ordered tracks, clips, audio, captions, and thumbnail |
| Overlay HTML fragments | Titles, figures, and shapes (referenced by HTML clips in `tracks[].items[]`) |
| `captions.json` | Caption data |
| `decision-log.md` | A record of decisions |

## The essentials of edit.json

This file is the canonical record of the editing state. The exact schema is defined in each
contract under [Reference](../README.md#reference), but day to day, what matters is:

- **New projects use edit v2** — `sources[]` declares media and `tracks[].items[]` holds every
  visual or audio clip. A clip points to its source with `source.kind` and `source.src`.
- **Tracks are just ordered rows** — `lane` separates visual from audio; old “main” and
  “layer” categories are not part of the format. Visual stacking follows the order of
  `tracks[]`, from back to front.
- **Clips use frames on the output timeline** — `at` and `duration` are integer frames.
  Media trim points `source.in` and `source.out` remain seconds in the original source.
- **Empty rows are preserved** — a declared track remains visible when `items[]` is empty.
  Moving its last clip does not delete it; only the explicit “Delete track” action does.

You're free to edit it by hand (git diff will track the changes). Just remember to run
[edit-lint](./review-and-fix.md) afterward.

## Asking for part of it

You don't have to hand off the whole plan — you can also ask for individual pieces:

- Just captions, figures, or 3D → [Make titles, captions, figures, and 3D](./overlays-and-captions.md)
- Just narration → [Add narration](./narration.md)

## Next steps

- Inspect the result → [QA, review, and fix](./review-and-fix.md)
- Export → [Export](./export.md)
