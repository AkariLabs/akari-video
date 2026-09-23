# Rotate then scale: L1 evidence

This directory reuses the P3b-1 `transform-anisotropic-scale-v1` fixture format, capture runner, PNG comparison, and shell CDP runner. The copied fixtures add `rotate: 30` to the uniform parent of `group-leaf` and add `uniform-rotated` as a control. `rotated`, `group-leaf`, and `uniform-rotated` carry four zero-size corner markers, allowing measured corner angles rather than an inference from a bounding box.

Run `node run-l1.mjs` here for shell, Web, gpu, and osr attempts, five frames each, then the comparison merge. `AKARI_L1_ELECTRON=/absolute/path/to/Electron` selects a tier-2 exporter launcher. Run `node run-l1.mjs --quick` to repeat the browser-only measurement without network listeners or Electron. Results are in `results/summary.json` and the per-surface JSON files. A missing or blocked surface is never counted as passing.

`runtime-dom.mjs` runs the classic shell runtime and production render-cut sheet in headless Chrome. It measures bounds at frames 0, 15, 30, 45, and 59 for seven fixtures; measures all four corners for the three rotated fixtures; asserts right angles within 0.5°; compares pixel-identical old/new CSS ordering for the uniform rotated control; and checks the legacy fixture against P3b-1's PNG captures. It is a browser runtime check, not an Electron shell or GPU/OSR capture.

The reused `run.mjs` uses the production Web preview and GPU/OSR export APIs; `run-shell.mjs` uses a disposable shell workspace and CDP. Those paths require localhost listen permission and a working Electron launcher. A blocked result records the error instead of claiming parity.
