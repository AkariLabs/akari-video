---
name: render-cut
description: Take an approved edit.json and an edit-lint PASS through final MP4 planning, explicit approval, local export, ffprobe verification, and visual keyframe inspection. Use when the edit is approved and the user requests a delivery video or final render.
---

# Export an approved edit

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

## Hard rules

1. **Generate commands deterministically from edit.json as the SSOT. Improvised ffmpeg from natural language is forbidden** (handwriting an ffmpeg command and saying "I exported it" violates the contract).
2. **Rendering without a plan is forbidden** (never skip validate → plan → approval → render).
3. **Rendering while edit-lint is FAIL is forbidden** (an override requires an approval gate and a render.json record).
4. **Machine verification with ffprobe after rendering is required.** Do not call an output deliverable if verification failed.
5. **Default to local ffmpeg only.** Paid cloud APIs (such as Rendi) are not adopted in v0 (future use may be considered only through opt-in and the manage-connections approval gate).
6. **Render from original sources** (never use proxies for the final render).
7. **State belongs in render.json; HTML is for visualization only** (do not import a new surface mechanism).
8. **Do not copy code from external candidates** (Kinocut / json-to-ffmpeg are structural references only).
9. **Never silently overwrite an existing deliverable.**
10. Call the ffmpeg / ffprobe **binaries directly** for cut concatenation, compositing, and verification (wrapper libraries are forbidden; the same policy applies across analysis, export, and verification). Draw video through either GPU or OSR.
11. **Draw 3D overlays through the GPU / OSR path too.**

## Procedure

### Resolve the executable

First run `akari doctor --json`. Use `render_cut.path` as `<render-cut>` and `cli.node.exec_path` as the node executable.
When `cli.node.runtime` is `electron`, invoke it with `cli.node.required_env` (`ELECTRON_RUN_AS_NODE=1`) as shown in `cli.node.invocation.sh` / `.cmd`; without this, the GUI application opens.
`cli.node.electron_run_as_node` only reflects the diagnostic environment; do not use it to decide whether the executable works.
For older versions without `runtime`, treat an `exec_path` basename other than `node` or `node.exe` as Electron and likewise set `ELECTRON_RUN_AS_NODE=1`.
If the version does not yet output these fields, use the discovery sequence below.

`ls` these three locations in table order; use the first existing `<render-cut>`.

| Form | macOS | Windows |
|---|---|---|
| (a) Bundled desktop application | `<App>/Contents/Resources/packages/render-cut/bin/render-cut.mjs` (default `<App>` is `/Applications/AKARI Video.app`) | `<install dir>\resources\packages\render-cut\bin\render-cut.mjs` |
| (b) `install.sh` path | `~/.akari/app/packages/render-cut/bin/render-cut.mjs` | `%USERPROFILE%\.akari\app\packages\render-cut\bin\render-cut.mjs` |
| (c) Monorepo | `<repo>/packages/render-cut/bin/render-cut.mjs` | `<repo>\packages\render-cut\bin\render-cut.mjs` |

Users who only use desktop form (a) do not have `~/.akari/app`.

Resolve node in this order: `AKARI_NODE_BIN` → node on PATH (20 or later) → bundled Electron run as node with `ELECTRON_RUN_AS_NODE=1`. Below, `node` means the executable resolved this way, and `<render-cut>` means the executable path resolved above.

Do not read all of `edit.json` or `captions.json`; grep by ID and read only matching lines ([how to read edit.json](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/edit-json-access.md)). This skill does not write them. If another stage must write them, use Edit on the matching lines or the edit-store script API.

1. Confirm that the target project's `edit.json` is approved and `.akari/lint.json` has `verdict` `pass`. Otherwise run `edit-lint` and fix it. Use `--force` only with explicit approval to override the lint result.
2. Generate only the plan.

   ```sh
   node <render-cut> <project-root> --plan-only
   ```

3. Read `<project>/.akari/render.json` and `<project>/.akari/reports/render-report.html`; present predicted duration, output location, ffmpeg command sequence, intermediates, rasterizer candidates, and input hashes.
4. **Obtain explicit human approval for this specific export and wait for it.** Do not construe silence, earlier blanket approval, or approval given before the plan as approval for this run.
5. Run the export only after approval.

   ```sh
   node <render-cut> <project-root>
   ```

   Add `--out <path>` only to specify the output explicitly. Do not manually replace the CLI's validate → plan → render → verify sequence.
   Add `--engine gpu` to request direct GPU rendering explicitly. HTML animated only with CSS animation / transition / `@keyframes` / Web Animations / `@property` qualifies as a DOM layer. Karaoke / pop / reveal / reveal-word in `words[]` and supported `emphasis_words` qualify for GPU-native rendering. A two-point entrance animation using opacity plus 2D translate / scale only on the single root element of declarative 3D also qualifies. Ineligible captions or HTML fail closed with a reason. On Windows / Linux, evaluate GPU only when `--engine gpu` is explicit; `--engine auto` chooses GPU for eligible work and OSR otherwise on every platform.
6. Check the exit code and `.akari/render.json`. `0` means completion with verify PASS; `1` means refusal or verify FAIL; `2` means execution error. In `provenance.rasterizer`, check the selected method and why higher-ranked candidates were rejected. `verify.findings` includes exact duration and frame-count matches (`verify.frame-count`), successful decoding of every frame (`verify.decode`), resolution, fps, codec, and more.
7. After verify PASS, start visual keyframe inspection with the contact sheet the CLI generates at `<project>/.akari/reports/contact-sheet.png`. It tiles stills at representative times deterministically derived from the plan: start, immediately after each cut boundary, midpoint of each overlay/caption interval, and ending. Times are recorded in `render.json` at `contact_sheet.timestamps_seconds`. Extract additional frames only for intervals this misses (including those thinned to respect the contact-sheet tile limit). Check source-cut times, text, position, omissions, and alpha compositing.

   **Sampling trap: do not judge from boundary frames alone.** A frame exactly on a beat or cut boundary always hits an interval boundary value (0% / 100% = offscreen or opacity 0). An element whose duration is exactly one beat therefore looks absent there; **do not misdiagnose normal motion as a dead animation**.

   - **Always inspect intermediate times (1/4, 1/2, and 3/4 of each interval).** Confirm that the timestamp list (`render.json` `contact_sheet.timestamps_seconds`) includes the **midpoint** of each overlay / caption interval. For thinned intervals without a midpoint, capture more with [`akari capture --auto`](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-08-29-capture-v0.md), which derives the same representative times deterministically and can be unioned with `-t <時刻>` (a specific time).
   - **Interpret blank-frame scan warnings correctly** (ON by default; OFF with `--no-verify-blank`): `verify.blank-frames` in `verify.findings` lists stretches of **at least 0.3 consecutive seconds** whose brightness remains at background level. Severity is `warning` if **at least one** overlay / cut is declared active there (the animation may have ended before its cut; investigate), or `info` if **zero** are active (likely an intended black interval; it may be ignored). Read the interval table and active IDs in `render.json` `verify.declared.blank_frames` and the HTML report. These findings do not change the verify verdict.
8. Report machine verification values, deliverable SHA-256, selected rasterizer, fallback reasons, and the contact-sheet-based keyframe inspection result. On verify FAIL, do not describe the output as deliverable; retain `.akari/render-tmp/` and report the cause.

## Storyboard (print)

Use the following command to make an L1 overview map **only for the initial timeline review**.

```sh
akari storyboard <project-root>
```

Store it in `<project>/.akari/reports/storyboard/`. Make the storyboard only once; do not update it on timeline changes. AI must not read it later or use it as input to image or video generation. If it needs redrawing, first fix `edit.json` / `captions.json` and have a human explicitly regenerate it.

## Output contract

- By default, place the result at `<project>/exports/<source-name>.mp4`. If that name exists, use a numbered name.
- The state SSOT is `<project>/.akari/render.json`; the HTML report is only a visualization.
- After successful export, the CLI appends a result row to the ledger (`akari decision-log settle`). `--no-settle` suppresses this.
- Delete `<project>/.akari/render-tmp/` only on success; retain it for diagnosis on failure.
- Generate captions deterministically from `captions.json` into HTML and burn them in through the same path as other overlays.
- Caption style presets live in `presets/textstyle/` and `akari-apply-textstyle.mjs` can apply them to `captions.json`. Resolve this executable by the same procedure; it lives under the same `bin/` as `<render-cut>`. Usually edit-plan already applies the preset and render-cut draws that result directly.
- After verify PASS, the CLI automatically generates `<project>/.akari/reports/contact-sheet.png` as evidence, **not as a pass/fail verdict**. The timestamp list is derived deterministically only from the plan (`predicted_duration_seconds` / `preset.fps` / cuts / overlays). With the same edit.json and media, both timestamps and tiled image are byte-identical. Record timestamps in `render.json` `contact_sheet.timestamps_seconds` and link the sheet from `render-report.html`.
- Put extra stills needed to inspect intervals missed by the contact sheet in `<project>/.akari/reports/`. If a person creates temporary verification scripts or experimental intermediates separately from the CLI's `.akari/render-tmp/`, place them in `<project>/.akari/work/` (the `.akari/work/` directory; [project-structure-v0 contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-25-project-structure-v0.md) §1). Separate disposable items in `tmp/` from irreplaceable items in `keep/`; put neither at the project root.

## Public contracts

- [edit.json v0 and export stages](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-13-m1-m4.md)
- [edit.json v1 extension notes](https://github.com/AkariLabs/akari-video/blob/main/docs/notes-2026-07-13-edit-json-v1.md)
- [Captions and cut editing](https://github.com/AkariLabs/akari-video/blob/main/docs/notes-2026-07-14-captions-and-cut-editing.md)
