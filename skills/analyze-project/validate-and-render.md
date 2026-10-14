# Validate and generate the report

## 1. Validate interpretation.json

Write to `interpretation.json.tmp`, validate, and atomically replace `interpretation.json` only with a PASS result.

```sh
node packages/schemas/bin/validate-interpretation.mjs <interpretation.json のパス>
```

Confirm exit code 0 and `OK: ...` output. The CLI also checks semantic constraints not expressible by schema alone:
1:1 `assets[].ref` / `inputs.analyses[].ref`, dangling `arc[].refs[].asset`/`relations[].target` references,
`section`'s `end > start`, paired `flag` start/end, and consistency of `open_questions[].status` with `answer`.
On failure, fix the cause and revalidate; never silently relax constraints.

## 2. Generate the report

```sh
node packages/analysis-report/render-analysis-report.mjs \
  --analysis <ref1>=<analysis1.json のパス> \
  --analysis <ref2>=<analysis2.json のパス> \
  --interpretation <interpretation.json のパス> \
  --out <report.html の出力先>
```

- **Always pass `--analysis` explicitly as `<ref>=<path>`**, with `ref` matching the
  `interpretation.assets[].ref` established in `collect.md`. Although the CLI accepts bare paths, that degraded
  route relies on unique string matching against `inputs.analyses[].path` and increases misassociation risk
  in multi-asset projects. The positional-mapping convention before the 2026-07-22 revision demonstrably caused
  silent data corruption. **analyze-project always uses explicit `ref=path`.**
- Supply exactly 1 corresponding `--analysis` for every `ref` in `interpretation.assets[]`.
  The renderer hard-errors on 1:1 mismatch with `inputs.analyses[].ref` or failed path cross-checks;
  it writes nothing on failure.
- `interpretation.json` must already have passed step 1. The renderer also calls `validate-interpretation.mjs`
  internally; do not omit step 1 despite double validation.

## 3. Open

Generated HTML separates template/data and is self-contained (no external CSS/font/script/remote-image references),
so it can be opened directly in a browser.

```sh
open <report.html の出力先>
```

If `open` is unavailable, show the file path and ask the human to open it in a browser.

## 4. Read the report (checks)

- Every card/row is labeled fact / interpretation (visualizing thesis 2). Interpretation evidence
  `relations[].evidence`/`flags[].evidence` can be opened through the evidence control.
- Sections are limited to facts + readings of assets + objective relations + interview ledger + provenance.
  **The proposed arc is not displayed**, though it exists in interpretation.json
  ([interpretation.md](interpretation.md#arc-is-internal-data-hidden-from-reports)).
- Verify there is no decision UI (choices, knobs, finalize buttons). Its presence is a template regression.
- With 0 `open_questions`, a no-interview-items empty-state message appears; verify the page is not blank
  in a way that misleadingly suggests analysis has not been done.

## Common mistakes

- Passing multiple bare-path `--analysis` arguments and relying on unique matching (use explicit `ref=path`).
- Treating an unvalidated `.tmp` as final.
- Manually editing HTML to reconcile a renderer rejection.
- Omitting `arc` from `interpretation.json` because it is not displayed.
  Schema requires `arc`; hiding `arc` is intentional, omitting data is forbidden.
