---
name: manage-connections
description: Centrally manage AKARI Video generation providers, social connections, API-key references, model selection, and cost-approval policies. Use for initial setup, connection checks, adding providers/models, and gates before paid generation or external publication. Works with `.akari/connections.json` and a free, read-only doctor.
---

# FORBIDDEN-level hard rules

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

These rules always override detailed procedures.

1. **Never expose key values in git-tracked files, HTML, logs, or conversation.** Always mask displays.
2. **Find keys only in environment variables and credentials.env (new location → old location), with env taking priority. Never search elsewhere or ask for keys in chat.** Explain the location and KEY name; the human places them.
3. **Do not require keychain / external vault dependencies** (consider only as optional future backends).
4. **Doctor is free and read-only; never test actual generation** (pending ruling 2026-07-17).
5. **Do not perform paid operations before an estimate and cost approval** (same pattern as edit-plan's Decision
   Communication Contract). Stop before execution if the budget cap is expected to be exceeded.
6. **Do not adopt real-time hook monitoring (PreToolUse, etc.).** State is JSON; communication is the net git diff.
7. **Consumer skills must not use connections absent from connections.json**, meaning the resolved registry in
   project → workspace → default order. This skill is the sole entry point; the 42/70-series contracts inherit this rule.

# Steps in execution order

1. Resolve project `.akari/connections.json` → workspace `.akari/connections.json` → product-bundled defaults;
   inspect providers, `models.default / allowed`, and `policy`. Check resolution with
   `node <このスキルのディレクトリ>/bin/resolve-connections.mjs [プロジェクトルート]`
   (existing placeholders: this skill's directory and project root). Never use unregistered connections or models outside allowed.
2. Present the previous `doctor` result. Only when rechecking is explicitly requested, run
   `node <このスキルのディレクトリ>/bin/doctor.mjs` from the project root (existing skill-directory placeholder).
   To check another project, pass its root or connections.json path as argument 1. Results run from a project
   root are written back to files corresponding to each provider's origin layer (project / workspace / default).
3. If neither env nor new/old credentials.env contains the required key, explain doctor's location, KEY name,
   and acquisition URL to the human and stop. Do not acquire or write on their behalf.
   Use `AKARI_CREDENTIALS_FILE` to specify a replacement file only in tests.
4. To add a provider, the human adds 1 `KEY=VALUE` line to credentials.env; add 1 value-free entry to
   `.akari/connections.json`'s `providers`. For `auth: env-key`, `env` must use `${KEY_NAME}` form.
   Honestly retain `unchecked` for providers lacking a safe doctor adapter.
5. For model changes, establish `models.allowed` first, then choose `models.default` from it.
   Declare per-task overrides at the next approval gate.
6. Before paid operations, follow the [approval gate](../edit-plan/approvals-and-generation.md) format:
   target, method, reason, alternatives, estimated cost, wait time, external transmission, provenance.
   Do not execute before cost approval; stop if the budget cap is unset or expected to be exceeded.

Doctor writes back connections.json's `doctor` block and generates a read-only `connections-report.html` in the project root.
Display credentials only as present (masked) or absent; never show HTTP response bodies or key values.

Application-wide tool and service settings live in `~/.akari/connectors.json` (override the location with `AKARI_HOME`).
Doctor displays the enabled state, generation order, and automatic fallback settings without credential values.
Check each connection with `akari connect list --json`; follow [connect](../connect/SKILL.md) for usage.

## Default models (defaults.generate)

- Optional `.akari/connections.json` fields `defaults.generate.still` / `defaults.generate.video` specify default generation model IDs.
- Resolve through the same 3 layers as providers (project > workspace > product-bundled defaults), but shallow-merge individual `still` / `video` fields.
- Product-bundled defaults: still = `codex:image` / video = `fal:h3-i2v`.
- Model ID catalog: `packages/schemas/gen-models.json`.
- Check `effective.defaults` in `node <このスキルのディレクトリ>/bin/resolve-connections.mjs [プロジェクトルート]`
  (existing placeholders: this skill's directory and project root).

## Key locations (environment variables and credentials.env)

Follow this table for additional TTS connections. Humans issue keys; never put values in the registry.

| provider | credentials.env name | Source | Doctor's free GET |
|---|---|---|---|
| `fish-audio` | `FISH_AUDIO_API_KEY` | https://fish.audio/app/api-keys/ | `/wallet/self/api-credit` |
| `google-ai` | `GEMINI_API_KEY` | https://aistudio.google.com/api-keys | `/v1beta/models` (`x-goog-api-key` header) |

- For `auth: env-key` providers, doctor searches environment variables → new credentials.env → old credentials.env; env takes priority.
- Reports use only 3 values: `env` / `credentials.env` / `未設定` (machine output meaning unset). Show neither values nor last 4 characters.
- `akari doctor`'s `fal_key` row shows the same 3 values. Missing keys do not change verdict or exit code.
- Use `AKARI_CREDENTIALS_FILE` only to substitute locations in tests.

## Manage memory connections

The `memory` array in `.akari/connections.json` declares external reference-memory connections distinct from
generation providers. Canonical source:
[contract-2026-07-25-memory-connection-v0.md](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-25-memory-connection-v0.md) (Japanese).
They are read-only, without credentials or billing; this skill centrally manages them in the same registry as `providers`.

- **Add**: Add 1 entry to `memory`, minimally `{ "name": "<kebab-case>", "root": "<ローカルパス>" }`
  (existing placeholder: local path). Optional: `entry` (default `INDEX.md`), `include`/`exclude`, `read_policy`
  (default `read-only`). No secrets such as API keys in `root`; it contains only routing information.
- **Remove**: Remove the corresponding `memory` entry. There is no matching credentials.env line
  (`memory` has no `auth`/`env`).
- **Doctor display**: Limit `memory` checks to lightweight checks separate from `providers` HTTP/authentication tests:
  only existence of `root` and `root`+`entry`, free and read-only. This inherits hard rule 4's free/read-only principle.
  However, **schema design gives `memory` no `doctor` field**, since there is no persistent authentication state;
  v0 `doctor.mjs` does not implement this path check. v0 establishes data/skill contracts; implementation is next.
- Inaccessible `root` must not stop the consuming skill when it attempts to read (research-plan / edit-plan opening,
  analyze-project context integration). See memory-connection-v0 §5 for degraded behavior.

## Sources

- Canonical connection/settings management contract (2026-07-17): private internal records (`akari-video-internal`).
- First-run / no proxy acquisition discipline: [../setup-library/SKILL.md](../setup-library/SKILL.md)
- Paid-operation approval gates: [../edit-plan/approvals-and-generation.md](../edit-plan/approvals-and-generation.md)
- Registry validation: `node packages/schemas/bin/validate-connections.mjs .akari/connections.json`
  (monorepo only; not bundled with distributed projects).
