# Contributing Guide

Thanks for your interest in contributing to AKARI Video.
Please use [GitHub issues](https://github.com/AkariLabs/akari-video/issues) for bug
reports and feature requests, and Pull Requests for code changes.

日本語版: [CONTRIBUTING.ja.md](CONTRIBUTING.ja.md)

## PR basics

- Split large changes into stacked PRs and state the merge order in the PR description
- Commit messages follow this repo's convention: Japanese body + a prefix
  (`[機能追加]` `[修正]` `[ドキュメント]` etc.)
- `node --test` must pass in each touched package

## Acceptance screening for external PRs

External PRs go through **automated screening plus maintainer review** before merge.
The patterns below are flagged automatically. **A flag is not a rejection** —
maintainers adjudicate false positives — but if your change matches one,
**explaining why in the PR description** speeds up review considerably.

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

### AKARI Video-specific rule

- **Render paths are deterministic and offline** by contract. Any network reach in
  code a render touches (including CDN fonts and remote image references) is treated
  as a defect in itself.

## Security

Please report vulnerabilities via the repository's Security tab (private vulnerability
reporting), not public issues.
