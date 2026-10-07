# Daihon row button focus verification

Run from the repository root. The scripts use `AKARI_TASK_TMP` for isolated homes and fixtures and write results outside the repository. Set `AKARI_TASK_TMP`, `AKARI_L0_EVIDENCE_DIR`, and `AKARI_L1_EVIDENCE_DIR` to directories reserved for this run. Set `CHROME_BIN` if browser tests need a browser executable.

```sh
npm ci --ignore-scripts
npm install --workspace=apps/shell --ignore-scripts
node node_modules/electron/install.js
npm run build:ext --workspace=apps/shell
node evidence/daihon-row-button-keep-focus/build-l1.mjs
node evidence/daihon-row-button-keep-focus/run-l0.mjs
node evidence/daihon-row-button-keep-focus/run-l1.mjs
```

`run-l0.mjs` runs each transcript test file in a separate process with four workers and a five minute limit per file. Set `AKARI_TEST_ROOT` and `AKARI_L0_LABEL` to compare another checkout. `run-l1.mjs` launches its own Electron process, connects through CDP, records focus, playback ticks and scroll position, and terminates that process tree. Use `AKARI_L1_CDP_PORT` to choose a free CDP port.
