**English** | [日本語](./plan-your-edit.ja.md)

# Plan your edit and execute it

The central step: based on the analysis, the agent proposes an editing direction and writes it
to `edit.json` (the editing save file) according to the selected mode. The skill is `edit-plan`.

## When to use it

- After footage analysis ([analyze-footage / analyze-project](./analyze-footage.md)) is done
- When you want to decide cut structure, BGM, SFX, B-roll, and caption plans all together
- When assembling from zero footage via generation (→ first see
  [Plan from scratch](./plan-from-scratch.md)). With no media, it starts by turning a question dialogue
  into a provisional timeline in `plan.json`

## How to ask

"Draft an editing direction" / "Trim this down to 60 seconds based on the analysis report" /
"Cut for pacing"

If you prefer to assemble and trim the timeline yourself first, save `edit.json` and ask “How does
this feel so far?” or “Take a look at this cut.” [critique-cut](../../skills/critique-cut/SKILL.md)
will inspect only the source ranges used by the timeline plus one contact sheet of the composited
result, then return observations without rewriting the edit. Route broad structural changes back
through edit-plan; for a point fix, add an annotation and continue with
[QA, review, and fix](./review-and-fix.md).

## Three modes (one stamp, at export)

| Label | ID | What happens | Stamps |
|---|---|---|---|
| Fully automatic | `full-auto` | Adds exactly what you asked for and exports without preview review. Attaches 1–2 captures and lint results afterward | 0 |
| With suggestions (default) | `checkpoint` | Adds what you requested plus promising additions to the timeline. You review the preview, remove or adjust anything unwanted, and export | 1, at export only |
| Create together | `collaborative` | Confirms three stages: direction → asset plan → execution | One per stage |

The default is **With suggestions**. edit-plan adds what you requested plus promising additions
to the timeline. It does not pause along the way. Review the preview and remove anything
unwanted. The export button is the only stamp.

**Fully automatic** exports without preview review, then attaches 1–2 captures and lint
results in `.akari/reports/`. It does not add anything you did not ask for (B-roll, BGM, effects).

Only **Create together** stops at three stages. In order — direction (thumbnail ideas, cut intensity,
caption policy, chapters), asset plan, execution — it shows a recommendation and alternatives in chat
and does not move on until you approve explicitly. The analysis report (analyze-project) is the
primary evidence for these decisions.

Switch modes in the intake form (“How to proceed” in Home, `autonomy` in `.akari/intake.json`).
A one-line instruction takes precedence over the form.

Approval for billing and external sends is independent of the mode
([Connections and API keys](../how-to/connections.md)).

Every decision is appended to `decision-log.md`, so "why did it end up this way" can always be
traced afterward. The machine writes one prediction line when it adds a proposal to the
preview, so the record continues without an approval pause. At export, outcome rows are added for
what you deleted, changed, or left as is.

## Where it stops — automation gates

In every mode, the agent stops and waits for your answer before anything **irreversible, outward-facing,
or touching money or rights**. Changes that stay inside the project and can be undone (`edit.json`,
`captions.json`, `planning/`, adding generated assets) go ahead without stopping, even while you are
not watching.

| Gate | Stops before |
|---|---|
| Publish / post | Publishing to YouTube or similar, issuing a share link |
| Lab submission | Submitting to Lab or a store |
| Paid | Paid generation or purchase (with an estimate) |
| External send | Sending assets or documents to an external service |
| Delete original | Deleting or overwriting imported original media |
| License check | Unclear provenance, suspected non-commercial terms, and similar |
| Playbook checkpoint | A checkpoint declared by a Playbook |
| Check requested | A point where you asked to be consulted |

When it stops, a gate band appears on screen with “Approve” and “Cancel”. The agent cannot approve for
itself. Export is not a gate: unless it overwrites an original, it can be undone.

### Activity

Work that went ahead without stopping is kept under “Activity” (shown in the Japanese UI as
「やったこと」). Rows are newest first, with the time, who did it (you / partner / outside agent / unattended),
a one-line summary, and the number of files changed. Open it from the project's Home or from the gate band.

- **View changes** — see the diff of that milestone
- **Restore to before this** — return the files to the state before that milestone. The restore itself is saved
  as a new milestone, so it can be undone too

Only editing data and documents are restored. Imported originals and exported videos are not part of the
history. If the project has no git history, the list is not shown.

## What gets generated

| File | Contents |
|---|---|
| `edit.json` | The SSOT for the edit: sources, ordered tracks, clips, audio, captions, and thumbnail |
| Overlay HTML fragments | Titles, figures, and shapes (referenced by HTML clips in `tracks[].items[]`) |
| `captions.json` | Caption data |
| `planning/script.json` | Planned and memo lines for the script (if any) |
| `decision-log.md` | A record of decisions |

## The essentials of edit.json

This file is the canonical record of the editing state. The exact schema is defined in each
contract under [Reference](../README.md#reference), but day to day, what matters is:

- **New projects use edit v2** — `sources[]` declares media and `tracks[].items[]` holds every
  visual or audio clip. A clip points to its source with `source.kind` and `source.src`.
- **It is a tree** — an item can hold child `items[]`. A group (`source.kind: "group"`, called a canvas in
  the UI) can contain more clips. A child's `at` is in frames relative to its parent, and the order of
  `items[]` is the front-to-back stacking.
- **Tracks are just ordered rows** — `lane` separates visual from audio; old “main” and
  “layer” categories are not part of the format. Visual stacking follows the order of
  `tracks[]`, from back to front.
- **Clips use frames on the output timeline** — `at` and `duration` are integer frames.
  Media trim points `source.in` and `source.out` remain seconds in the original source.
- **Empty rows are preserved** — a declared track remains visible when `items[]` is empty.
  Moving its last clip does not delete it; only the explicit “Delete track” action does.

You're free to edit it by hand (git diff will track the changes). Just remember to run
[edit-lint](./review-and-fix.md) afterward. To read it without loading the whole file, grep by id and
read only the matching lines; see [How to read edit.json](./edit-json-access.md).

## Script plans and memos

Besides captions, the Script panel can hold **planned** lines (what you intend to put here) and
**memo** lines (notes and instructions). All three kinds sit in one column in time order. A plan can
have a range and is checked off when done. “+ Memo” adds a memo at the current playhead.

Plans and memos live in `planning/script.json` (captions remain canonical in `captions.json`). A
“Script” row appears at the top of the timeline, with plans as bands and memos as dots. You do not edit
there; you edit in the Script panel. In a project started from a Playbook, the Playbook's breakdown
becomes the planned lines.

A caption look (caption style) can be applied to all captions or only to the text you select.

## Transitions

You can put a transition on the boundary between two clips.

- **Pick by preview** — select a boundary and choose a type (cross-fade, wipe, slide, zoom, and so on)
  from a list with previews. It is applied at 0.5 seconds, and the Inspector lets you change type,
  direction, length (0.1–3 seconds), and position. Dropping a style from the Library onto a boundary
  works too
- **Shift it** — position is “center”, “shift earlier”, or “shift later”. When you apply one, it moves
  automatically toward the side that has spare material, and you can adjust it in the Inspector
  (“Reset to recommended” undoes your change)
- **Fill with held frames** — when there is not enough spare material, you are asked whether to hold
  a frame for the missing part. The timeline length does not change, and the filled range shows as a band

If spare material is still missing, the transition gets shorter. It cannot be applied when there is a gap
between clips or more than one video track (the screen tells you why).

## Captions with speakers separated

For conversations and interviews, you can separate speakers at transcription time (you only give the
number of people). If the channel's people have consented voice samples, name suggestions also appear;
a person decides the name. See [Analyze footage](./analyze-footage.md).

## Asking for part of it

You don't have to hand off the whole plan — you can also ask for individual pieces:

- Just captions, figures, or 3D → [Make titles, captions, figures, and 3D](./overlays-and-captions.md)
- Just narration → [Add narration](./narration.md)

## Next steps

- Inspect the result → [QA, review, and fix](./review-and-fix.md)
- Export → [Export](./export.md)

<!-- BEGIN GENERATED facts:stamp -->
This page describes AKARI Video v1.5.1 (released 2026-10-19).
<!-- END GENERATED facts:stamp -->
