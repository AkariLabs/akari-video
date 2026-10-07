# `source.elements` parity evidence

Build edit-store (`npm run build -w @akari-video/edit-store`) before running these scripts.
`node run.mjs --checks-only` runs the Node-only contract checks: malformed address rejection by
`readEditV2` and JSON Schema, unresolved-address warnings, unchanged legacy records, and fragment
SHA-256 equality. The scripts create isolated projects and HTML fragments under ignored `results/fixtures/`.
No source fragment is edited after creation.

After building the repository, run `node run.mjs --electron /absolute/path/to/Electron` for Web,
GPU and OSR captures. `--surface web|gpu|osr` and `--case <name>` select subsets. GPU and OSR
use a tier 2 Electron launcher with `AKARI_EXPORT_ALLOW_DESKTOP=0`. The surface's launcher tier
comes from `receipt.launcherTier`; a value other than 2 fails that capture. GPU eligibility is evaluated after `loadOverlays`, as in render-cut. A
degraded overlay with no unsupported condition is captured with `force: true`, and the surface entry
records its classification, reason and forced status. The checks compare eligibility for every
overridden fixture and its baseline. The cases are `bars-base`, `bars`, `card-base`, `card`,
`bag-base`, `bag`, `bag-child`, `bag-lazy`, `paths-base`, `paths`, `missing`, and `legacy`.
Every surface captures frame 15 at 640 × 360.
`AKARI_CHROME_EXECUTABLE` selects a Chrome executable for Web preview.

Run `node run-shell.mjs` with the built shell and tier 2 Electron available. It launches each
fixture in a disposable workspace, opens the production output preview, measures
`getBoundingClientRect()` through CDP and checks fragment hashes. The shell screenshot comes
from the top-level page and is diagnostic only. Shell acceptance compares every DOM rectangle
with the Web measurement within 1 px, plus the shell's own geometry checks. Boxes that are 0 × 0
on both surfaces skip position comparison and record `skippedUnrendered`. `ELECTRON_BIN`,
`AKARI_CDP_PORT` (default 9861) and `AKARI_SHELL_CASE_TIMEOUT_MS` (default 180000) configure
the runner. `--case <name>` selects one fixture. Its output is `results/shell-results.json`.

Run `node merge-results.mjs` after split captures. It chooses the newest result for each
fixture/surface, including failures, recomputes one-pixel colored bounds comparisons and PNG
diffs for Web/GPU/OSR and DOM parity for shell, and requires all four surfaces, tier 2 export receipts,
and the Node checks. All images,
logs, and JSON receipts stay under ignored `results/`.
