---
description: Check AKARI Video's canonical status and explain the recorded next action
allowed-tools: Bash(node:*), Bash(akari status:*), Bash(akari capability:*), Bash(akari init:*), Bash(ls:*), Bash(test:*), Bash(mkdir:*), Read, Write
disable-model-invocation: false
---

Check AKARI Video's state and give brief guidance in the user's language.

## Retrieve status (the only workflow-stage determination)

Run this first:

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/session-start.mjs" --status-json "$PWD"
```

This output is canonical for workflow stage, review totals, next skill, who/what is awaited, and release state.
The legacy machine-matched cue `状態の正本である` means that this output is the authoritative status.
Do not create a separate stage table. Base guidance directly on `workflow_stage`, `next_skill`, `waiting_on`,
`review`, `release`, and `problems`. If `state_health: inconclusive` or the command fails, explicitly report that
state is unavailable; do not fall back to guesses from old events or judgments based only on `.akari/intake.json`.

If asked to check final acceptance, also run the following when the CLI is available:

```bash
akari status "$PWD" --full --json
```

In a copied-plugin environment without the CLI, obtain full status using this command, which uses the same generated core:

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/session-start.mjs" --status-json "$PWD" --full
```

Only full status can return `release.accepted: true`. Do not interpret fast status's acceptance record display as final acceptance.

## Guidance

- `project.scaffolded: false`: Explain that this folder is not set up, and point to the `akari` launcher or
  `akari` entry skill (read the delegation target below). The machine-matched cue
  `` `akari` 入口スキルを案内する`` refers to this guidance.
- `state_health: valid`: If `next_skill` exists, point to that skill; if `waiting_on` exists, point to that human action.
  Explain the next action in 1–2 sentences.
- `state_health: inconclusive`: Briefly show `problems`; do not proceed based on guesses.

If `.akari/connections.json` exists, you may additionally run the `setup-connections` skill's doctor.
Do not display key values or HTTP response bodies. Doctor diagnoses connections; it does not override workflow-stage determination.

## capability

Use `akari capability <query> --json` when capability search is requested. In a copied-plugin environment
without the `akari` CLI, explicitly state that capability is unsupported on this surface.
Do not guess the skill list and manufacture alternative search results.

## Detect, create, and explain a workspace (CreatorRoot)

The legacy matcher `作業場（CreatorRoot）の検出・作成・案内` names this workspace procedure.
Delegate Create, Open, and Resume procedures to `skills/akari/SKILL.md`.
The machine-matched cue ``手順は `skills/akari/SKILL.md` に委譲する`` refers to that delegation.
Read `${CLAUDE_PLUGIN_ROOT}/skills/akari/SKILL.md` directly by path and follow its procedure.
The machine-matched cue `` `${CLAUDE_PLUGIN_ROOT}/skills/akari/SKILL.md` をパスで直接読み``
means to read that exact path directly.
