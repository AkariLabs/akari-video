**English** | [日本語](./review-and-fix.ja.md)

# QA, review, and fix

The loop of checking and review is what makes "nearly finished when you open it" work.
Three skills work together: `edit-lint` (mechanical checks) → `compile-review-session`
(turns recorded review into tickets) → `address-review` (resolves tickets).
Marks you draw directly on the preview become annotations (tickets) without any recording.

## Self-check — `edit-lint`

**When to use**: Right after creating or changing `edit.json`. Before export. To re-check
after addressing review tickets.

**How to ask**: "run lint" / "check it before I export"

**What it does**:

1. A deterministic CLI checks `edit.json` (v2), `captions.json`, `analysis.json`, and the
   media assets themselves (broken references, time inconsistencies, overlaps, duration
   mismatches, etc.; for v2 it also warns about items that are too short and about a
   source range that disagrees with the duration placed on the timeline)
2. Before export, run it with `--engine gpu` / `osr` / `auto` to confirm the export engine
   reads every field you used (the table lives in `packages/schemas/engine-capabilities.json`).
   A field the engine ignores is an error; one it only approximates is a warning
3. After PASS, the agent **actually looks at** keyframes to confirm quality

**What it produces**:

- `.akari/lint.json` — the canonical check result (`verdict: pass / fail`)
- `.akari/reports/edit-lint-report.html` — a human-readable report

In the app you can open the check results in a popup, down to the details, and have your
partner fix the findings as they are. On FAIL, the report shows counts and reasons. You can
ask "fix the lint failures" to have them addressed. render-cut requires lint PASS as a
precondition, so this gate can't be skipped.

## Mark the preview and hand it to the AI

You don't have to record anything. Mark what bothers you directly while you watch.

1. On the **second row** of the output preview's playback bar, pick **Pen**, **Pin**, or **Range**
   - Pen: draw a line on the video
   - Pin: click the video to drop one (you can drag it afterwards)
   - Range: choose a start and an end (confirming a range leaves the Range tool)
2. Write what you want changed in the small window beside the mark. The caption or footage
   under the mark is recorded with it. (The window stays up until you close it with ×, and
   you can still play and seek meanwhile.)
3. Confirmed marks appear as **annotations in the right panel**. They also show in the
   "Attachments (N)" list on the playback bar, and they survive reopening the app
4. Press **"<!-- F ui.annotation.handToAi -->Hand to AI<!-- /F -->"** on one annotation, or **"Hand all to AI"** for all of them. The request
   is placed in the input of the partner you used last and stops there, so you can read it
   before sending. For partners that can't be typed into, you're guided to copy and paste it

For pen lines, the request says "from where to where". Pressing a pen line in an annotation
traces it in the order it was drawn, with a circle at the start so you can tell which way
it went. Annotations and recordings can be deleted.

Annotations are stored in `review.json`. Contracts:
[review.json v1 annotation model](../contract-2026-07-20-review-json-v1-annotation-model.md) and
[annotation stroke persistence](../contract-2026-08-23-stroke-persistence.md) (both in Japanese).

## Review while talking through it — `compile-review-session`

**When to use**: When you want to call out issues out loud while watching the preview.

Start with "Annotate while talking" in the right panel, then talk and draw while it plays
(use earphones). A recording is kept under `review/sessions/` as audio, interaction events,
the lines you drew, and a snapshot of `edit.json` at that moment. Hand it over and it:

1. Transcribes it → segments the utterances
2. Resolves deictic references like "here" or "this caption" to their **actual targets**
   using playback position and interaction events
3. Normalizes them into imperative form and lands them as open tickets (annotations) in
   `review.json`. An utterance it can't resolve is never dropped silently; it stays with a
   `[要確認]` (needs confirmation) marker and low confidence

**How to ask**: "turn that review session into tickets"

The right panel shows how many recordings you haven't handed to the AI yet. "Look back at the
recording" replays audio, output preview, lines, and transcript on one clock, and shows how
`edit.json` has changed since the recording
([session viewer contract](../contract-2026-09-12-review-session-viewer.md), in Japanese).

## Address tickets — `address-review`

**When to use**: When `review.json` has open tickets piling up.

**How to ask**: "address a-0002 and a-0003" / "address all open tickets"

For each ticket, it makes the actual fix in `edit.json` → re-checks with edit-lint →
updates the ticket from `open` to `addressed`, following the same routine every time.
A ticket it won't act on is never closed silently; it's returned as declined, with a reason.
Tickets marked `[要確認]` are handled only when you name them. State transitions are recorded
atomically, so it's always clear what's been addressed.

Only a person can set `resolved` (confirmed). `addressed` means the AI has acted, and the
ticket still counts as unresolved until you confirm. You do that on the review board (the
kanban of `review.json`) after looking at the result.

## Automation gates and "Activity"

When you hand work to an agent and aren't watching, **work that can be undone keeps going,
and only what can't be undone waits for your answer**. At every autonomy level (fully automatic /
with suggestions / create together), it always stops at these points:

| Stops at | Example |
|---|---|
| Publishing | Uploading to YouTube, issuing a share link |
| Lab submission | Submitting to Lab or the store |
| Paid | Paid generation or purchase (with an estimate) |
| Sending out | Sending a person's photo to a generation API |
| Deleting originals | Deleting or overwriting imported footage |
| License check | Unknown origin, suspected no-commercial-use |
| Playbook checkpoint | A point the playbook declared as "stop here" |
| Asked to confirm | A point a person asked to double-check |

When it stops, the app shows a confirmation-waiting band. **Approve** to continue, or
**Cancel** to skip it. Work that went ahead without stopping is recorded as milestones of the
project, and the **"Activity"** list shows who did what (you / partner / outside agent /
unattended). You can **view the changes** or **restore to before this**. Going back is itself saved as
a new milestone, so you can undo the undo. What goes back are the edit data and documents; the
imported footage and the exported files aren't part of the history, which is why deleting or
overwriting originals stops at a gate. Contract:
[automation-gates-v0](../contract-2026-10-16-automation-gates-v0.md) (in Japanese).

## About review persistence

Annotations aren't stored as "seconds on the timeline" but as **(asset, source timestamp
within the asset)**. Reordering cuts doesn't shift what a ticket points to.

## Next steps

- Once everything passes → [Export](./export.md)

<!-- BEGIN GENERATED facts:stamp -->
This page describes AKARI Video v1.5.1 (released 2026-10-19).
<!-- END GENERATED facts:stamp -->
