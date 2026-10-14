# Browse the catalog and propose a starter pack

## 1. Inspect the bundled catalog

Run `akari assets catalog --json` for the catalog location and counts. If it exits 1, report that the bundled catalog was not found; do not infer paths or invent inventory. Run `akari assets list --source site --json` for external entries, adding `--category <c>` or `--query <s>` when useful. For each candidate, run `akari assets show <category/id> --json` and read `meta.source.url`, `meta.source.acquisition`, `meta.source.license_at_source`, `meta.source.attribution_required`, `meta.license`, and `meta.tags`. These same commands work in a repository checkout and in an installed app.

If the list is empty, or a requested category has no entries, report that it has no assets available to propose. Do not substitute a note about future additions for actual inventory. Never invent IDs, URLs, or licenses.

Also inspect `cached` rows in `akari assets list` and existing `assets/<category>/INDEX.md`; do not propose duplicates if similar assets already exist locally.
Entries with a non-null `bundledAssetDir` already have their files bundled with the app, even though their `state` remains `reference`; exclude them from acquisition candidates.
In the proposal, mark them `同梱済みのため対象外`, just as existing local assets are marked `既存 assets/ に既にあるため対象外`.

## 2. Ask about intended use

Always ask for information that cannot be derived. Before proposing, confirm:

- Video genre/scenes (e.g., product demo, interview, B-roll supplementation, caption enhancement)
- Intended aspect ratio (16:9 / 9:16 / both)
- Budget (free only, or may include `acquisition: purchase`)
- Whether sources requiring login (`acquisition: login`) are acceptable

## 3. Build a CC0-first starter pack

Follow the contract's CC0-first policy.
Here, consider only external catalog entries with `source.url`. akari-r2 entries with `source.image` lack
`license_at_source` and `acquisition`, so do not mix them into these acquisition candidates.

- Prioritize entries whose `source.license_at_source` is CC0-equivalent (no attribution required; commercial use and modification allowed).
- Entries with `source.attribution_required: true` may be included, but always flag this in the proposal.
- Include entries whose `source.acquisition` is `login` / `purchase` only if the user permits them.
- List only entries actually returned by the bundled catalog commands.

## 4. Proposal format

For each category, show ID, title, license_at_source, acquisition, and a brief rationale.

```text
[telop] lower-third-clean は既存 assets/ に既にあるため対象外。
[font]  <id> は同梱済みのため対象外。
[font]  <id> — <title>（license: CC0 1.0 / acquisition: direct）— 日本語見出し向け
[3d]    <id> — <title>（license: CC-BY 4.0 / acquisition: direct / ⚠ attribution 必須）— 製品モックアップ
```

Do not omit notes such as `⚠ attribution 必須` (the existing Japanese example means attribution required).
Provide enough information for the user to judge acceptability from the list alone.

## 5. Obtain explicit human approval

Ask “Which items in this list should I acquire?” and obtain an explicit YES/NO or narrowed selection.
Do not proceed to [fetch-and-validate.md](fetch-and-validate.md) until approved.

- A topic change or silence is not approval.
- If only some items are approved, target only those IDs in the next stage.
- Carry the approved ID list unchanged into the next stage.

## Common mistakes

- Proposing nonexistent bundled-catalog categories/entries just to meet demand.
- Proposing everything without asking about intended use.
- Hiding or omitting notes about `attribution_required` or `acquisition: purchase`.
- Proceeding on assumed approval without an explicit YES.
- Proposing duplicates of similar assets already in `assets/`.
