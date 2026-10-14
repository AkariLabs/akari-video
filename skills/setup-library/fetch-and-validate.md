# Acquire, place, validate, and update INDEX

The library defaults to the workspace's `library/`. Without a workspace, use the legacy `~/.akari/assets/`.
Check the first line of `akari-assets list` (or `akari assets list`) for the actual location.
Below, `<ライブラリの置き場>` is the existing library-location placeholder; audio belongs in its `audio/` subdirectory.

Target only catalog entries explicitly approved in [starter-pack.md](starter-pack.md). Do not acquire unapproved IDs alongside them.

This acquisition procedure is for **external** catalog entries with `source.url`. **akari-r2** entries with
`source.image` lack `acquisition` and `license_at_source`; use AKARI's asset acquisition route instead.
Determine `source` type under the [asset tier contract v1](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-10-04-asset-tier-v1.md) (Japanese).

## Resolver acquisition references (2026-10-05)

Pass `category/id` when acquiring through a resolver such as `akari-assets fetch`. A bare ID resolves only when
unique in the catalog. If multiple categories have the same ID, stop with an `ambiguous_id` error showing candidates.

## 1. Acquire (branch by acquisition)

### acquisition: direct

The agent may acquire with `curl` or similar.

```sh
curl -fsSL "<source.url または直接ファイル URL>" -o "<作業ディレクトリ>/<file>"
```

- Immediately check file type and size (`file`, `ls -la`). Do not mistake an unexpected HTML error page for the asset.
- Start from `source.license_at_source`, but compare it with license statements actually verifiable on the source page. Stop acquisition and report any contradiction.

### acquisition: login / purchase

The agent must not acquire these. Present:

- `source.url` (source page)
- Overview of required registration/purchase (only what the catalog states; do not fill missing information with guesses)
- Ask “Where did you put the acquired file?” and use the user's local path as the next stage's input

## 2. Place in assets/<category>/<id>/ in the selected scope

Before placement, confirm the **registration scope** with the user (see the contract's asset scope hierarchy):
`user` (`<ライブラリの置き場>/`, all projects — default starter-pack candidate; existing library-location placeholder) /
`local` (project `assets/`) / `shared` (ancestor directory's `.akari/assets/`) /
`builtin` (product repository `assets/`, only for developers building the library itself).
Below, `assets/...` denotes the selected layer's root.

Do not overwrite an existing same-name directory. Compare contents and obtain an explicit human decision to update
or use a new ID (same discipline as [harvest-asset](../harvest-asset/SKILL.md)).

Subsequent work depends on the acquired file's nature.

- **Assets needing no authoring** (audio/broll, where the acquired file is the finished asset): Copy meta.json nearly unchanged and apply only the changes below.
- **Assets requiring authoring** (standalone 3d models/fonts lacking `fragment.html` or `@font-face` definitions): Follow [harvest-asset](../harvest-asset/SKILL.md) §2 first (CSS variables → knobs, automatic dependency → requires extraction), then place. Treat catalog meta.json only as the starting draft.

Minimum set: actual file + `meta.json` + `preview.png`. Make `preview.png` according to category using
[harvest-asset](../harvest-asset/SKILL.md) §4 (headless Chrome for HTML, representative pose for 3D,
representative `ffmpeg` frame for B-roll, waveform for audio). If generation fails, retain the reason;
do not create a mock differing from the actual asset as its preview.

### Writing meta.json

Start from the `meta` returned by `akari assets show <category/id> --json` and change:

1. **Remove (delete) the `remote` key.** Assets with complete files do not carry catalog-only flags; other assets already in `assets/` also lack `remote`.
2. **Record catalog origin and acquisition source in `provenance.origin` (required).** Example:
   `"同梱カタログの参照 <category>/<id> 由来 / 取得元: <source.url> / acquisition: <direct|login|purchase> / license_at_source: <...> / 取得日: YYYY-MM-DD"`
   (Existing Japanese example: catalog origin / source / acquisition / license / acquisition date.)
   Do not fill unknown values. The acquisition date is the execution date.
3. You may retain the external `source` block (a `source` object is schema-valid without `remote`). Keep it if retaining machine-readable acquisition records; update `source.url` to the actual acquired file/page URL. Remove it if unnecessary. Only 1 and 2 are mandatory.
4. Base `license` / `tags` / `title` / `description` / `when_to_use` / `ai_usage` / `knobs` / `requires` / `author` / `tier` on catalog values. For assets requiring authoring, verify consistency with the actual `fragment.html` CSS variables and dependencies before finalizing. Do not put assets with undetermined licenses into `assets/`.

### Font category exception

Font redistribution licenses often prohibit bundling.

- Place binaries in `assets/font/<id>/` and remove `remote` only when redistribution / embedding is explicitly permitted (such as many OFL Google Fonts).
- If permission cannot be verified, do not copy binaries into `assets/`. Leave external + `remote: true` entries in the catalog; do not treat them as placed in `assets/`. If the design depends on a font installed in the user's environment, separately verify its actual installation and terms of use.

## 3. Record attribution_required

If `source.attribution_required` or `license.attribution_required` is true, do both:

- Explicitly mark attribution as required in the corresponding `assets/<category>/INDEX.md` row.
- Tell the user explicitly that exports using this asset require project-side credit (e.g., end credits).
  Automatic insertion is a future specification; currently only record and notify.

## 4. Validate

```sh
akari assets validate "<配置したフォルダ>"
```

If validation fails, fix `meta.json`, the minimum 3-file set, category match, relative references, and INDEX;
rerun until successful. If the validator is unavailable, do not treat it as success; include the following unchanged in the result report.

```text
後で実行: akari assets validate "<配置したフォルダ>"（検証器が利用可能になった後）
```

## 5. Update assets/<category>/INDEX.md

Add 1 row in the same format as harvest-asset.

```text
<id> — <何で、どんな場面向けかを一文で>（要クレジットなど注記があれば併記）
```

Do not create duplicate rows. Add a category description to `assets/INDEX.md` only when first creating a new
category (such as font) whose directory does not yet exist under `assets/`.

## Common mistakes

- Acquiring with an unverified/unclear license (blindly trusting catalog `license_at_source` without checking source statements).
- Omitting attribution_required records (neither INDEX nor user notified).
- Copying catalog meta.json directly to `assets/<category>/<id>/meta.json`, leaving `remote: true`.
- Agent acquisition of `login` / `purchase` catalog entries.
- Unconditionally copying binaries to `assets/font/<id>/` without checking redistribution permission.
- Reporting placement complete without validation.
- Acquiring unapproved catalog entries alongside approved ones.
- Silently overwriting existing same-name directories in `assets/`.
- Treating assets requiring authoring (3d / font) as finished with unchanged catalog meta.json, leaving knobs/requires inconsistent with actual files.

## Sources

- Contract: [`docs/contract-2026-07-13-asset-library.md`](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-13-asset-library.md), Catalog and acquisition skills section (Japanese)
- Asset harvesting and meta.json v0 discipline: [../harvest-asset/SKILL.md](../harvest-asset/SKILL.md)
- Authoring hard rules: [../overlay-authoring/SKILL.md](../overlay-authoring/SKILL.md)
