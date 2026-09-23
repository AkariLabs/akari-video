# Verification

- GPU export package: `npm test` — 465 tests, 465 passed, 0 failed (round 2).
- OSR export package: `npm test` — 213 tests, 213 passed, 0 failed (round 2). The evidence-only PNG assertion was removed; structural blend and warning-path tests remain.
- Render-cut affected tests (`rasterize` and export-sheet parity): 13 tests, 13 passed, 0 failed (round 2).
- Overlay-runtime live video-texture browser test: 1 test, 1 passed, 0 failed (round 2).
- `git diff --check`: passed.
- OSR tier-2 browser captures: depth, blend, pseudo-element, video texture, and oversized plane fixtures produced stamp-matched PNGs; detailed results are in neighboring files.
- Shell `npm run build`: passed. The rebuilt shell was launched with CDP port 9479 and an isolated user profile, then stopped by its own PID. Stage screenshots at the requested times are in `preview-blend-r2.md`, `preview-video-r2.md`, and `preview-entrance-r2.md`.

The full render-cut package test did not reach a green result. During an unrelated audio-master media test, its OSR Electron child remained alive for over 20 minutes after output and run files appeared. Stopping that exact child PID made the test fail; the suite was then stopped. The full overlay-runtime package test failed browser readiness timeouts under the concurrent machine load. A serial retry still timed out in an unrelated browser interaction test; it was stopped. These full-suite gates remain unverified. No source outside the owned boundary was changed to work around them.

No frame-engine source changed, so no generated frame-engine bundle was rebuilt. The round-2 forced GPU capture is a real tier-2 BEFORE route but did not reproduce the reported frozen frame: the three PNGs differed. Shell preview screenshots now cover blend, item-local video time, and entrance boundary. Blend preview parity remains false because the shell HTML overlay path applies normal composition for all three values; the shell source is outside this task's ownership boundary.

The OSR test package has mocked launcher/API capture tests but no existing browser/Electron pixel harness. The evidence-PNG-reading unit test was removed; real pixel measurements remain in `blend-results.md` and the structural test covers all ten mode mappings plus the unknown-mode warning.

Round 3: eligibility now preserves the existing reason for fixtures that were already degraded; the GPU baseline tests were restored for those reasons. `npm test` passed again for GPU (465/465) and OSR (213/213). The test diff removes no preexisting degraded reason expectation.
