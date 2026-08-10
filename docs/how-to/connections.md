**English** | [日本語](./connections.ja.md)

# Connections and API keys

Connections to external services (cloud transcription, TTS, generation APIs, SNS
integrations) are centrally managed by the `manage-connections` skill.

## Principles

- **Local-only work needs no connection** — proxy generation, whisper.cpp
  transcription, editing, lint, and export all work with no external connection
- **API keys never appear in chat** — the key itself lives in
  `~/.config/akari-video/credentials.env` (outside the project); connections
  registries hold only a **reference** to it
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

## Choose a model or provider

For things with multiple backends — transcription, TTS, and so on — you can set the
default in `connections.json`'s model selection. You can change it conversationally
too, e.g. "make local whisper the default for transcription."

## Partner agents (the app's connect button)

The desktop shell's connect button opens a partner catalog: each card connects one
agent CLI (in a PTY tab) or one editor extension. The current catalog ships
**7 CLIs** — Claude Code, Codex, opencode, Copilot, Cursor, Antigravity, and
Grok Build — plus the Claude Code and Codex extensions. The catalog is data-driven
(`partner-catalog.json`) and grows over releases, so treat this list as a snapshot,
not a promise. Whichever partner you connect, everything converges on the same file
contracts under `.akari/`.

## Cost approval policy

Independent of the delegation level (`autonomy` in `intake.json`), the
`connections.json` policy takes priority for **billing and external sends**. Even
when editing is delegated as full-auto, you're still asked to confirm before any
paid generation.

## Related

- First-time setup → [Getting Started](../getting-started.md)
- Paid vs. free narration generation → [Add narration](../guides/narration.md)
