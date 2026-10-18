**English** | [日本語](./resume-session.ja.md)

# Resume a session

AKARI Video builds "context carries over across sessions" into its design. All state lives in
the project's files, so any entrance picks up from the same place. The Claude Code plugin also has
a hook (SessionStart) that hands over where you left off the moment a session opens.

## How it works

Each stage's milestones (report generated, approval, edit complete, export complete, and so on),
along with the agent's actions and pending confirmations, get recorded one at a time in
`.akari/events/`.

With the plugin enabled, the moment you open a Claude Code session in a project
directory, the SessionStart hook:

1. Auto-detects `.akari/`
2. Works out the current stage from the intake form (what to make / duration / delegation level),
   the assets, analysis, annotations, checks, export, approval, and the milestone records
3. Automatically injects the "next skill" and "what it is waiting on" as status

For example, if the footage has not been analyzed yet, the next step is analysis; if annotations
are still open, it is working through them. The files decide where to continue. When you open the
session in a workspace (a folder with `.akari/root.json`), it hands over the workspace's state instead.

In a directory without `.akari/`, nothing happens (a normal session isn't
interrupted).

## Check status manually

- In a session: **`/akari`** — diagnoses state and suggests the next step
- From the terminal: **`akari`** (no arguments) — opens the project, runs the diagnostic, then
  launches the AI agent (creating the project first if needed). Arguments you add, such as
  `akari --continue`, are passed straight to Claude Code, so you can return to your previous session
- From the terminal: **`akari status`** — checks state without launching anything (`--json` for
  machine-readable output, `--full` to include the integrity check). When the agent has done work,
  counts follow, such as "Actions: 3 (latest: cut 12 silences)" and "Awaiting confirmation: 1"
- In the app: open the project from "Recent projects" on Home. The project's Home says "Continue
  where you left off." with the current stage, and "Activity" opens the list of work done while you
  were away (View changes / Restore to before this)

## Crossing entrances

Since all state lives in file contracts, moves like these are free to make:

- Create a project from the terminal, then open it later in the app just to
  review
- Take annotations added in the app (review.json) and resolve them in a session
  by saying "work through the annotations"
- `git clone` to another machine and pick up where you left off (save data is
  text, so git handles it end to end)

## Related

- The full picture of events and files → [Project structure](./project-structure.md)
- Working through annotations → [QA, review, and fix](../guides/review-and-fix.md)

<!-- BEGIN GENERATED facts:stamp -->
This page describes AKARI Video v1.5.0 (released 2026-10-17).
<!-- END GENERATED facts:stamp -->
