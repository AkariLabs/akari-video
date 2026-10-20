**English** | [日本語](./getting-started.ja.md)

# Getting Started — your first project

> **A note on screen terms**: this document uses the terms on the latest `main`.
<!-- BEGIN GENERATED facts:shipped-note -->
<!-- END GENERATED facts:shipped-note -->

AKARI Video is a system where **an AI agent does the video editing**.
You only do two things: **say what you want to make** and **check the result and fix it**.

It's useful when you want to create short videos but don't have time to learn editing software,
or when you want to add titles, captions, and narration but find it tedious to do manually.

## What you'll learn from this document

1. What you need to prepare (prerequisites and installation)
2. How to pick an entrance (the app, the terminal, or inside an AI agent)
3. Creating your first project and exporting a video (the app flow and the CLI flow)
4. The intake form, and connecting to Lab

---

## Prerequisites — what you need

There are two ways to use AKARI Video.

- **The desktop app (recommended)** — download it and open it. You add an AI partner inside the app.
  You do not need to install Node.js or ffmpeg yourself; the first-run "Set up AKARI Video" screen can install any
  missing tools
- **The terminal (`akari` command) or inside an AI agent** — you use **three things**: Node.js, an AI agent, and ffmpeg.
  Read "Install the CLI" below

### Download the desktop app

Get the version for your computer from [akari.video/download](https://akari.video/download/).

| OS | File | Notes |
|---|---|---|
| macOS (Apple Silicon) | `.dmg` | Signed with a Developer ID and notarized by Apple. To check it, see "Verifying the macOS download" below |
| Windows (x64) | Setup `.exe` (a zip is also available) | Not code-signed yet. Read the note below |

There is no app for Linux (the CLI works on Linux too).

**The first screen you'll see on Windows**: the Windows build is not code-signed yet, so the first time you run it
Windows shows a blue "Windows protected your PC" screen. Click **"More info" → "Run anyway"** and setup starts.
The source code is public, so anyone can inspect what you are running.

The app downloads new versions automatically. Once the download finishes, an update notice appears
("Restart to install the new version. Open projects are saved.") with an "Update and restart" button — or choose
"On next launch", or just quit and relaunch the app normally, and it applies then. It never force-restarts you mid-session.

By default, updates include stable versions only. To try new features early, choose
“<!-- F ui.settings.prereleaseToo -->Include prereleases<!-- /F -->” under “Release channel” in the app settings to receive beta versions too.
This is the same as setting `"channel": "prerelease"` in
`~/.akari/update-preferences.json`, and it also applies to CLI automatic updates.

Once the app is installed, continue with **D** under "Pick an entrance" and "Create your first project" below.

### Install the CLI (if you use the terminal)

**Auto-install (recommended)**:

Run only **one** command — the one for your OS.
The installer checks out the **latest release** (not the development branch).

**Linux / macOS**:
```sh
curl -fsSL https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.sh | bash
```

**Windows (PowerShell)**:
```sh
irm https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.ps1 | iex
```

**Windows (CMD)**:
```sh
curl -fsSL https://raw.githubusercontent.com/AkariLabs/akari-video/main/install.cmd -o install.cmd && install.cmd
```

`install.sh` (Linux / macOS) automatically checks and installs:
- Node.js v20+ (if missing, a portable copy is placed under `~/.akari/` — no Homebrew,
  no admin password)
- opencode or Claude Code (if neither is found it offers to install opencode; install Codex, Cursor Agent, or any other agent yourself)
- ffmpeg (nothing to do — `npm install` pulls in a bundled GPL build automatically,
  sha256-verified; a system ffmpeg on PATH is preferred when present)

`install.sh` does not need git either — it fetches the repository as a tarball.
The CLI is installed to `~/.akari/app/` by default. Set `AKARI_INSTALL_DIR` to override
that location. The `~/.akari/app/` directory is replaceable as a whole during updates;
other entries directly under `~/.akari/`—including `assets/`, `avatars/`, `runtime/`, and
`*.json` files—are user data and are preserved. If an older installer-managed copy is
found at `~/akari-video/`, the installer shows migration instructions but never deletes
the old copy automatically.

**The Windows installers** (`install.ps1` / `install.cmd`) behave a little differently:

- **git is required.** They clone the repository into `%USERPROFILE%\akari-video` and check out the latest release tag
- For Node.js v20+, `install.ps1` installs it with winget / Chocolatey / Scoop. `install.cmd` does not, so install it first from [nodejs.org](https://nodejs.org/)
- `install.ps1` offers to install ffmpeg. If it isn't on PATH, `npm install` still fetches the bundled GPL build
- To update, run the same installer again

If you would rather not use git, use `npm i -g akari-video` (below) or the desktop app.

**Open a new terminal after installing.** The installer appends to your PATH
(`~/.zshrc` on Linux / macOS, or `~/.bashrc` for bash), but your current terminal doesn't pick that up,
so typing `akari` there gives `command not found`.
To continue in the same terminal, first run `source ~/.zshrc` (or `source ~/.bashrc` for bash).

**Updating**: a CLI installed with `install.sh` keeps itself up to date automatically — no need to re-run the
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

**Prefer a lightweight CLI-only install?** `npm i -g akari-video` installs just the `akari`
command (agent workflow bundled; the browser preview server is not included — use the
installer above for the full setup). This never uses sudo; if it fails with `EACCES`
(permission error), prefer `install.sh` above (user-space, no admin password needed) or
configure an npm user prefix instead. The desktop app uses its bundled `akari` CLI directly,
so updating the app updates the CLI to the same version. To use it from an
OS terminal, add `~/.akari/cli/bin` to PATH or run `install.sh` above.

**For manual installation**, see below:

### 1. Node.js (JavaScript runtime)

Node.js is needed to run the CLI (the `akari` command).

**How to install**:

- **Windows**: download the LTS version from [nodejs.org](https://nodejs.org/) and install it
- **Linux (Ubuntu/WSL2)**:
  ```sh
  curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```
- **macOS**: download the LTS version from [nodejs.org](https://nodejs.org/), or `brew install node`

> If you use `install.sh`, skip this section entirely — if Node is missing, a portable copy is
> placed under `~/.akari/` automatically (no Homebrew, no admin password).

**How to verify**:
```sh
node --version
# Should show v20.x.x or similar
```

### 2. An AI agent (opencode, Claude Code, Codex, Cursor Agent, and others)

To use the CLI you need an AI agent.
Install any one (or more) of the following. If you use the desktop app you can add agents from
"Add partner" inside the app, so you can skip this section.

#### Using opencode

opencode is an open-source AI coding assistant.
It ships with **free models**, but you need a provider account to use more capable models.

**How to install**:

```sh
curl -fsSL https://opencode.ai/install | bash
```

**How to verify**:
```sh
opencode --version
# Should show a version number
```

See the [opencode website](https://opencode.ai) for details.

#### Using Claude Code

Claude Code is Anthropic's AI coding assistant.
It requires a **paid Claude subscription**.

**How to install**:

```sh
# Windows / Linux / macOS
curl -fsSL https://claude.ai/install.sh | bash
```

**How to verify**:
```sh
claude --version
# Should show a version number
```

See the [Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code/overview) for details.

#### Using Codex

Codex is OpenAI's coding agent. You sign in with a ChatGPT account.
Start Codex in an AKARI Video project folder and the [Agent Skills](https://agentskills.io)-format skills
under `.agents/skills/` and `.codex/skills/` are discovered automatically. For installation, see
the [Codex repository](https://github.com/openai/codex).

#### Using Cursor Agent

[Cursor](https://cursor.com) is an AI-native IDE with an Agent mode.
Open the AKARI Video monorepo, or a video project folder, in Cursor and
[Agent Skills](https://agentskills.io)-format skills are discovered automatically from
`.cursor/skills/` (monorepo) or from the project adapter (after `akari new`).

**How to start**:

1. Open the repository or project in Cursor
2. In Agent chat, say **"I want to start a new video project"**
3. The agent reads `AGENTS.md` and the `SKILL.md` files under `.cursor/skills/` and proceeds

There is no Cursor-specific `/akari` slash command at the moment. Use natural language or an
explicit path such as `skills/edit-plan/SKILL.md`, just as with the other harnesses.

Inside the app you can also choose GitHub Copilot, Antigravity (Google), Grok Build (xAI), Command Code, Pi,
Devin, Muse Code (Meta), and DeepSeek Harness as partners.

### 3. ffmpeg (video processing tool)

ffmpeg is used for cutting, converting, and exporting video.
**You normally don't need to install it** — `install.sh` and `npm install` pull in a bundled GPL
build automatically (verified against a pinned sha256). A system ffmpeg on PATH is preferred when present.

**Manual install (optional — if you want it system-wide)**:

- **Windows**: `winget install Gyan.FFmpeg`, or download from the [ffmpeg website](https://ffmpeg.org/download.html)
- **Linux**: `sudo apt install ffmpeg`
- **macOS**: `brew install ffmpeg` (requires [Homebrew](https://brew.sh/))

**How to verify**:
```sh
ffmpeg -version
# Should show version information
```

### 4. The monorepo and its npm dependencies

If you use the installer above, everything in this section happens automatically.
Read on only if you are **setting up the monorepo manually** (for example fetching a tarball without the installer).

Fetch the source. A tarball needs no git (`install.sh` fetches the same way,
but the installer's default is the latest release tag `tar.gz/refs/tags/vX.Y.Z`, not `main`).

```sh
mkdir %USERPROFILE%\.akari\app
curl -fsSL -o main.tar.gz https://codeload.github.com/AkariLabs/akari-video/tar.gz/refs/heads/main
tar -xzf main.tar.gz -C %USERPROFILE%\.akari\app --strip-components=1
```

(On Linux / macOS, extract to `$HOME/.akari/app` and the same two commands work.)

#### Windows: symlink errors while extracting are expected — ignore them

Creating symbolic links on Windows needs a privilege that regular accounts don't have, so
`tar` fails on every symlink in the repository and finishes with **exit 1**.

```
.agents/skills/edit-from-review: Can't create '\\?\C:\Users\<username>\.akari\app\.agents\skills\edit-from-review': Invalid argument
.claude/skills/...   (same)
.codex/skills/...    (same)
.cursor/skills/...   (same)
.opencode/skills/... (same)
plugin/skills:       (same)
```

**This is not an installation failure.** Only the agent entry points that are symlinks fail
(the skill directories under `.agents/`, `.claude/`, `.codex/`, `.cursor/`, `.opencode/`, and
`plugin/skills`). The real files (`packages/`, `skills/`, `docs/`, `templates/`, and so on)
are extracted, so you can keep working. These links merely point at `skills/`; the actual
skills live in `skills/<name>/SKILL.md`. Point your agent at that path directly to get the
same result ("Read `skills/edit-plan/SKILL.md` and follow it").

Because `tar` returns exit 1, a script wrapping the extraction will see a "failure".
Decide by whether the extracted files exist rather than by the exit code
(for example `packages\akari-launcher\bin\akari.mjs`).

If you do want real symlinks, allow their creation and extract again:

- Turn on **Developer Mode** (Settings → System → For developers), or extract from a shell
  **run as administrator**
- If you fetch with git clone, also run `git config --global core.symlinks true`
  **before** cloning (otherwise symlinks are checked out as text files)

#### Install the npm dependencies

Right after fetching there is no `node_modules/`. Install dependencies before using the CLI.

These packages have runtime dependencies or tool setup:

| Package | External dependency | What it is needed for |
|---|---|---|
| `packages/preview-server` | `esbuild` | Browser preview server |
| `packages/media-bin` | none — but `postinstall` fetches ffmpeg/ffprobe (sha256-verified) | The ffmpeg used by all media processing |
| `packages/akari-tools` | `puppeteer-core` + the in-repo package `@akari-video/render-cut` | Root-level bulk install only (see below) |
| `packages/export-nle` | the in-repo package `@akari-video/media-bin` | Root-level bulk install only (see below) |
| `apps/shell` | Theia / Electron | Desktop app — see the [Windows build guide](./dev/windows-build.md) |

**Install the CLI dependencies in one go (same steps as the installer)** — in the extracted
install directory, narrow npm workspaces to `packages/*`, then install from the root.

```sh
cd %USERPROFILE%\.akari\app
node -e "const fs = require('fs'); const p = 'package.json'; const pkg = JSON.parse(fs.readFileSync(p, 'utf8')); pkg.workspaces = ['packages/*']; fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n');"
npm install
```

The installer and `akari update` default to a CLI-only setup (including the browser preview) and do not
install the desktop shell (`apps/shell`, Theia + Electron).
Set `AKARI_INSTALL_SHELL=1` to skip rewriting workspaces.
For the desktop app, use the release DMG / EXE. If you are a developer building the shell, run
`npm install --no-workspaces` inside `apps/shell`.
See the [Windows build guide](./dev/windows-build.md) for details.

`packages/akari-tools` and `packages/export-nle` depend on other in-repo packages
(`@akari-video/render-cut` / `@akari-video/media-bin`) that are not published to npm.
Installing either package on its own fails with `404 Not Found`, so install from the
repository root, where npm workspaces resolve them locally.

Do not pass `--ignore-scripts`. The `postinstall` in `packages/media-bin` is what fetches the
bundled ffmpeg/ffprobe.

---

## Pick an entrance

AKARI Video has five entrances.
All converge on the same file contracts (under `.akari/`),
so you can start from anywhere and continue from another later.

| Entrance | Best for | How to start |
|---|---|---|
| A. Terminal | Comfortable with command line | `akari` (no arguments) |
| B. opencode / Claude Code / Codex session | Already using an AI agent CLI | Say "I want to start a new video project" |
| C. Cursor Agent | Prefer an IDE with Agent chat | Open the repo or project in Cursor and say "I want to start a new video project" |
| D. App | Prefer GUI | Open the desktop app and use "<!-- F ui.home.startButton -->+ Start a new video<!-- /F -->" on Home |
| E. Entry skill | Want to start from any folder | Run `akari skills install --entry` once, then say "I want to make a video" |

**Recommended for beginners: start with D (the app)**. You build with the AI while looking at the screen.

---

### A. From the terminal (`akari` command)

```sh
akari
```

Running `akari` with no arguments opens a project and launches the AI agent. It runs in this order:

1. Diagnoses whether the current directory is a project (presence of `.akari/connections.json`)
2. If not set up yet, walks you through creating an empty project (prompts are currently in Japanese)
3. Checks and displays connection status (generation providers, API keys)
4. Finally launches the AI agent — from there you continue conversationally inside the session

The default is Claude Code. To use opencode, run `akari --opencode` (`--claude` selects Claude Code explicitly).
If you work straight from a repository checkout, `./akari.sh` (or `./akari.sh --opencode`) does the same.

### B. From inside an opencode, Claude Code, or Codex session

If you already use an AI agent CLI, this is the natural entrance.

- **opencode**: Say "I want to start a new video project" and the `create-project` skill triggers
- **Claude Code**: **`/akari`** — a slash command that diagnoses the current state and suggests
  the next step. Or just say "I want to start a new video project"
- **Codex**: start it in an AKARI Video project folder and say "I want to start a new video project".
  Skills are discovered from `.agents/skills/` and `.codex/skills/`

**Install as a Claude Code plugin** (all 28 skills + `/akari`, from the marketplace):
```sh
claude plugin marketplace add AkariLabs/akari-video
claude plugin install akari@akari
```
- The marketplace clones the whole repository (about 1 GB). Update with `claude plugin update akari@akari`.
- The plugin only delivers the skills and `/akari`. The `akari` CLI (`akari new` etc.) still needs the installer used by §A ([Prerequisites](#prerequisites--what-you-need)) — the plugin alone cannot make a video.
- One entry skill is enough → use E. Want all 28 skills inside Claude Code → use B.

### C. From Cursor Agent

Open the monorepo (`akari-video`) or a video project folder in Cursor.
Skills are discovered from `.cursor/skills/` (symlinks to `skills/` in the monorepo) or from
project adapters created by `akari new`.

Say **"I want to start a new video project"** in Agent chat, or point the agent at a specific
skill (for example `skills/edit-plan/SKILL.md`).

Preview while editing: run `./akari.sh --preview` in a terminal and open http://localhost:4567.
The desktop app can start the same server from its menu (Open → Browser preview); the URL is
shown in the menu, and appending `?frameEngine=0` switches to the legacy view.

The CLI bundled with the desktop app can start the same server without the installer:
run `akari preview [dir]` in a project folder (it prints the URL), pass `--port <n>` to choose a
port (the default is 3000), and pass `--open` to open the browser once the server is ready.
`akari.sh --preview` keeps working as before.

### D. From the app

Open the desktop app (the Theia-based shell, `apps/shell/`) and start from "<!-- F ui.home.startButton -->+ Start a new video<!-- /F -->" on Home.
The flow is in "[Create your first project in the app](#create-your-first-project-in-the-app)" below.
The app is the main entrance: you run your AI partner in the right-hand panel and review and
fix what the partner built in the same window. The terminal and session entrances (A–C, E) work too.

A tour of the screen is in [Shell UI](./how-to/shell-ui.md).

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

### E. From an empty folder (entry skill)

Run `akari skills install --entry` once to install the entry skill for your AI agents
(by default into `~/.claude/skills/akari` and `~/.agents/skills/akari`). In any folder, tell Claude Code, Codex, opencode, or Cursor: “I want to make a video.”

- **Create:** choose the workspace (`~/Akari/`, created with `akari init` if needed) or this folder in one question; then `akari new <target>` creates the project.
- **Open:** choose a project from the workspace’s `channels/*/videos/*`.
- **Resume:** an existing project uses `akari status` to show the next skill or waiting action.
- **Suggest a playbook:** when you start a project and right after you add footage, it proposes up to three matching playbooks from `akari playbook list`, with the reasons. It never applies one on its own.

The agent reads `<project>/.claude/skills/<name>/SKILL.md` directly in the current session; discovery picks it up on the next project session.

---

## Create your first project

### Create your first project in the app

This is the path from opening the app for the first time to exporting one video.

1. **Set up AKARI Video** — the first time you open the app, a setup screen appears. Work through four steps in order:
   Tools, Workspace, Assets, Partner. Tools are the parts used for video conversion and transcription, and one button installs them.
   The workspace is where your channels and video projects live (`~/Akari` by default). On the Assets step you can add a folder of
   existing assets or connect AKARI Video Lab ([Connect to Lab](#connect-to-lab)). You can redo this from "Set up AKARI Video" in Settings at any time
2. **The first guide** — choose "Yes, I'm new" under "Is this your first time using AKARI Video?" and a guide starts that
   makes a sample video with you (about five minutes). You look at the screen layout, add footage, ask the AI, play the result,
   and export. Even before you connect an AI, you can see the flow as a prepared example. The example follows the app's display
   language (Japanese or English). If you close it, you can open it again from "Getting started guide" in Settings or
   "Replay the first guide" on Home
3. **Add an AI partner** — in the right-hand panel, choose the AI you use with "Add partner".
   With Claude Pro or Max, Claude Code connects directly; with a ChatGPT account, Codex; with a Google account, Antigravity
   (the guide points to these three). The app installs the parts it needs, and then you just sign in in the browser.
   You can also choose opencode, Cursor, GitHub Copilot, Grok Build, Command Code, Pi, Devin, Muse Code, and DeepSeek Harness.
   Under "Partner privileges" in Settings you choose between auto mode, asking every time, and all permissions. You can also update the CLI agents from Settings
4. **Create a new project** — press **"<!-- F ui.home.startButton -->+ Start a new video<!-- /F -->"** on Home to open a single "<!-- F ui.home.newProjectHeading -->New project<!-- /F -->" popup.
   Give it a name, pick the channel it goes in (or "Create without a channel"), and choose **"Start blank"** or **"Start from a playbook"**.
   - **Start blank**: begin with no assets and no settings
   - **Start from a playbook**: pick a playbook (the steps, checkpoints, settings, and placeholder slots for one video) from yours, your channel's, or Lab's,
     read the review sheet, and press "Import and start". You start with its flow and settings
5. **Add your assets** — drag and drop your footage and photos into "Assets" in the left project panel.
   The left panel has three bands from top to bottom: **Assets** (what you bring in), **Records** (plans, edit data, reports), and **Exports** (what you've rendered).
   Assets, styles, and templates are on the shelves of the **Library**, and you can drag them onto the timeline
6. **Ask the AI partner** — tell the partner in the right-hand panel what you want, in plain text
   (for example "add captions and music, and cut the dead air"). The partner works through analysis, cuts, captions, and BGM.
   You can do something else while it works. If you're not sure how to ask, open "Open Planning form" on Home (see below)
   and pick the tasks, length, and how much to delegate
7. **Check and fix** — play it in the preview in the middle. To point at something to change, mark it with the pen, pin, or range tool
   under the preview, write your note, and press **"<!-- F ui.annotation.handToAi -->Hand to AI<!-- /F -->"**; it reaches the partner as an annotation in the right-hand panel.
   You can fix things by hand too: cut and move things on the timeline, select words or lines in the script panel and use "Cut with video",
   or apply a caption look to "the whole caption" or "selected words". After fixing by hand you can still ask the partner to continue
8. **Export** — use **"Export…"** in the menu on the left, then press Export. The rendered file appears under "Exports" in the left
   panel, where you can open it or show it in Finder. You can also ask the partner to "export it"
   (it shows you the contents and asks before it runs). See [Export](./guides/export.md)

Everything the partner does is saved as a step in "Activity". From "History" on the project home you can
"View changes" or "Restore to before this". Only things that can't be undone — publishing, submitting, paid generation, sending data
outside, deleting original footage — make the partner stop and show a bar at the top of the screen; you answer with approve or cancel.

### Create your first project in the terminal

```sh
akari new my-video
```

`akari new <dir>` creates a new empty project. These forms are available:

| Form | Meaning |
|---|---|
| `akari new <dir>` | Create an empty project |
| `akari new <dir> --scaffold <path>` | Create from the scaffold at `<path>`. In v1.5.0 the flag is `--template` (`--scaffold` arrives in the next release; the old name stays as an alias) |
| `akari new <dir> --from <playbook directory \| id>` | Create from a playbook, carrying over its flow and settings |
| `--lang <code>` | Set the project's language (for example `en`); it is stored as `language` in `.akari/intake.json` |

<!-- BEGIN GENERATED facts:cli.new -->
```sh
akari new <target-dir> [--scaffold <path>] [--template <path> (alias for --scaffold)] [--lang <code>]
```

`--template` remains an alias for `--scaffold`.
<!-- END GENERATED facts:cli.new -->

`akari playbook list` shows playbooks from yours, your channel's, and Lab's, and
`akari playbook apply <id> --into <project>` applies one to a project already in progress (it doesn't move existing cuts; it only adds missing placeholder slots and plan items).

Running `akari` with no arguments opens a project and launches the AI agent (creating one if needed).
Telling the AI agent **"I want to create a project"** produces the same set of files:

```
my-video/
├── .akari/
│   ├── intake.json        ← intake form (fill this in first)
│   ├── connections.json   ← connection registry (API key references, model choices)
│   ├── workflow.json      ← role definitions for the project
│   ├── events/            ← milestone records (the "resume from here" signal)
│   ├── reports/           ← reports such as the creation report
│   └── sidecars/          ← per-asset side data such as analysis
├── .agents/ .claude/ .codex/ .cursor/ .opencode/ .devin/
│                          ← entry points for each agent (links to skills/)
├── edit.json              ← the edit data (source of truth, v2)
├── assets/                ← source material
├── planning/              ← plans and planning documents
├── exports/               ← render output
├── AGENTS.md / CLAUDE.md  ← guidance for agents
└── akari.sh
```

Check the current state with `akari status`: it shows the next skill (`next_skill`) and whether the project is waiting on a person.
When something seems missing, `akari doctor` diagnoses which required parts exist and where they were found.

---

## Fill in the intake form (intake.json)

Right after project creation, `.akari/intake.json` is `status: draft`.
Answer three items and set it to `submitted`, and the partner can start working.

| Field | Meaning | Example |
|---|---|---|
| `tasks` | What to do. Chosen from five fixed ids | Transcription and text overlays (`transcribe-captions`) / Cut unwanted pauses and outtakes (`silence-cut`) / Music and sound effects (`bgm-sfx`) / Narration (`narration`) / 3D and screen replacement effects (`3d-inserts`) |
| `target` | Length | A target in seconds (`duration_s`; the form offers 15 s / 30 s / 60 s / up to 3 minutes), or "keep the full length" (`keep_length: true`) — only one of the two. An optional free-text `taste` describes the mood |
| `autonomy` | How much to delegate | `full-auto` (fully automatic — do exactly what I said and export without review) / `checkpoint` (with suggestions, the default — include promising options and show them; one review before export) / `collaborative` (create together — confirm at key points: direction, assets, execution) |

There are also optional `title` (a human-readable name) and `language` (the language of the work).

You can fill the form from "Open Planning form" on Home in the app. Pressing "Send to Partner" turns what you checked
into the partner's instructions and saves it as `submitted`. You can also fill it in chat:
say **"let's fill in the intake form"** and the agent asks the questions and records your answers.

---

## Connect to Lab

AKARI Video Lab ([akari.video/lab](https://akari.video/lab/)) is the library that distributes assets, styles, templates, and playbooks.
There are two tiers: **free** and **Pro**. Free assets are CC0; Pro is available to people with the Pro pass (the Lifetime plan).
You can inspect the contents of Pro assets in Lab.

You only connect once.

- **From the app**: in Settings, open "AKARI account" → "Connect", then check the confirmation code in the browser that opens and approve.
  The "Connect AKARI Video Lab" button on the Assets step of first-run setup does the same thing
- **From the CLI**: `akari store connect` (approve in the browser; `--no-open` skips opening the browser, and `--token` lets you pass a token manually).
  `akari store status` shows the connection and your purchases

Once connected, the free asset packs and the Pro assets you have bought arrive in the app. In the Library, set the source to
"Lab", find an asset, and press the use button to fetch it and place it on the timeline.

**Example playbooks**: Lab gives away ten example playbooks for free (film, short drama, music video, explainer, product intro,
vlog, commercial, education, clips, logo). Install one with `akari store install <id>` and it shows up in the list under
"<!-- F ui.home.startButton -->+ Start a new video<!-- /F -->" → "Start from a playbook", with the source "Lab". Installing a playbook-only item does not ask you to enable
a Claude Code extension kit (that only appears for items that include skills).

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

4. **Check and fix** → play it in the preview, mark what you want changed, and "<!-- F ui.annotation.handToAi -->Hand to AI<!-- /F -->"
   → [Review and fix](./guides/review-and-fix.md)

5. **Export** → say "export it"
   → lint PASS → you approve → MP4 is saved in `exports/`
   → [Export](./guides/export.md)

   To check lint yourself, run `akari lint .` (it rewrites nothing). Findings it can fix mechanically are
   repaired by `akari lint . --fix`, which prints the changed files, diff, and backup path first.

### Without footage

You can start from planning with just an idea.
The agent asks questions, proposes a plan, and suggests how to source material.
→ [Plan from scratch](./guides/plan-from-scratch.md)

---

## Frequently asked questions

**Q. Do I need programming knowledge?**
No. The AI agent does everything. You just say what you want to make, then check the result and fix what you want changed.

**Q. Does it cost money?**
The AKARI Video app is free. Local operations (proxy generation, transcription, editing, export) cost nothing.
The AI partner needs its own plan from the AI you use (Claude Code and Codex each need their own subscription, for example).
You can also start with an AI that has a free tier or with opencode's free models. Only external APIs (cloud transcription, narration generation, etc.) incur costs.
Lab assets come in two tiers, free and Pro.

**Q. Does it work on Windows?**
Yes. The app supports Windows (x64) and macOS (Apple Silicon). The Windows build isn't code-signed yet, so you'll see a
confirmation screen the first time (see "The first screen you'll see on Windows" above). The CLI also runs on Linux (including WSL2).

**Q. I only speak English — is that okay?**
You can choose Japanese or English under "Language" in the app settings (it starts from your OS language).
In the English UI, asset names and the first guide are in English too. Some error messages and documentation may still be in Japanese.

<!-- BEGIN GENERATED facts:stamp -->
This page describes AKARI Video v1.5.1 (released 2026-10-19).
<!-- END GENERATED facts:stamp -->
