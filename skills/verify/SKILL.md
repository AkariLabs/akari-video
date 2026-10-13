---
name: verify
description: "Use to execute the L0 / L1 / L2 verification ladder required by an AKARI Video task contract on the current Theia stack. Read when acceptance criteria specify levels such as L0 or L0+L1, to determine exactly what to run and how at each level."
---

# verify — Verification ladder (L0 / L1 / L2)

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

The mapping referenced by the task-contract template (internal `tasks/_template/task.md`).
**These definitions are inferred from actual recent `report.md` / `task.md` usage, not invented**;
see Sources at the end.

## Mapping

| Level | Definition | Judge | Examples on the current stack |
|---|---|---|---|
| L0 | Static/mechanical verification. Exit codes alone decide pass/fail; no real app launch or human viewing. | Agent alone | Minimum required by nearly every task |
| L1 | Automated real-app observation. Launch Electron, operate via CDP/Playwright, capture screenshots, measure performance. Script-reproducible without subjective human judgment. | Agent alone (scripts) | Nearly all shell tasks of 2026-07-15/16 require L0+L1 |
| L2 | Judgments automation/scripts cannot fully make (subjective visual quality, owner's final check of actual distribution). | Human (owner) | **No examples on the current Theia stack**; see About L2 below |

## L0 — Static and mechanical

On the current Theia stack, use `apps/shell` npm scripts:

```sh
cd apps/shell
PYTHON=/usr/bin/python3 npm ci --no-workspaces   # 初回・依存更新時のみ
npm run build:ext                                 # tsc -b（11 拡張の型検査 + コンパイル）
npm run lint                                       # eslint "extensions/*/src/**/*.{ts,tsx}"
```

- **Use `npm ci`, not `npm install`.** `apps/shell/package-lock.json` has been **tracked** since 2026-08-19
  (previously in `.gitignore`). Verification must not use `npm install`, which rewrites the lock against that day's
  registry and introduces drift. Use `npm install` only for deliberate dependency upgrades, and commit the lock diff.
- **`--no-workspaces`** treats apps/shell as standalone, using `apps/shell/package-lock.json` + `apps/shell/node_modules`.
  Without it, execution shifts to root workspace/root `package-lock.json`, involving `packages/*` and roughly doubling runtime.
- Install postinstall runs **`npm run preflight`** (`scripts/ensure-no-nested-extension-deps.mjs` →
  `scripts/ensure-electron-dist.mjs`). `npm run build` prebuild and `npm start` prestart use the same preflight.
  **No manual Electron extraction or nested `node_modules` cleanup is required**; both pitfalls below are repaired automatically.
- Exit 0 from `build:ext` and `lint` is the minimum L0 pass. CI (`.github/workflows/ci.yml`) then runs apps/shell
  and extension unit tests (`npm run test:shell`) on push/PR, since 2026-09-02.
  Installation uses `npm ci --no-workspaces --ignore-scripts` for the tracked lock.
- **`packages/*`, `scripts/test`, and `skills/*` unit tests are also in CI**, since 2026-09-02.
  Canonical lane definitions: `scripts/ci/run-unit-tests.mjs`.
  `npm run test:unit` (pure, no external tools, required) / `npm run test:quarantine` (already failing on main,
  informational) / `npm run test:media` (requires ffmpeg / Chrome, informational) / `npm run test:lanes`
  (list and reasons for exclusions from CI). Locally, changed-package `npm test` suffices;
  use `npm run test:unit` only to run the same set as CI.
- Individual contracts may require stricter L0 `npm run build` (= `build:ext && theia build --mode production`),
  including frontend/backend/Electron bundles (e.g., `shell-sb-surfaces` / `shell-sc-project` / `shell-sd-partner` /
  `governance-sanitize`). **Not run in CI**; see pitfalls below. Bundler is **esbuild**, not webpack
  (Theia 1.73 default; absent `apps/shell/webpack.config.js` means `theia build` always takes the esbuild route).
- Tasks changing `packages/*` use each package.json's build/test scripts for L0
  (`waveplan-2026-07-15-sbcd-e5.md`, acceptance-gate section).

### Known pitfalls (L0)

1. **npm 11's allow-scripts gate is opened through `allowScripts` in `apps/shell/package.json`**, an allowlist,
   not a denylist. Measured 2026-08-19: after `npm ci --no-workspaces`, exactly **11 dependencies** have
   install scripts (preinstall/install/postinstall + implicit `node-gyp rebuild` from `binding.gyp`), and **all 11
   are listed in `allowScripts`, so they run**. Confirmed Electron postinstall via `npm rebuild electron --foreground-scripts`.
   **The former statement that 11 packages' install scripts are skipped by default was wrong.** Entries use
   `名前@完全一致バージョン` (existing machine format: name@exact-version), so **a single version mismatch silently
   prevents that dependency's install script from running**. Tracked locks prevent drift; update `allowScripts`
   with dependencies. `build:ext` / `lint` need no native modules and pass either way.
   CI L0 suppresses all scripts with `--ignore-scripts`.
2. **Homebrew Python 3.14 and node-gyp**: On macOS, installation without `PYTHON=` can stop when
   `drivelist`'s `node-gyp rebuild` hits Homebrew Python 3.14 `pyexpat` ABI mismatch
   (`Symbol not found: _XML_SetAllocTrackerActivationThreshold`). Always set `PYTHON=/usr/bin/python3` (Apple Python).
3. **Electron postinstall silently exits partway on Node 26** (measured 2026-08-19).
   `node_modules/electron/install.js` extracts zips via extract-zip 2.0.1 → yauzl 2.10 → fd-slicer 1.1.
   **Node v26.3.0 stops this pipe at 1,900,544 B (64KiB × 29 chunks); the event loop empties without `end`
   or `error`, ending with exit 0.** `dist/` contains only `LICENSE` and truncated `LICENSES.chromium.html`;
   no `Electron.app`, `dist/version`, or `path.txt`, yet installation appears successful.
   Node 22.23.1 completes the same zip; standalone zlib/fd-slicer work on Node 26, indicating failure to resume reads
   after backpressure clears. **`scripts/ensure-electron-dist.mjs` preflight detects the incomplete result,
   reextracts with `ditto` / `tar` / `unzip`, and writes `path.txt`.** Former manual `ditto -x -k` extraction
   and `echo <version> > dist/version` workaround are no longer needed.
4. **`apps/shell/package-lock.json` is tracked** (policy changed 2026-08-19; removed from `apps/shell/.gitignore`).
   Former claims that `npm ci` is unavailable or only Node pinning + `--no-workspaces` ensure reproducibility are **invalid**.
   Before tracking, 63 of 1400 packages changed in 1 month (`@babel/*`, acorn, postcss, react, terser,
   webpack 5.108.4→5.109.2, etc.).
5. **Zero grep matches means exit 1**. Add `|| true` when using grep in verification scripts.

## L1 — Real-app observation (Electron via CDP/Playwright)

Nearly all current-stack tasks require L1 as mandatory GUI screenshots (`preview-streaming` / `shell-s4-tabs` /
`preview-open-repair` / `project-diff-repair` / `shell-s12-preview-tab` / `shell-sc-repair` /
`shell-strip-menu-repair`, etc.). Below is the reproducible procedure established by `shell-s4-tabs` report.md §6-2
and `preview-streaming` report.md §2.

**Never judge frames only at boundaries.** Exact beats/cut boundaries hit interval extremes (0% / 100% = off-screen /
opacity 0), causing normal motion to be misdiagnosed. Always capture intermediate 1/4, 1/2, 3/4 times too.
`akari capture --auto` deterministically derives representative times including overlay/caption midpoints.

### Procedure

1. **Build** (requires actual Electron in addition to L0):
   ```sh
   cd apps/shell
   PYTHON=/usr/bin/python3 npm ci --no-workspaces
   npm run build
   ```
   Postinstall/prebuild `npm run preflight` supplies Electron (`node_modules/electron/dist` + `path.txt`),
   fetching via `@electron/get` if no cached zip exists. **Manual `ditto` or `echo <version> > dist/version`
   workarounds are no longer needed**. If necessary, preflight stops with exit 1 and a reason (L0 pitfall 3).
2. **Prepare an isolated workspace**: Copy `templates/project-default/` to a temporary working directory,
   leaving originals unchanged. For tasks needing media, generate actual files there with `ffmpeg` or similar.
   Example: `preview-streaming` generated a 4K / 120-second / 836MB MP4 via `ffmpeg -f lavfi ...` for measurement.
   Completely remove with `rm -rf` after checking; never commit it.
3. **Launch Electron directly**, not `theia start` CLI or Playwright `_electron.launch()` (known argv bug in the latter):
   ```sh
   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
     <apps/shell 絶対パス> <隔離ワークスペース絶対パス> \
     --remote-debugging-port=<port> --user-data-dir=<隔離ディレクトリ> --no-sandbox
   ```
   Pass environment `THEIA_CONFIG_DIR=<隔離ディレクトリ>` (existing isolated-directory placeholder)
   to avoid conflicts with normal development settings.
4. **`npm install` `playwright-core` only in a verification scratch directory**, never in the repository;
   attach with `chromium.connectOverCDP('http://127.0.0.1:<port>')`.
5. **Reach nested webview frames**: Theia `WebviewWidget` nests an outer `webview.localhost` iframe around
   inner `active-frame`. Simple `page.frames()` may not reach actual content. A custom client may need to correlate
   CDP `Page.getFrameTree` with `Runtime.executionContextCreated` `auxData.frameId`, identify the actual inner
   execution context, then read DOM state (`readyState` / `currentTime` / `data-*` attributes) via `Runtime.evaluate`.
   See `preview-streaming` report.md §2.
6. **Observe and record**:
   - Screenshots: CDP `Page.captureScreenshot` or Playwright screenshot API.
   - **Do not commit observation records**, since 2026-10-02. Screenshots, video, audio, logs, measurement JSON,
     etc., belong outside the repository (temporary working directories or task-record storage); reports contain
     summaries/numbers. Only reproduction scripts (`.mjs` / `.cjs` / `.js` / `.sh`) and `README.md` may be committed
     beneath `evidence/<機能名>/` (existing feature-name placeholder). Governance `evidence-growth` rejects new
     records under `evidence/` (images/video/audio/`.txt`/`.log`/`.json`, etc.). Keep already committed evidence unchanged.
   - Performance: Sample `ps -o %cpu -p <pid>` every 1 second, recording GPU/renderer/main separately.
     Measure timing through CDP events/DOM changes before/after operations, e.g., milliseconds to `readyState>=3`.
   - API boundaries: Directly call services through Inversify DI via `window.theia.container` to verify backend
     rejection even when frontend guards are bypassed (defense in depth). See `preview-streaming` report's serving-boundary checks.
7. **Cleanup**: Identify actual launched Electron PIDs with `ps aux` and `kill` those PIDs;
   never use broad matching such as `pkill -f`. Completely delete isolated workspaces/large generated media afterward;
   never commit them.

### Known pitfalls (L1)

0. **Residual `ELECTRON_RUN_AS_NODE=1` immediately crashes Electron** (measured 2026-09-27,
   `library-tile-cards` lane). Electron starts as Node rather than GUI, leaving `app` undefined and failing with:
   ```
   Cannot read properties of undefined (reading 'requestSingleInstanceLock')
   ```
   This occurs if L1 follows packaged-path verification (`ELECTRON_RUN_AS_NODE=1` + `cwd=/`, L0 pitfall 3)
   in the same shell. Always remove it at launch with `env -u ELECTRON_RUN_AS_NODE <electron のパス> …`
   (existing Electron-path placeholder).

1. **Nested extension `node_modules` (the most frequent L1 pitfall)**: A second `@theia/core` inside
   `apps/shell/extensions/<ext>/node_modules/` causes esbuild's realpath-based bundling to include 2
   `frontend-application-config-provider` copies in one `bundle.js`. `src-gen/frontend/index.js` calls `set()`
   on one, while extensions call `get()` on the other, leaving the frontend at its preload spinner with:
   ```
   Failed to start the frontend application.
   Error: The configuration is not set. Did you call FrontendApplicationConfigProvider#set?
   ```
   This dual-package hazard was **reproduced and confirmed on a real app 2026-08-19**: the same tree errors only
   when `extensions/akari-preview/node_modules/@theia/core` exists; deleting it restores launch.
   Cause: standalone extension-directory `npm install` (one run installs 643 packages).
   **Never run `npm install` inside extension directories.** Preflight (postinstall/prebuild/prestart) removes
   accidental nesting, but `bundle.js` needs rebuilding; rerun from `npm run build`.
   A prior case blamed webpack versions (2026-08-18 timeline-z-order-unification handoff §2).
   `theia build` uses esbuild and never calls webpack; launch was measured with webpack 5.109.2 still installed.
   Suspect nested `node_modules` first.
2. **Electron entry point**: Use `lib/backend/electron-main.js` as specified by `package.json`'s `main`.
   Directly specifying `lib/backend/main.js` creates no `BrowserWindow`, leaving `/json/list` empty.
3. **Packaged path resolution**: Bundled `__dirname` differs from development (e.g., `app.asar/lib/backend`).
   Features searching relative paths outside `apps/shell` must be checked against `electron-builder --dir` output
   with `ELECTRON_RUN_AS_NODE=1` + `cwd=/` (see `package-runtime-assets` task.md).
   Checking only development `npm start` is insufficient.

## About L2

**No recent tasks after migration to the current Theia stack** (2026-07-15/16, S-A–S-D, S4/S6/S12,
preview-streaming, preview-open-repair, project-diff-repair, package-runtime-assets, shell-sc-repair,
shell-strip-menu-repair, etc.) **have required L2 as an acceptance criterion**.
All finish within L0 + L1 (mandatory real-app GUI screenshots); automated real-app observation (L1)
is the practical highest level.

L2 was used by verify during the old Tauri era. Examples informing the definition:

- `2026-07-15-preview-band-artifact`: L2 reproduced and verified the fix on a real app, with **the owner's own
  visual confirmation** that the band disappeared as the final gate.
- `2026-07-15-vlog-mvp-edit`: L2 real-app check unperformed. L1 actual export/ffprobe verification was complete,
  but real-app visual verification of preview compositing was separately classified L2 and outside scope.
- `2026-07-15-decision-cards-runtime`: Real Tauri/companion-extension webview visual inspection was outside scope
  (L2 excluded); automated headless Chrome DOM checks (L1 equivalent) were distinct from actual webview experience (L2).
- Private dev-harness contract (2026-07-14) explicitly equates its L3 real-device layer with verify L2;
  L3 means owner field test → handoff record (private wave plan, 2026-07-15, §6).

The shared distinction is **L2 means judgments automation/scripts cannot fully make**, not whether real media is used.
L1 commonly uses real media too, such as `preview-streaming`'s 836MB 4K footage.
Thus define current-stack L2 as follows, explicitly noting this is extrapolation without current-stack examples:

> L2: The owner personally checks real-use scenarios on packaged distribution (`electron-builder` output),
> assessing visual feel/usability and other aspects automation cannot judge, and records the result in handoff.

### Criteria for requiring L2

- Acceptance includes **subjective quality judgments** (e.g., “feels natural”, “looks faithful”), not numerically measurable.
- A needed experience cannot in principle be reproduced by L1 CDP/Playwright observation
  (actual distribution install → launch → operation, real touch/mouse feel, etc.).
- The coordinator/owner explicitly requests a real-device field test.

Otherwise finish current-stack tasks at L0+L1, matching actual practice.

## Which levels to require (task-side criteria)

- **L0 only**: No observable runtime behavior change (documentation, CI configuration, type definitions, etc.).
  This task itself (`ci-and-verify-skill`) is an example.
- **L0+L1**: Default for code changes affecting GUI/runtime, such as `apps/shell/extensions/**` or
  `packages/preview-engine`. Nearly all 2026-07-15/16 shell tasks belong here.
- **L0+L1+L2**: Only when the L2 criteria above apply. No current-stack precedent.

## Sources (basis for inference)

Mapping/procedures are inferred from private internal task records (`akari-video-internal`) report.md/task.md.
Those internal records do not belong in this repository, consistent with
`https://github.com/AkariLabs/akari-video/blob/main/docs/design-2026-07-13-agent-native-architecture.md` §3. Executable verification procedures (commands, observation
subjects, pitfalls) are already provided in L0/L1 above. Below only identifies source tasks, all private:

- preview-streaming (2026-07-16): L1 reproduction, 836MB real media, nested-webview access.
- shell-s4-tabs (2026-07-16): L1 reproduction, dual-package hazard, Electron entry-point pitfalls; procedures in §6-2.
- package-runtime-assets (2026-07-16): Packaged L1 execution.
- Internal task-record README: CI prerequisites for acceptance flow 4-c.
- Internal task template: Source of the verification-level mapping terminology.
- dev-harness contract (2026-07-14), wave plan (2026-07-15) §6: Verification layer table, L0/L1/L2/L3 definitions.
- preview-band-artifact, vlog-mvp-edit, decision-cards-runtime (all 2026-07-15, old Tauri era):
  L2 examples; these alone support the L2 definition because no current-stack examples exist.
