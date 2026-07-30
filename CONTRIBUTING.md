# Contributing Guide

Thanks for your interest in contributing to AKARI Video.
Please use [GitHub issues](https://github.com/AkariLabs/akari-video/issues) for bug
reports and feature requests, and Pull Requests for code changes.

日本語版: [CONTRIBUTING.ja.md](CONTRIBUTING.ja.md) — 日本語での issue / PR も歓迎です。

## Repository model

AKARI Video is maintained in two layers:

- **This public OSS repository** — the product itself: code, skills, schemas, docs,
  and the public intake for issues and pull requests.
- **A private maintainer repository** — product operations: strategy, field testing,
  and the screening / verification infrastructure.

External PRs are screened and reviewed here. Maintainers may narrow, adapt, or
partially adopt a change before it lands. **A PR can be a valuable contribution
even when it is not merged as-is.**

## PR basics

- One clear problem per PR. Split large changes into stacked PRs and state the
  merge order in the PR description
- Commit messages follow this repo's convention: Japanese body + a prefix
  (`[機能追加]` `[修正]` `[ドキュメント]` etc.)
- `node --test` must pass in each touched package. State exactly what you ran —
  and what you could not run — in the PR description
- An `accepted` label on an issue means the direction is reasonable. It is not a
  delivery promise
- Stale, conflicting, too-broad, or unsafe PRs may be closed. A smaller PR against
  current `main` is much more likely to land — please don't take a scope-close
  personally

## Acceptance screening for external PRs

External PRs go through **automated screening plus maintainer review** before merge.
The patterns below are flagged automatically. **A flag is not a rejection** —
maintainers adjudicate false positives — but if your change matches one,
**declaring it in the PR template's Security impact section** speeds up review
considerably.

| Pattern | Handling |
|---|---|
| `curl … \| sh` one-liners (detected **even inside display strings / user guidance text**) | Prefer linking to the official install page; if needed, state why |
| URLs to new external domains in code | Each domain needs maintainer sign-off; state the purpose in the PR description |
| Adding or changing dependencies | Registry sources only (no `git:` / `http:` / `file:`); justify additions |
| Adding lifecycle scripts (`postinstall` etc.) to `package.json` | Not accepted without prior discussion |
| Reading secrets or sensitive paths (`.env`, `~/.ssh`, bulk `process.env` enumeration) | Not accepted |
| Obfuscation: `eval` / `new Function` / base64 or hex blobs | Not accepted |
| New `child_process` usage | Reviewed case by case (a common idiom in this repo's tests and CLI — fine when the purpose is clear) |
| Changes under `.github/` or CI config | Keep out of feature PRs; open an issue first |

## High-risk areas

Changes touching these areas need a focused test plan, and maintainers may choose
to reimplement them through the private repository before they land:

- **The render pipeline and anything it touches** — render paths are deterministic
  and offline by contract. Any network reach (including CDN fonts and remote image
  references) is treated as a defect in itself
- **Launcher, installer, and update check** — process-execution surfaces
- **`.github/`, CI, and release workflows**
- **File contracts and schemas** — `edit.json`, `meta.json`, and anything that
  handles `.akari/connections.json`
- **Skill and plugin instruction files** — these are executed by AI agent
  harnesses; see [SECURITY.md](SECURITY.md)

## Security

See [SECURITY.md](SECURITY.md). Never include the contents of
`.akari/connections.json`, provider API keys, or footage / screenshots containing
private data in issues or PRs. Report vulnerabilities via the repository's
Security tab (private vulnerability reporting), not public issues.
