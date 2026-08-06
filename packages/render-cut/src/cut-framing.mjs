// docs/contract-2026-07-22-render-basics.md #6 (cuts[].framing). Static crop and scale-keyframe
// zoom, both expressed as an output-canvas-relative window: a rectangle inside the already
// width x height-fitted frame that gets cropped out and rescaled back up to fill the canvas
// (the standard "punch in" technique). Operates on the *fitted* frame -- callers must invoke
// this after the existing scale+pad-to-canvas step (see cut-transform.mjs), never on the raw
// source frame, so 0..1 fractions map 1:1 onto final output pixels (this is what makes the
// static-crop pixel assertion in cut-framing.test.mjs exact rather than approximate).
//
// When both `crop` and `keyframes` are declared on the same cut, keyframes win (documented in
// the render-basics contract) -- crop is really just the single-point degenerate case of a zoom
// window, so there is no meaningful way to "combine" both without one silently overriding parts
// of the other; picking one deterministically avoids ambiguity.

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isUsableCrop(crop) {
  return Boolean(crop) && typeof crop === "object"
    && isFiniteNumber(crop.x) && isFiniteNumber(crop.y)
    && isFiniteNumber(crop.w) && crop.w > 0
    && isFiniteNumber(crop.h) && crop.h > 0;
}

function isUsableKeyframePoint(point) {
  return point && typeof point === "object"
    && isFiniteNumber(point.t) && point.t >= 0
    && isFiniteNumber(point.scale) && point.scale > 0;
}

function usableKeyframes(keyframes) {
  if (!Array.isArray(keyframes)) return null;
  const points = keyframes.filter(isUsableKeyframePoint);
  return points.length >= 2 ? points : null;
}

export function hasUsableFraming(framing) {
  if (!framing || typeof framing !== "object") return false;
  return usableKeyframes(framing.keyframes) !== null || isUsableCrop(framing.crop);
}

export function hasCutFraming(cuts) {
  return Array.isArray(cuts) && cuts.some((cut) => cut && typeof cut === "object" && hasUsableFraming(cut.framing));
}

// Appends the crop(+rescale) filter for one cut's framing onto `filters`, from `inputLabel`
// (a width x height frame) to `outputLabel` (the same width x height, re-composed from the
// cropped window). Assumes hasUsableFraming(framing) is true; callers gate on that so the
// no-framing case never emits this filter at all (see cut-transform.mjs).
export function appendCutFraming({ filters, inputLabel, outputLabel, framing, width, height, id }) {
  const keyframes = usableKeyframes(framing.keyframes);
  if (keyframes) {
    appendKeyframeZoom({ filters, inputLabel, outputLabel, keyframes: keyframes.slice().sort((a, b) => a.t - b.t), width, height, id });
    return;
  }
  appendStaticCrop({ filters, inputLabel, outputLabel, crop: framing.crop, width, height });
}

function appendStaticCrop({ filters, inputLabel, outputLabel, crop, width, height }) {
  const cropW = clampRange(crop.w * width, 2, width);
  const cropH = clampRange(crop.h * height, 2, height);
  const cropX = clampRange(crop.x * width, 0, width - cropW);
  const cropY = clampRange(crop.y * height, 0, height - cropH);
  filters.push(
    `${inputLabel}crop=w=${formatNumber(cropW)}:h=${formatNumber(cropH)}:x=${formatNumber(cropX)}:y=${formatNumber(cropY)},scale=${width}:${height}${outputLabel}`,
  );
}

// 2 points -> a single linear zoom ramp (in or out). 3+ points -> a piecewise-linear staged
// zoom (e.g. shrink, then shrink again). Center (cx, cy) defaults to frame-center (0.5, 0.5)
// per point when omitted, and is itself interpolated the same way as scale, so a keyframe set
// can pan while it zooms.
//
// Implementation notes (all verified empirically against the ffmpeg on this machine):
// 1. `crop`'s own w/h expressions are only evaluated once, at filter init -- there is no
//    working `eval=frame` for crop's size (a `t`-referencing crop w/h errors with "Error when
//    evaluating the expression", while the identical expression in x/y works fine). So the zoom
//    itself is done the other way around: `scale` DOES support per-frame w/h expressions
//    (`eval=frame` -- undocumented in `-h filter=scale`'s AVOptions dump on this build, but
//    functional), so the fitted frame is scaled UP by scale(t) (>=1; scale<1 would ask to
//    reveal beyond the original frame, which a crop-based technique cannot do, so it is clamped
//    to 1 -- a stated v0 boundary), then a FIXED width x height window is cropped out of that
//    larger frame.
// 2. crop's `iw`/`ih` constants do NOT track the true per-frame size coming out of a
//    variable-size upstream scale -- they reflect the negotiated (link) size instead, which
//    stays pinned to the *first* frame's dimensions (verified empirically: a pan/zoom built on
//    `x='cx*iw-out_w/2'` silently used the t=0 frame size for every subsequent frame, putting
//    the crop window in the wrong place as soon as the zoom actually changed size). So cropX/Y
//    below recompute the same scaledWidth/Height expression directly from `t` instead of
//    reading it back off the frame -- redundant symbolically, but the only value `crop` can see
//    that is actually current.
// 3. **Left/right flicker investigation (2026-08-06, ws:framing-zoom-flicker)**: three candidate
//    causes were probed empirically (checkerboard-fixture edge tracking + `showinfo`, see
//    evidence/ under the task record) before picking a fix, rather than guessing:
//    a. `scale`'s `eval=frame` w/h expressions are floats, but the filter negotiates an *actual*
//       integer frame size per frame (verified via `showinfo`: this build truncates/floors, not
//       rounds). The old code recomputed cropX/Y's "current scaled width/height" from the *raw,
//       unrounded* float (`width*scale(t)`), which is always >= the true truncated width scale
//       actually produced -- so crop's own internal edge-clamp and this file's clip() bound
//       could silently disagree on some frames and not others. This is a real self-consistency
//       gap and is fixed below (both `scale`'s own w/h and cropX/Y's recomputation now read the
//       literal same already-rounded expression string, and that rounding is to *even* -- not
//       just integer -- to also stay aligned to the yuv420 chroma subsampling grid, the same
//       convention `cut-transform.mjs`'s own scale step already uses:
//       `trunc(iw*scale/2)*2`). Measured impact *alone*, isolated via an A/B render: negligible
//       (frame-to-frame jitter stdev ~0.51px before and after) -- so this was not the dominant
//       cause, just a latent correctness gap worth closing regardless.
//    b. Interpolation quality (`scale` defaults to bilinear): tested by adding `flags=lanczos`
//       to the per-frame zoom `scale` alone. Also measured negligible effect (~0.51px stdev,
//       unchanged). This makes sense in hindsight -- interpolation flags only change how *pixel
//       values* are reconstructed when magnifying, not the *positional* precision of where
//       `crop` places its window, which is the actual bottleneck (next point).
//    c. **Confirmed dominant cause**: `crop`'s `x`/`y` are only ever representable at whole
//       output-pixel positions -- ffmpeg has no fractional-pixel crop. A continuously changing
//       `scale(t)` therefore gets unavoidably quantized to a 1px-stepped staircase every frame;
//       compared against the smooth trajectory a real zoom implies, that staircase is exactly
//       what reads as a snapping left/right shimmer on fine periodic detail (checkerboards,
//       grids, or any regular texture) even though each individual frame is internally
//       consistent. Verified by supersampling the crop/zoom math at `SUPERSAMPLE`x the canvas
//       resolution (upscale first, so the same 1px `crop` quantization step becomes
//       1/SUPERSAMPLE of a true output pixel, then downscale back with a quality filter):
//       shrinking the quantization step this way shrinks the measured jitter proportionally
//       (checkerboard fixture, SUPERSAMPLE=1/2/4 -> jitter stdev 0.51px/0.26px/0.13px), which
//       only a positional (not value) precision fix would do -- confirming (c) over (a)/(b).
//
// `t` is evaluated by ffmpeg per output frame against the cut-local clock, which is already
// rebased to 0 by the preceding setpts=PTS-STARTPTS step, so keyframes[].t (cut-local seconds,
// per the schema) lines up directly with no further offset.
//
// SUPERSAMPLE=2 roughly halves the frame-to-frame positional jitter (measured: 0.51px -> 0.26px
// stdev, 47->24 direction reversals per 59 consecutive-frame-pairs on the checkerboard fixture)
// at a bounded cost (crop/scale operate on a 4x-pixel-count intermediate canvas, only for cuts
// that actually declare a zoom). Picked over 4x: still a clear, visible improvement per the task
// contract's own suggested fix, without doubling the supersampled canvas' pixel count again.
const SUPERSAMPLE = 2;

function appendKeyframeZoom({ filters, inputLabel, outputLabel, keyframes, width, height, id }) {
  const ssWidth = width * SUPERSAMPLE;
  const ssHeight = height * SUPERSAMPLE;
  const scaleExpr = piecewiseLinearExpr(keyframes.map((k) => ({ t: k.t, value: k.scale })));
  const clampedScaleExpr = `max(1\\,${scaleExpr})`;
  // Even-integer-rounded (not raw float) so this exact string, reused verbatim below in both
  // `scale`'s own w/h and crop's x/y clip bounds, is what `scale` actually negotiates per frame
  // -- see implementation note 3a above. All math below operates in the supersampled (ssWidth x
  // ssHeight) canvas, per note 3c.
  const scaledWidthExpr = `trunc((${ssWidth}*(${clampedScaleExpr}))/2)*2`;
  const scaledHeightExpr = `trunc((${ssHeight}*(${clampedScaleExpr}))/2)*2`;
  const cxExpr = piecewiseLinearExpr(keyframes.map((k) => ({ t: k.t, value: isFiniteNumber(k.cx) ? k.cx : 0.5 })));
  const cyExpr = piecewiseLinearExpr(keyframes.map((k) => ({ t: k.t, value: isFiniteNumber(k.cy) ? k.cy : 0.5 })));
  const cropXExpr = `trunc(clip((${cxExpr})*(${scaledWidthExpr})-${ssWidth}/2\\,0\\,(${scaledWidthExpr})-${ssWidth})/2)*2`;
  const cropYExpr = `trunc(clip((${cyExpr})*(${scaledHeightExpr})-${ssHeight}/2\\,0\\,(${scaledHeightExpr})-${ssHeight})/2)*2`;
  filters.push(
    `${inputLabel}scale=w=${ssWidth}:h=${ssHeight}:flags=lanczos,`
      + `scale=w='${scaledWidthExpr}':h='${scaledHeightExpr}':eval=frame,`
      + `crop=w=${ssWidth}:h=${ssHeight}:x='${cropXExpr}':y='${cropYExpr}',`
      + `scale=w=${width}:h=${height}:flags=lanczos${outputLabel}`,
  );
}

// Builds a piecewise-linear expression of `t` over `points` (sorted ascending by `t`): holds
// points[0].value before the first timestamp, holds the last value after the final one, and
// linearly interpolates between consecutive points otherwise. Commas inside a single filter
// option must be backslash-escaped (matches the convention already used for cut-transform.mjs's
// rotate/scale expressions) since ffmpeg's own filter-graph syntax uses unescaped commas to
// separate chained filters.
function piecewiseLinearExpr(points, tVar = "t") {
  if (points.length === 1) return formatNumber(points[0].value);
  let expr = formatNumber(points[points.length - 1].value);
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const start = points[index];
    const end = points[index + 1];
    const span = end.t - start.t;
    const localExpr = span > 0
      ? `${formatNumber(start.value)}+(${formatNumber(end.value)}-${formatNumber(start.value)})*(${tVar}-${formatNumber(start.t)})/(${formatNumber(span)})`
      : formatNumber(end.value);
    expr = `if(lt(${tVar}\\,${formatNumber(end.t)})\\,${localExpr}\\,${expr})`;
  }
  return `if(lt(${tVar}\\,${formatNumber(points[0].t)})\\,${formatNumber(points[0].value)}\\,${expr})`;
}

function clampRange(value, minimum, maximum) {
  if (maximum <= minimum) return minimum;
  return Math.min(Math.max(value, minimum), maximum);
}

function formatNumber(value) {
  return Number(Number(value).toFixed(6)).toString();
}
