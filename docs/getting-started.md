**English** | [日本語](./getting-started.ja.md)

# Getting Started — your first project

AKARI Video is a system where **an AI agent does the video editing**.
You only do two things: **say what you want to make** and **check the result**.

It's useful when you want to create short videos but don't have time to learn editing software,
or when you want to add titles, captions, and narration but find it tedious to do manually.

## What you'll learn from this document

1. What you need to prepare (prerequisites)
2. How to install everything
3. Creating your first project and exporting a video

---

## Prerequisites — what you need

AKARI Video runs in the terminal (command line).
Install the following three items in order.

**Auto-install (recommended)**:
```sh
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/kuwa2005/akari-video/main/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/kuwa2005/akari-video/main/install.ps1 | iex

# Windows (CMD)
curl -fsSL https://raw.githubusercontent.com/kuwa2005/akari-video/main/install.cmd -o install.cmd && install.cmd
```

The script automatically checks and installs:
- Node.js v20+ (auto-installs if missing)
- Claude Code or opencode (shows instructions)
- ffmpeg (optional, can auto-install)

**For manual installation**, see below:

### 2. Claude Code or opencode (AI agent)

You need an AI agent to run AKARI Video.
Install one or both.

#### Using Claude Code

Claude Code is Anthropic's AI coding assistant.
**A paid Claude subscription** is required.

**How to install**:

```sh
# macOS / Linux / WSL2
curl -fsSL https://claude.ai/install.sh | bash

# Windows (PowerShell)
irm https://claude.ai/install.ps1 | iex
```

**Verify installation**:
```sh
claude --version
# Should show a version number
```

See [Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code/overview) for details.

#### Using opencode

opencode is an open-source AI coding assistant.
**Free models** are included, but a provider account is needed for more powerful models.

**How to install**:

```sh
curl -fsSL https://opencode.ai/install | bash
```

**Verify installation**:
```sh
opencode --version
# Should show a version number
```

See [opencode website](https://opencode.ai) for details.

### 3. ffmpeg (video processing tool)

ffmpeg is used for cutting, converting, and exporting video.
**The skill checks this automatically during setup and guides you if needed**.
Installing it beforehand makes things smoother.

**How to install**:

- **macOS**: `brew install ffmpeg` (requires [Homebrew](https://brew.sh/))
- **Windows**: Download from [ffmpeg official site](https://ffmpeg.org/download.html) and add to PATH
- **Linux**: `sudo apt install ffmpeg`

**Verify installation**:
```sh
ffmpeg -version
# Should show version information
```

---

## Pick an entrance

AKARI Video has three entrances.
All converge on the same file contracts (under `.akari/`),
so you can start from anywhere and continue from another later.

| Entrance | Best for | How to start |
|---|---|---|
| A. Terminal | Comfortable with command line | `node packages/akari-launcher/bin/akari.mjs` |
| B. Claude Code / opencode session | Already using an AI agent | Say "I want to start a new video project" |
| C. App | Prefer GUI | Connect from the Theia-based desktop shell |

**Recommended for beginners: start with A**.

---

### A. From the terminal (`akari` command)

```sh
# Run from inside the monorepo checkout (not yet published to npm)
node packages/akari-launcher/bin/akari.mjs
```

`akari` runs in this order:

1. Diagnoses whether the current directory is a project (presence of `.akari/connections.json`)
2. If not set up yet, walks you through scaffolding a project (prompts are currently in Japanese)
3. Checks and displays connection status (generation providers, API keys)
4. Finally launches the AI agent — from there you continue conversationally inside the session

**Using opencode instead**:

```sh
node packages/akari-launcher/bin/akari.mjs --opencode
```

### B. From inside a Claude Code or opencode session

If you already use Claude Code or opencode, this is the natural entrance.

- **Claude Code**: **`/akari`** — a slash command that diagnoses the current state and suggests
  the next step. Or just say "I want to start a new video project"
- **opencode**: Say "I want to start a new video project" and the `create-project` skill triggers

### C. From the app

Connect from the Start screen of the Theia-based desktop shell (`apps/shell/`, mid-migration).
The app is a place to review and fix what the agent built, so starting from the terminal
or a session is the current recommendation for your first step.

---

## Create a project

Once you've chosen an entrance, create a project first.

Tell the AI agent **"I want to create a project"** and it will automatically
scaffold everything from a template:

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

---

## Fill in the intake form (intake.json)

Right after project creation, `.akari/intake.json` is `status: draft`.
Answer three questions and set it to `submitted`, and the agent can start working.

| Field | Meaning | Example |
|---|---|---|
| `tasks` | What to make | "One short video from this footage" |
| `target` | Duration & destination | "60 seconds, vertical" |
| `autonomy` | How much to delegate | `full-auto` / `checkpoint` (default — approve at milestones) / `collaborative` |

You can fill the form in chat: say **"let's fill in the intake form"** and the agent asks
the questions and records your answers.

---

## Set up connections (only when you need them)

Once you reach the point of using external APIs — cloud transcription, narration
generation, asset generation — configure them with the `manage-connections` skill.

**Everything local (proxy generation, whisper.cpp transcription, editing, export) works
with no connections at all.**

Details: [How-to: Connections & API keys](./how-to/connections.md)

---

## A first flow — what you can do

### With footage available

If you have one piece of footage:

1. **Put it in the project** → say "analyze this video"
   → The agent creates 720p proxy, transcription, keyframes
   → [Analyze footage](./guides/analyze-footage.md)

2. **Plan the edit** → say "draft an editing direction"
   → The agent proposes a direction based on the analysis report → you approve
   → [Plan your edit](./guides/plan-your-edit.md)

3. **Assemble the edit** → The agent automatically creates `edit.json`, titles, and captions

4. **Export** → say "export it"
   → lint PASS → you approve → MP4 is saved in `exports/`
   → [Export](./guides/export.md)

### Without footage

You can start from planning with just an idea.
The agent asks questions, proposes a plan, and suggests how to source material.
→ [Plan from scratch](./guides/plan-from-scratch.md)

---

## Frequently asked questions

**Q. Do I need programming knowledge?**
No. The AI agent does everything. You just say what you want to make and approve the result.

**Q. Does it cost money?**
Local operations (proxy generation, transcription, editing, export) are free.
Only external APIs (cloud transcription, narration generation, etc.) incur costs.

**Q. Does it work on Windows??
Yes. macOS, Linux (including WSL2), and Windows are supported.

**Q. I only speak English — is that okay?**
Conversations with the agent can be in English.
Some error messages and documentation may be in Japanese.
