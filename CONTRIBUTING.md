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

## Development flow

1. Branch from the latest `main` and keep the change small.
2. Install from the repository root (`npm install`; do not add `--ignore-scripts`,
   because `packages/media-bin` downloads ffmpeg in its `postinstall`). For the
   desktop shell, run `npm install --no-workspaces` inside `apps/shell` — see the
   [Windows build guide](docs/dev/windows-build.md) (Japanese).
   The repo is pinned to Node 26.3.0 in CI.
3. Run the checks that match what you touched (below), then open a PR using the template.

### Checks

| Command | What it checks |
|---|---|
| `npm run lint:i18n` | UI catalogs have the same keys in `ja` and `en`, placeholders match, static `t('key')` references exist, and no new hard-coded Japanese UI text was added |
| `npm run check:docs-sync` | Skill counts written in docs match `skills/`, and every `docs/contract-*.md` is linked from both `docs/README.md` and `docs/README.ja.md` |
| `npm run check:skills-index` | The skill index in `AGENTS.md` is up to date (regenerate with `npm run gen:skills-index`) |
| `npm run check:entry-skill` | The entry skill's description stays generic (it must not name specific production stages) |
| `npm run check:cross-package-imports` | Imports between packages stay within what the packaged build ships |
| `npm run check:status-core` / `check:generation-models` / `check:cut-candidates` | Generated files match their generators (regenerate with the matching `gen:*` script) |

Unit tests are split into lanes. `npm run test:lanes` lists which package is in which lane.

| Lane | Command | Notes |
|---|---|---|
| pure | `npm run test:unit` | No external tools, deterministic. Required in CI |
| shell | `npm run test:shell` | The desktop shell and its extensions. Required in CI |
| media | `npm run test:media` | Needs ffmpeg / ffprobe / Chrome. Informational in CI |
| quarantine | `npm run test:quarantine` | Already red on `main`, waiting for a fix. Informational |

For a single package, `node --test` inside it also works.

### UI text and i18n

Text shown in the app lives in `packages/i18n/locales/<ja|en>/<namespace>.json`, and code uses only the
key: `t('settings.appearance.language.auto')`. Add every key to both languages, keep the key stable when
the wording changes, and do not add hard-coded Japanese UI strings. Run `npm run lint:i18n` after editing
(`npm run gen:i18n-catalog` regenerates the catalog). The full rules are in
[`docs/contract-2026-10-11-ui-i18n.md`](docs/contract-2026-10-11-ui-i18n.md). Use the on-screen words from
[`docs/contract-2026-10-16-vocabulary-v0.md`](docs/contract-2026-10-16-vocabulary-v0.md) (asset, style,
template, showcase, playbook) in UI text and docs; internal names such as `kind`, file names, and CLI flags stay as they are.

### Docs

User-facing docs are written in English at the canonical path with a Japanese copy next to it
(`<name>.ja.md`). Change both in the same commit. A new `docs/contract-*.md` needs entries in both
`docs/README.md` and `docs/README.ja.md`.

## PR basics

- One clear problem per PR. Split large changes into stacked PRs and state the
  merge order in the PR description
- Commit messages follow this repo's convention: Japanese body + a prefix such as
  `[機能]` `[改善]` `[修正]` `[ドキュメント]` (merge and release commits use `[合流]` `[リリース]`)
- The checks above and the tests for each touched package must pass. State exactly what you ran —
  and what you could not run — in the PR description
- An `accepted` label on an issue means the direction is reasonable. It is not a
  delivery promise
- Stale, conflicting, too-broad, or unsafe PRs may be closed. A smaller PR against
  current `main` is much more likely to land — please don't take a scope-close
  personally

## PR salvage & co-authorship

To cut down review round-trips, maintainers may **salvage** a PR — instead of
sending it back for another round, we take over the branch, finish the remaining
work, and carry it to merge. Your credit is always preserved:

- Your commits are kept as-is (or cherry-picked) wherever possible, so your
  authorship stays in git history
- Where maintainers rewrite or squash your work, you are credited with a
  `Co-authored-by:` trailer; salvage PRs carry `(salvage of #N)` in the title to
  reference the original
- When similar fixes for the same problem arrive from multiple people, they may
  be consolidated into one commit **crediting everyone as co-authors**
- **Credit goes to humans.** Even if you build your PR with an AI agent, we
  recommend the commit author be you (the human contributor), not the tool —
  please set your git author identity to yourself

Keeping **"Allow edits by maintainers"** enabled on your PR lets your PR itself
be merged and makes salvage much faster. If you would rather finish the PR
yourself, say so in the PR description — we will send regular review feedback
instead.

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
