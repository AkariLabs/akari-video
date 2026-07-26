**English** | [日本語](./resume-session.ja.md)

# Resume where you left off

AKARI Video builds "context carries over across sessions" into its design. Two
mechanisms make this work — `.akari/events/` and the SessionStart hook.

## How it works

Each stage's milestones (asset added, report generated, approval, edit complete,
export complete, and so on) get recorded one at a time in `.akari/events/`.

With the plugin enabled, the moment you open a Claude Code session in a project
directory, the SessionStart hook:

1. Auto-detects `.akari/`
2. Reads the intake state (what to make / duration / delegation level) and the
   most recent events
3. Automatically injects "what to do next" as context

For example, if the most recent event is `video-added`, it asks "want to analyze
this?"; if it's `report-approved`, it asks "ready to move to edit planning?" —
picking up right where things left off.

In a directory without `.akari/`, nothing happens (a normal session isn't
interrupted).

## Check status manually

- In a session: **`/akari`** — diagnoses state and suggests the next step
- From the terminal: **`akari`** — runs the same diagnostic, then launches `claude`
  (`akari --continue` returns to your previous session)

## Crossing entrances

Since all state lives in file contracts, moves like these are free to make:

- Create a project from the terminal, then open it later in the app just to
  review
- Take annotations added in the app (review.json) and resolve them in a session
  by saying "work through the tickets"
- `git clone` to another machine and pick up where you left off (save data is
  text, so git handles it end to end)

## Related

- The full picture of events and files → [Project structure](./project-structure.md)
- Working tickets → [QA, review, and fix](../guides/review-and-fix.md)
