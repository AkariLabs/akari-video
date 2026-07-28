**English** | [日本語](./getting-started.ja.md)

# Getting Started — your first project

AKARI Video is headless-first: everything works with Claude Code alone, no UI required.
This page covers picking an entrance, creating your first project, and filling in the
intake form.

## Prerequisites

- macOS (Windows support is in progress — [dev/windows-build.md](./dev/windows-build.md), Japanese)
- [Claude Code](https://claude.com/claude-code) or [opencode](https://opencode.ai)
- CLI tools such as ffmpeg and whisper.cpp are checked and guided through by the skills
  on first setup

## Pick an entrance

All three entrances converge on the same file contracts (under `.akari/`).
Wherever you start, you can pick up the project again from any other entrance.

### A. From the terminal (the `akari` command)

```sh
# run from inside the monorepo checkout (not yet published to npm)
node packages/akari-launcher/bin/akari.mjs
```

`akari` runs in this order:

1. Diagnoses whether the current directory is a project (presence of `.akari/connections.json`)
2. If not set up yet, walks you through scaffolding a project (prompts are currently in Japanese)
3. Checks and displays connection status (generation providers, API keys)
4. Finally launches `claude` — from there you continue conversationally inside the session
   (arguments are forwarded to `claude` as-is, e.g. `akari --continue`)

**Using opencode instead**:

```sh
node packages/akari-launcher/bin/akari.mjs --opencode
```

With the `--opencode` flag, `opencode` is launched instead of `claude`.

### B. From inside a Claude Code or opencode session

If you already use Claude Code or opencode, this is the natural entrance.

- **Claude Code**: **`/akari`** — a slash command that diagnoses the current state and suggests
  the next step. Or just say "I want to start a new video project"
- **opencode**: Skills are auto-discovered from `.opencode/skills/`. Just say "I want to start
  a new video project" and the `create-project` skill triggers

With the Claude Code plugin (`plugin/`) enabled, opening a session in a project directory loads
its state automatically and offers to continue where you left off (SessionStart hook).

### C. From the app

Connect from the Start screen of the Theia-based desktop shell (`apps/shell/`, mid-migration).
The app is a place to review and fix what the agent built, so starting from the terminal
or a session is the current recommendation for your first step.

## Create a project

The `create-project` skill scaffolds everything from a template:

```
my-video/
├── .akari/
│   ├── intake.json        ← intake form (fill this in first)
│   ├── connections.json   ← connection registry (API key references, model choices)
│   ├── workflow.json      ← role definitions for the project
│   └── events/            ← milestone records (the "resume from here" signal)
├── .opencode/
│   ├── config.json        ← opencode configuration
│   ├── skills/            ← skill definitions (symlinks to skills/)
│   └── hooks/             ← session start hooks
├── assets/                ← source material
├── planning/              ← plans and planning documents
└── exports/               ← render output
```

## Fill in the intake form (intake.json)

Right after project creation, `.akari/intake.json` is `status: draft`.
Answer three questions and set it to `submitted`, and the agent can start working.

| Field | Meaning | Example |
|---|---|---|
| `tasks` | What to make | "One short video from this footage" |
| `target` | Duration & destination | "60 seconds, vertical" |
| `autonomy` | How much to delegate | `full-auto` / `checkpoint` (default — approve at milestones) / `collaborative` |

You can fill the form in chat: say "let's fill in the intake form" and the agent asks
the questions and records your answers.

## Set up connections (only when you need them)

Once you reach the point of using external APIs — cloud transcription, narration
generation, asset generation — configure them with the `manage-connections` skill.
Everything local (proxy generation, whisper.cpp transcription, editing, export) works
with no connections at all.

Details: [How-to: Connections & API keys](./how-to/connections.md)

## A first flow

If you already have one piece of footage:

1. Put it in the project and say "analyze this video" →
   [Analyze footage](./guides/analyze-footage.md)
2. "Draft an editing direction" → review the analysis report and approve the direction →
   [Plan your edit](./guides/plan-your-edit.md)
3. The agent assembles `edit.json`, titles, and captions
4. "Export it" → lint PASS → approve → MP4 lands in `exports/` →
   [Export](./guides/export.md)

No footage yet? Start from planning →
[Plan from scratch](./guides/plan-from-scratch.md)
