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
You need **three things**: Node.js, an AI agent, and ffmpeg.

**Auto-install (recommended)**:

Run only **one** command — the one for your OS.
If already installed, the same command updates to the latest version.

**Windows (PowerShell)**:
```sh
irm https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.ps1 | iex
```

**Windows (CMD)**:
```sh
curl -fsSL https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.cmd -o install.cmd && install.cmd
```

**Linux / macOS**:
```sh
curl -fsSL https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.sh | bash
```

The script automatically checks and installs:
- Node.js v20+ (auto-installs if missing)
- opencode or Claude Code (shows instructions)
- ffmpeg (optional, can auto-install)

**For manual installation**, see below:

### 1. Node.js (JavaScript runtime)

Node.js is required to run the AKARI Video core.

**How to install**:

- **Windows**: Download and install the LTS version from [nodejs.org](https://nodejs.org/)
- **Linux (Ubuntu/WSL2)**:
  ```sh
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```
- **macOS**: Download from [nodejs.org](https://nodejs.org/) or `brew install node`

**Verify installation**:
```sh
node --version
# Should show v20.x.x or similar
```

### 2. opencode, Claude Code, or Cursor Agent (AI agent)

You need an AI agent to run AKARI Video.
Install one or more of the following.

#### Using opencode (recommended)

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

#### Using Claude Code

Claude Code is Anthropic's AI coding assistant.
**A paid Claude subscription** is required.

**How to install**:

```sh
# Windows / Linux / macOS
curl -fsSL https://claude.ai/install.sh | bash
```

**Verify installation**:
```sh
claude --version
# Should show a version number
```

See [Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code/overview) for details.

#### Using Cursor Agent

[Cursor](https://cursor.com) is an AI-native IDE with an Agent mode.
Open the AKARI Video monorepo or a video project folder in Cursor — skills under
`.cursor/skills/` (monorepo) or project adapters (after `create-project`) are
auto-discovered from the [Agent Skills](https://agentskills.io) layout.

**How to start**:

1. Open the repository or project in Cursor
2. Start an Agent chat and say **"I want to start a new video project"**
3. The agent reads `AGENTS.md` and the matching `SKILL.md` under `.cursor/skills/`

There is no dedicated `/akari` slash command in Cursor today; natural-language
requests and explicit skill paths (for example `skills/edit-plan/SKILL.md`) work the same
as in other harnesses.

### 3. ffmpeg (video processing tool)

ffmpeg is used for cutting, converting, and exporting video.
**The skill checks this automatically during setup and guides you if needed**.
Installing it beforehand makes things smoother.

**How to install**:

- **Windows**: `winget install Gyan.FFmpeg` or download from [ffmpeg official site](https://ffmpeg.org/download.html)
- **Linux**: `sudo apt install ffmpeg`
- **macOS**: `brew install ffmpeg` (requires [Homebrew](https://brew.sh/))

**Verify installation**:
```sh
ffmpeg -version
# Should show version information
```

---

## Pick an entrance

AKARI Video has four entrances.
All converge on the same file contracts (under `.akari/`),
so you can start from anywhere and continue from another later.

| Entrance | Best for | How to start |
|---|---|---|
| A. Terminal | Comfortable with command line | `./akari.sh --opencode` |
| B. opencode / Claude Code session | Already using an AI agent CLI | Say "I want to start a new video project" |
| C. Cursor Agent | Prefer an IDE with Agent chat | Open the repo or project in Cursor and say "I want to start a new video project" |
| D. App | Prefer GUI | Connect from the Theia-based desktop shell |

**Recommended for beginners: start with A**.

---

### A. From the terminal (`akari` command)

```sh
./akari.sh --opencode   # opencode
./akari.sh --cursor     # Cursor Agent (cursor-agent / agent CLI)
./akari.sh --codex      # OpenAI Codex CLI
./akari.sh              # Claude Code (falls back to opencode if Claude is missing)
```

`akari` runs in this order:

1. Diagnoses whether the current directory is a project (presence of `.akari/connections.json`)
2. If not set up yet, walks you through scaffolding a project (prompts are currently in Japanese)
3. Checks and displays connection status (generation providers, API keys)
4. Finally launches the selected AI agent — from there you continue conversationally inside the session

Pass **`-y` / `--yes`** to auto-confirm where the harness supports it
(Claude: `-y`, opencode: `--auto`, Cursor: `--force`, Codex: `--full-auto`).

**Using Claude Code explicitly**:

```sh
./akari.sh --claude
```

### B. From inside an opencode or Claude Code session

If you already use opencode or Claude Code, this is the natural entrance.

- **opencode**: Say "I want to start a new video project" and the `create-project` skill triggers
- **Claude Code**: **`/akari`** — a slash command that diagnoses the current state and suggests
  the next step. Or just say "I want to start a new video project"

### C. From Cursor Agent

Open the monorepo (`akari-video`) or a video project folder in Cursor.
Skills are discovered from `.cursor/skills/` (symlinks to `skills/` in the monorepo) or from
project adapters created by `create-project`.

Say **"I want to start a new video project"** in Agent chat, or point the agent at a specific
skill (for example `skills/edit-plan/SKILL.md`).

Preview while editing: run `./akari.sh --preview` in a terminal and open http://localhost:4567.

### D. From the app

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

**Q. Does it work on Windows?**
Yes. Windows, Linux (including WSL2), and macOS are supported.

**Q. I only speak English — is that okay?**
Conversations with the agent can be in English.
Some error messages and documentation may be in Japanese.
