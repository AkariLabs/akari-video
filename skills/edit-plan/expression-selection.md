# Select expressive means from context (meaning → means)

The library defaults to workspace `library/`; without a workspace, use legacy `~/.akari/assets/`. Check the actual path on the first line of `akari-assets list` (or `akari assets list`). Below, `<ライブラリの置き場>` means that displayed library path; audio lives under its `audio/` directory.

These rules choose how to show each scene. [beats.md](beats.md) identifies highlights, [beat-sync.md](beat-sync.md) determines what fires when, and this leaf governs **which expressive means to use for a scene during the asset plan (Checkpoint 2)**.

This leaf specifies **candidate selection**, not a waiver of approval. Candidates still pass Checkpoint 2 (asset plan) under [approvals-and-generation.md](approvals-and-generation.md), as in §Approval gate remains unchanged.

## Selection principles

- **Meaning determines means; means do not come first.** First state what the scene communicates to viewers, then derive the means from that meaning.
- **Do not use novelty or desire to use a means as a selection reason.** "I want 3D" or "it is in the catalog" **is not a reason**; only the scene's meaning requiring that means justifies it.
- **One primary means per scene.** Only one means may make the main claim at a time. Supporting captions or restrained decoration are allowed, but do not combine a rotating 3D model, a full-screen chart, and word-level text effects as competing leads.

## Default meaning-to-means mapping

| Scene meaning | First choice | Second choice | Do not use |
|---|---|---|---|
| Product or object explanation | 3D model (bake-3d catalog) | Live-action B-roll | Text-only explanation |
| Data, numbers, comparison | HTML chart/table | Text effect emphasizing a number | Decorative 3D |
| Steps or operation | Screen recording or reference material | HTML diagram | Unrelated stock footage |
| Place or atmosphere | Live-action B-roll | Stock footage | — |
| Moment of emotion or assertion | Word-level text effect | Person treatment (outline or zoom) | Information-heavy overlay |
| Concept or structure | HTML diagram (shapes, outlines, arrows) | 3D only for spatial concepts | — |

- Search the table **from meaning to means**, not backward from an available asset.
- **The "Do not use" column is a prohibition. Never choose it even if `allowed_means` (§Hard filter) allows it.** Permission is not an obligation and does not cancel a prohibition.
- For a scene meaning absent from the table, choose the closest row and document **which row was borrowed** (§Evidence record). Do not invent a row.

## Map table means to `allowed_means` vocabulary

`allowed_means` contains seven fixed values from the decision-cards `direction` card, at a different granularity from the mapping table. Use this exact correspondence:

| Means in the table | `allowed_means` value |
|---|---|
| 3D model (bake-3d catalog) / 3D only for spatial concepts / decorative 3D | `3D` |
| Live-action B-roll | `実写 B ロール` |
| Stock footage | `ストック素材` |
| Screen recording or reference material | `スクリーン録画・資料` |
| HTML chart/table / diagram / information overlay | `HTML 図解` |
| Word-level text effect / numerical emphasis | `文字演出` |
| Person treatment (outline or zoom) | Overlaid outlines use `HTML 図解`; image transforms such as zoom are **outside this means check** because they add no asset. |

- `AI 生成` **does not appear as a table row**. It describes how to acquire an asset, rather than how the scene is shown, and is independent of B-roll, stock, 3D, and diagrams. Check it **in addition** when generating an asset (§Hard filter).
- Writing overlay HTML yourself under [overlay-authoring](../overlay-authoring/SKILL.md) uses the `HTML 図解` / `文字演出` checks. Apply `AI 生成` to generated image, video, or audio assets.

## Hard filter — `allowed_means`

**Exclude means absent from** the effect card's `allowed_means` (`answer.allowed_means` on the `direction` card in `<レポートパス>.decisions.json`, where the Japanese placeholder means report path). By default, all seven values are allowed.

- **If the first choice is excluded, try the second.** If both are excluded, the row is exhausted.
- **If all fail, show the scene as plain video plus captions.** Do not reinterpret an excluded means as a nearby one (for example, no 3D-looking stock CG when 3D is disallowed).
- Exclusion and exhaustion are **decisions**. Record excluded means and fallback under §Evidence record.
- If `decisions.json` is absent or corrupt, **substitute explicit chat approval** under [report-guide.md](report-guide.md)'s generic-card fallback. Do not assume all values are allowed by default and continue.
- `allowed_means` is a hard filter, separate from effect strength (`direction { preset, intensity }` in [beat-sync.md](beat-sync.md)). Raising `intensity` never restores a disallowed means.

### Two gates for AI-generated assets

`AI 生成` must satisfy **the intake policy permitting AI generation** as well as `allowed_means`. Only when both allow it may a generated asset be considered. If either disallows it, do not generate; fall back to proposing an available asset or not using one.

- Measured against `packages/schemas/intake.schema.json` v0: intake.json v0 has `version` / `tasks` / `target` / `autonomy` / `status` / `submitted_at`, with **no dedicated AI-generation permission field**. Read intake policy from `target.taste` free text and approvals recorded in `decision-log.md`.
- If neither provides an answer, do not assume permission; check through the pre-generation declaration in [approvals-and-generation.md](approvals-and-generation.md) before proceeding.

## Catalog connection — Search assets after choosing means

**Search for assets after choosing a means**, not the other way around. Search all scope layers from nearest to farthest under [report-guide.md](report-guide.md#asset-plan): project `assets/` → parent `.akari/assets/` → `<ライブラリの置き場>/` → product repository `assets/` → `catalog/`. State the layer for each hit.

- **Search with `when_to_use` and `tags`.** Match `when_to_use` directly to scene meaning and use `tags` to narrow results. Do not select from the feel of `title` / `description` alone.
- **Check the license in `meta.json` before adoption.** Inspect `license.spdx` / `license.scope` / `license.attribution_required` and `source.license_at_source` for redistribution conditions.
  - With `attribution_required: true`, adoption creates a credit-text obligation. Put it in the editing report, as in [beat-sync.md](beat-sync.md)'s credit procedure.
  - **Do not commit an asset forbidding standalone redistribution to a public repository**, even if copying it into the project is allowed.
  - `catalog/` with `remote: true` is **an acquisition index, not the asset itself** ([catalog/INDEX.md](https://github.com/AkariLabs/akari-video/blob/main/catalog/INDEX.md)). If not acquired, state the need to acquire it in the asset plan.
  - If absent locally, search the **account asset library** (all free items plus purchases after `akari store connect`). Narrow with `akari assets list --tag <t> --query <s>`; after selection, fetch into this project with `akari assets fetch <category/id> --project .` (including SHA-256 validation). Pro (Lifetime pass) assets can be fetched one at a time. Pasting a `category/id` copied from one Lab item page lets `akari assets fetch <category/id>` fetch that item. After acquisition, check `meta.json` licensing as above.
  - ATF text-overlay rendering and preset reference tables are retired. Acquire HTML-asset versions through Lab and check both asset and font licenses. Existing baked assets remain playable.
- Do not record "propose if available" without an actual hit. Use [report-guide.md](report-guide.md#asset-plan)'s three choices (propose if available / generate if absent / do not use). Do not invent previews or search results.

## Evidence record

For **every choice**, record **one row** connecting scene meaning → table row → selected asset id in the editing decision record's asset plan, with the same granularity as [beat-sync.md](beat-sync.md)'s evidence. Use the `material` category of `decision-log.md` ([report-guide.md](report-guide.md#decision_log)). Write the pipe labels and their contents in the user's language; the example below shows the Japanese form.

```text
<scene id> @ <timeline 秒> | 意味: <シーンの意味> | 行: <対応表の行名> / <第一候補|第二候補|全滅> |
手段: <allowed_means 語彙> | 素材: <素材 id>（<層> / <license.spdx> / クレジット<要|不要>） | 理由: <1 文>
```

- **Write one row for exclusion, exhaustion, and rejection too** (for example `手段: —（全滅 → 素の映像 + 字幕）`, explaining excluded means in the reason). Never silently drop them.
- If a generated asset such as overlay HTML has no `id`, put its path in the asset field.
- When skipping candidate rank (such as choosing second while first is allowed), explain why in the reason field. Unexplained deviation is forbidden; first choice is the default.

## Approval gate remains unchanged

This leaf chooses candidates; it does not waive approval.

- The asset plan still requires human approval at **Checkpoint 2 (asset plan)** ([approvals-and-generation.md](approvals-and-generation.md)).
- Passing `allowed_means` does not mean approval. The hard filter only **reduces** candidates; it never auto-approves survivors.
- For paid or heavy generation (AI-generated assets), never skip the pre-generation declaration even after both `allowed_means` and intake permit it.

## worked example

### Premise

Promotional video for a task-management app (explanatory tone = `真面目`, the fixed "serious" value). It has three scenes with different meanings.

| scene | Timeline seconds | Scene meaning | Content |
|---|---|---|---|
| `sc-01` | 24.0 | Product/object explanation | Show the app screen on a physical device |
| `sc-02` | 98.0 | Data/numbers/comparison | Processing time before and after adoption (12 minutes → 90 seconds) |
| `sc-03` | 232.0 | Emotion/assertion | Utterance `正直、ここまで変わるとは思っていませんでした。` (surprise at how much changed) |

### Case 1 — All seven `allowed_means` values allowed

```json
["実写 B ロール", "スクリーン録画・資料", "ストック素材", "AI 生成", "3D", "HTML 図解", "文字演出"]
```

| scene | Table row | First choice | Filter result | Selected means | Selected asset |
|---|---|---|---|---|---|
| `sc-01` | Product/object explanation | 3D model | `3D` allowed → pass | 3D | `catalog/scene3d/modern-smartphone` |
| `sc-02` | Data/numbers/comparison | HTML chart/table | `HTML 図解` allowed → pass | `HTML 図解` | Generated overlay HTML plus font `catalog/font/noto-sans-jp` |
| `sc-03` | Emotion/assertion | Word-level text effect | `文字演出` allowed → pass | `文字演出` | Lab HTML text overlay (select actual asset after acquisition) |

Asset-selection evidence (measured catalog data):

- `sc-01`: Compare the three `catalog/scene3d/` entries by `when_to_use`. `modern-smartphone` applies to an app introduction, UI explanation, or product demo with a device-screen mockup, matching this scene (`vintage-camera` is a retro prop and `studio-hdri` is environment lighting). `license.spdx` = `CC0-1.0` / `attribution_required: false`, so no credit is needed. State in the asset plan that `remote: true` requires acquisition.
- `sc-02`: `catalog/` has no chart/table category (measured directories: scene3d / audio / avatars / broll / font). Under "generate if absent," create overlay HTML and use `catalog/font/noto-sans-jp` (`OFL-1.1`, no credit). **Do not add decorative 3D from the "Do not use" column even when `3D` is allowed.**
- `sc-03`: Choose a Lab HTML text treatment fitting a serious explanatory tone. If not acquired, record that acquisition is needed. Do not use old ATF search counts as evidence for current candidates.

Record rows (`material` in `decision-log.md`; the fixed Japanese labels inside the code example remain unchanged):

```text
sc-01 @ 24.0 | 意味: 製品・物体の説明 | 行: 製品・物体の説明 / 第一候補 | 手段: 3D | 素材: modern-smartphone（catalog / CC0-1.0 / クレジット不要） | 理由: when_to_use「実機に画面を映し込んだモックアップ」がシーンの意味に一致
sc-02 @ 98.0 | 意味: データ・数値・比較 | 行: データ・数値・比較 / 第一候補 | 手段: HTML 図解 | 素材: overlays/sc-02-chart.html（生成 / 書体 noto-sans-jp OFL-1.1 / クレジット不要） | 理由: catalog にグラフ素材のカテゴリが無く三択の「なければ生成」。3D の飾りは禁止列のため不使用
sc-03 @ 232.0 | 意味: 感情・主張の瞬間 | 手段: 文字演出 | 素材: Lab の HTML テロップ（取得・選定待ち） | 理由: 真面目なトーンに合う表現を実物で確認する
```

### Case 2 — `3D` and `AI 生成` disallowed (five values)

```json
["実写 B ロール", "スクリーン録画・資料", "ストック素材", "HTML 図解", "文字演出"]
```

| scene | Table row | First choice | Filter result | Selected means | Selected asset |
|---|---|---|---|---|---|
| `sc-01` | Product/object explanation | 3D model | `3D` **excluded** → second choice | `実写 B ロール` | `catalog/broll/laptop-typing-closeup` |
| `sc-02` | Data/numbers/comparison | HTML chart/table | `HTML 図解` allowed → pass | `HTML 図解` | Generated overlay HTML plus font `catalog/font/noto-sans-jp` |
| `sc-03` | Emotion/assertion | Word-level text effect | `文字演出` allowed → pass | `文字演出` | Lab HTML text overlay (select actual asset after acquisition) |

Differences from case 1 and effects of disallowing `AI 生成`:

- **Only `sc-01` changes.** Excluding first-choice `3D` moves it to second-choice live-action B-roll. `laptop-typing-closeup`, the sole `catalog/broll/` entry, has `when_to_use` for a generic hands-at-work shot in SaaS/app introductions or remote-work explanations, matching this scene. `LicenseRef-Mixkit-Free-License` / `attribution_required: false` requires no credit, but `source.license_at_source` **forbids redistributing the asset unchanged**. Copying into the project is allowed; **do not commit it to a public repository**.
- Disallowing `AI 生成` excludes generating a product-cut video instead of 3D for `sc-01`; even if `実写 B ロール` is allowed, **generating** that asset is blocked. It also excludes an AI-generated image behind `sc-03`'s text overlay, leaving only word-level text treatment.
- `sc-02` is unchanged: `HTML 図解` remains allowed. **Do not place** decorative 3D from the prohibition column in either case, regardless of `allowed_means`.
- Hand-authored overlay HTML for `sc-02` / `sc-03` falls under `HTML 図解` / `文字演出`, so disallowing `AI 生成` does not affect it (see vocabulary mapping).

Record row for changed `sc-01` only; `sc-02` / `sc-03` match case 1:

```text
sc-01 @ 24.0 | 意味: 製品・物体の説明 | 行: 製品・物体の説明 / 第二候補 | 手段: 実写 B ロール | 素材: laptop-typing-closeup（catalog / LicenseRef-Mixkit-Free-License / クレジット不要） | 理由: 第一候補 3D が allowed_means で除外。when_to_use「SaaS/アプリ紹介…手元ショット」が一致。再配布禁止のため公開リポジトリへコミットしない
```

### Verify all-candidates-excluded fallback

If case 2 also excludes `実写 B ロール` and `ストック素材`, `sc-01` has no remaining row candidates (3D → live-action B-roll). Show `sc-01` as **plain video plus captions** and record the following row. "No text-only explanation" in the prohibition column forbids making text effects the primary means; it does not forbid plain video plus captions as an exhaustion fallback.

```text
sc-01 @ 24.0 | 意味: 製品・物体の説明 | 行: 製品・物体の説明 / 全滅 | 手段: —（全滅 → 素の映像 + 字幕） | 素材: なし | 理由: 3D・実写 B ロール・ストック素材がいずれも allowed_means で除外
```

### Self-consistency check

- All six selections (three scenes × two cases) use **first or second choice from the same mapping row**; none crosses rows or invents a means.
- Zero selections use the "Do not use" column: decorative 3D for `sc-02`, information overlays for `sc-03`, and text-only explanation for `sc-01` were all rejected.
- **One primary means per scene**: each of the six has one main means, with captions only supporting it.
- Zero candidate-rank deviations occur: case 2's second choice for `sc-01` follows exclusion of the first.
- All six choices and the one exhaustion check have record rows, each connecting meaning → row → asset id.

## Validation (measured 2026-07-23)

The actual catalog data used in the worked example was checked as follows (`catalog/` was read-only):

```
$ ls catalog/scene3d | tr '\n' ' '
INDEX.md modern-smartphone studio-hdri vintage-camera
$ node -e "const m=require('./catalog/scene3d/modern-smartphone/meta.json');console.log(m.license.spdx,m.license.attribution_required,m.remote)"
CC0-1.0 false true
$ node -e "const m=require('./catalog/broll/laptop-typing-closeup/meta.json');console.log(m.license.spdx,m.license.attribution_required)"
LicenseRef-Mixkit-Free-License false
$ node -e "const m=require('./catalog/font/noto-sans-jp/meta.json');console.log(m.license.spdx,m.license.attribution_required)"
OFL-1.1 false
```

Old ATF search results are unavailable after retirement. Check actual HTML-asset data after acquisition.

With case 1 `sc-02` / `sc-03` overlay HTML in a temporary project's `edit.json` (`version: 0` plus one `source`), `validate-edit.mjs` returned `OK` and `edit-lint` returned `PASS (0 findings, 5 skipped)`. This measured that these selections pass existing validation. The authoritative check remains [edit-lint](../edit-lint/SKILL.md) from [execution.md](execution.md) §4; this leaf adds no validation procedure.

## Common mistakes

- Choosing a means first, then searching for a scene that suits it; meaning must determine means.
- Giving "the catalog has a nice 3D asset" as the reason. Novelty or desire to use it is not evidence.
- Putting two or more competing means in one scene (3D plus full-screen chart plus word-level text effects).
- Choosing only from the mapping table without reading `allowed_means`. The filter is **a prerequisite that reduces candidates**, not a later step.
- When `allowed_means` excludes the first choice, slipping to a "similar" means instead of the second (no 3D-looking stock CG when 3D is disallowed).
- Trying to fill a scene after all candidates fail; the default is **plain video plus captions**.
- Selecting a means in the "Do not use" column because `allowed_means` includes it. Permission is not an obligation.
- Checking `AI 生成` only against `allowed_means` and ignoring intake policy; there are two gates.
- Choosing assets by the feel of `title` / `description` without matching `when_to_use` and `tags`.
- Adopting without checking the `meta.json` license. `attribution_required: true` obliges a credit line; redistribution restrictions forbid committing the asset publicly.
- Treating a `catalog/` entry as an acquired file; `remote: true` is only an index.
- Recording "propose if available" without a hit or inventing a preview.
- Silently dropping exclusions, exhaustion, or rejection; each is a decision needing a row.
- Skipping candidate rank without a reason; unexplained deviation is forbidden and first choice is default.
- Treating passage through the hard filter as approval and skipping Checkpoint 2.
