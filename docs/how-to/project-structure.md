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
| `.akari/diffs/` | Where human-to-AI diff collaboration lives |
| `.akari/work/` | Agent intermediates (**safe to delete** — regenerable) |
| `.akari/reports/` | Verification evidence and report HTML (**do not delete** — the record of human review) |
| `.akari/cache/` | Thumbnail/proxy cache and the like (safe to delete) |

## What's safe to delete, and what isn't

- `.akari/work/` and `.akari/cache/` — regenerate automatically if deleted
- `.akari/reports/` — evidence of what a human reviewed, so don't delete it
- `edit.json` and `.akari/events/` — the project's memory itself. Git tracking is
  recommended

## Outside the project

| Location | Role |
|---|---|
| `~/.config/akari-video/credentials.env` | Where API keys actually live (never put them in the project) |
| `~/.akari-video/assets/` | The personal-scope asset library |

## Git compatibility

All save data is plain text (JSON / HTML), so committing it turns your edit history
into version control by itself. "Revert to yesterday's edit" is just `git diff` and
a revert.
