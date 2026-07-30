# Security Policy

AKARI Video runs on users' machines, launches AI agent CLIs, executes renders,
and stores generation-provider API keys in each project's
`.akari/connections.json`. Security reports must be handled privately first.

日本語版: [SECURITY.ja.md](SECURITY.ja.md)

## Supported versions

Security fixes are prioritized for the latest public release and the current
`main` branch. Maintainers usually fix forward.

## Reporting a vulnerability

Please do not report security vulnerabilities in public GitHub issues, pull
requests, screenshots, logs, or discussions.

Use **GitHub private vulnerability reporting** (the repository's Security tab).
When reporting, include:

- A short description of the impact
- Affected version or commit SHA, and the file / package / skill involved
- Reproduction steps or a minimal proof of concept against latest `main`
- What data, key, or trust boundary can be affected
- Logs with secrets and personal data removed

## What counts as security-sensitive

Report privately if the issue involves:

- Exposure of `.akari/connections.json` contents or provider API keys — in logs,
  reports, rendered artifacts, error messages, or the update check
- Network reach from render paths — the render contract is deterministic and
  offline; an unexpected network call from a render is both a defect and a
  potential exfiltration channel
- Code execution beyond what the user asked for — launcher, installer, update
  check, lifecycle scripts, or template scaffolding
- **Instruction injection into skills / plugin files** — AKARI Video's skills
  (`SKILL.md`, plugin commands, adapters) are executed by AI agent harnesses.
  Content that could steer an agent into exfiltrating data or running unintended
  commands is a vulnerability here, not a docs problem
- Cross-project data access through the `.akari/` file contracts

## Public issues are OK for

These can usually be public when sanitized: setup failures, build errors, UI
bugs, render output problems, feature requests, and questions about documented
behavior. If you are unsure, report privately.

## Secrets and private data

Never paste these into issues, PRs, commits, screenshots, or logs:

- The contents of `.akari/connections.json`
- Generation-provider API keys or tokens of any kind
- Footage, screenshots, or project files containing private or client data

If a key was exposed, **rotate it first**, then notify maintainers privately.

## Maintainer handling

Maintainers may close, hide, edit, or redirect public issues and PRs that
disclose unpatched vulnerabilities, exploit details, keys, or private data.
Security fixes may be developed privately and published after a safe release.
