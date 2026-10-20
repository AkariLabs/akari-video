# Collect assets

## Principle

Separate per-asset fact extraction (pass 1) from cross-asset interpretation (pass 2). Pass 1 remains
[analyze-footage](../analyze-footage/SKILL.md)'s responsibility. This skill only checks completeness and fills missing results.
Do not analyze the same asset 2 times.

## 1. List project assets

List assets in the specified project directory; if none is specified, list video/still-image/audio files beneath
`assets/` and directly in the project root. If the listing scope is unclear, confirm target paths with the user first
(this confirms work inputs rather than asking for a decision).

## 2. Check existing analysis for each asset

Use the same search order as [plan-edit/workflow.md §2](../plan-edit/workflow.md#2-branch-by-media-availability) (English section anchor):

1. User-specified `analysis.json`
2. `<source-dir>/analysis/<source-stem>/analysis.json`
3. `<source-dir>/analysis/analysis.json` only if the directory is confirmed to be dedicated to that asset

Verify that `source` points to the target asset before reuse. If it may have changed, reanalyze or show the difference
to the human; do not guess freshness.

## 3. Run analyze-footage only for missing assets

For assets without valid analysis, invoke [analyze-footage](../analyze-footage/SKILL.md), 1 asset = 1 execution.
For multiple assets, assign in parallel and wait for all. Give each request the absolute source path, repository root,
and analyze-footage SKILL.md; do not allow edits to other assets or this skill's artifacts.

## 4. Build an asset reference table

Map each project-unique `ref` (e.g., filename stem or project-specific name) to its corresponding analysis.json
absolute or relative path. Use this table directly as `interpretation.json`'s `inputs.analyses[]` (`ref` / `path` / `source`)
and as the `ref` in [validate-and-render.md](validate-and-render.md)'s renderer invocation (`--analysis <ref>=<path>`).

Choose `ref` 1 time, then keep `ref` consistent throughout pass 2, report generation, and interviewing:
`assets[].ref` / `arc[].refs[].asset` / `relations[].target` all refer to it; changing it breaks foreign keys.

## Common mistakes

- Re-running analyze-footage on analyzed assets (do not rerun pass 1).
- Combining multiple assets into 1 analyze-footage execution (loses per-asset evidence boundaries).
- Using the file path itself as `ref`, making references break when relative-path bases change.
  Use a stable, location-independent ID for `ref`.
- Resolving paths relative to `analysis.json` (`source` or `keyframes[].path`) as if relative to the project root.
