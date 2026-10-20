

# Proposal, structure, and storyboard

Read this file only at step 5 of [SKILL.md](SKILL.md), after the `topic-select` card has a non-null `completedAt` (or explicit chat approval) and `topic.selected` is set. Produce `structure`, including `chapters[]`, `shots[]`, `opening_hook`, `confirmed`, and `confirmed_at`.

## 1. Draft the chapter structure

Write the video's structural beats for the selected topic in `structure.chapters[]`, ordered as they will appear on the timeline. Each chapter has:

- `id`: A short chapter identifier.
- `title`: Chapter name.
- `duration_estimate_seconds`: Estimated duration in seconds, or `null` if unknown.
- `notes`: Visual direction, on-screen text approach, and related guidance.

Let the Hub, Hero, or Help classification in [ideate.md](ideate.md) inform pace and length. For example, a Hero concept needs a strong opening hook, while a Help video should cover the steps thoroughly.

## 2. Decide how to open

Use one sentence in `opening_hook` to describe the opening intended to hold viewers, such as "Show the finished video in the first three seconds." If no hook is selected, set it to `null` and explain why in the report.

## 3. Create storyboard shot cards

Write the principal shots for each chapter in `structure.shots[]`. A shot card describes only what to show and how to show it; it is a visual blueprint, separate from the practical list in [shotlist.md](shotlist.md).

- `id`: A short shot identifier.
- `chapter_id`: The associated `structure.chapters[].id`, or `null` if unassigned.
- `sequence`: Optional reference to `structure.chapters[].id` for chapter bands in the visual storyboard.
- `cutaway_of`: Optional `id` of the main shot to which this one cuts away and returns. Limit this to one branch level; do not branch from a cutaway.
- `shot_type`: Free-text shot size and angle, such as `close-up`, `overhead`, or `wide`; do not impose a strict enum.
- `description`: What appears on screen.
- `duration_estimate_seconds`: Estimated seconds, or `null` if unknown.
- `camera`: Reserved optional field. It may contain `movement?: string[]` and `path_hint?: string`, but this workflow does not interpret that vocabulary; display any values as text in the report.
- `image_path`: Optional concept-image path. **An image is not required to finish this stage**; leave it `null` when unnecessary.

### 3.1 Add a concept image when useful

Concept images are optional aids to understanding the storyboard. They are not required for every shot. Generate or select images only for representative shots that need them.

1. Follow the Decision Communication Contract in [plan-edit/approvals-and-generation.md](../plan-edit/approvals-and-generation.md): state the target, method, reason, alternatives, and impact.
2. Choose the source in this order:
   1. Generate a concept image with Codex image generation (`image_generation` in `codex exec`).
   2. If generation is unnecessary or unsuitable, use an actual frame from the footage.
3. Save the generated image or source frame under the same planning directory as `research-plan.json`. Put its relative path in `image_path`, and record the method, instructions, date, and source as provenance.
4. Keep `image_path: null` for a shot without an image; review its `shot_type` and `description` text placeholder in the report.


### 3.2 Generate the visual storyboard report

Validate `research-plan.json`, then generate the self-contained HTML report:
```sh
node packages/decision-cards/render-research-plan-report.mjs \
  planning/research-plan.json \
  planning/research-plan-report.html
```
- The card view groups shots by `sequence`. Each row shows a small image on the left and text on the right; opening it reveals the full text and a larger image, or a text placeholder if `image_path` is absent.
- The structure view orders shots without `cutaway_of` as the main sequence and shows branches and return lines in a read-only SVG.
- For older data without `sequence` or `cutaway_of`, show the cards normally and display `構造情報なし` ("no structure information") in the structure view.
- Keep shot-specific and overall annotations in the browser only. `注釈をコピー` ("copy annotations") produces text for pasting back, including shot IDs and the exact annotation wording. The report writes no file itself. The agent overwrites the single `plan-comments.json` file, revises only named shots, and deletes the file after processing.

## 4. Wait for approval before confirming

Do not write `structure.confirmed` or `structure.confirmed_at` until the `structure-confirm` card in [SKILL.md](SKILL.md) is complete. Its `answer` records chapter adoption via `chapters[].adopt` and the opening-hook choice. Keep rejected chapters in `structure.chapters[]` and record their rejection in the report's `decision_log`; deletion would erase the decision history.

## 5. Receive revisions to `structure-confirm` (plan-comments.json)

Before presenting the `structure-confirm` card again, check for `<plan-dir>/plan-comments.json` **before interpreting chat replies**. The [plan-comments contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-25-plan-comments-v0.md) defines its lifecycle and format.

- If `plan-comments.json` has `pass: "structure"`, revise **only** the entries in `structure.shots[]` named by `comments[].target_kind: "shot"`; `target_id` is the array index. Leave unnamed chapters and shots unchanged.
- After revising, **delete `plan-comments.json`** before presenting the updated `structure-confirm` card.
- If no file exists, follow the revision instructions in chat as before.

## Common mistakes

- Setting `structure.confirmed: true` before approval.
- Putting equipment or location in `shot_type` by confusing a shot card with a shooting checklist.
- Generating a concept image without first making the Decision Communication Contract declaration.
- Guessing `duration_estimate_seconds` when duration is unknown instead of using `null` and stating that it is undecided.
