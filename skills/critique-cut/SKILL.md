---
name: critique-cut
description: Read a human-assembled edit.json and observe only the source ranges used in its timeline, then return findings without editing. This read-only skill never modifies edit.json. Use for requests such as “How does this look?”, “Look at this cut”, or “Critique the current timeline”.
---

# Give findings on an assembled timeline

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

Observe a timeline whose direction was chosen and assembled by a human; return findings without fixes.
Read [workflow.md](workflow.md) for derivation, prior-observation checks, time selection, and report template.

## Hard rules

1. **Do not modify `edit.json` / `captions.json` / `review.json`.** All 3 files are always read-only; no automatic fixes or tickets.
   The only findings file you may write is `.akari/reports/critique/<stamp>/critique.md`.
   `akari media` appending observations to asset `analysis.json` is permitted as an observation-CLI ledger side effect.
   Do not run `akari migrate` from this skill because it modifies edit.json.
2. **Separate facts and readings.** Label CLI/ledger/actually viewed finished-frame information as facts;
   label derived evaluations and proposals as readings.
3. **Do not discuss unseen material.** Normally view only 1 finished-frame contact sheet.
   Mark unavailable/unviewed sections unobserved rather than guessing, including failed v0/v1 capture.
4. **Ask at most 1 question.** Combine only ambiguities essential to findings into 1 question.
   If readable without questions, ask none.
5. **Read the ledger first; do not observe twice.** If existing `analysis.json` `probe` / `tracks.waveform` /
   `transcript[]` / `observations[]` cover the used ranges, do not rerun. Fill only unobserved ranges through the CLI.
6. Limit observations to timeline-used `(src, source 秒)` (existing notation: source seconds).
   Do not `transcribe` unused ranges. Distinguish source and timeline seconds; locate findings in both.

## Execution order

Do not Read all of `edit.json` / `captions.json`; grep by ID and read only matching lines ([Reading edit.json](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/edit-json-access.md)).
This skill does not write them. Other writing stages use relevant-line Edit or edit-store's script API.

1. Read the version line with `grep -n '"version"' edit.json`, distinguish v0/v1/v2, and grep target IDs for
   relevant lines only. For v0/v1, inspect `source` / `sources[]`, `cuts[].src/in/out/at/track`,
   `overlays` / `layers` / `audio`; for v2, inspect `sources[]`, `tracks[].lane/items[]/content`,
   `items[].at/duration/source`, `audio` / `captions` / `thumbnail`.
   Use the helper CLI below to get merged overlapping/adjacent used ranges, timeline projections, and nonmedia item counts.
   Stop for unsupported versions rather than guessing.

   ```sh
   node skills/critique-cut/bin/used-ranges.mjs <project-root>/edit.json
   ```

2. Apply [workflow.md](workflow.md#prior-observation-checks)'s checks per asset. From the project root,
   run only missing observations in this order. `probe` / `waveform` have no range arguments, so run at most 1 time
   per asset; for `speech_likely: true` assets, `transcribe` each merged used range with `--in/--out`.
   This is range-limited L0 + L1.

   ```sh
   akari media probe <src-id-or-path>
   akari media waveform <src-id-or-path>
   akari media transcribe <src-id-or-path> --in <source-in> --out <source-out>
   ```

3. **Only for edit.json v2**, capture a finished-frame contact sheet using the union of `akari capture --auto`,
   times in the opening 3 seconds, and explicitly requested times. Actually view **only 1 sheet**, selected in
   [workflow.md](workflow.md#capture-time-selection)'s priority order. Do not run current `akari capture` for
   v0/v1, which it rejects. Recommend `akari migrate <project-root>` to the human, but **never run migrate yourself**
   because it writes edit.json. If capture remains unavailable after human migration, or migration is not done,
   mark ② Visible picture unobserved and do not discuss visuals.
4. Assemble findings in the fixed format below. Locate each issue in timeline seconds and `(src, source 秒)`
   (existing source-seconds notation), e.g., `timeline 4.2s / (s2, source 18.0s)`.
5. Write findings and evidence to `.akari/reports/critique/<stamp>/critique.md`: viewed sheet path, observed
   `(src, source range)`, per-asset ledger paths and reused/appended status, number of images viewed.
   Return the same ①–⑥ summary in chat.
6. Deepen only needed areas according to the human's reply. Propose L2 via
   `akari media grab <target> -t <source-time...>` for further visuals, or L3 for person-related staging.
   **Do not execute fixes in this skill.** Hand substantial structure/direction fixes to
   [edit-plan](../edit-plan/SKILL.md), explaining that existing human direction allows Checkpoint 1 to pass by ratification.
   For pinpoint fixes, the human first locates them in `review.json` annotations, then hand off to
   [address-review](../address-review/SKILL.md). If no annotation exists, ask the human to mark the location;
   do not create tickets from this skill.

## Findings format

Keep sections in ①–⑥ order. Even optional sections retain headings; without evidence, write unobserved.

1. **① Facts** — Duration, cut count, used assets, speech presence, silence positions within used ranges.
2. **② Visible picture** — Overlaps, caption positions, clipping, black frames verifiable from the 1 viewed sheet.
   Outside-sheet material is unobserved; if capture fails, mark the whole section unobserved.
3. **③ Pace and pauses** — Read from cut-length distribution, actual duration with speed/freeze, and silence in used ranges.
4. **④ Caption need and approach** — Reading based on speech facts and finished visuals.
   Do not justify captions solely from `speech_likely`.
5. **⑤ Hook position** — Explain what is in the opening 3 seconds using timeline 0–3-second facts and finished visuals.
6. **⑥ Up to 3 next actions** — Label each `edit-plan 行き` / `address-review 行き` / `追加観察`
   (existing Japanese example labels: hand off to edit-plan / address-review / further observation).
