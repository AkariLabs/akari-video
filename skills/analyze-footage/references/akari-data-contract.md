# `.akari` data contract v1

`workflow.json` declares canonical role paths, localized labels, normal-mode hidden entries, sidecar suffixes,
and gate event types. Asset metadata lives at `sidecars/<asset-relative-path>.meta.json`; for example,
`assets/interview.mp4` uses `sidecars/assets/interview.mp4.meta.json`.
Full per-asset analysis output lives at `sidecars/<asset-relative-path>.analysis/analysis.json`; for example,
`assets/interview.mp4` uses `sidecars/assets/interview.mp4.analysis/analysis.json`.

An asset meta object has `version: 1`, `asset` (project-relative string), optional `thumbnail` (path or URI),
optional non-negative `durationSeconds`, optional positive integer `width` and `height`, optional
`transcript` (`available` boolean and optional `path`), optional `analysis` (`status` and `summary` strings),
and optional inline `decisions` (`id`, `summary`, `status`). Missing inspection fields mean "未分析".

An optional `<asset>.decisions.json` has `version: 1`, `asset`, and a `decisions` array. Each decision contains
`id`, `summary`, `status` (`proposed`, `approved`, or `rejected`), and ISO-8601 `updatedAt`.

Each immutable event has `version: 1`, unique `id`, `type`, and ISO-8601 `occurredAt`. Gate event types are
declared by `workflow.json`; other event types such as `video-added` do not create a workflow snapshot.
