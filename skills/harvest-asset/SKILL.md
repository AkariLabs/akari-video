---
name: harvest-asset
description: Use to turn costly, reusable project overlays, 3D, motion, captions, thumbnail layouts, audio, and B-roll into AKARI Video library assets. Assess admission, draft meta.json, create previews, update INDEX, and validate.
---

# Asset harvesting workflow

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

The library defaults to the workspace's `library/`. Without a workspace, use the legacy `~/.akari/assets/`.
Check the first line of `akari-assets list` (or `akari assets list`) for the actual location.
Below, `<ライブラリの置き場>` is the existing library-location placeholder; audio belongs in its `audio/` subdirectory.

Follow the order; do not ask humans for information you can derive.

## 1. Assess admission criteria

**Admit only things expensive or impossible to generate.** Stop harvesting and report why unless both criteria are met:

- Cannot be immediately regenerated from natural language each time. Examples: licensed 3D models, complex multi-element motion,
  polished caption/thumbnail layouts, audio, B-roll.
- Value of storage, search, and license management exceeds generation cost on reuse.

Exclude simple subtitles, mere color variations, basic fades/slides, and fragments with only project-specific wording
changed. If essentially the same as an existing asset, check whether its knobs can express the variation before adding variants.

## 2. Build a working package and draft `meta.json`

Read the source fragment and same-level dependency assets; assemble a self-contained package in a temporary working directory.
Before final placement, automatically extract:

### CSS variables → `knobs`

1. List fragment `--name: value` and `var(--name, fallback)`.
2. Deduplicate; distinguish runtime-owned `--x`, `--y`, `--scale`, `--rotate` from asset-specific knobs.
3. Take defaults from declarations/fallbacks and use them to check fragment/preview. Follow schema v1's allowed
   `knobs[].default` types; never invent values.
4. Mechanically map types to this vocabulary:
   - Color → `color`
   - Number + unit → `slider`; add `min` / `max` only when evidence can be extracted
   - Media URL / `src` → `media`
   - Boolean visibility toggle → `checkbox`
   - Finite choices readable in code → `dropdown`
   - Other replaceable strings → `text`
5. Generate `group` and `label` from variable names and usage sites. Note ambiguous inference in the draft;
   do not add more human questions.

### Dependencies → `requires` and bundled files

- Scan `<script src>`, module imports, `@import`, `url()`, `src` / `href`, Three.js addons/decoders,
  fonts, models, textures, audio, video.
- Put package/runtime names in `requires`; copy relative files.
- Do not adopt CDN/remote URLs unchanged: verify licenses and localize, or stop admission.
- Leave no nonexistent file references, relative paths escaping the fragment, or unused dependencies.

### Other automatic derivations

- `id`: Generate kebab-case from source name/content.
- `category`: Choose a single category by **distribution form** from `overlay` / `still` / `scene3d` / `audio` /
  `broll` / `font` (changed from topic-based categories on 2026-07-29). Timed HTML fragments are `overlay`;
  untimed HTML sheets baked into images (e.g., thumbnail layouts) are `still`; Three.js + glTF or bake recipes are `scene3d`.
  **Put topics (captions, blackboards, lower thirds, BGM, SFX, thumbnails) in `tags`, not categories. Add no categories.**
- `title` / `description` / `tags`: Summarize appearance, role, aspect, and scene from source/use context.
- `provenance`: Fill origin project, original path, generation method, prompt, timestamp from existing information; never fabricate unknowns.
- Inspect dimensions, duration, codec, and model information only when readable with `sips`, `ffprobe`, or an available
  GLB inspector; use for description/tags/preview judgments. Add no top-level fields absent from schema.
- `author`: Use known project/git information. Confirm `tier` (`free` / `pro`) with the owner; do not guess.
  Do not write legacy `price` in new metadata.

Align `meta.json` with v1 of `packages/schemas/asset-meta.schema.json` and `https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-10-04-asset-tier-v1.md`;
use the official `when_to_use` key. Treat request wording `when_use` as meaning that key.

## 3. Ask only the 5 items requiring human judgment

Briefly show extraction results; ask these 5 items together. Ask nothing else.

1. **when_use** → `when_to_use`: Which scenes/purposes?
2. **ai_usage**: What AI may change, what must be preserved, and prohibited modifications.
3. **license**: SPDX, commercial scope, attribution requirement, AI training permission. Unknown license does not default to permission.
4. **tier**: Confirm `free` / `pro` with the owner. `pro` cannot be combined with CC0.
5. **Registration scope**: `local` (this project only) / `shared` (ancestor `.akari/assets/`, business/organization) /
   `user` (`<ライブラリの置き場>/`, reusable across all projects; existing library-location placeholder) /
   `builtin` (product repository; promotion via PR). Give guidance: use `local` if project-specific wording/assets remain;
   use `user` if generalized. Never silently put assets into `builtin`.

Reflect answers in `meta.json`. Admit no asset into any layer until its license is established.

## 4. Generate `preview.png`

- HTML / CSS: Place fragment in one preview harness, wait for local fonts/images to load, capture with headless Chrome.
  Seek video timing to a representative time.
- 3D: Use a representative pose showing model/material/texture. Even if current Three.js live runtime is unfinished,
  never misrepresent a substitute image as the actual model preview.
- B-roll / video: Select a representative frame with `ffmpeg`.
- Audio: Make a preview with readable waveform, title, duration.
- Thumbnail / still: Fit the original asset into the preview canvas without breaking aspect ratio.

Previews identify contents; do not generate imaginary finished images different from the source.
Any dimension conventions added in schema or category INDEX take priority.

## 5. Place in the chosen scope's `assets/<category>/`

Use **the registration scope established in step 3** at `assets/<category>/<id>/`; do not add hierarchy levels.
If the scope's actual directory (`local` = project / `shared` = ancestor `.akari/assets/` /
`user` = `<ライブラリの置き場>/`, existing library-location placeholder) is absent, create it with category and INDEX.md.
Structure, meta.json v1, and validator are identical across layers. Minimum:

- `meta.json`
- `preview.png`
- Actual files: `fragment.html` for HTML, otherwise model/media files
- Local dependencies referenced by fragment

Never overwrite a same-name directory. Compare contents and obtain an explicit decision to update or use a new ID.
Leave no symlinks outside the library; make the package self-contained.

## 6. Update category `INDEX.md`

Add 1 row to `assets/<category>/INDEX.md`, following ID order or existing sorting conventions.

```text
<id> — <何で、どんな場面向けかを一文で>
```

No duplicate rows. Add a category description to `assets/INDEX.md` only for a new category.

## 7. Validate

First check existence of `packages/schemas/bin/validate-asset.mjs` and `packages/schemas/asset-meta.schema.json`,
and read script usage. Current usage takes the target package as follows:

```sh
node packages/schemas/bin/validate-asset.mjs "assets/<category>/<id>"
```

If usage changes, the script is authoritative; do not guess arguments. On failure, fix `meta.json`, the minimum
3-file set, category match, relative dependencies, and INDEX; rerun until successful.

If script or schema is absent, do not treat it as success; retain this unchanged in the result report:

```text
後で実行: node packages/schemas/bin/validate-asset.mjs（validator / schema 作成後）
```

## Common mistakes

- Admitting simple, easily regenerated visuals just because they look nice.
- Making humans transcribe CSS variables/dependencies.
- Saving `when_to_use` under non-schema `when_use`.
- Guessing slider min/max, licenses, or provenance.
- Leaving CDN references or relative references to project directories.
- Duplicating 1 asset across multiple categories.
- Silently admitting into `builtin` without asking scope.
- Putting project-specific wording/images in `user` / `builtin`, making assets unusable elsewhere.
- Omitting previews or using mocks different from actual files.
- Omitting INDEX updates, making assets undiscoverable by grep.
- Reporting validation pass without a validator.

## Sources

- Admission criteria, schema, structure, harvesting: `https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-13-asset-library.md`
- Authoring hard rules: [../author-overlay/SKILL.md](../author-overlay/SKILL.md)
