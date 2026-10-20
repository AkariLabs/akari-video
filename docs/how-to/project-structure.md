**English** | [日本語](./project-structure.ja.md)

# Project structure — what's inside .akari/

AKARI Video projects run on "file contracts." Agents, the app, and humans read and
write the same files, so you can reach the same state from any entrance. This page
lists the files you'll see day to day and what they're for (for the exact schemas,
see [Reference](../README.md#reference)).

## Project root

| File | Role |
|---|---|
| `edit.json` | **The edit's save data (SSOT)**. Cuts, how assets are placed, motion parts, audio, beats, direction. v2 (an object tree) |
| `captions.json` | Caption data. Holds each line's look and looks applied to ranges of characters (runs v1, caption styles) |
| `review.json` | Sidecar for annotations (pen, pin, range, attachments). The data behind "<!-- F ui.annotation.handToAi -->Hand to AI<!-- /F -->" in the right panel |
| `decision-log.md` | Append-only decision history shared by analyze-project and plan-edit |
| `analysis-report.html` | The formal cross-asset analysis report produced by analyze-project |

These contract files are the only generated output allowed directly at the root.
Everything else has its own designated place (a no-clutter convention).

## Directories

| Location | Role |
|---|---|
| `assets/` | Source material (`assets/<category>/<id>/` + meta.json). Kept flat; no sub-folders. Placeholders and generated files go in `assets/generated/` (provenance in `<file>.meta.json`) |
| `planning/` | Planning documents. See the table below |
| `exports/` | Render output. NLE exports go in `exports/nle/` |
| `motion/` | **Canonical** keyframe curves referenced by edit.json (not regenerable) |
| `scenes/` | Only in projects that have scenes. Nesting goes one level deep (see "Scenes" below) |

### Inside planning/

| File | Role |
|---|---|
| `research-plan.json` / `plan.json` | The plan and the approved plan |
| `playbook.md` + `playbook.json` | **The playbook**: steps, checkpoints, settings, placeholders, parts used, and tools needed for one video. The `harvest-playbook` skill writes it from a finished project. A project started with `akari new --from` gets a copy, and its source is kept in `provenance` |
| `playbook-preview/frames/` | Frames from key moments of the playbook (optional) |
| `script.json` | The **plans and memos** shown in the Script panel (timed lines). Captions stay canonical in `captions.json`. Without it, the Script panel works on captions alone. Plan lines are generated from the playbook's breakdown (`beats`) |
| `frames/<name>.scene.json` | Scene JSON describing the contents of a placeholder. The placeholder's picture (png) and meta stay in `assets/generated/` |
| `world-map.json` | The world map (when you use one) |

Playbooks can also live on shelves outside the project. Your own shelf is
`~/.akari/playbooks/<id>/`, and a channel's shelf is `channels/<channel>/playbooks/<id>/`.
Listing and starting resolve in just two steps: channel first, then your own shelf.

A **template** (one finished bundle with only the footage left open, to be swapped in) lives on
the same shelves as a playbook. It is a playbook at depth 3: `<id>/template/` holds a fragment,
`item.json`, and the actual media in `media/`. When you place it on the timeline from the
Library's Templates shelf, it becomes one grouped item inside edit.json, so the project gets no
extra location. To write a template from your own project to a shelf, use `akari template export`
(or `akari playbook template`). In the v1.5.0 build only `akari playbook template` exists; `akari template export` comes in the next release, and the old name stays as an alias.

### Scenes

In a project with scenes, each `scenes/<scene>/` has the same layout as a single-video project
(`edit.json`, `captions.json`, `assets/`, `.akari/`). You cannot add further layers under `scenes/`.

- `akari project scene add <id>` creates `scenes/<id>/` and adds the scene to `.akari/manifest.json`
- The app opens a scene's folder as the working folder. Open it from "Scenes" on Home, and
  go back to the list from "Scene list (project)" in the title bar
- When a scene uses an asset from the project-wide `assets/`, it is brought into that scene's
  `assets/` as a **hard link** (a copy if the volumes differ). `.akari/manifest.json` records
  which scene uses which shared asset
- The Scenes / Structure / Relations tabs show the scene list, the project → scene → cut tree, and the relationship map

A single-video project has no `scenes/` and runs from the root `edit.json` as before.

## Inside .akari/

| File / Directory | Role |
|---|---|
| `.akari/intake.json` | The intake form (what to make / duration / delegation level). `title` (human-readable display name, distinct from the folder name) is written by the agent once the intake is decided. `language` is the **language of the video's content** (BCP 47, e.g. `en`), independent of the UI and conversation language. It drives caption, narration, and transcription language; if absent it comes from the transcript, and failing that it is `ja` |
| `.akari/manifest.json` | **The dependency list.** What is involved in this project (assets, styles, scenes, people, tool outputs…), at which version, and who uses whom. It holds no media and no edit content. `akari project sync` generates it from the asset and style ledgers (entries you add by hand are kept), and `akari project check` looks for missing, not-yet-fetched, and broken entries (results go to `.akari/reports/manifest-check.json`). The project works without it |
| `.akari/asset-references.json` | Ledger of the assets the project references |
| `.akari/style-usage.json` | Ledger of the styles applied |
| `.akari/tasks.json` | Operational state for work raised from annotations, lint, and proposals (unsent → sent → review → done). Text and positions stay canonical in `review.json`. Tracked in history |
| `.akari/connections.json` | Connection registry (API key references, model choices, cost approval policy) |
| `.akari/workflow.json` | Role definitions for the project |
| `.akari/sidecars/` | Per-asset `analysis.json` (the factual layer of analysis) |
| `.akari/events/` | Milestone records (one file each, append-only — the "resume from here" signal). The agent's actions (`agent-action`) and confirmations (`gate-requested` / `gate-resolved`) are recorded here too |
| `.akari/memory/` | The project's memory, such as the word book (`word-book.json`). Entries can be promoted to a channel's or the workspace's `.akari/memory/` |
| `.akari/lint.json` | The canonical record of edit-lint check results |
| `.akari/render.json` | The canonical record of export plans and run results |
| `.akari/diffs/` | Generated snapshots used by the "View changes" workflow |
| `.akari/render-tmp/` | Temporary workspace used during rendering |
| `.akari/work/` | Agent work area. Put disposable work in `tmp/` and work that cannot be recreated in `keep/` |
| `.akari/reports/` | Verification evidence and report HTML (**do not delete** — the record of human review). Holds `manifest-check.json`, the confirmation sheet `playbook-sheet.html` from starting with a playbook, the storyboard in `storyboard/`, and so on |
| `.akari/backup/` | Pre-migration backups made by `akari migrate` |
| `.akari/cache/` | Thumbnail/proxy cache and the like (safe to delete) |

### Actions and confirmations

Work the agent did while you were away is recorded in `.akari/events/` as actions.
Anything that cannot be undone, leaves the project, or touches money or rights (publishing,
submitting to Lab, paid generation, sending to an outside service, deleting original footage,
a license doubt, or a checkpoint a playbook declared) stops and waits for confirmation at every
delegation level. In the project's Home, "Activity" lists them, and you can choose "View changes"
or "Restore to before this". `akari status` also shows the counts (see [Resume a session](./resume-session.md)).

## What's safe to delete, and what isn't

Run `akari clean [project-dir]` to list disposable, retained, and undecided entries with their
sizes. It only lists by default. After `--yes` (or interactive approval), it deletes disposable
entries only; recently updated candidates and symbolic links remain undecided.

- **Disposable**: the contents of `.akari/cache/`, `.akari/render-tmp/`, and `.akari/diffs/`; render
  intermediates in `exports/` (`*.gpu-video.mp4`, `*.osr-video.mp4`, `run.json`); `.akari/work/tmp/`;
  and the temporary write lock (`.akari/tasks.json.lock`). They are listed when not currently active
- Under `.akari/work/`, use `tmp/` for disposable work and `keep/` for plans, generators, or
  hand-edited files. An empty `.akari-disposable` or `.akari-keep` marker applies to its directory
  tree, with keep taking priority. Unmarked legacy contents remain undecided
- **Retained**: `edit.json`, `captions.json`, `review.json`, `plan.json`, `motion/`, `assets/`,
  `planning/` (including playbooks and script plans and memos), delivered `exports/*.mp4` and
  `exports/nle/`, `.akari/reports/`, `.akari/sidecars/`, `.akari/events/`, `.akari/backup/`, the
  `*.json` files directly under `.akari/` (such as `manifest.json` and `tasks.json`), `.claude/`,
  `.opencode/`, `AGENTS.md`, `CLAUDE.md`, `akari.sh`, and `.gitignore`. They are evidence, source
  material, or the project's memory itself; Git tracking is recommended
- **Undecided**: anything the declaration table does not classify (such as `scenes/` and
  `.akari/memory/`). Check what is inside before you remove it

## Outside the project

| Location | Role |
|---|---|
| <!-- F paths.credentials -->`~/.akari/credentials.env`<!-- /F --> | Where API keys actually live (never put them in the project) |
| `~/.akari-video/assets/` | The personal-scope asset library |
| `~/.akari/playbooks/` | Your own shelf of playbooks and templates |

## Git compatibility

All save data is plain text (JSON / HTML), so committing it turns your edit history
into version control by itself. "Revert to yesterday's edit" is just `git diff` and
a revert.

Rendered video, images, and audio stay on disk but are **kept out of the change history**.
Automatic snapshots that pile up 100 MB mp4 files push `.git` into the gigabytes for a single
40-second video, so the `.gitignore` in a new project's scaffold excludes them.

| In the history | Out of the history |
|---|---|
| `edit.json`, `captions.json`, `review.json`, `planning/`, `.akari/events/`, `.akari/manifest.json`, `.akari/tasks.json`, JSON and HTML under `.akari/reports/` | Source material in `assets/` |
| Export settings under `exports/nle/` | Rendered video, images, and audio (`*.mp4`, `*.png`, `*.wav`, …) |
| Keyframe curves under `motion/` | `.akari/render-tmp/`, `.akari/cache/`, `.akari/diffs/` |
| Analysis results under `.akari/sidecars/` (expensive to rebuild, so they stay even when they are video) | |

The app only manages the block between `# >>> AKARI Video ... >>>` and `# <<< ... <<<`.
Lines you add outside that block are left untouched.

Opening an older project brings its `.gitignore` up to date, drops the newly excluded
generated files from the change history, and commits that once. **No file is removed from
disk.** Past commits are never rewritten, so this alone does not shrink `.git`.

To reclaim the past as well, run `git filter-repo` (or similar) yourself. One caveat: those
tools **only rewrite commits**, so a ref that points straight at a tree — the checkpoints some
AI coding tools create, for instance — keeps holding the old data, and the repository stops
shrinking about halfway. Check `git for-each-ref` for refs you do not recognize before you gc.

<!-- BEGIN GENERATED facts:stamp -->
This page describes AKARI Video v1.5.1 (released 2026-10-19).
<!-- END GENERATED facts:stamp -->
