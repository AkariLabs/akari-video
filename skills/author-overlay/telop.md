# Subtitle and telop design

Design subtitles as a repeated UI for reading speech and telops as visual elements that emphasize a point or feeling. Do not give both the same density or visual force.

## Principles

For language-dependent line composition, type, and text conventions, follow the selected language pack.

- Never rely implicitly on a font absent from the export environment.
- For captions whose line breaks are decided before fragment generation, prevent further CSS wrapping within each line (`white-space: nowrap`); the generated breaks must be the only breaks.
- Place subtitles away from on-video text and faces, normally toward the bottom. Move them up or sideways on collision. Put telops near the subject of attention, but do not confuse covering the subject with "emphasis".
- Separate text from the backdrop with a static opaque or translucent plate, outline, or shadow. Do not rely on `filter: blur()` / `backdrop-filter`.
- Expose `--font-size`, `--line-height`, `--color`, `--background`, `--max-width`, and `--safe-*` as adjustment points. Put defaults in `var(--name, fallback)` and never block outer `vars`.
- `knobs[].default` is required in an asset's `meta.json`. The inspector uses this `default` when `vars` is unset and cannot read the fragment's effective value. Keep it equal to the fragment CSS fallback.
- Scope selectors and `@keyframes` names with asset-specific prefixes.
- For a plate + text telop, a class on the text element makes that text the first selectable target. If the whole unit should move, omit the text-side class and put one on the root plate.

## Readable size and text density

There is no official minimum burned-in telop px size shared by all platforms. Do not turn an unsupported `px` minimum into a hard rule. Set `--font-size` in relation to output height and actually read it at final resolution and on the smallest intended device. Mark untested values **needs verification**. Follow the selected language pack for language-specific line lengths and reading rates.

## Units — `px` means output px; `vw` / `vh` use output dimensions (2026-08-31)

The fragment coordinate system is the **logical pixels of the output frame** (`edit.json.output`, for example 1280x720), so `px` means output px directly. `vw` / `vh` / `vmin` / `vmax` also use **output dimensions** (`1vw` = `output.width / 100` px). They mean the same thing in preview and export; the runtime rewrites them in preview, and the fragment needs no code (`packages/overlay-runtime/src/viewport-units.js`). `@media` / `@container` conditions use window dimensions, so do not branch fragment layout with media queries. Receive output size through `vars` or the `--akari-vw` family.

## Placement safe zones

Before using fixed values, identify destination, ad versus organic placement, aspect ratio, CTA, subtitle area, and LTR/RTL direction. Never reuse numbers across different conditions on the same platform.

| Conditions | Official figures | Operation |
|---|---:|---|
| YouTube vertical **video ad**, 1080×1920 | Avoid top 288px, right 192px, bottom 672px, left 48px | Keep important text / logos in the remaining safe area. Do not treat these as organic Shorts values |
| Instagram / Facebook **Reels ad**, 9:16 | Leave bottom 35% clear | Keep important text / logos out of the bottom; check with Meta's safe-zone checker too |
| TikTok Auction In-Feed ad | No fixed coordinates | Use official ZIP and Preview specific to aspect ratio, caption length, additional format, and LTR/RTL; figures **need verification** |

Even YouTube's safe zone is not guaranteed on every device. For organic posts or destinations absent from the table, do not set fixed coordinates: mark them **needs verification** and check platform preview just before publishing.

Sources:

- [Google Ads Help — About video ad specs](https://support.google.com/google-ads/answer/13547298?hl=en)
- [Google — Universal Video Ad Safe Zones](https://services.google.com/fh/files/misc/universalsafezones-youtube.pdf)
- [Meta — The Reels ads guide](https://d3m889aznlr23d.cloudfront.net/img/events/458925814/assets/e042d2be.reels_ads_guide1.pdf)
- [TikTok Ads Manager — TikTok Auction In-Feed Ads](https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads)

## Corner caption (TV-style corner label)

This is a persistent program / segment label in the upper left or right of a broadcast frame: program title plus current chapter title, changing with chapters. **It may be generated from this pattern for each project rather than added to the asset library**: project-specific text substitutions are the point, and only the structure is reusable.

- **Build it in HTML/CSS, not image generation**: Every chapter needs different text. Images require one generation per chapter and risk misspelled or malformed text. A single fragment with one overlay entry per chapter avoids that work and lets preview and export use the same source. For language-specific text risks, see the selected language pack.
- **Chapter tracking**: Reference the same slotted fragment for each chapter. Put its title in each HTML item's `source.params` and its interval in `at` / `duration` (one chapter = one overlay item). Existing fragments with fixed text may keep text directly in the DOM. Never put text into CSS variables.
- **Structure**: one root + plate (program-name row and chapter-name row, or a combined line). Set position with the runtime-owned outer-container transform; the fragment holds only appearance.
- **Restrain persistent elements**: Use a smaller `--font-size`, translucent plate, and a corner away from subject, subtitles, and in-video UI. Because captions can coexist below, do not put this at the bottom.
- Example knobs: `--plate-bg`, `--accent`, `--font-size`, `--radius`. Expose defaults through `var(--name, fallback)`.
- Use only short opacity / translate for chapter transitions. Keep it still while held (per the animation principles).

## Text slots (data-akari-slot)

Do not read all of `edit.json` or `captions.json`; grep by ID and read only matching lines ([how to read edit.json](https://github.com/AkariLabs/akari-video/blob/main/docs/guides/edit-json-access.md)). Write with Edit on matching lines or the edit-store script API.

Use slots to share one HTML file across items while putting each item's text in `edit.json`.

```html
<span data-akari-slot="title">既定タイトル</span>
```

```json
{
  "source": {
    "kind": "html",
    "path": "overlays/chapter-tag.html",
    "params": { "title": "第1章 問題の本質" }
  }
}
```

- **Declaration**: Put `data-akari-slot="<name>"` on the replaceable text element itself. Keep only plain text inside; do not nest child elements or other slots. The runtime assigns the value through `textContent`, so `<b>` in params will not become a tag.
- **Default text**: Always put a human-readable default inside the element. Items without the matching params key display that default unchanged.
- **Naming**: Use a semantic name matching `^[a-z][a-z0-9_-]*$` (for example `title`, `chapter-title`, `speaker_name`). Do not use sequence numbers or the visible string itself as names. Reuse a name on multiple elements only if the same text is intended.
- **Sharing boundary**: Keep color, spacing, font, and animation in template HTML/CSS; keep per-instance words in `source.params`. Double-click editing a slot updates params, not the template file.
- **Compatibility without slots**: For fragments without `data-akari-slot`, continue editing DOM text and writing it back to the referenced HTML file.

## Fonts (`@font-face`)

`edit-lint` finding `overlays.fragment-font-glyphs` warns when a character is absent from every font referenced by the fragment. It examines the union of font cmaps, so another referenced font can mask a missing glyph in one element's font. If runtime script creates characters, declare them on the fragment root as `data-akari-font-chars="使う可能性のある字"`. Without that declaration, an info finding notes incomplete static collection.

Actual display and warnings can differ due to `src` fallbacks or fonts in another fragment. The check does not track `unicode-range`, `source.text` substitutions in component items, or combining-character composition.

Automatic font subsetting at export is only planned. Until it exists, continue using the current manually subsetted fonts; then manual resubsetting will no longer be needed. See the [fragment-font contract](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-10-02-fragment-font-subset-v0.md).

## Animation

- Use short opacity / translate transitions for subtitles; keep them still while held.
- Per-character entrances can harm reading speed and reproducibility on seek. Limit them to effects that need them, and establish the character DOM first. Follow the selected language pack for the appropriate split unit.
- Use CSS animation / WAAPI so the runtime can set `currentTime = (t - start) * 1000`.
- Put position-motion transforms on child elements inside the fragment, separate from the runtime-owned outer-container geometry transform.

### Fill-mode trap when putting IN/OUT in one `animation` (measured 2026-08-04)

With `animation: X__in 0.6s both, X__out 0.6s 3.2s both`, **`both` on OUT kills IN**. OUT's `both` (backwards fill) applies its starting value (`opacity: 1`, etc.) during the delay. A later animation wins for the same property, overriding IN throughout the delay. The result appears fully visible from the beginning, without fade IN / slide IN. This is standard CSS behavior and occurs **in both preview and burned output**, not a preview bug.

- **Use `forwards` for OUT** (`animation: X__in 0.6s both, X__out 0.6s 3.2s forwards`).
- It does not occur for a fragment with a single animation (stagger / loop); only when IN and OUT are listed on the same property.
- Check the first few frames by seeking and visually confirm the IN start value (opacity 0 / offscreen).
- The trap generalizes beyond two-stage IN/OUT (chains of three or more, an omitted endpoint in a blinking loop, etc.). See "Implicit 0% override when chaining multiple animations on the same property" in `motion.md`.

## Text splitting and stagger contract (2026-08-15)

For character-, word-, or phrase-staggered entrances, **ship the fragment already split and express stagger with CSS `calc()`**. Never write a `<script>` in the fragment.

```html
<div class="foo__line" data-akari-split="bunsetsu"
  ><span class="akari-u" style="--i:0">今日は</span
  ><span class="akari-u" style="--i:1">とても</span
  ><span class="akari-u" style="--i:2">いい</span
  ><span class="akari-u" style="--i:3">天気ですね</span></div>
```

```css
.foo__line{
  --anim-duration: var(--anim-duration-telop, 500ms);  /* 1 要素の尺（対象別の相場は motion.md） */
  --anim-stagger:  150ms;                              /* ずらし */
  --anim-easing:   var(--ease-snap-out);               /* 語彙は motion.md「イージング語彙」。未指定なら smooth */
}
/* ★ [data-akari-active] ゲートの中で宣言する（下の「性能」参照） */
[data-akari-active] .foo__line .akari-u{
  animation: foo__in var(--anim-duration) var(--anim-easing) both paused;
  animation-delay: calc(var(--i) * var(--anim-stagger));
}
@keyframes foo__in{
  from{ opacity:0; transform: translateY(var(--anim-distance, 50px)); }
  to  { opacity:1; transform: none; }
}
```

- **The single `animation-delay: calc(var(--i) * var(--anim-stagger))` line does the work.** The same stagger applies to any `@keyframes` effect. Do not list delays separately for each effect.
- **Knobs must be CSS variables**, overridable through edit.json `vars`.
- **`--i` is a zero-based sequential index**. The runtime supplies the total count in `--n`.

### Split units (`data-akari-split`)

| Value | Unit | Use |
|---|---|---|
| `bunsetsu` | Japanese phrase unit | See the Japanese language pack |
| `chars` | One character | For effects; do not overuse because it harms reading speed |
| `words` | Words | For space-separated languages; see the language pack |
| `lines` | Lines | Advance by line |
| `none` | No splitting | — |

The runtime's Japanese segmentation behavior and its limits are documented in the Japanese language pack.

### Runtime responsibilities (do not implement in the fragment)

As with `data-mirror="text"`, the runtime owns DOM manipulation:

- **At mount**: Split an element that declares splitting but arrives unsplit (an idempotent safety net for shipping mistakes).
- **At edit start**: Collapse spans to plain text (editing with `<span>` nodes can split spans on keystrokes and jump the caret across unit boundaries).
- **At edit commit**: Split the final text again and reassign `--i`. Saved HTML is **already split**, because export uses fragment HTML directly.

Required runtime: **0.5.0 or later**. Declare `min_overlay_runtime_version: "0.5.0"` in the asset's `meta.json`.

### Performance — the `[data-akari-active]` gate is required (measured)

Splitting multiplies one fragment's CSS animations by its unit count. Without the gate, performance collapses:

| Condition | Existing animations | One tick |
|---|---:|---:|
| Gated; 1,200 fragments × 16 splits; 60 visible | 960 | **0.023ms** |
| Ungated; 1,200 fragments × 8 splits | 9,600 | **221ms** |
| Ungated; above + 60 visible | 9,600 | **11,783ms** |

`getAnimations()` cost is proportional to the total number of existing CSS animations in the whole document. Under the gate, hidden fragments have none, so splitting itself is harmless. A single fragment without the gate brings the whole document down.

## Multilayer text fragments and data-mirror contract (2026-08-06)

Fragments that stack the same text in layers with different `-webkit-text-stroke` widths (multiple outlines, offset shadows, backing, two-stage extrusion, etc.) must pick one editable layer or edits diverge. overlay-runtime (`packages/overlay-runtime/`) synchronizes layers.

- **Mark duplicate layers**: Give outline, shadow, and backing copies `data-mirror="text"`. Make only the front fill layer editable by double click → contenteditable. The fragment need not set `contenteditable` or a special role; the direct-text layer without `data-mirror="text"` is selected by elimination (`canEditText` excludes mirrors).
- **Structure**: Place mirror and fill layers immediately under the same stack container (for example `.stack`). Sync defaults to descendants of the editable layer's parent; distant layers do not synchronize.
- **Runtime sync**: On the editable layer's `input` / `compositionend`, the runtime copies textContent into every `data-mirror="text"` layer in that stack. No fragment `<script>` is needed (also consistent with the FORBIDDEN-level single-root rule). A safety sync runs on save.
- **Shipping state**: Ship identical text baked into every layer. Initial display is correct even in runtimes without mirror support; only live editing synchronization requires `packages/overlay-runtime/package.json` `version` `0.2.0` or later (available as `window.akari.runtime.version`). Declare the minimum with optional top-level `min_overlay_runtime_version` in asset `meta.json` (x.y.z; added to asset-meta.schema.json on 2026-08-06).
- **Accessibility**: At mount the runtime adds `aria-hidden="true"` to every mirror layer. Fragments need not write it.

## Centering available-width trap — all wrappable content (measured and generalized 2026-08-06)

For an element centered with `position: absolute; left: 50%; transform: translateX(-50%)`, shrink-to-fit ignores the transform and calculates available width from left to the right edge of the stage: half its width. It was first measured with flex-wrap (a 1920px stage was treated as 960px, **wrapping even default text unexpectedly**) and also occurs with a single stack without flex whenever content can wrap. Small canvases expose it more easily: a screenshot at a roughly 600px stage can wrap where production will not. For centered fragments that allow wrapping, set `width: max-content` on the content to avoid shrink-to-fit; add explicit `max-width` only when wrapping is intended. Render verification screenshots at actual production width (at least 1080px), then crop them.

## Common mistakes

- Keeping too much text and lowering only font-size.
- Asking an image generation model to draw text, then delivering misspelled or malformed output.
- Displaying subtitles and emphatic telops together continuously until neither is readable.
- Putting plain white text directly over bright video.
- Reusing unofficial template safe-zone values for a different placement or organic post.
- Redefining `--font-size` or similar variables on the fragment root, blocking `edit.json.vars` overrides.
- For language-specific text-generation mistakes, see the selected language pack.

## Separate bands for fixed labels (rule from two measured failures, 2026-08-03)

**Never put variable content (sample display, typed input field, etc.) and fixed labels (counter, note, button, etc.) under the same absolutely positioned wrapper.** Two failure patterns were measured:

1. **Wrapper-relative bottom drift**: `bottom: 60px` inside a centered wrapper (for example 1400×420) means the wrapper's bottom, not the screen bottom. It lands in the screen's middle band and overlaps sample text. Absolutely position fixed labels **directly under the stage (fragment root)** and separate their band from content.
2. **Variable-length content entering the band**: When a button is absolutely positioned at the input's right edge, growing typed text slides under it. Reserve the button band in advance with parent `padding-right`.

After writing a fragment, visually check overlap with fixed labels on a frame containing the **longest content state** (longest string, final typed state, maximum lines).
