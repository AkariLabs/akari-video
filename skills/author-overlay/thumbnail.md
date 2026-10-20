# Thumbnail design

Output a still thumbnail at **1280×720**. Make multiple candidates, show variations in headline text, and place them at the start of the editorial decision report. The contract has no universal threshold for the number of candidates: choose from the request and the hypothesis to compare, and do not invent an unsupported "standard count".

## Choose a pattern from the situation

| Situation / genre | First candidate pattern | Caution |
|---|---|---|
| How-to / software | Evidence frame of UI + focal area + short result headline | Crop the area to show; do not shrink the whole UI |
| Product / feature announcement | Product hero + benefit + small category tag | Do not distort the logo, shape, or UI through generation |
| Interview / person-led explanation | Readable expression + topic or opposing viewpoint | Do not overprocess faces; leave text space in the gaze direction |
| Comparison / review | Split / versus + subjects + judgment word | Match scales and conditions on both sides; do not fabricate a winner |
| Before / after | Two views under the same conditions + change | Do not present material shot under different conditions as comparable |
| List / roundup | One hero subject + number or category badge | Do not crowd small elements or confuse it with the list in the video |
| Incident / story / documentary | Key object / place + short question creating tension | Do not depict an unsupported claim or fabricated event |

Choose by what the video proves after the click, not genre alone. Adopt only thumbnails that stand alone and make a promise the video fulfills.

## Design vocabulary

### Background treatments

| Technique | Purpose | HTML/CSS implementation hint |
|---|---|---|
| crop / focal crop | Make the subject large | Parameterize `<img>` `object-fit: cover` and `object-position` |
| gradient wash | Build contrast behind text | Use a pseudo-element linear / radial gradient |
| vignette | Darken the perimeter to draw attention inward | Pseudo-element radial-gradient; do not use CSS blur |
| duotone / color wash | Unify a series | Overlay a translucent blend layer without erasing the original evidence |
| cutout silhouette | Separate person or product from background | Use a prepared alpha PNG / HEVC and inspect the edge |
| split field | Distinguish comparison subjects instantly | Use two Grid regions and a dividing line |

If background blur is needed, preprocess the still image. Do not base the design on `filter: blur()` / `backdrop-filter`, which are forbidden in video overlays.

### FX

| Technique | Purpose | HTML/CSS implementation hint |
|---|---|---|
| outline / keyline | Separate the subject edge | Offset a duplicate silhouette behind an alpha cutout |
| halftone | Information / comic texture | radial-gradient pattern layer |
| speed lines | Motion and direction | repeating-conic / repeating-linear gradient |
| accent ray | Radiate from the focus | Mask a conic-gradient and restrain its opacity |
| hard offset shadow | Depth and pop | box/text shadow with little blur, or translated duplicate layer |
| sticker / tape | Secondary label | Small transformed tag; never stronger than the main claim |

### Text emphasis

| Technique | Purpose | HTML/CSS implementation hint |
|---|---|---|
| stroke | Separate text from background | Combine `-webkit-text-stroke` with normal fill |
| highlight band | Emphasize only a keyword | Background color and padding on an inline span |
| two-tone keyword | Contrast meanings | Change `--accent` on a keyword span |
| condensed stack | Stack a short large headline | Explicit breaks and line-height; do not rely on automatic wrapping |
| label + headline | Separate category from claim | Small tag and large headline in different hierarchy |
| hard shadow | Keep an edge at small display size | Offset duplicate text behind with `aria-hidden` |

For language-specific thumbnail text, follow the selected language pack. Never entrust accurate headlines, logos, or UI to an image generation model.

## Choose a route

### Route A — real frame + HTML text

Choose when:

- The video contains a strong evidence frame: face, product, UI, result, etc.
- Words, numbers, logos, or UI must be displayed accurately.
- Fabricated facts from generation must be avoided.

Crop / grade a real frame, then overlay only text, badges, arrows, and comparison lines with HTML/CSS.

### Route B — Codex image generation

Choose when:

- No usable real frame exists.
- An abstract concept, world, or illustration is central and photographic evidence is unnecessary.
- The generated nature and provenance can be recorded.

Generate a text-free composition and record the generator, prompt, and date. Do not fall back to calling an API key directly. If image generation is unavailable, return to A or pause production.

> **Measured (2026-07-14)**: Through `codex exec --skip-git-repo-check`, a 16:9, text-free background PNG (1664×936, 1.7MB) was visibly confirmed as a real file after about 93 seconds. See [plan-edit/approvals-and-generation.md](../plan-edit/approvals-and-generation.md), "Method 1 (Codex image generation) live verification", for invocation, preflight, and the known account-usage-limit failure mode.

### Hybrid — B background + A text

Choose when a custom backdrop is necessary but words, branding, or numbers must stay accurate. Ask B for space but no text, logos, or UI; add the final words and official asset in A's HTML layer.

## HTML → screenshot procedure for `examples/`

There is currently no thumbnail-specific CLI. Open a frame-engine preview at the requested size and capture a still.

1. Create `examples/local/thumbnails/<slug>/index.html`. `examples/local/` is a gitignored prototype area.
2. Set `html, body` and a single sheet to 1280×720, margin 0, overflow hidden. Specify a background; use local relative URLs below that directory for images and fonts.
3. Expose text, color, crop, and accent as CSS variables. Put final text in HTML, following the selected language pack.
4. Ensure fonts and images are loaded and the fixed preview time produces a stable result.
5. Display the app preview at 1280×720 and a fixed time, then take one PNG.

6. Confirm **1280×720** with `sips -g pixelWidth -g pixelHeight .../thumbnail.png`.
7. Inspect the PNG visually for clipped text, font fallback, crop, contrast, spelling, and safe zones. Move the adopted PNG to a project deliverable outside gitignored areas.

The official recommendation for YouTube video ads is also 1280×720, 16:9, but this skill fixes 1280×720 as the user-specified AKARI output contract. Source: [Google Ads Help — About video ad specs](https://support.google.com/google-ads/answer/13547298?hl=en).

## Common mistakes

- Generating an unsupported result, emotion, person, or UI and presenting it as fact.
- Asking an image generation model to draw exact text or logos.
- Giving the background, person, text, arrows, and badges equal visual strength.
- Shrinking an entire real frame so tiny UI becomes unreadable.
- Scaling a 16:9 sheet with CSS transforms without checking actual PNG dimensions.
- Relying on network fonts or CDN images that disappear in headless output.
- Treating a prototype PNG in `examples/local` as the final deliverable location.
