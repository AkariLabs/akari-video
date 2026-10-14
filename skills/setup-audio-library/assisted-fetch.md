# Assisted acquisition (only on user instruction)

The library defaults to the workspace's `library/`. Without a workspace, use the legacy `~/.akari/assets/`.
Check the first line of `akari-assets list` (or `akari assets list`) for the actual location.
Below, `<ライブラリの置き場>` is the existing library-location placeholder; audio belongs in its `audio/` subdirectory.

## 1. When to run

- When the user explicitly asks for acquisition, such as “Download it” or “Acquire it”.
- Do not switch from the default flow (candidate generation → user saves manually → drop-folder scan) without
  instruction. Conversely, **reverting to “Please do it manually” despite an instruction is also wrong**.
  The user decides whether to acquire; do not preemptively declare or enumerate per-source feasibility.

## 2. Procedure

1. Establish targets: cards in the candidate file at `audioCandidatesPath` (`akari assets catalog --json`) or user-specified distribution-page URLs.
2. Open the page and target only file URLs actually read there (never construct guessed URLs).
3. Acquire serially. Sleep 3–5 seconds between requests; retry failures at most 1 time.
   No bulk or parallel acquisition.
4. Save in `<ライブラリの置き場>/audio/_staging/<site>/<id>/` (existing library-location placeholder).
   Write provenance `.meta.json` alongside it: source-page URL, acquisition time, license, credit requirement,
   and what could actually be verified.
5. Report unsuccessful sources with facts (403, access restriction, unresolved URL, etc.); link the download page
   and switch to manual acquisition.
6. After all targets finish, join [gallery.md](gallery.md)'s listening flow and discard everything except keep selections.

## 3. Report format

- N successes / M acquisition failures (breakdown and reasons by source)
- Staging path
- If sources requiring credit are included, attach `credit_template` wording unchanged

## Common mistakes

- Switching to acquisition without instruction (default remains candidate list + manual drop).
- Recording judgments such as “prohibited site” for failed sources in documents/catalogs.
  Report only execution-time facts; do not make a static feasibility list.
- Treating `_staging/` as a permanent library. Register keep selections in `<ライブラリの置き場>/audio/<id>/`
  (existing library-location placeholder) + catalog metadata; join drop-folder.md's registration procedure.
