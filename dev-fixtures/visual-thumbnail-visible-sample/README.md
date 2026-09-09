# Visual thumbnail visible sample

The Electron capture host compares the original midpoint capture with the visible-sample fallback: exits at 2s, 3.3s and 5s on 10s/12s items, unchanged lower-third pixels, and a fully transparent item. It records capture counts (at most four per request) and checks that each request uses one window.

From the repository root, after `npm run build:ext` in `apps/shell`:

```sh
node dev-fixtures/visual-thumbnail-visible-sample/run-l1.mjs
```

Use `--check` to validate module loading, assets and generated pages in Node without launching Electron. The full command also runs this check first. Electron uses a temporary `AKARI_HOME`; initialization errors exit immediately. Evidence goes to `evidence/2026-09-09-visual-thumbnail-visible-sample/`. Screenshots show the capture host, not the timeline widget.

The Electron entry finishes module evaluation before waiting for `ready`. Child output is redacted and forwarded line by line; a 300-second timeout terminates a stuck child with an explicit diagnostic. The `visual-thumbnail-l1-startup.test.mjs` unit test checks the actual ESM entry against a simulated Electron ready barrier without requiring Electron to launch.
