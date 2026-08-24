import { spawnSync } from "node:child_process";

// contract-2026-08-09-transform-keyframes-v0.md: layers[].keyframes -- a common time-varying
// mechanism for a layer's transform (x/y/scale/rotate), crop, and perspective (4 corners),
// modeled after cuts[].framing.keyframes' "array of {t, ...partial state}" shape (see
// cut-framing.mjs) rather than per-property tracks. This module builds the ffmpeg per-frame
// expressions/filter steps; layers.mjs only calls into it when hasUsableLayerKeyframes(layer) is
// true, so a keyframe-less layer (the overwhelming majority of existing projects) never runs this
// code path at all -- byte-identical output, zero regression risk.
//
// t-origin gotcha: keyframes[].t is layer-local seconds (contract), but the `t` ffmpeg exposes
// inside a layer's own per-frame filter chain is NOT layer-local for every layer -- it depends on
// which compositing path layers.mjs takes. The "normal" blend path (buildLayersCompositeCommand's
// isNormal branch) never applies setpts=PTS-STARTPTS, so `t` there still carries the absolute
// base-timeline clock (shifted by -itsoffset layer.t, so it ranges over
// [layer.t, layer.t+layer.duration]); the non-normal (blend-mode) path DOES rebase via
// setpts=PTS-STARTPTS, so `t` there is already 0-based/layer-local. Every expression builder below
// takes the caller-resolved `localTExpr` string instead of assuming either convention, so
// layers.mjs picks the right one per blend path (see its own comment at the call site).

const EASINGS = new Set(["linear", "ease-in-out"]);
const TRANSFORM_LEAF_DEFAULTS = { x: 0, y: 0, scale: 1, rotate: 0 };

// Keep this numerically aligned with cut-framing.mjs's SUPERSAMPLE. It is intentionally local:
// cut-framing's constant is private to a different rendering mechanism, while this module owns
// the native-source-relative layer keyframe grid. Sharing the value through either implementation
// module would couple two otherwise independent filter builders merely to save one literal.
export const LAYER_KEYFRAME_SUPERSAMPLE = 2;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberOr(value, fallback) {
  return isFiniteNumber(value) ? value : fallback;
}

function easingOf(point) {
  return EASINGS.has(point?.easing) ? point.easing : "linear";
}

// Sorted (t ascending), >=2 usable points, or null (caller falls back to the layer's static
// transform/crop/perspective entirely -- matches cut-framing.mjs's usableKeyframes contract).
function usableLayerKeyframePoints(keyframes) {
  if (!Array.isArray(keyframes)) return null;
  const points = keyframes.filter((point) => isPlainObject(point) && isFiniteNumber(point.t) && point.t >= 0);
  const sorted = points.slice().sort((a, b) => a.t - b.t);
  return sorted.length >= 2 ? sorted : null;
}

export function hasUsableLayerKeyframes(layer) {
  return usableLayerKeyframePoints(layer?.keyframes) !== null;
}

function isUsableCropShape(crop) {
  return isPlainObject(crop) && isFiniteNumber(crop.x) && isFiniteNumber(crop.y)
    && isFiniteNumber(crop.w) && crop.w > 0 && isFiniteNumber(crop.h) && crop.h > 0;
}

function isUsablePerspectiveShape(perspective) {
  if (!isPlainObject(perspective)) return false;
  const corners = perspective.corners;
  if (!Array.isArray(corners) || corners.length !== 4) return false;
  return corners.every((corner) => Array.isArray(corner) && corner.length === 2
    && isFiniteNumber(corner[0]) && isFiniteNumber(corner[1]));
}

// Points declaring `category` (transform/crop/perspective), in t order, or null if none do --
// "declaring" is per-point-and-whole-category (a point either has a usable transform/crop/
// perspective sub-object, or it doesn't; there is no per-leaf-field granularity within a
// category), matching #layerKeyframe's schema $comment.
function declaringPoints(points, category, isUsable) {
  const declaring = points.filter((point) => isUsable(point[category]));
  return declaring.length > 0 ? declaring : null;
}

function formatNumber(value) {
  return Number(Number(value).toFixed(6)).toString();
}

function clamp(value, minimum, maximum) {
  if (maximum <= minimum) return minimum;
  return Math.min(Math.max(value, minimum), maximum);
}

// easeInOutCubic(u) = u<0.5 ? 4u^3 : 1-(-2u+2)^3/2 -- a standard, simple, monotonic (0,0)->(1,1)
// cubic ease. render-cut/shell/web each implement this exact formula independently (numeric on
// the two preview surfaces, as an ffmpeg expression here) per the 3-surface duplication convention
// (contract-2026-08-02-preview-parity.md §2.2.1) -- keep any change to the formula in sync across
// all three, or the "linear" and "ease-in-out" easings will visibly drift between preview and
// export.
function easeInOutCubicAt(u) {
  return u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2;
}

function easeExprFor(easing, uExpr) {
  if (easing !== "ease-in-out") return uExpr;
  return `if(lt(${uExpr}\\,0.5)\\,4*pow(${uExpr}\\,3)\\,1-pow(-2*(${uExpr})+2\\,3)/2)`;
}

// Builds a piecewise ffmpeg expression of `tVar` over `points` (already t-ascending): holds
// points[0]'s value before the first timestamp, holds the last value after the final one, and
// interpolates between consecutive points otherwise -- linearly, or eased, per the *arriving*
// point's own easing (#layerKeyframe: a point's easing governs the segment ending at that point).
// Mirrors cut-framing.mjs's piecewiseLinearExpr, generalized with the easing branch.
function piecewiseExpr(points, pickValue, tVar) {
  if (points.length === 1) return formatNumber(pickValue(points[0]));
  let expr = formatNumber(pickValue(points[points.length - 1]));
  for (let index = points.length - 2; index >= 0; index -= 1) {
    const start = points[index];
    const end = points[index + 1];
    const span = end.t - start.t;
    const startValue = pickValue(start);
    const endValue = pickValue(end);
    let localExpr;
    if (span > 0) {
      const uExpr = `((${tVar})-${formatNumber(start.t)})/(${formatNumber(span)})`;
      const easedExpr = easeExprFor(easingOf(end), uExpr);
      localExpr = `${formatNumber(startValue)}+(${formatNumber(endValue)}-${formatNumber(startValue)})*(${easedExpr})`;
    } else {
      localExpr = formatNumber(endValue);
    }
    expr = `if(lt(${tVar}\\,${formatNumber(end.t)})\\,${localExpr}\\,${expr})`;
  }
  return `if(lt(${tVar}\\,${formatNumber(points[0].t)})\\,${formatNumber(pickValue(points[0]))}\\,${expr})`;
}

// Numeric twin of piecewiseExpr (same hold/interpolate/ease semantics), evaluated at a concrete
// time instead of emitted as an expression string. Used by this module's own perspective sampling
// (below) and by render-cut's tests to sanity-check the expressions above actually match.
export function piecewiseValueAt(points, pickValue, t) {
  if (points.length === 1) return pickValue(points[0]);
  if (t <= points[0].t) return pickValue(points[0]);
  const last = points[points.length - 1];
  if (t >= last.t) return pickValue(last);
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (t >= start.t && t <= end.t) {
      const span = end.t - start.t;
      if (span <= 0) return pickValue(end);
      const u = (t - start.t) / span;
      const eased = easingOf(end) === "ease-in-out" ? easeInOutCubicAt(u) : u;
      return pickValue(start) + (pickValue(end) - pickValue(start)) * eased;
    }
  }
  return pickValue(last);
}

// ---- transform (x/y/scale/rotate) ----------------------------------------------------------

// Returns null when no keyframe point declares `transform` at all (caller keeps the existing
// static x/y/scale/rotate reads verbatim). Otherwise returns ffmpeg expression strings (in terms
// of `localTExpr`) for each leaf, plus whether rotate actually varies across the declaring points
// (min !== max) -- callers only need the expensive fixed-bounding-box rotate technique when it
// does; a keyframed layer that only animates e.g. scale should keep using the cheap static
// `ow=rotw(angle):oh=roth(angle)` sizing for its (constant) rotate value.
export function layerTransformKeyframeExprs(layer, localTExpr) {
  const points = usableLayerKeyframePoints(layer?.keyframes);
  if (!points) return null;
  const declaring = declaringPoints(points, "transform", isPlainObject);
  if (!declaring) return null;

  const leaf = (name) => declaring.map((point) => ({
    t: point.t,
    value: numberOr(point.transform[name], TRANSFORM_LEAF_DEFAULTS[name]),
    easing: point.easing,
  }));
  const scaleLeaf = leaf("scale").map((p) => ({ ...p, value: p.value > 0 ? p.value : 1 }));
  const rotateLeaf = leaf("rotate");
  const scaleValues = scaleLeaf.map((p) => p.value);
  const rotateValues = rotateLeaf.map((p) => p.value);
  const rotateVaries = Math.max(...rotateValues) !== Math.min(...rotateValues);

  return {
    xExpr: piecewiseExpr(leaf("x"), (p) => p.value, localTExpr),
    yExpr: piecewiseExpr(leaf("y"), (p) => p.value, localTExpr),
    scaleExpr: piecewiseExpr(scaleLeaf, (p) => p.value, localTExpr),
    rotateExpr: piecewiseExpr(rotateLeaf, (p) => p.value, localTExpr),
    rotateVaries,
    rotateMin: Math.min(...rotateValues),
    rotateMax: Math.max(...rotateValues),
    scaleDeclared: declaring.some((point) => isFiniteNumber(point.transform.scale)),
    scaleVaries: Math.max(...scaleValues) !== Math.min(...scaleValues),
    scaleMax: Math.max(...scaleValues),
  };
}

// ---- crop -------------------------------------------------------------------------------------

// Returns null when no keyframe point declares a usable `crop` (caller keeps the existing static
// crop step verbatim). Otherwise returns the filter step(s) to push in place of the static crop
// step, immediately after `format=yuva420p` (same position the static crop step occupies).
//
// ffmpeg's crop filter cannot evaluate its own w/h per frame at all -- verified empirically
// against this machine's ffmpeg 8.1.1 (`crop=w='trunc((100+20*t)/2)*2':...` fails with "Error when
// evaluating the expression"; there is no `eval` option on crop, unlike scale/perspective/rotate,
// and only x/y are re-evaluated per frame automatically). cut-framing.mjs's own header comment
// documents the same constraint for its analogous zoom feature and works around it by scaling the
// frame instead of resizing crop's own window; this generalizes that trick from one shared zoom
// factor to two independent (x-axis, y-axis) crop fractions:
//   1. anisotropically scale the whole frame so that a FIXED (SW, SH) window, positioned at the
//      right spot, always covers exactly the declared [x(t)..x(t)+w(t)] x [y(t)..y(t)+h(t)]
//      fraction of the original frame (scale is one of the filters that DOES support eval=frame
//      w/h, confirmed by cut-framing.mjs's own appendKeyframeZoom);
//   2. crop that FIXED (SW, SH) window out -- crop's own w/h are now plain numeric constants
//      (no per-frame variance requested of crop itself), only x/y vary, which crop already
//      supports natively;
//   3. scale the (SW, SH) result back down to the true time-varying box size (w(t)*SW, h(t)*SH)
//      -- this is what makes layers[].keyframes[].crop shrink/grow the layer's own on-screen
//      footprint over time, matching the *static* layers[].crop's "no rescale, box just gets
//      smaller" semantics (unlike cuts[].framing's keyframe zoom, which punches back up to fill
//      the canvas -- these are different mechanisms for different things, same as their static
//      counterparts already are).
// SW/SH must be the layer source's own native pixel size (probeLayerSourceSize) -- NOT `iw`/`ih`,
// because crop's x/y position expressions below need to recompute "the current scaled width" from
// `t` directly (the same redundant-recomputation discipline cut-framing.mjs's implementation note
// 2 documents: a filter's own iw/ih reflect the negotiated *first-frame* link size, not the true
// current per-frame size, once a variable-size filter sits upstream of it).
//
// `extraScaleExpr`, when given, folds an *additional* uniform scale factor (layers[].transform's
// own keyframed scale) into this function's own final scale-down step instead of layers.mjs
// emitting a second, separate `scale=` filter after this one. This is not just an optimization:
// verified empirically against this machine's ffmpeg 8.1.1 that a `scale` filter's `eval=frame`
// w/h expressions reading `iw`/`ih` do NOT see a truly-changing size when the immediately
// upstream filter is *also* a variable-size `scale` (both report frame 0's negotiated link size
// for every subsequent frame) -- even though the very same downstream-reads-upstream-iw pattern
// works correctly when the downstream filter is `pad` instead of `scale` (also verified). Folding
// avoids ever emitting two `scale` filters back to back for this layer.
export function layerCropKeyframeSteps(layer, localTExpr, sourceWidth, sourceHeight, extraScaleExpr = null) {
  const points = usableLayerKeyframePoints(layer?.keyframes);
  if (!points) return null;
  const declaring = declaringPoints(points, "crop", isUsableCropShape);
  if (!declaring) return null;
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return null;

  const track = (leaf) => declaring.map((point) => ({ t: point.t, value: point.crop[leaf], easing: point.easing }));
  const wExpr = piecewiseExpr(track("w"), (p) => clamp(p.value, 0.01, 1), localTExpr);
  const hExpr = piecewiseExpr(track("h"), (p) => clamp(p.value, 0.01, 1), localTExpr);
  const xExpr = piecewiseExpr(track("x"), (p) => p.value, localTExpr);
  const yExpr = piecewiseExpr(track("y"), (p) => p.value, localTExpr);

  const SW = Math.round(sourceWidth);
  const SH = Math.round(sourceHeight);
  const scaledWExpr = `trunc((${SW}/(${wExpr}))/2)*2`;
  const scaledHExpr = `trunc((${SH}/(${hExpr}))/2)*2`;
  const cropXExpr = `trunc(clip((${xExpr})*(${scaledWExpr})\\,0\\,(${scaledWExpr})-${SW})/2)*2`;
  const cropYExpr = `trunc(clip((${yExpr})*(${scaledHExpr})\\,0\\,(${scaledHExpr})-${SH})/2)*2`;
  const finalWFactor = extraScaleExpr ? `(${wExpr})*(${extraScaleExpr})` : `(${wExpr})`;
  const finalHFactor = extraScaleExpr ? `(${hExpr})*(${extraScaleExpr})` : `(${hExpr})`;
  const finalWExpr = `trunc((${SW}*${finalWFactor})/2)*2`;
  const finalHExpr = `trunc((${SH}*${finalHFactor})/2)*2`;

  return [
    `scale=w='${scaledWExpr}':h='${scaledHExpr}':eval=frame`,
    `crop=w=${SW}:h=${SH}:x='${cropXExpr}':y='${cropYExpr}'`,
    `scale=w='${finalWExpr}':h='${finalHExpr}':eval=frame`,
  ];
}

// Fixed-canvas supersampled path for layers[].keyframes crop and/or transform.scale. The caller
// deliberately limits this to combinations whose downstream semantics remain stable (normal
// blend, no perspective/rotate): perspective defines its corners against the processed bitmap
// bounds, so feeding it a max-sized transparent canvas would change the declared geometry.
//
// Unlike layerCropKeyframeSteps's compatibility path, every returned frame has one invariant
// output size. The visible bitmap grows/shrinks inside that transparent canvas at 2x resolution;
// the final Lanczos reduction turns one supersampled grid step into half an output pixel and keeps
// overlay_w/overlay_h constant, removing the old parity-dependent `(main-overlay)/2` reversal.
// `sourceWidth`/`sourceHeight` describe the stream arriving at these steps. For a scale-only layer
// with a static crop, layers.mjs emits that crop first and passes its even-rounded dimensions here.
export function layerFixedCanvasKeyframeSteps({
  layer,
  localTExpr,
  sourceWidth,
  sourceHeight,
  scaleExpr = "1",
  scaleMax = 1,
}) {
  const points = usableLayerKeyframePoints(layer?.keyframes);
  if (!points || !(sourceWidth > 0) || !(sourceHeight > 0)) return null;

  const cropPoints = declaringPoints(points, "crop", isUsableCropShape);
  const ss = LAYER_KEYFRAME_SUPERSAMPLE;
  const baseWidth = Math.max(2, Math.round(sourceWidth));
  const baseHeight = Math.max(2, Math.round(sourceHeight));
  const ssBaseWidth = baseWidth * ss;
  const ssBaseHeight = baseHeight * ss;
  const boundedScaleMax = isFiniteNumber(scaleMax) && scaleMax > 0 ? scaleMax : 1;

  const evenCeil = (value) => Math.max(2, Math.ceil(value / 2) * 2);
  const centeredPad = (canvasWidth, canvasHeight) =>
    `pad=w=${canvasWidth}:h=${canvasHeight}:x='trunc((ow-iw)/4)*2':y='trunc((oh-ih)/4)*2':color=black@0:eval=frame`;

  if (!cropPoints) {
    const canvasWidth = evenCeil(baseWidth * boundedScaleMax);
    const canvasHeight = evenCeil(baseHeight * boundedScaleMax);
    const ssCanvasWidth = canvasWidth * ss;
    const ssCanvasHeight = canvasHeight * ss;
    const scaledWidthExpr = `trunc((${ssBaseWidth}*(${scaleExpr}))/2)*2`;
    const scaledHeightExpr = `trunc((${ssBaseHeight}*(${scaleExpr}))/2)*2`;
    return [
      `scale=w=${ssBaseWidth}:h=${ssBaseHeight}:flags=lanczos`,
      `scale=w='${scaledWidthExpr}':h='${scaledHeightExpr}':eval=frame:flags=lanczos`,
      centeredPad(ssCanvasWidth, ssCanvasHeight),
      `scale=${canvasWidth}:${canvasHeight}:flags=lanczos`,
      `crop=w=${canvasWidth}:h=${canvasHeight}:x='0':y='0'`,
    ];
  }

  const track = (leaf) => cropPoints.map((point) => ({
    t: point.t,
    value: point.crop[leaf],
    easing: point.easing,
  }));
  const wTrack = track("w").map((point) => ({ ...point, value: clamp(point.value, 0.01, 1) }));
  const hTrack = track("h").map((point) => ({ ...point, value: clamp(point.value, 0.01, 1) }));
  const wExpr = piecewiseExpr(wTrack, (point) => point.value, localTExpr);
  const hExpr = piecewiseExpr(hTrack, (point) => point.value, localTExpr);
  const xExpr = piecewiseExpr(track("x"), (point) => point.value, localTExpr);
  const yExpr = piecewiseExpr(track("y"), (point) => point.value, localTExpr);

  const scaledWidthExpr = `trunc((${ssBaseWidth}/(${wExpr}))/2)*2`;
  const scaledHeightExpr = `trunc((${ssBaseHeight}/(${hExpr}))/2)*2`;
  const cropXExpr = `trunc(clip((${xExpr})*(${scaledWidthExpr})\\,0\\,(${scaledWidthExpr})-${ssBaseWidth})/2)*2`;
  const cropYExpr = `trunc(clip((${yExpr})*(${scaledHeightExpr})\\,0\\,(${scaledHeightExpr})-${ssBaseHeight})/2)*2`;
  const visibleWidthExpr = `trunc((${ssBaseWidth}*(${wExpr})*(${scaleExpr}))/2)*2`;
  const visibleHeightExpr = `trunc((${ssBaseHeight}*(${hExpr})*(${scaleExpr}))/2)*2`;

  // Independent maxima are a deliberate conservative bound. w(t)*scale(t) can have an interior
  // extremum when the two tracks move in opposite directions; max(w)*max(scale) cannot clip it,
  // and transparent excess only costs a small amount of canvas area.
  const maxW = Math.max(...wTrack.map((point) => point.value));
  const maxH = Math.max(...hTrack.map((point) => point.value));
  const canvasWidth = evenCeil(baseWidth * maxW * boundedScaleMax);
  const canvasHeight = evenCeil(baseHeight * maxH * boundedScaleMax);
  const ssCanvasWidth = canvasWidth * ss;
  const ssCanvasHeight = canvasHeight * ss;

  return [
    `scale=w='${scaledWidthExpr}':h='${scaledHeightExpr}':eval=frame:flags=lanczos`,
    `crop=w=${ssBaseWidth}:h=${ssBaseHeight}:x='${cropXExpr}':y='${cropYExpr}'`,
    `scale=w='${visibleWidthExpr}':h='${visibleHeightExpr}':eval=frame:flags=lanczos`,
    centeredPad(ssCanvasWidth, ssCanvasHeight),
    `scale=${canvasWidth}:${canvasHeight}:flags=lanczos`,
    `crop=w=${canvasWidth}:h=${canvasHeight}:x='0':y='0'`,
  ];
}

// ---- perspective --------------------------------------------------------------------------

// KNOWN, LOAD-BEARING FFMPEG CONSTRAINT (empirically discovered while implementing this -- not
// documented anywhere in `ffmpeg -h filter=perspective`'s option dump): unlike scale/crop-x/y/
// rotate/overlay, the `perspective` filter's expression evaluator does not expose *any* per-frame
// variable at all, not `t` and not `n` -- `perspective=x0='t*10':...` fails with "Undefined
// constant" even with eval=frame set. So there is no way to make perspective's corners a function
// of time via an expression, at all, on this machine's ffmpeg (8.1.1) -- eval=frame only lets it
// re-read a *static* expression (one built only from W/H) every frame, which is useless for
// animation. This directly hits the task contract's stated fallback: "式が破綻する場合はキーフレーム
// 区間ごとにフィルタを分ける方式へ退避してよい" -- perspective's expression path doesn't just
// degrade, it's flatly unavailable, so this is not a stylistic choice between the two approaches.
//
// expandLayerForPerspectiveKeyframes implements the segment-splitting fallback, but at the
// *layer* level rather than inside one layer's own filter chain: a layer with keyframed
// perspective is expanded (in JS, before any ffmpeg args are built) into N adjacent synthetic
// sub-layers, each covering a narrow [start,end) time window with perspective held *static* at
// that window's own midpoint-sampled (interpolated) *declared corners* -- design decision "4 隅
// をそれぞれ線形補間": the raw corners are interpolated, not any derived homography. Each sub-layer
// gets a plain static `perspective.corners`, so buildLayersCompositeCommand's own existing static
// path (pad→perspective→crop via computePerspectiveFfmpegCorners) runs completely unmodified for
// every sub-layer -- this needs no changes to that pipeline at all, and reuses its existing parity
// tests; a keyframed-perspective layer composites exactly like N ordinary adjacent PiP layers
// would. transform/crop keyframes (if also declared) are NOT flattened -- they are passed through
// unchanged (still fully continuous, piecewise-eval=frame) on every sub-layer, since only
// perspective is fundamentally expression-incapable.
//
// Segment density trades smoothness for two real costs: each extra segment is a *separate* ffmpeg
// input (the layer's own source file gets opened/decoded once per segment) and a separate small
// filter subgraph. Keep every density threshold and the hard resource guard together: changing
// this policy should never require hunting through the boundary-building code below.
const PERSPECTIVE_SEGMENT_POLICY = Object.freeze({
  minSegmentsPerSecond: 0.5,
  maxSegmentsPerSecond: 12,
  // Real gesture tracking reaches roughly 0.9--1.4 normalized units/second. Calibrate the cubic
  // response so that range receives 8--12/s instead of remaining pinned near the coarse floor.
  fullDensityCornerSpeed: 1.22,
  speedResponseExponent: 3,
  // A very short moving layer can otherwise round its integrated density down to one or two
  // samples even when its peak interval is fast. Three samples are the smallest useful moving
  // approximation; static layers remain governed solely by the 0.5/s floor.
  minMovingSublayers: 3,
  maxSublayersPerLayer: 240,
});

function clampRange(value, minimum, maximum) {
  if (maximum <= minimum) return minimum;
  return Math.min(Math.max(value, minimum), maximum);
}

function perspectiveCornersAt(points, t) {
  return points[0].perspective.corners.map((_, cornerIndex) => [0, 1].map((axis) =>
    piecewiseValueAt(points, (point) => point.perspective.corners[cornerIndex][axis], t)));
}

function maxCornerSpeed(points, startT, endT) {
  const span = endT - startT;
  if (!(span > 0)) return 0;
  const startCorners = perspectiveCornersAt(points, startT);
  const endCorners = perspectiveCornersAt(points, endT);
  let displacement = 0;
  for (let index = 0; index < startCorners.length; index += 1) {
    displacement = Math.max(
      displacement,
      Math.hypot(
        endCorners[index][0] - startCorners[index][0],
        endCorners[index][1] - startCorners[index][1],
      ),
    );
  }
  return displacement / span;
}

function adaptivePerspectiveDensity(points, startT, endT) {
  const speedRatio = clampRange(
    maxCornerSpeed(points, startT, endT) / PERSPECTIVE_SEGMENT_POLICY.fullDensityCornerSpeed,
    0,
    1,
  );
  return PERSPECTIVE_SEGMENT_POLICY.minSegmentsPerSecond
    + (speedRatio ** PERSPECTIVE_SEGMENT_POLICY.speedResponseExponent) * (
      PERSPECTIVE_SEGMENT_POLICY.maxSegmentsPerSecond
      - PERSPECTIVE_SEGMENT_POLICY.minSegmentsPerSecond
    );
}

function perspectiveSegmentApproximationError(points, startT, endT) {
  const heldCorners = perspectiveCornersAt(points, (startT + endT) / 2);
  const sampleTimes = [
    startT,
    ...points.filter((point) => point.t > startT && point.t < endT).map((point) => point.t),
    endT,
  ];
  let maximum = 0;
  for (const t of sampleTimes) {
    const corners = perspectiveCornersAt(points, t);
    for (let cornerIndex = 0; cornerIndex < corners.length; cornerIndex += 1) {
      maximum = Math.max(
        maximum,
        Math.hypot(
          corners[cornerIndex][0] - heldCorners[cornerIndex][0],
          corners[cornerIndex][1] - heldCorners[cornerIndex][1],
        ),
      );
    }
  }
  return maximum;
}

function buildMinimaxPerspectiveBoundaries(points, layerDuration, segmentCount) {
  if (segmentCount <= 1) return [0, layerDuration];
  const minimumDuration = 1 / PERSPECTIVE_SEGMENT_POLICY.maxSegmentsPerSecond;
  const boundaries = Array.from(
    { length: segmentCount + 1 },
    (_, index) => (layerDuration * index) / segmentCount,
  );

  // Start uniformly so the requested count is always achievable (recursive midpoint splitting
  // gets stuck at 8/s on a one-second interval). Coordinate relaxation then places that fixed
  // budget more accurately. A half-step grid lets a boundary move by 1/24s while the
  // minimum-duration check still enforces the 12/s ceiling. Strict improvement + stable scan
  // order keeps this finite and deterministic.
  const gridStep = 1 / (PERSPECTIVE_SEGMENT_POLICY.maxSegmentsPerSecond * 2);
  const candidates = [...new Set([
    0,
    ...points.map((point) => clampRange(point.t, 0, layerDuration)),
    ...Array.from(
      { length: Math.max(0, Math.ceil(layerDuration / gridStep) - 1) },
      (_, index) => Math.min(layerDuration, (index + 1) * gridStep),
    ),
    layerDuration,
  ])].sort((a, b) => a - b);
  for (let pass = 0; pass < 20; pass += 1) {
    let changed = false;
    for (let index = 1; index < boundaries.length - 1; index += 1) {
      const previous = boundaries[index - 1];
      const next = boundaries[index + 1];
      let best = boundaries[index];
      let bestError = Math.max(
        perspectiveSegmentApproximationError(points, previous, best),
        perspectiveSegmentApproximationError(points, best, next),
      );
      for (const candidate of candidates) {
        if (
          candidate - previous < minimumDuration - 1e-9
          || next - candidate < minimumDuration - 1e-9
        ) continue;
        const error = Math.max(
          perspectiveSegmentApproximationError(points, previous, candidate),
          perspectiveSegmentApproximationError(points, candidate, next),
        );
        if (error < bestError - 1e-12) {
          best = candidate;
          bestError = error;
        }
      }
      if (best !== boundaries[index]) {
        boundaries[index] = best;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Guarantee that the single fastest measured region is represented at 8/s or finer without
  // increasing the layer-wide segment budget. Move the cheaper adjacent boundary inward; the
  // minimax placement above remains untouched everywhere else.
  let fastestIndex = 0;
  let fastestSpeed = -1;
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const speed = maxCornerSpeed(points, boundaries[index], boundaries[index + 1]);
    if (speed > fastestSpeed) {
      fastestIndex = index;
      fastestSpeed = speed;
    }
  }
  const fastDuration = 1 / 8;
  let fastestDeclaredDensity = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = clampRange(points[index].t, 0, layerDuration);
    const end = clampRange(points[index + 1].t, 0, layerDuration);
    if (end > start) {
      fastestDeclaredDensity = Math.max(
        fastestDeclaredDensity,
        adaptivePerspectiveDensity(points, start, end),
      );
    }
  }
  if (
    fastestDeclaredDensity >= 8
    && boundaries[fastestIndex + 1] - boundaries[fastestIndex] > fastDuration + 1e-9
  ) {
    const moves = [];
    const start = boundaries[fastestIndex];
    const end = boundaries[fastestIndex + 1];
    if (fastestIndex > 0) {
      const candidate = end - fastDuration;
      const previous = boundaries[fastestIndex - 1];
      if (candidate - previous >= minimumDuration - 1e-9) {
        moves.push({
          boundaryIndex: fastestIndex,
          candidate,
          error: Math.max(
            perspectiveSegmentApproximationError(points, previous, candidate),
            perspectiveSegmentApproximationError(points, candidate, end),
          ),
        });
      }
    }
    if (fastestIndex + 1 < boundaries.length - 1) {
      const candidate = start + fastDuration;
      const next = boundaries[fastestIndex + 2];
      if (next - candidate >= minimumDuration - 1e-9) {
        moves.push({
          boundaryIndex: fastestIndex + 1,
          candidate,
          error: Math.max(
            perspectiveSegmentApproximationError(points, start, candidate),
            perspectiveSegmentApproximationError(points, candidate, next),
          ),
        });
      }
    }
    moves.sort((a, b) => a.error - b.error || a.boundaryIndex - b.boundaryIndex);
    if (moves.length > 0) boundaries[moves[0].boundaryIndex] = moves[0].candidate;
  }
  return boundaries;
}

// Returns [layer] unchanged when there is nothing to expand (no usable perspective keyframes, or
// -- v0 scope cut, see below -- a non-"normal" blend). Otherwise returns the N synthetic
// sub-layers described above, in time order, ready to replace the original single layer entry
// in-place in the `layers[]` array buildLayersCompositeCommand iterates.
//
// KNOWN v0 LIMITATION: layers with blend !== "normal" ("screen"/"multiply"/...) go through a
// completely different trim/pad/blend/maskedmerge/concat compositing path (see layers.mjs) whose
// own internal clock is rebased per-layer via setpts=PTS-STARTPTS; correctly re-deriving
// keyframes[].t's clock origin across that path's own segment splitting was judged not worth the
// added complexity for what both this task and the wider codebase treat as the rare case (most
// PiP/overlay use is blend:"normal"). A non-normal-blend layer with keyframed perspective keeps
// its perspective un-animated (falls back to the layer's static `perspective`, if any) -- this
// is a deliberate, reported v0 boundary, not a silent gap.
export function expandLayerForPerspectiveKeyframes(layer) {
  if ((layer?.blend ?? "normal") !== "normal") return [layer];
  const points = usableLayerKeyframePoints(layer?.keyframes);
  if (!points) return [layer];
  const declaring = declaringPoints(points, "perspective", isUsablePerspectiveShape);
  if (!declaring) return [layer];

  const layerT = Number(layer.t) || 0;
  const layerDuration = Number(layer.duration) || 0;
  if (!(layerDuration > 0)) return [layer];

  // Measure at every in-range declaring point, then integrate each interval's density into one
  // layer-wide budget. Hold-before-first and hold-after-last naturally measure as zero motion and
  // therefore use the 0.5/s floor.
  const anchors = [...new Set([
    0,
    ...declaring.map((point) => clampRange(point.t, 0, layerDuration)),
    layerDuration,
  ])].sort((a, b) => a - b);
  const intervals = [];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const start = anchors[index];
    const end = anchors[index + 1];
    const span = end - start;
    if (span <= 1e-9) continue;
    intervals.push({
      start,
      end,
      speed: maxCornerSpeed(declaring, start, end),
      weight: span * adaptivePerspectiveDensity(declaring, start, end),
    });
  }

  const moving = intervals.some((interval) => interval.speed > 1e-9);
  const densityTotal = Math.floor(intervals.reduce((sum, interval) => sum + interval.weight, 0));
  const requestedTotal = Math.max(
    1,
    densityTotal,
    moving ? PERSPECTIVE_SEGMENT_POLICY.minMovingSublayers : 1,
  );
  const cap = PERSPECTIVE_SEGMENT_POLICY.maxSublayersPerLayer;
  const segmentCount = Math.min(requestedTotal, cap);
  if (requestedTotal > cap) {
    process.stderr.write(
      `[render-cut] perspective layer ${JSON.stringify(String(layer.id ?? "<unnamed>"))} requested `
      + `${requestedTotal} sub-layers; capped at ${cap} and redistributed at a coarser density.\n`,
    );
  }

  const sortedBoundaries = segmentCount < requestedTotal
    ? Array.from({ length: segmentCount + 1 }, (_, index) => (layerDuration * index) / segmentCount)
    : buildMinimaxPerspectiveBoundaries(declaring, layerDuration, segmentCount);

  // transform/crop keyframes (if declared) stay continuous and untouched on every sub-layer --
  // only perspective is stripped from each point (it becomes each sub-layer's own static
  // `perspective` field instead).
  const keyframesWithoutPerspective = Array.isArray(layer.keyframes)
    ? layer.keyframes.map((point) => {
      if (!point || typeof point !== "object" || !("perspective" in point)) return point;
      const { perspective: _drop, ...rest } = point;
      return rest;
    })
    : layer.keyframes;
  const keptKeyframes = usableLayerKeyframePoints(keyframesWithoutPerspective) ? keyframesWithoutPerspective : undefined;

  const segments = [];
  for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
    const segStart = sortedBoundaries[index];
    const segEnd = sortedBoundaries[index + 1];
    if (segEnd - segStart <= 1e-9) continue;
    // Holds the value sampled at the segment's own midpoint (centers the discrete step within
    // its time window, rather than lagging a full step behind a start-of-segment hold).
    const midT = (segStart + segEnd) / 2;
    const corners = perspectiveCornersAt(declaring, midT);
    segments.push({
      ...layer,
      id: `${layer.id}__persp${index}`,
      t: layerT + segStart,
      duration: segEnd - segStart,
      perspective: { corners },
      // A sub-layer's own `t` (used for -itsoffset and, in layers.mjs, as the keyframe clock's
      // subtraction origin) no longer equals the *original* layer's `t` -- keyframes[].t values
      // are unchanged (still relative to the original layer start), so layers.mjs must subtract
      // the original layerT, not this sub-layer's shifted t, when building localTExpr for
      // transform/crop. __keyframeClockOriginT carries that original origin through; ordinary
      // layers never set it, so layers.mjs's `?? t` fallback keeps them byte-identical.
      __keyframeClockOriginT: layerT,
      ...(keptKeyframes ? { keyframes: keptKeyframes } : { keyframes: undefined }),
    });
  }
  return segments;
}

// ---- layer source size probe (crop/rotate keyframes need the native pixel size) --------------

// Minimal, independent ffprobe call for a layer source's own decoded pixel size -- deliberately
// separate from probeLayerAlphaSource (which already runs once per layer, unconditionally) so
// that function's existing contract/tests are untouched; this one only runs for layers that
// actually have usable crop keyframes or a genuinely-varying rotate keyframe (see layers.mjs's
// call site), so it adds zero cost to the overwhelming majority of layers/projects.
export function probeLayerSourceSize(ffprobeCommand, path) {
  const result = spawnSync(
    ffprobeCommand,
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", path],
    { encoding: "utf8" },
  );
  if (result.error || result.status !== 0) return null;
  try {
    const stream = JSON.parse(result.stdout).streams?.[0];
    const width = Number(stream?.width);
    const height = Number(stream?.height);
    return isFiniteNumber(width) && width > 0 && isFiniteNumber(height) && height > 0 ? { width, height } : null;
  } catch {
    return null;
  }
}
