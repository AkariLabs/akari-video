**English** | [日本語](./connections.ja.md)

# Connections and API keys

Connections to external services (cloud transcription, TTS, generation APIs, SNS
integrations) are centrally managed by the `manage-connections` skill.

## Principles

- **Local-only work needs no connection** — proxy generation, whisper.cpp
  transcription, editing, lint, and export all work with no external connection
- **API keys never appear in chat** — the key itself lives in
  <!-- F paths.credentials -->`~/.akari/credentials.env`<!-- /F --> (outside the project); connections
  registries hold only a **reference** to it
- **Older keys still work** — AKARI reads keys from the former location
  (<!-- F paths.credentials.legacy -->`~/.config/akari-video/credentials.env`<!-- /F -->) when they have not been copied yet.
  New keys are saved in <!-- F paths.credentials -->`~/.akari/credentials.env`<!-- /F -->. `akari doctor` shows which of
  the two a key was found in
- **Workspace defaults, project overrides** — the default registry lives at
  `<creator-root>/.akari/connections.json`. A project's `.akari/connections.json`
  is an optional overlay; when no workspace registry exists, AKARI Video falls
  back to the bundled default registry
- **Paid runs go through an approval gate** — per the cost approval policy, you're
  always asked to confirm before any run that incurs charges

## Check status (doctor)

**How to ask**: "show me connection status" / "run doctor"

A read-only diagnostic runs and reports which providers are usable and what's still
unconfigured, via a report (`connections-report.html`). Key values are never shown.
Doctor writes each provider's result back only to its source layer (project,
workspace, or the appropriate default destination), preventing project-local copies
from drifting away from workspace settings.

## Register a key

**How to ask**: "I want to set up the API key for ◯◯"

The agent walks you through the steps to write it into `credentials.env`, then
confirms connectivity with doctor once it's registered.

You can also do it from the app: **Settings → Connect** lists AKARI's tools and the
services that make assets (image / video generation, narration, transcription, 3D
settings, called 3D recipes in v1.5.0). Each card shows whether it is usable, needs a key, or is still being
prepared; "Add key" saves the key to the credentials file on your computer. The same
screen lets you set the order in which generation services are tried and whether to
fall back to the next service automatically when one fails (off by default).
The key never needs to go into chat. From a terminal, `akari connect list [--json]`
shows the same status, and `akari connect exec <id> -- <command>` runs a command with
that service's key passed to the child process only.

## Choose a model or provider

For things with multiple backends — transcription, TTS, and so on — you can set the
default in `connections.json`'s model selection. You can change it conversationally
too, e.g. "make local whisper the default for transcription."

## Partner agents (the app's connect button)

When you open a project, the last successfully used CLI or web partner for that
project opens automatically. If there is no project history, the last app-wide
partner is used. Turn off Settings → Partner → “Reopen the previous partner at startup,” or close its tab to stop
automatic opening in that project. An uninstalled partner is never installed automatically.
Exiting inside a CLI (for example, `/exit`) does not count as closing its tab; it opens again next time. Close the tab or turn off the setting to stop it.

Claude Code and Codex are the two recommended starting points; the rest are there
if you already use them. You can also update a partner CLI from the app: when a newer
version exists, **Settings → Partner** shows an **Update** button next to it. CLIs that
update themselves say so, and a copy installed outside AKARI (Homebrew, npm, and so on)
is left for you to update the way you installed it.

AKARI Chat (preview) is hidden by default. Turn on **Show AKARI Chat (preview)** in
Settings → Partner to use it.

The desktop shell's connect button opens a partner catalog. It offers
**11 CLIs** in PTY tabs — Claude Code, Codex, opencode, Command Code, Pi,
Devin, Copilot, Cursor (`cursor-agent`), Antigravity, Grok Build, and Muse Code — plus
the Claude Code and Codex editor extensions, and DeepSeek Harness (a web partner). Command Code requires Node.js 22 or newer;
when it is not installed, the shell uses the official
`npm install -g command-code` package flow. Muse Code is installed with
its official install script (on Windows, into `%LOCALAPPDATA%\Programs\muse`).
On first launch, Muse Code asks whether to trust the workspace; once trusted,
it loads the project's skills. On Windows, Muse Code also shows an
administrator prompt (User Account Control) on first launch to set up its
sandbox. The tab stays blank while that prompt is open. DeepSeek Harness is installed
through npm (`npm install -g @deepseek-ai/dsh`) and opens its work screen
in the right panel without opening a browser. Its workspace is the
currently open project folder. The shell automatically detects an
OpenCode Go login or a DeepSeek API key and chooses the connection.
When you reopen a project, DeepSeek returns to its last open conversation if the project's assigned port is available.
If that port is occupied and another is used, the last conversation may not reopen.
For conversations created in earlier versions, you may need to select the project folder once.
The DeepSeek work screen follows the app's Dark, Light, or System
appearance and updates when that appearance changes.
A theme explicitly chosen in DeepSeek Settings takes priority; AKARI
leaves DeepSeek font size and other settings unchanged.
The catalog is data-driven
(`partner-catalog.json`) and grows over releases, so treat this list as a snapshot,
not a promise. Whichever partner you connect, everything converges on the same file
contracts under `.akari/`.

### Partner permissions

Settings → Partner → Partner permissions defaults to **Auto (recommended)**.
This is a user setting shared across projects. Project settings files cannot change it.
**Ask every time** uses each tool's default permission behavior. **Allow all** bypasses
approval prompts and, where supported, the sandbox. Auto uses Claude Code and
Grok's `auto` mode, Codex and Cursor's auto review, Devin's `smart` mode,
and Muse Code's `on-request` mode with automatic review. Allow all passes `--yolo` to Muse Code.
Muse Code defaults to automatic review (`on-request`), so Ask every time behaves the same as Auto.
Copilot, Antigravity, Command Code, and Pi have no launch-time auto mode, so
Auto starts them with their allow-all option. opencode keeps its own default
behavior in Auto. Pi has no approval mechanism, so its tab shows
“Start with all permissions” in every mode.
DeepSeek Harness uses Workspace Write in Auto and Ask, and
Full access in Allow all. If a CLI's `--help` does not list the requested flag
or value for a mode flag, AKARI starts it without that flag using the tool's
default behavior. The partner tab title shows the mode actually applied,
including “Start with tool defaults” when no permission option was passed. A running DeepSeek Harness process retains
its original mode when its work screen is reused. Claude Code and Codex editor
extensions use their own extension settings; this setting applies to CLI and
DeepSeek web partners.

## Tool procedures and connections

Two layers keep "what you want to do" apart from "which service does it":

- A **tool procedure** (`akari-recipe`) is the situation: make 30 seconds of BGM,
  spin a product in 3D, and so on. It names the **capabilities** it needs
  (`music-generation`, `image-generation`, `video-generation`, `speech-synthesis`,
  `3d-render`, `transcription`, `publish`), never a service. In the app, the 3D one
  appears as **3D settings** (**3D recipes** in v1.5.0).
- A **connection** is a service or program: fal, ElevenLabs, Blender, and so on. Its entry
  in `connections.json` can declare `provides` (the capabilities it has), `adapter`
  (`official-api`, `local`, or `custom`), and `terms` (when its terms were checked and
  whether commercial use is allowed).

Swapping the service does not change the procedure.

```sh
akari recipe list [--json] [--project <dir>]
akari recipe plan <id> [--project <dir>] [--json]
```

`list` shows the procedures on your shelf (`~/.akari/tool-recipes/<id>/recipe.json`, or
`<project>/recipes/<id>/recipe.json` for one project only). `plan` shows, for each needed
capability, which connections can provide it, whether they are authenticated, and which
**gates** would stop a run: `paid`, `external-send`, and `license` (a connection with no
checked `terms` stops at `license`). `plan` only reports; it never runs anything. The agent
runs the procedure with the matching skill and commands, and the output files are recorded
in the project manifest with the procedure and connection that made them.

To see which generation models exist and what they cost, see
[Generation models](../guides/generation-models.md).

## Connect your AKARI account (Lab)

`akari store connect` links your AKARI account so the free asset packs and the assets you
have bought from Lab become available. It opens your browser, shows a confirmation code,
and finishes when you approve. Add `--no-open` to skip opening the browser, or
`--token akst_…` to link manually. `akari store status` shows what is linked and
`akari store disconnect` removes it. The link is also offered from the app.

## Cost approval policy

Independent of the delegation level (`autonomy` in `intake.json`), the
`connections.json` policy takes priority for **billing and external sends**. Even
when editing is delegated as full-auto, you're still asked to confirm before any
paid generation.

## Related

- First-time setup → [Getting Started](../getting-started.md)
- Paid vs. free narration generation → [Add narration](../guides/narration.md)

<!-- BEGIN GENERATED facts:stamp -->
This page describes AKARI Video v1.5.0 (released 2026-10-17).
<!-- END GENERATED facts:stamp -->
