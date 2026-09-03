**English** | [日本語](./project-structure.ja.md)

# Project structure — what's inside .akari/

AKARI Video projects run on "file contracts." Agents, the app, and humans read and
write the same files, so you can reach the same state from any entrance. This page
lists the files you'll see day to day and what they're for (for the exact schemas,
see [Reference](../README.md#reference)).

## Project root

| File | Role |
|---|---|
| `edit.json` | **The edit's save data (SSOT)**. Cuts, overlays, audio, beats, direction |
| `captions.json` | Caption data |
| `review.json` | Sidecar for review annotations (tickets) |
| `decision-log.md` | Append-only decision history shared by analyze-project and edit-plan |
| `analysis-report.html` | The formal cross-asset analysis report produced by analyze-project |

These contract files are the only generated output allowed directly at the root.
Everything else has its own designated place (a no-clutter convention).

## Directories

| Location | Role |
|---|---|
| `assets/` | Source material (`assets/<category>/<id>/` + meta.json) |
| `planning/` | Planning documents (research-plan.json / plan.json) |
| `exports/` | Render output |
| `motion/` | **Canonical** keyframe curves referenced by edit.json (not regenerable) |

## Inside .akari/

| File / Directory | Role |
|---|---|
| `.akari/intake.json` | The intake form (what to make / duration / delegation level). `title` (human-readable display name, distinct from the folder name) is written by the agent once the intake is decided — it isn't a form field yet |
| `.akari/connections.json` | Connection registry (API key references, model choices, cost approval policy) |
| `.akari/workflow.json` | Role definitions for the project |
| `.akari/sidecars/` | Per-asset `analysis.json` (the factual layer of analysis) |
| `.akari/events/` | Milestone records (appended one at a time — the "resume from here" signal) |
| `.akari/lint.json` | The canonical record of edit-lint check results |
| `.akari/render.json` | The canonical record of export plans and run results |
| `.akari/diffs/` | Generated snapshots used by the "View changes" workflow |
| `.akari/render-tmp/` | Temporary workspace used during rendering |
| `.akari/work/` | Agent work area. Put disposable work in `tmp/` and work that cannot be recreated in `keep/` |
| `.akari/reports/` | Verification evidence and report HTML (**do not delete** — the record of human review) |
| `.akari/cache/` | Thumbnail/proxy cache and the like (safe to delete) |

## What's safe to delete, and what isn't

Run `akari clean [project-dir]` to list disposable, retained, and undecided entries with their
sizes. It only lists by default. After `--yes` (or interactive approval), it deletes disposable
entries only; recently updated candidates and symbolic links remain undecided.

- `.akari/cache/`, `.akari/render-tmp/`, generated diffs, and render intermediates are listed as
  disposable when they are not currently active
- Under `.akari/work/`, use `tmp/` for disposable work and `keep/` for plans, generators, or
  hand-edited files. An empty `.akari-disposable` or `.akari-keep` marker applies to its directory
  tree, with keep taking priority. Unmarked legacy contents remain undecided
- `.akari/reports/`, `motion/`, `assets/`, `edit.json`, and `.akari/events/` are retained. They are
  evidence, source material, or the project's memory itself; Git tracking is recommended

## Outside the project

| Location | Role |
|---|---|
| `~/.config/akari-video/credentials.env` | Where API keys actually live (never put them in the project) |
| `~/.akari-video/assets/` | The personal-scope asset library |

## Git compatibility

All save data is plain text (JSON / HTML), so committing it turns your edit history
into version control by itself. "Revert to yesterday's edit" is just `git diff` and
a revert.

Rendered video, images, and audio stay on disk but are **kept out of the change history**.
Automatic snapshots that pile up 100 MB mp4 files push `.git` into the gigabytes for a single
40-second video, so the project `.gitignore` template excludes them.

| In the history | Out of the history |
|---|---|
| `edit.json`, `captions.json`, `planning/`, `.akari/events/`, JSON and HTML under `.akari/reports/` | Source material in `assets/` |
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
