# AKARI Video project

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

The library defaults to the workspace's `library/`. Without a workspace, use the legacy `~/.akari/assets/`.
Check the first line of `akari-assets list` (or `akari assets list`) for the actual location.
Below, `<library-location>` is the existing library-location placeholder; audio belongs in its `audio/` subdirectory.

Edit this project according to these roles:

- `assets/` … Source video and audio. Treat originals as read-only; never modify or delete them.
- `planning/` … Human-readable artifacts such as proposals, analysis reports, and edit plans.
- `exports/` … Finished video exports.
- `.akari/` … Media analysis results and workflow milestone records.

Save media analysis results in `.akari/sidecars/<relative-path-under-assets>.meta.json`
(the placeholder means the relative path beneath assets).
Never read or upload `.akari/sidecars/**/voices.json` (voice embeddings are biometric identifiers).
At report creation, approval, editing completion, and export completion, append 1 new record to `.akari/events/`.
Never modify or delete existing records.

The workflow is recorded in `.akari/intake.json`. When `status` is `submitted`, follow its `tasks` (work to do), `target` (finished duration), and `autonomy` (level of delegation). Treat `full-auto` as “proceed directly to export without intermediate confirmation; attach capture + lint afterward”, `checkpoint` as “with suggestions, the default: add promising choices and show them; remove unwanted ones; require approval 1 time, at export”, and `collaborative` as “work together: confirm direction, assets, and execution at key points”. If `status` is `draft`, the file is absent, or `autonomy` is missing, use the suggestions workflow and do not follow draft `tasks` / `target` / `autonomy`. Settle the workflow through the form or conversation.

When writing the workflow to `.akari/intake.json`, use only the 5 prescribed IDs for `tasks`; for `target`, choose either `duration_s` or `keep_length: true`. Run lint before setting `status` to `submitted`.

If assets are missing, inspect the account's asset library (all free + purchased assets) with `akari assets list`.
Import a chosen asset into this project with `akari assets fetch <id> --project .` (including sha256 verification).
For free external sound effects, BGM, fonts, and other site references, use `akari assets list --source site`; inspect acquisition, license, and source with `akari assets show <category/id>`. An entry marked `同梱済み` is already bundled in the app and ready to use. A `↗` (`reference`) entry cannot be fetched; if it is not marked `同梱済み`, follow `/setup-library` with explicit approval, then run `akari assets validate <dir>`. Do not guess `catalog/` or `packages/` paths.
Paid assets are available if purchased through the account connected with `akari store connect`;
unpurchased assets display `locked` and their price. Library files live in `<library-location>/`
(the existing library-location placeholder). Operate through these commands rather than editing them directly.

## Check the preview

Use the existing preview functionality. Do not implement dedicated playback HTML, playback UI, or audio synchronization
just to provide a preview (unless the user explicitly requests a standalone playback page).
Open this project's output preview in the app. Launch the browser version from Menu → Browser Preview.
See [Launch and check the existing preview](.claude/skills/verify-edit/preview.md).
If launch fails, record the cause and reproduction conditions. To report it as checked, verify playback, seeking,
and audio (if present) in the existing screen, and specify whether you used the app or existing browser preview.
Checking only rendering components or a separate page does not count as checking the existing preview.

## Where AKARI Video is installed

- `~/.akari/cli` … Command implementation and entry point (macOS / Linux: `~/.akari/cli/bin/akari`; Windows: `~/.akari/cli/bin/akari.cmd`). Deployed when the partner connects.
- `~/.akari/app` … AKARI Video installed via `install.sh`. It need not exist when only the desktop app is used.
- App-bundled `<App>/Contents/Resources/packages/` … Editing and checking commands such as render-cut and edit-lint. On Windows: `<install dir>\resources\packages\`.
- App-bundled `<App>/Contents/Resources/media-bin/` … ffmpeg and ffprobe. Some builds do not bundle whisper-cli. On Windows: `<install dir>\resources\media-bin\`.
- `<library-location>` … Existing placeholder for the asset library's actual location.

Assume none is on PATH. Outside the partner PTY, run the full path: `~/.akari/cli/bin/akari` on macOS / Linux,
`~/.akari/cli/bin/akari.cmd` on Windows (the only Windows entry point is `akari.cmd`; Git Bash cannot find it if you omit the extension).

## Editing skills

All directories beneath `.claude/skills/` are available as-is. Main skills:

- `/analyze-footage` … Analyze each source asset.
- `/analyze-project` … Analyze multiple assets together with the project's overall context.
- `/plan-edit` … Make an edit plan and apply it after reporting and approval.
- `/author-overlay` … Create captions, diagrams, glass, motion, thumbnails, and other 2D visual elements.
- `/author-scene3d` … Author 3D scenes (Three.js by default, Blender bake only when needed).
- `/verify-edit` … Check edits mechanically and support final quality checks.
- `/render-cut` … Export approved edits and verify the finished file.
- `/setup-library` … Prepare available assets.
- `/edit-from-review` … Apply open review feedback to the edit.

Entry points for other AI agents such as Codex and Cursor are in `.agents/skills/`, `.cursor/skills/`, and `.codex/skills/`
(links to `.claude/skills/`). See `AGENTS.md` for the workflow and paths for reading skill documents directly.

When explaining things to users in the UI or conversation, follow the response-language rule above and use
role-based words such as “change history”, “planning notes”, and “assets”, rather than internal mechanism names.

Do not create new files directly under the project root (except existing contract files such as `edit.json`).
Put generated files in `.akari/work/`, evidence in `.akari/reports/`, and caches in `.akari/cache/`.
See the [public repository's canonical contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-25-project-structure-v0.md) (Japanese) for layer definitions.
Local copies are also available at (b) `~/.akari/app/docs/contract-2026-07-25-project-structure-v0.md` after installation via `install.sh`,
and (c) `<repo>/docs/contract-2026-07-25-project-structure-v0.md` with a monorepo checkout.

This file belongs to your project. Feel free to adapt it to your workflow.
