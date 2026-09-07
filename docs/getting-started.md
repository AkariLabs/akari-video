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
The installer checks out the **latest release** (not the development branch).

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
- Node.js v20+ (if missing, a portable copy is placed under `~/.akari/` — no Homebrew,
  no admin password)
- opencode or Claude Code (shows instructions)
- ffmpeg (nothing to do — `npm install` pulls in a bundled GPL build automatically,
  sha256-verified; a system ffmpeg on PATH is preferred when present)

The CLI is installed to `~/.akari/app/` by default. Set `AKARI_INSTALL_DIR` to override
that location. The `~/.akari/app/` directory is replaceable as a whole during updates;
other entries directly under `~/.akari/`—including `assets/`, `avatars/`, `runtime/`, and
`*.json` files—are user data and are preserved. If an older installer-managed copy is
found at `~/akari-video/`, the installer shows migration instructions but never deletes
the old copy automatically.

git is not required either — the installer fetches the repository as a tarball.

**Updating**: `akari` keeps itself up to date automatically — no need to re-run the
installer, use git, or even run `akari update` yourself. When a new version is
available, it's downloaded and checksum-verified in the background while you keep
working (this never blocks startup), then applied atomically the next time you run
`akari`; a one-line "updated to vX.Y.Z" notice confirms it. The previous version is
kept for one generation; `akari update --rollback` reverts to it, and `akari update`
still works for an on-demand check/apply. Set `AKARI_NO_AUTO_UPDATE=1` to disable
both the background download and the automatic apply (you'll still get the one-line
"a new version is available" notice, and can update manually with `akari update`) —
useful for CI or when you want to pin your environment. Re-running the installer
above also still works (and is the way to move to a different `AKARI_INSTALL_DIR`,
or to recover an installation that isn't managed by `akari update`, e.g. a global
npm install or a monorepo checkout, neither of which are auto-updated).

The desktop app (the Theia-based shell) downloads new versions automatically too.
Once the download finishes, the home screen banner switches to "Downloaded. It will be
applied on restart." with a "Restart and apply now" button — or it applies the next time
you quit and relaunch the app normally. It never force-restarts you mid-session.

**Prefer a lightweight CLI-only install?** `npm i -g akari-video` installs just the `akari`
command (agent workflow bundled; the browser preview server is not included — use the
installer above for the full setup). This never uses sudo; if it fails with `EACCES`
(permission error), prefer `install.sh` above (user-space, no admin password needed) or
configure an npm user prefix instead. The desktop app uses its bundled `akari` CLI directly,
so updating the app updates the CLI to the same version. To use it from an
OS terminal, add `~/.akari/cli/bin` to PATH or run `install.sh` above.

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

> Using the one-line installer? You can skip this section entirely — when Node is
> missing it places a portable copy under `~/.akari/` (no Homebrew, no admin password).

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
**Normally there is nothing to install** — `npm install` (run for you by the one-line
installer) pulls in a bundled GPL build automatically, verified against pinned sha256
checksums. If an ffmpeg is already on your PATH, it is used first.

**Manual install (optional, for a system-wide copy)**:

- **Windows**: `winget install Gyan.FFmpeg` or download from [ffmpeg official site](https://ffmpeg.org/download.html)
- **Linux**: `sudo apt install ffmpeg`
- **macOS**: `brew install ffmpeg` (requires [Homebrew](https://brew.sh/))

**Verify installation**:
```sh
ffmpeg -version
# Should show version information
```

### 4. The monorepo and its npm dependencies

The one-line installer above already does everything in this section. Read it only when you
set the monorepo up by hand — for example when you fetch it as a tarball instead of running
the installer.

Fetch the source. A tarball needs no git — this is how `install.sh` fetches it, except that
the installer defaults to the newest release tag (`tar.gz/refs/tags/vX.Y.Z`) rather than
`main`:

```sh
mkdir %USERPROFILE%\.akari\app
curl -fsSL -o main.tar.gz https://codeload.github.com/AkariLabs/akari-video/tar.gz/refs/heads/main
tar -xzf main.tar.gz -C %USERPROFILE%\.akari\app --strip-components=1
```

(On Linux / macOS the same two commands work with `$HOME/.akari/app` as the destination.)

#### Windows: symlink errors while extracting are expected — ignore them

Creating a symbolic link on Windows requires a privilege a normal account does not have, so
`tar` fails on every symlink in the repository and **exits 1**:

```
.agents/skills/address-review: Can't create '\\?\C:\Users\<you>\.akari\app\.agents\skills\address-review': Invalid argument
.claude/skills/...   (same)
.codex/skills/...    (same)
.cursor/skills/...   (same)
.opencode/skills/... (same)
plugin/skills:       (same)
```

**This is not a failed install.** The only entries that fail are the symlinked agent
entrances (the skill directories under `.agents/`, `.claude/`, `.codex/`, `.cursor/`,
`.opencode/`, plus `plugin/skills`); every real file (`packages/`, `skills/`, `docs/`,
`templates/`, …) is extracted and you can keep going. Those symlinks only point at
`skills/`, and the skill sources themselves are all under `skills/<name>/SKILL.md` — so you
can point your agent at that path directly ("read `skills/edit-plan/SKILL.md` and follow
it").

Because `tar` still exits 1, a script wrapping the extraction sees a "failure". Check for an
extracted file instead of trusting the exit code — for example
`packages\akari-launcher\bin\akari.mjs`.

To have the symlinks created for real, allow symlink creation and extract again:

- Turn on **Developer Mode** (Settings → System → For developers), or run the extraction from
  a shell started with **Run as administrator**
- If you clone with git instead, also set `git config --global core.symlinks true` **before**
  the clone — without it each symlink becomes a plain text file

#### Install the npm dependencies

A fresh checkout has no `node_modules/`. Install dependencies before running the CLI.
ATF rendering has retired; get HTML telop assets through Lab. Existing baked items remain playable.

The following packages need runtime dependencies or tool setup:

| Package | External dependencies | Needed for |
|---|---|---|
| `packages/preview-server` | `esbuild` | the browser preview server |
| `packages/media-bin` | none — but its `postinstall` downloads ffmpeg/ffprobe (sha256-verified) | ffmpeg for every media step |
| `packages/akari-tools` | `puppeteer-core` + the monorepo package `@akari-video/render-cut` | root install only — see below |
| `packages/export-nle` | the monorepo package `@akari-video/media-bin` | root install only — see below |
| `apps/shell` | Theia / Electron | the desktop app — see [Windows build guide](./dev/windows-build.md) (Japanese) |

**Install CLI dependencies together (what the installer runs)** — in the extracted install
directory, restrict npm workspaces to `packages/*`, then install from the root:

```sh
cd %USERPROFILE%\.akari\app
node -e "const fs = require('fs'); const p = 'package.json'; const pkg = JSON.parse(fs.readFileSync(p, 'utf8')); pkg.workspaces = ['packages/*']; fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');"
npm install
```

The installers and `akari update` install CLI dependencies, including browser preview, and
exclude the desktop shell (`apps/shell`, Theia + Electron) by default. Set
`AKARI_INSTALL_SHELL=1` to skip the workspace rewrite. For the desktop app, use the release
DMG / EXE. Developers building the shell should run `npm install --no-workspaces` inside
`apps/shell`; see the [Windows build guide](./dev/windows-build.md) (Japanese).

`packages/akari-tools` and `packages/export-nle` depend on other packages of this monorepo
(`@akari-video/render-cut` / `@akari-video/media-bin`), which are not published to npm — a
per-package install there fails with `404 Not Found`. Install from the repository root
instead, where npm workspaces link them locally.

Do not add `--ignore-scripts`: the `postinstall` of `packages/media-bin` is what downloads
the bundled ffmpeg/ffprobe.

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
./akari.sh --opencode
```

`akari` runs in this order:

1. Diagnoses whether the current directory is a project (presence of `.akari/connections.json`)
2. If not set up yet, walks you through scaffolding a project (prompts are currently in Japanese)
3. Checks and displays connection status (generation providers, API keys)
4. Finally launches the AI agent — from there you continue conversationally inside the session

**Using Claude Code instead**:

```sh
./akari.sh
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
The desktop app can start the same server from its menu (Open → Browser preview); the URL is
shown in the menu, and appending `?frameEngine=0` switches to the legacy view.

### D. From the app

Connect from the Start screen of the Theia-based desktop shell (`apps/shell/`, mid-migration).
The app is a place to review and fix what the agent built, so starting from the terminal
or a session is the current recommendation for your first step.

#### Verifying the macOS download

Mount the downloaded DMG (file name varies by version) and verify the `.app` inside. Run these commands in the folder where you saved the DMG.
```sh
dmg=$(ls *.dmg | head -1)
hdiutil attach "$dmg"
app=$(ls -d "/Volumes/AKARI Video"*/"AKARI Video.app" | head -1)
codesign --verify --deep --strict -vv "$app"
spctl -a -t exec -vv "$app"
xcrun stapler validate "$app"
```
Expected output includes `valid on disk`, `accepted`, `source=Notarized Developer ID`, `origin=Developer ID Application: nakajima ryoma (WH2ZAX783Q)`, and `The validate action worked!`.
For releases that include DMG notarization, also check the DMG itself with `xcrun stapler validate "$dmg"` and `spctl -a -t open --context context:primary-signature -vv "$dmg"`.
Extract the zip using Finder or `ditto -x -k shell-mac.zip extracted`. Extraction tools that do not preserve symlinks can cause `invalid signature` errors.

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
| `autonomy` | How much to delegate | `full-auto` (straight through) / `checkpoint` (default — with proposals) / `collaborative` (work together) |

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
