---
name: overlay-authoring
description: Author and review AKARI Video overlay HTML, captions, tables and charts, motion graphics, thumbnails, and text-behind-person effects. Routes the work to the relevant authoring leaf.
---

# FORBIDDEN-level hard rules

> **Language**: Respond in the user's language — conversation, questions, approval prompts, and the reports and records you write (including decision-log rows) follow the language the user writes in.

Never create or accept a video overlay that violates any rule below. These rules always outrank the detailed leaves.

Do not read all of `edit.json` or `captions.json`; grep by ID and read only matching lines ([how to read edit.json](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/edit-json-access.md)).
For writes, use Edit on the matching lines or the edit-store script API.

Read lang/<content-language>.md for language-specific rules (content language: --lang → intake.json "language" → transcript language → ja; see https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-10-11-content-language.md). If that file does not exist, read lang/en.md.

1. **Never hardcode adjustable values.** Expose human-adjustable position, scale, font size, color, spacing, and content through CSS variables. Use nonreserved names such as `--font-size`, `--color`, and `--block-left`. Reference them as `var(--name, fallback)` so they inherit from `edit.json.overlays[].vars`. Do not redefine the same variables on the fragment root: doing so blocks overrides from the outer vars.
   **`--x` / `--y` / `--scale` / `--rotate` are runtime-reserved variables** (`renderOverlayNode` in `packages/render-cut/src/rasterize.mjs` always sets them inline on `.akari-overlay-container`. Values come from `overlays[].transform`; `role==="background"` forces identity values). **Neither reference these four variables (`var(--x, ...)`) nor redefine them for your own use inside a fragment.** Inheritance prevents the fallback and causes specified values to be ignored, pulling every overlay toward the origin (0,0; scale 1; rotate 0). This was observed in `overlay-css-var-collision` on 2026-08-17; edit-lint passes and rendering succeeds, so it can escape notice until visual inspection. Define nonreserved position, scale, and rotation knobs such as `--block-left` / `--block-scale`.
2. **Never put timing on the fragment root.** `edit.json` is the SSOT for timeline start and duration; the runtime applies these to the outer container. Do not place `data-start` / `data-duration` on the fragment root. If the asset's natural duration is needed, record it in seconds as `data-akari-natural-duration`; write internal motion in local seconds starting at clip time 0.
3. **Never animate layout every frame.** Animate mainly `transform` / `opacity`. `filter: blur()` and `backdrop-filter` are forbidden over 4K video.
4. **Never determine an image from wall-clock time.** Do not depend on `Date.now()`, elapsed differences from `performance.now()`, `setTimeout`, `setInterval`, accumulated rAF deltas, or unseeded randomness. Use deterministic motion so setting WAAPI `currentTime` on seek reproduces the same frame.
5. **3D work belongs to [author-scene3d](../author-scene3d/SKILL.md).** This skill covers 2D motion parts; do not author 3D here.
6. **Do not create multiple top-level elements.** The HTML fragment must have exactly one root element so the AKARI outer container's translate / scale / rotate always applies.

## Pointer hit testing

The runtime makes its full-screen container and the HTML fragment root `pointer-events: none` by default, leaving margins available to select video or layers below. It automatically restores `pointer-events: auto` only on visible descendants that actually draw a background, border, shadow, text, image, video, canvas, or SVG.

If an element needs different hit behavior, put `data-akari-hit="catch"` (catch below it) or `data-akari-hit="pass"` (pass through below it) on the element or an ancestor of the range. The nearest explicit setting inherits downward and outranks automatic detection. Use `catch` only with a deliberate reason, such as a transparent drag surface; do not casually put it on the full-screen root.

## Elements directly editable in preview

This is not a FORBIDDEN-level hard rule (the image survives if it is ignored), but an element with neither class nor `id` cannot later be targeted individually in preview. Build likely direct-edit targets as follows.

- Only elements with a class or `id` can be selected directly in preview. Clicking one without either selects its nearest ancestor with a class or `id`; design with this in mind.
- Put a meaningful class on bars, labels, headings, icons, and cards (`bar`, `value-label`, `legend-item`, `card-title`, etc.) before visual utility classes. The first class forms the address.
- Give elements with the same role the same class (all five bars should be `bar`). Addresses use the index within that class, so additions, deletions, or reordering can shift an override to a neighbor. Revisit per-element overrides in `edit.json` `source.elements` if applied to that fragment.
- An SVG is selectable as one picture; its internal `rect` or `text` is not individually selectable. Build a chart whose individual bars or labels need direct editing with div + CSS. Use SVG for icons, logos, curves, and other pictures that can move as a unit.
- When splitting a text effect into one `span` per character, the whole heading remains one selection unless each `span` has a class. Add those classes only when character-level editing is intended.
- Set finished bar or box dimensions with `width` / `height` (px), and arrange neighbors with flex / grid. Changing a box then reflows its neighbors. Never create finished dimensions with `transform: scale()`. Animate entry with `transform` ending at natural size (for example `scaleY(0)` → `scaleY(1)`) and `opacity`, while final dimensions depend only on `width` / `height`.
- Use a name tag (`data-akari-part`) when an element needs its own time and motion and must appear as a timeline row. A class marks an element whose position, rotation, or box is sufficient to edit. See [object-tree contract §§1.3–1.4](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-08-30-edit-json-v2-object-tree-v0.md) for name tags.
- A general role name such as `bar` is fine for a class (addresses are counted inside the fragment). Keep CSS selectors scoped under a fragment-specific root as before (for example `.sales-chart .bar`).

Element overrides use `translate` / `rotate` / `width` / `height` and never touch child `transform`, so the outer-container geometry in [motion.md](motion.md) can coexist with child motion transforms.

# Leaf index

Read only the decision area needed.

- Subtitle and telop readability and placement: [telop.md](telop.md). Language-specific typesetting is in lang/<code>.md.
- HTML/CSS structure and animation for tables and charts: [table.md](table.md)
- 3D scenes (Three.js + glTF live scenes, 3D text, device screens, Blender bake): [author-scene3d](../author-scene3d/SKILL.md). Read it before any 3D fragment; this skill covers 2D only.
- Glass refraction declarations, nesting, knobs, and still backdrops: [glass.md](glass.md)
- Canvas 2D worlds, DOM-sheet synchronization, and bird's-eye views: [world.md](world.md)
- Register new rendering types in the `packages/overlay-runtime/runtimes.mjs` manifest (procedure: `packages/overlay-runtime/README.md`).
- Deterministic motion, easing, and compositor limits: [motion.md](motion.md)
- Thumbnail patterns, design vocabulary, generation routes, and HTML screenshots: [thumbnail.md](thumbnail.md)
- Person cutouts, HEVC alpha, and text behind a person: [text-behind-person.md](text-behind-person.md)

An HTML sheet for a still thumbnail is not a video overlay and needs no timing data attributes. It must still use CSS variables, a single root, local assets, and deterministic screenshots.

An overlay's library `meta.json` must declare asset contract v1 `tier`, for example `"tier": "free"` with `"license": { "spdx": "CC0-1.0", ... }`. Use `"tier": "pro"` for Pro and never specify `CC0-1.0` in `license.spdx`. Confirm the tier with the creator ([asset tier contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-10-04-asset-tier-v1.md)).
