# AFTER observations

All paths and fixtures are repository relative or neutral. No reported PV content is present.

| Item | Observation |
| --- | --- |
| C-1 | The same synthetic desktop bundle with the changed edit-lint CLI returned exit 0, `verdict: pass`, and empty stderr for `--engine osr --json`. `packages/edit-lint/src/engine-capabilities.json` is byte-identical to the source table and covered by the desktop `src/**/*` filter. A missing table now names the omitted bundle paths. Focused bundle tests: 2 pass. |
| C-2 | The same neutral `review/edit.json` returned exit 0, wrote project-root `.akari/lint.json`, and did not create `review/.akari/lint.json`. Capture now normalizes `--edit` to the same nearest project ancestor, falling back to the edit file's directory when none exists. Both help texts state the rule. |
| B-6 | The adjacent two-BGM fixture still reports `v2.audio-bgm-multiple`, now naming `music-1 [0, 30)`, `music-2 [30, 60)`, no overlap, and the one-file workaround. An overlapping fixture names its shared frame range. In `edit-store/src/internal-model.ts`, each BGM assignment overwrites the single `audioBgm` value; `render-cut/src/plan.mjs` builds one `audio.bgm` label and one ducking envelope. Both inputs remain errors. |
| B-11 | The neutral data URI with a parenthesized token still yields a false `foo.png` reference. The scanner's owner file is outside the permitted boundary. |
| C-3 | The three zip callers now share `extractZipWithTools`. Injected Windows `tar.exe` success with `unzip` unavailable passed; all-tools-missing produced an actionable error. Focused tests: 2 pass. Sounds package tests: 102 pass, 2 platform skips. |
| C-4 | Mocked `akari assets fetch akari-sounds-sfx` and `akari-sounds-jingle` each reach the first-party fetcher with the matching `--pack` and exit 0. A neutral catalog pack with two member ids invokes two individual fetches, both exit 0. Live network retrieval was not attempted. The previous mismatch was the resolver's `catalog.items[].id` lookup versus pack references shown by the catalog. |
| C-5 | Bare non-TTY `akari` returned exit 0 with zero agent launches and the root filename list unchanged. An uninitialized folder also stayed empty. A real doctor invocation returned exit 0 and wrote `.akari/reports/connections-report.html`, leaving root filenames unchanged. |
| C-6 | A neutral v2 narration without `provenance` remains PASS. If `provenance` exists but lacks `provider`, the existing execution error now appends required-field guidance and voicevox/fal/human examples. The generation skill shows the same examples. |

The requested Electron observation was excluded by the task's explicit no-Electron constraint. Headless CLI/package tests are recorded above.

R2 verification: edit-lint 336/336 pass; asset-resolver 150/150 pass; audio-library-setup 102 pass / 2 platform skips; capture-related akari-tools tests 11/11 pass; restored audio-level fixture tests 9/9 pass; manage-connections 20/20 pass. Akari-launcher: 437 tests / 419 pass / 18 fail. Failures come from HEAD tests/fixtures: stale assets help, kit CLI version and update CLI version assertions, library migration state, and the restored integrity fixture's legacy `start` audio fields (the latter causes the full-integrity subtests and status-distribution test to fail before the changed path runs). `npm run test:unit` was not repeated in r2.
