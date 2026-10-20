# Text behind person

Place text over the native video, then layer an alpha-bearing person video above it. The visual order must be `base video < text < cutout video`.

## Check current limits first

edit.json v1 does not implement time synchronization for fragment `<video>`. Current preview / export synchronizes only CSS / WAAPI animation `currentTime`, not a fragment `<video>.currentTime`. Adding `data-akari-sync` currently has no effect.

Therefore, do not report moving-person text-behind-person as deterministic, WYSIWYG, or production-ready. Choose one:

- Use a still person alpha PNG / matte.
- Precompose text-behind-person externally into a video asset.
- Wait for video sync in the v1 runtime and verify both preview and export.

Basis: `https://github.com/AkariLabs/akari-video/blob/main/docs/notes-2026-07-13-edit-json-v1.md` §4, `ui/overlay-runtime.js`, `scripts/render-overlays.mjs`

## Matte reference contract

Fix a convention for referencing a person matte (alpha-bearing person video) from a fragment. The data contract is [docs/contract-2026-07-23-analysis-person-matte.md](https://github.com/AkariLabs/akari-video/blob/main/docs/contract-2026-07-23-analysis-person-matte.md), and generation instructions are in [skills/analyze-footage/person-matte.md](../analyze-footage/person-matte.md). This section specifies **only the consuming side** (fragment authoring).

### 1. Source and copying rules

The canonical matte source is `tracks.person_matte` in `analysis.json` (contract §2). At authoring time, the fragment author must:

1. Resolve `person_matte.path` **relative to the directory containing analysis.json** (contract §2 field table). If `null` or unresolvable, treat the matte as absent and fall back to an ordinary telop layout (contract §5 degradation rule).
2. **Copy the resolved asset into the project.** Default destination: `assets/matte/<素材名>-person-matte.webm`.
3. Reference that copy from the fragment by a **path relative to edit.json (project-relative)**.

Do not link directly to the analysis-side path. The matte can live under the source-media directory; a directly linked project breaks when moved, distributed, or reproduced (project self-containment). Preview asset resolution (`resolveAsset` for 3D declarations and `akari-preview-open-handler.ts`) also rejects leading `/` and URL schemes, so absolute paths or `file:` URLs will not work.

**Copy byte for byte; do not re-encode.** Passing it through an ffmpeg decoder can silently lose alpha (contract §3). Trimming (equivalent to `--ss`) is also forbidden because it breaks time-zero alignment (contract §4).

### 2. Reference within the fragment through `data-akari-matte-src`

**Do not hardcode `<video>` `src` in fragment HTML.** The contract uses **`data-akari-matte-src`** injected into the outer container (the runtime-created div directly under `.akari-overlay-container` / `#overlay-stage`). The fragment checks only whether the attribute is present.

This follows the convention of runtime-owned timing attributes `data-start` / `data-duration` (hard rule 2). The reason is also the same: actual URLs vary by path:

| Path | Required actual URL |
|---|---|
| Preview | `http://127.0.0.1:<port>/asset/<id>` (issued by `createAssetStream`, the same path as a 3D `.glb`) |
| Export (render-cut) | The overlay sheet lives at `<projectRoot>/.akari/render-tmp/<run>/overlay-sheet.html`; writing a project-relative path directly resolves three directory levels away |

The fragment may know only the project-relative path; turning it into a path-specific actual URL is the outer layer's responsibility.

When the attribute is absent, **do not show the matte layer**. Declare this using a selector gated by an ancestor attribute (the same approach as `data-akari-active`; see `packages/overlay-runtime/src/overlay-runtime.js`):

```html
<div class="tbp-root">
  <style>
    .tbp-root { position: absolute; inset: 0; isolation: isolate; }
    .tbp-root__text {
      position: absolute; z-index: 1;
      left: var(--text-x, 8%); top: var(--text-y, 42%);
      font-size: var(--font-size, 96px); color: var(--color, #fff);
    }
    /* マット層は既定で出さない。外側コンテナに属性が注入されたときだけ出す。 */
    .tbp-root__matte { display: none; }
    [data-akari-matte-src] .tbp-root__matte {
      display: block;
      position: absolute; inset: 0; z-index: 2;
      width: 100%; height: 100%;
      object-fit: var(--matte-fit, cover);
      object-position: var(--matte-position, 50% 50%);
      pointer-events: none;
    }
  </style>
  <div class="tbp-root__text">正確な日本語テキスト</div>
  <video class="tbp-root__matte" muted playsinline preload="auto"></video>
</div>
```

**Degradation must be only "text appears in front."** If the attribute is absent, the matte cannot load, or it cannot play, text and source video continue to display. A person matte is an effect input and must not determine the success of the underlying video (contract §5).

### 3. Standard three-layer structure (z)

| Layer | Content | In fragment? |
|---|---|---|
| Bottom | Source video (preview `#preview-video` / export composite base) | **No** |
| Middle | Text (`z-index: 1`) | Yes |
| Top | Matte `<video>` (`z-index: 2`, `inset: 0`, `muted`, `playsinline`, `pointer-events: none`) | Yes |

- Set `isolation: isolate` on the fragment root, keeping these two fragment layers in its stacking context (single root = hard rule 6).
- Text `z-index` must be below the matte; reversing them makes an ordinary telop.
- Match the matte `<video>` `object-fit` / `object-position` to the source video crop contract; otherwise the cutout outline drifts from the person behind it.
- Expose adjustable values (text position, size, color, matte fit / position) as CSS variables (hard rule 1). Never redefine the same names on the fragment root and block outer overrides.

### 4. VP9 alpha WebM first; HEVC alpha fallback

- **First choice (default)**: VP9 alpha WebM (`.webm` / `alpha_mode=1` / straight alpha), established in contract §3. It is 1/4.8 the size of HEVC alpha MOV and **does not depend on GPU decoding**. The headless Chrome export path starts with `--disable-gpu` (`packages/render-cut/src/rasterize.mjs`), so defaulting to HEVC would fail on that path.
- **Fallback (second format)**: HEVC alpha MOV. It is a compatibility format only when handing off to Apple tools, not the default recorded in `analysis.json`. The "Apple Vision → HEVC with alpha" and "Robust Video Matting → HEVC with alpha" sections below explain creating this second format yourself.
- The fragment does not identify formats; it only plays what `data-akari-matte-src` points to. The supplier (`analysis.json`) chooses the format. Do not write `<source type="...">` branching in the fragment.

### 5. Poster fallback (insurance for preview limits)

Preview webviews operate under CSP `default-src 'none'; media-src <stream origin>; img-src <stream origin> blob: data:` (`akari-preview-open-handler.ts`). A `data:` **image** is allowed, but media is limited to the issued stream origin. The resolution path that puts a matte on the asset stream is not yet implemented, so matte `<video>` can fail in preview, including when opening a fragment alone.

An optional fallback is **one still matte as a data URI in `poster`**:

```html
<video class="tbp-root__matte" muted playsinline preload="auto"
       poster="data:image/png;base64,iVBORw0KGgo…"></video>
```

- Include **only one** representative alpha PNG frame near the middle of that overlay interval. The default matte generation resolution is 512x384 (`balanced`; measured table in person-matte.md), enough for the poster. Since the entire data URI lives in fragment HTML, reduce PNG resolution if its size becomes excessive.
- Poster still draws when CSP blocks `media`, allowing preview of the **person/text front-back relation**, the point of the effect.
- **A poster is a still. Verify motion in the render.** Never treat seeing the poster as proof the matte moves, or use it alone in place of the final deliverable.

### 6. Determinism

- Matte time corresponds **1:1** to source seconds in `analysis.source` (contract §4). Do not put an offset on the matte.
- **Do not create an independent time source inside the fragment** (hard rules 2 / 4). Never advance the matte with `autoplay`, `loop`, `setTimeout`, or accumulated rAF deltas. The runtime advances `<video>` time; the fragment only declares it.
- Current measurement: Export assigns **composition seconds directly** to every `<video>` (`__akariSeek` in `rasterize.mjs`), without mapping through `cuts[]` to source seconds. A cut using a middle portion of source will misalign the matte. Preview does not touch `<video>.currentTime`. Thus **a moving-person matte is still not production quality** (same conclusion as the initial limits section). A still matte (poster / single frame) is deterministic now.

## Apple Vision → HEVC with alpha

The next two sections describe creating the **second format (HEVC alpha MOV) yourself**. The default generation path is `tracks.person_matte` in `analysis.json` (VP9 alpha WebM), described in [skills/analyze-footage/person-matte.md](../analyze-footage/person-matte.md).

1. Decode source in presentation order and preserve each frame's PTS and orientation.
2. Pass frames sequentially through the same `VNSequenceRequestHandler` to obtain a person mask with `VNGeneratePersonSegmentationRequest`. `.accurate` is a candidate for offline quality, but verify speed and edge quality on actual footage.
3. Do not hardcode camera-specific orientation; apply input orientation and align the mask with the source extent.
4. Composite RGB with the mask as alpha into an alpha-bearing pixel buffer. If uncertain, use Apple's recommended premultiplied alpha.
5. Configure `AVAssetWriterInput` or `VTCompressionSession` with `AVVideoCodecType.hevcWithAlpha`, append in original PTS order, and write `.mov`. Official alpha quality is in 0.0–1.0, but do not invent a fixed value: mark it **needs verification**.
6. Check output-track `.containsAlphaChannel`, duration, fps, frame count, and orientation. Inspect hair, fingers, motion blur, and translucent edges on a checkerboard.
7. Play the asset on real devices in both the new Chromium/Electron shell preview and the Chrome-based export renderer. Codec name alone does not guarantee compatibility. (Old Tauri assumed WKWebView; the new shell standardizes on Chromium.)

Official references:

- [Apple Vision — VNGeneratePersonSegmentationRequest](https://developer.apple.com/documentation/vision/vngeneratepersonsegmentationrequest)
- [Apple Vision — VNSequenceRequestHandler](https://developer.apple.com/documentation/vision/vnsequencerequesthandler)
- [Apple — Applying Matte Effects to People in Images and Video](https://developer.apple.com/documentation/vision/applying-matte-effects-to-people-in-images-and-video)
- [Apple — HEVC Video with Alpha](https://developer.apple.com/videos/play/wwdc2019/506/)
- [Apple — AVVideoCodecType.hevcWithAlpha](https://developer.apple.com/documentation/avfoundation/avvideocodectype/hevcwithalpha)
- [Apple — AVMediaCharacteristic.containsAlphaChannel](https://developer.apple.com/documentation/avfoundation/avmediacharacteristic/containsalphachannel)

## Robust Video Matting → HEVC with alpha

1. Check the RVM license first. Its official repository is GPL-3.0; do not bundle or copy its code or model into this MIT repository. Even when used as an external step, record version, license, and source in provenance.
2. Preserve frame order and pass RVM recurrent state to the next frame to obtain foreground (`fgr`) and alpha (`pha`). Do not process frames independently in parallel.
3. The official converter's `output_foreground` / `output_alpha` are separate outputs, not direct HEVC-alpha output.
4. For premultiplied alpha, form an alpha-bearing frame with `RGB = fgr * pha`, `A = pha`, and compare against original fps / PTS.
5. Pass it to the same AVFoundation HEVC-alpha encoder as the Apple Vision path and perform the same verification.

Official references: [Robust Video Matting repository](https://github.com/PeterL1n/RobustVideoMatting), [RVM inference guide](https://github.com/PeterL1n/RobustVideoMatting/blob/master/documentation/inference.md)

## DOM z order

Put text and cutout video in the same coordinate system inside one root. This is a minimal skeleton; the canonical form, including how to provide `src`, default hiding, and poster fallback, is in "Matte reference contract" above.

```html
<div class="tbp-root">
  <style>
    .tbp-root { position: absolute; inset: 0; isolation: isolate; }
    .tbp-root__text { position: absolute; z-index: 1; }
    .tbp-root__matte { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
  </style>
  <div class="tbp-root__text">正確な日本語テキスト</div>
  <video class="tbp-root__matte" muted playsinline preload="auto"></video>
</div>
```

- Set text z-index below cutout video.
- Match `<video>` `object-fit` / `object-position` to the base-video crop contract.
- Expose `--text-x`, `--text-y`, `--font-size`, `--matte-fit`, `--matte-position`, etc. as knobs.
- Do not entrust alpha video to autoplay / loop. A future runtime contract must set `currentTime` of a `data-akari-sync` video to the overlay local timeline.
- Live-preview resolution of relative video URLs is not yet in place, so mark it **needs verification**.

## Common mistakes

- Claiming `data-akari-sync` is already implemented.
- Hardcoding matte `<video>` `src` in a fragment (cannot resolve in either preview or export).
- Linking directly to the analysis-side matte and breaking project self-containment.
- Re-encoding a matte with ffmpeg when copying it into the project and silently losing alpha.
- Leaving a black or empty matte rectangle over the person when `data-akari-matte-src` is absent.
- Treating visible poster as proof that the matte moves.
- Autoplaying alpha video and hoping it happens to align with the base video.
- Putting text in front of the person layer, reverting to an ordinary telop.
- Mismatching crop / orientation / fps / PTS between base and cutout.
- Hardcoding a Vision sample's camera orientation for every video.
- Dropping RVM recurrent state and processing frames independently.
- Mistaking RVM foreground / alpha outputs for a finished HEVC-alpha file.
- Copying GPL-3.0 RVM code or model into this repository.
- Assuming that success in the new Chromium/Electron shell preview guarantees the same behavior in the headless Chrome export renderer without verifying it. (Old Tauri assumed Safari / WKWebView; the new shell standardizes on Chromium.)
