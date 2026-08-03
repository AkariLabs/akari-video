# status / render integrity / acceptance v1 contract

- Date: 2026-08-03
- Status: implementation contract
- Canonical implementation: `packages/akari-launcher/src/status-core/**`
- Compatibility: additive CLI commands; legacy bare `akari` launch behavior is unchanged

## 1. Support matrix

| Surface | fast/full status | capability | SessionStart |
|---|---:|---:|---:|
| monorepo checkout CLI | yes | yes | n/a |
| extracted `akari-video` npm tarball | yes | yes | n/a |
| checkout or copied Claude plugin | yes | explicit `unsupported` when the CLI catalog is unavailable | yes |
| Codex / opencode | use the CLI | use the CLI | Claude SessionStart compatibility is not claimed |

The launcher core is the only editable source. `plugin/runtime/status-core/**` is a generated
byte-identical mirror. Missing generated core is an explicit unsupported state; adapters must not
fall back to a separate stage table.

## 2. Status v1

`akari status [path] [--full] --json` returns stable JSON with a final newline and the fixed root
key order `version, mode, project, workflow_stage, state_health, waiting_on, next_skill, review,
release, problems, warnings`. Paths are project-relative and arrays are deterministically sorted.
Absolute roots, current time, free-space values, and secrets are forbidden.

Fast mode parses and shape-checks current state only. It does not hash or decode media, access the
network, or launch an agent, and it never returns `release.accepted:true`. Full mode re-hashes every
receipt-declared input and output and may return `accepted_verified` only after a valid final human
acceptance event.

Existing authoritative JSON that is malformed, has an unsupported version/status, or contains an
unorderable state event fails closed as `state_inconclusive` with `accepted:false`. Review counts
use `open + addressed = non_resolved`; addressed tickets remain human-review pending.

Executable specifications:

- `packages/akari-launcher/test/status-core.test.mjs`: material/zero-material, malformed/unknown,
  stable output, fast budget and no-I/O boundary.
- `packages/akari-launcher/test/events.test.mjs`: timestamp compatibility, duplicate ids, revoke,
  and same-instant conflict.

## 3. Immutable render receipt v1

After render verification PASS, render-cut writes a new canonical JSON file under
`.akari/reports/render-receipts/<payload-sha256>.json`. It never overwrites an existing different
payload. `inputs[]` comes from the same declared-input enumerator used by render input safety and
contains edit, captions when used, every used source, narration/BGM/SFX, overlay/layer/thumbnail,
path-backed chroma background, resolved LUT, and declared 3D model/environment/texture assets.
When resolved caption overlays are actually rendered, the repository-owned renderer font is also
recorded exactly once as role `caption-font`, path
`akari:assets/font/noto-sans-jp/NotoSansJP-Variable.ttf`, and scope `akari`. Caption-free renders
must not declare this input. Checkout, npm-tarball vendor, and copied-plugin runtime resolvers must
all resolve those bytes or full integrity fails closed; no system-font fallback is accepted.
Undeclared local or network assets in overlay HTML make integrity explicitly unsupported.
An optional narration path that the renderer skips because it is absent is preserved as a scoped
absence sentinel; if that path appears later, full integrity fails closed.

Full acceptance re-hashes all receipt inputs, output, current review and lint, validates the current
render plan SHA, and requires `verify.verdict:"pass"`. Current plan-only state remains
`render_pending` even when an older accepted receipt exists.

Executable specification: `packages/render-cut/test/render-receipt.test.mjs` and
`packages/akari-launcher/test/full-integrity.test.mjs`.

## 4. Acceptance events

Final events are version 1 `final-acceptance` records with a unique id, offset-bearing occurredAt,
`actor.kind:"human"`, `issuer:{kind:"akari-cli-tty",version:1}`, artifact and receipt paths/digests,
review digest, and the human-owned final acceptance statement in `verbatim`. Revocation is version 1
`final-acceptance-revoked` and names the target acceptance id and a non-empty reason. Path escape,
non-regular files, digest mismatch, non-resolved review, stale lint, render failure, duplicate ids,
revocation, and same-instant acceptance/revoke conflict fail closed.

`akari accept <project>` reads identity, a non-empty human final acceptance statement, and the exact
`ACCEPT <artifact-sha256>` checksum confirmation as separate prompts through an interactive real TTY
after full integrity details are displayed. The statement, not the generated checksum confirmation,
is stored in `verbatim`. It has no `--yes`, argument, pipe, or environment shortcut. This is
a cooperative local-operation record, not a cryptographic proof of human identity.

Executable specification: `packages/akari-launcher/test/full-integrity.test.mjs` and
`packages/akari-launcher/test/review-e2e.test.mjs`.

## 5. Capability and absence receipts

The deterministic source set contains tracked `skills/**/*.md`, `docs/contract-*.md`, package
README/package manifests, and every tracked public entry resolved from each manifest's `bin`
targets. A path escaping its package root or a missing/untracked target fails catalog/pack creation.
The manifest of source paths, byte sizes, and SHA-256 values produces `source_set_sha256`.

`akari capability <query> --json` returns stable ranked text matches. Only an explicit zero-hit
`--record-miss` writes under `.akari/reports/absence/`, with verdict
`NO_TEXT_MATCH_REQUIRES_REVIEW` and `approved_to_build:false`.

Executable specification: `packages/akari-launcher/test/capability.test.mjs`,
`packages/akari-launcher/test/capability-distribution.test.mjs`, and
`packages/akari-launcher/test/status-distribution.test.mjs`.
