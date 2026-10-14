# Working on an AKARI Video project

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

The library defaults to the workspace's `library/`. Without a workspace, use the legacy `~/.akari/assets/`.
Check the first line of `akari-assets list` (or `akari assets list`) for the actual location.
Below, `<library-location>` is the existing library-location placeholder; audio belongs in its `audio/` subdirectory.

- `assets/` holds source video and audio. Preserve the English directory name; never modify or delete originals.
- `planning/` holds human-readable proposals, analysis reports, and edit plans.
- `exports/` holds finished video exports.
- `.akari/sidecars/` holds media analysis results; `.akari/events/` holds workflow milestone records.
- Save media analysis results in `.akari/sidecars/<relative-path-under-assets>.meta.json` (the placeholder means the relative path beneath assets).
- Never read or upload `.akari/sidecars/**/voices.json` (voice embeddings are biometric identifiers).
- At report creation, approval, editing completion, and export completion, append 1 new record to `.akari/events/`.
  Never modify or delete existing records.
- When `.akari/intake.json` has `status` set to `submitted`, follow `tasks` / `target` / `autonomy`.
  With `autonomy: checkpoint` (default), check with the user at key points such as planning approval and before export.
  With `status: draft`, settle the workflow through the form or conversation before proceeding.
- When writing the workflow to `.akari/intake.json`, use only the 5 prescribed IDs for `tasks`; for `target`, choose either `duration_s` or `keep_length: true`.
  Run lint before setting `status` to `submitted`.
- Do not create new files directly under the project root (except existing contract files such as `edit.json`).
  Put generated files in `.akari/work/`, evidence in `.akari/reports/`, and caches in `.akari/cache/`.
  See the [public repository's canonical contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-25-project-structure-v0.md) (Japanese) for layer definitions.
  Local alternatives are (b) `~/.akari/app/docs/contract-2026-07-25-project-structure-v0.md` via `install.sh`,
  and (c) `<repo>/docs/contract-2026-07-25-project-structure-v0.md` in the monorepo.

## Check the preview

Use the existing preview functionality. Do not implement dedicated playback HTML, playback UI, or audio synchronization
just to provide a preview (unless the user explicitly requests a standalone playback page).
Open this project's output preview in the app. Launch the browser version from Menu → Browser Preview.
See [Launch and check the existing preview](.claude/skills/edit-lint/preview.md).
If launch fails, record the cause and reproduction conditions. To report it as checked, verify playback, seeking,
and audio (if present) in the existing screen, and specify whether you used the app or existing browser preview.
Checking only rendering components or a separate page does not count as checking the existing preview.

## Where AKARI Video is installed

- `~/.akari/cli` … CLI implementation and shims (macOS / Linux: `~/.akari/cli/bin/akari`; Windows: `~/.akari/cli/bin/akari.cmd`). Deployed when the partner connects.
- `~/.akari/app` … Installation via `install.sh`. It need not exist when only the desktop app is used.
- App-bundled `<App>/Contents/Resources/packages/` … CLI implementations such as render-cut and edit-lint. Windows: `<install dir>\resources\packages\`.
- App-bundled `<App>/Contents/Resources/media-bin/` … ffmpeg and ffprobe; some builds omit whisper-cli. Windows: `<install dir>\resources\media-bin\`.
- `<library-location>` … Existing placeholder for the asset library's actual location.

Assume none is on PATH. Outside the partner PTY, run the full path: `~/.akari/cli/bin/akari` on macOS / Linux,
`~/.akari/cli/bin/akari.cmd` on Windows (the only Windows entry point is `akari.cmd`; Git Bash cannot find it if you omit the extension).

## When assets are missing

- Inspect the account's asset library (all free + purchased assets) with `akari assets list`.
- Import into this project with `akari assets fetch <id> --project .` (including sha256 verification).
- For free external sound effects, BGM, fonts, and other site references, use `akari assets list --source site`; inspect acquisition, license, and source with `akari assets show <category/id>`. An entry marked `同梱済み` is already bundled in the app and ready to use. A `↗` (`reference`) entry cannot be fetched; if it is not marked `同梱済み`, follow `/setup-library` with explicit approval, then run `akari assets validate <dir>`. Do not guess `catalog/` or `packages/` paths.
- Paid assets are available if purchased through the account connected with `akari store connect`.
  Unpurchased assets display `locked` and their price.
- Library files live in `<library-location>/` (the existing library-location placeholder). Operate through these commands rather than editing directly.

## Skills in this project

All directories beneath `.claude/skills/` are available as-is. Main skills:

- `/analyze-footage` … Analysis of individual assets
- `/analyze-project` … Integrated analysis of multiple assets and project context
- `/edit-plan` … Edit planning, reporting, approval, and generation
- `/overlay-authoring` … Creation of captions, diagrams, 3D, and other visual elements
- `/edit-lint` … Deterministic checking and QA of edits
- `/render-cut` … Export and verification of approved edits
- `/setup-library` … Asset library preparation
- `/address-review` … Handling open review feedback

Harnesses such as Codex / Cursor discover the same skills through `.agents/skills/` / `.cursor/skills/` / `.codex/skills/`
(symlinks to `.claude/skills/`).

If your environment does not read skills automatically, read procedures directly from the project-relative path
`.claude/skills/<skill-name>/SKILL.md` (the placeholder means skill name).
The directory listing of `.claude/skills/` is the available skill list itself.

See `.claude/skills/analyze-footage/references/akari-data-contract.md`
for the detailed contract on analysis results and milestone records.

When explaining things to users, follow the response-language rule above and use role-based words
such as “change history”, “planning notes”, and “assets”, rather than internal mechanism names.

This guide belongs to this project. Feel free to adapt it to your workflow.
