# Inspector multi-generate L1

Developer verification fixture for the multiple-selection generation panel. Run after building the Electron bundles using the existing dependencies (no installation):

```sh
cd apps/shell
npm run build
node extensions/akari-annotations/evidence/inspector-multi-generate/scripts/l1-inspector-multi-generate.mjs
```

Optional: `--port=22223`, `FFMPEG=/absolute/path/to/ffmpeg`, `AKARI_CDP_TIMEOUT_MS=10000`. Requires a GUI session and a Node runtime with global WebSocket. The script launches the actual Electron application and uses loopback CDP only. All generation runs use the local fake CLI; no provider or paid API is called.

The project, AKARI_HOME, THEIA_CONFIG_DIR and Electron user-data directory are created under `os.tmpdir()` and removed after Electron exits. The source fixture and existing `evidence/inspector-generation/` are read-only.

The script creates two planned video clips, one still and two captions. It clicks a clip and Shift-clicks twice in reverse order, checks three inspector rows and the two-clip total, captures the cost dialog, approves once, and checks two sequential fake CLI completions in timeline order. Caption-only multi-selection must still display the original caption panel.

Outputs in this directory:

- `01-multi-selection.png`, `02-cost-approval.png`, `03-generating.png`, `04-completed.png`, `05-multi-captions.png` (and `99-failure.png` on failure).
- `results.json`: assertions, row/name/text/badge rectangles, button computed backgrounds and borders, append-only CLI start/end events, non-overlap check, elapsed time and cleanup.
- `electron.log`: sanitized process output.

Row rectangles must not intersect; name/duration and badge rectangles and their text must not intersect. Buttons must have a painted background or visible border. CLI events must be start A, end A, start B, end B; end A must precede start B. Screenshots still require visual review by the wrapper/reviewer.

For sandboxed editing, syntax-check only (L1 execution and visual review are deferred to the wrapper):

```sh
node --check scripts/cdp-lib.mjs
node --check scripts/gen-fixture.mjs
node --check scripts/fake-generate.mjs
node --check scripts/l1-inspector-multi-generate.mjs
```
