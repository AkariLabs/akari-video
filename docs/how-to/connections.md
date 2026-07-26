**English** | [日本語](./connections.ja.md)

# Connections and API keys

Connections to external services (cloud transcription, TTS, generation APIs, SNS
integrations) are centrally managed by the `manage-connections` skill.

## Principles

- **Local-only work needs no connection** — proxy generation, whisper.cpp
  transcription, editing, lint, and export all work with no external connection
- **API keys never appear in chat** — the key itself lives in
  `~/.config/akari-video/credentials.env` (outside the project); the project's
  `.akari/connections.json` holds only a **reference** to it
- **Paid runs go through an approval gate** — per the cost approval policy, you're
  always asked to confirm before any run that incurs charges

## Check status (doctor)

**How to ask**: "show me connection status" / "run doctor"

A read-only diagnostic runs and reports which providers are usable and what's still
unconfigured, via a report (`connections-report.html`). Key values are never shown.

## Register a key

**How to ask**: "I want to set up the API key for ◯◯"

The agent walks you through the steps to write it into `credentials.env`, then
confirms connectivity with doctor once it's registered.

## Choose a model or provider

For things with multiple backends — transcription, TTS, and so on — you can set the
default in `connections.json`'s model selection. You can change it conversationally
too, e.g. "make local whisper the default for transcription."

## Cost approval policy

Independent of the delegation level (`autonomy` in `intake.json`), the
`connections.json` policy takes priority for **billing and external sends**. Even
when editing is delegated as full-auto, you're still asked to confirm before any
paid generation.

## Related

- First-time setup → [Getting Started](../getting-started.md)
- Paid vs. free narration generation → [Add narration](../guides/narration.md)
