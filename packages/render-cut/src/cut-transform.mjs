import { appendCutFraming, hasUsableFraming } from "./cut-framing.mjs";
import { computePerspectiveFfmpegCorners, PERSPECTIVE_PAD_FRAC } from "./perspective-homography.mjs";
import {
  hasUsableLayerKeyframes,
  layerCropKeyframeSteps,
  layerTransformKeyframeExprs,
} from "./layer-keyframes.mjs";

// P0 2026-08-21 render-path-unification: cuts[]/layers[] used to be genuinely different feature
// sets (see planning/notes-2026-08-18-timeline-latency-and-track-model.md §12 for the decision
// record). This module is now the single per-item visual builder for every source.kind:'media'
// item regardless of which v2 track it sits on -- packages/edit-store/src/internal-model.ts no
// longer branches on track position for media, only on whether an item declares a non-'normal'
// `blend` (which still needs layers.mjs's composite-time blend math -- see hasCutLayerStyleVisual
// below and internal-model.ts's needsLayersEngine).
export function hasCutVisualTransform(cuts) {
  return Array.isArray(cuts) && cuts.some((cut) =>
    cut && typeof cut === "object"
    && (Object.prototype.hasOwnProperty.call(cut, "transform")
      || Object.prototype.hasOwnProperty.call(cut, "opacity")
      || Object.prototype.hasOwnProperty.call(cut, "crop")
      || Object.prototype.hasOwnProperty.call(cut, "perspective")
      || hasUsableLayerKeyframes(cut)),
  );
}

// A cut needs the layers-style (native-source-relative crop/perspective/keyframes) per-item
// builder instead of the plain canvas-fit transform builder when it declares crop, perspective,
// or keyframes. transform/opacity alone stay on the existing appendCutVisualTransform path
// (byte-identical to before this task -- see that function's own header comment).
export function hasCutLayerStyleVisual(cut) {
  return Boolean(cut && typeof cut === "object"
    && (Object.prototype.hasOwnProperty.call(cut, "crop")
      || Object.prototype.hasOwnProperty.call(cut, "perspective")
      || hasUsableLayerKeyframes(cut)));
}

export function appendCutVisualTransform({
  filters,
  inputLabel,
  outputLabel,
  cut,
  id,
  width,
  height,
  fps,
  duration,
  transparentBackground = false,
}) {
  const transform = cut?.transform ?? {};
  const x = finiteOr(transform.x, 0);
  const y = finiteOr(transform.y, 0);
  const scale = positiveOr(transform.scale, 1);
  const rotate = finiteOr(transform.rotate, 0);
  const opacity = boundedOr(cut?.opacity, 1, 0, 1);
  const fitted = `[ct_${id}_fit]`;
  const prepared = `[ct_${id}_prepared]`;
  const background = `[ct_${id}_background]`;
  const steps = [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    `fps=${formatNumber(fps)}`,
    "setsar=1",
    "format=yuva420p",
  ];
  filters.push(`${inputLabel}${steps.join(",")}${fitted}`);

  // docs/contract-2026-07-22-render-basics.md #6 (cuts[].framing). Framing crops the already
  // width x height-fitted frame and rescales it back up (a "punch in"), so it must run right
  // after the fit step above and before transform's own scale/rotate/opacity, which place the
  // (now possibly zoomed-in) frame within the output canvas. When framing is absent this stays
  // a no-op passthrough (framed === fitted), so the filter graph is byte-identical to before
  // this feature existed.
  const framing = cut?.framing;
  const framed = hasUsableFraming(framing) ? `[ct_${id}_framed]` : fitted;
  if (framed !== fitted) {
    appendCutFraming({ filters, inputLabel: fitted, outputLabel: framed, framing, width, height, id });
  }

  const transformSteps = [];
  if (scale !== 1) {
    transformSteps.push(
      `scale=max(2\\,trunc(iw*${formatNumber(scale)}/2)*2):max(2\\,trunc(ih*${formatNumber(scale)}/2)*2)`,
    );
  }
  if (rotate !== 0) {
    const radians = `(${formatNumber(rotate)}*PI/180)`;
    transformSteps.push(
      `rotate=${radians}:fillcolor=black@0:ow=rotw(${radians}):oh=roth(${radians})`,
    );
  }
  if (opacity !== 1) {
    transformSteps.push(`colorchannelmixer=aa=${formatNumber(opacity)}`);
  }
  filters.push(`${framed}${transformSteps.length > 0 ? transformSteps.join(",") : "null"}${prepared}`);
  // P0 2026-08-21 render-path-unification: `transparentBackground` is true only when the caller
  // knows this canvas will itself be alpha-composited onto something else below it (a
  // buildTrackStackPlan stage that is not the sole/bottom visual track -- see plan.mjs). It stays
  // false (opaque black, byte-identical to before this task) for every pre-existing caller
  // (the flat/default single-track dispatch, and any direct unit-test caller), because an item
  // whose own output is encoded straight to a non-alpha file has no "below" to reveal -- an
  // alpha-transparent canvas there does not merely no-op, it actively breaks a fractional
  // `opacity` (a semi-transparent premultiplied-red pixel over a transparent backdrop keeps its
  // full un-faded RGB, instead of fading toward black the way an opaque backdrop does; the
  // encoder then drops the now-meaningless alpha and the fade silently vanishes -- verified via
  // packages/render-cut/test/cut-transform.test.mjs's real-pixel opacity assertion).
  // The opaque branch is left exactly as it was before this task (no explicit format=
  // conversion on the color source) to guarantee byte-identical filter graphs for every
  // pre-existing caller; only the new transparent branch needs format=yuva420p; the plain
  // `color` filter's own default format already round-trips through overlay's format=auto fine
  // (verified: this is what every caller did before P0 2026-08-21).
  filters.push(
    transparentBackground
      ? `color=c=black@0:s=${width}x${height}:r=${formatNumber(fps)}:d=${formatNumber(duration)},format=yuva420p${background}`
      : `color=c=black:s=${width}x${height}:r=${formatNumber(fps)}:d=${formatNumber(duration)}${background}`,
  );
  filters.push(
    `${background}${prepared}overlay=x=(main_w-overlay_w)/2+${formatNumber(x)}`
      + `:y=(main_h-overlay_h)/2+${formatNumber(y)}:format=auto:shortest=1${outputLabel}`,
  );
}

// P0 2026-08-21 render-path-unification: per-item builder for cuts that declare crop /
// perspective / keyframes. These fields are native-source-relative (crop 0..1 against the
// item's own decoded frame, before any canvas fitting) -- the exact same convention
// packages/render-cut/src/layers.mjs already uses and has real projects depending on
// (fieldtest/2026-08-06-pip-perspective-crop-check), so this function reproduces that math
// (crop -> scale -> perspective -> rotate -> opacity) rather than cuts' own canvas-fit
// convention, to guarantee an item renders pixel-identically whichever v2 track it sits on.
// Ends with the same alpha-canvas overlay technique appendCutVisualTransform uses, so both
// functions produce a uniform full-canvas yuva420p frame that concat/xfade can join freely.
// Keyframe scope (P0 2026-08-21): crop and transform (x/y/scale) keyframes are supported by
// reusing packages/render-cut/src/layer-keyframes.mjs's own expression builders unmodified
// (they only read `.keyframes[].crop` / `.keyframes[].transform`, generic over any object shape
// -- verified by reading that module). Keyframed perspective and keyframed rotate are NOT
// supported here (ffmpeg's perspective filter has no per-frame expression capability at all --
// layers.mjs itself only supports it via a whole-array "expand into static sub-layers"
// preprocessing step keyed to layer-shaped t/duration fields, which does not translate to cuts'
// at/in/out fields without a parallel expansion pass; out of scope for this task). A cut with a
// keyframed perspective or keyframed rotate renders with that keyframe ignored (falls back to
// the first keyframe's static value) rather than failing -- documented as a known limitation.
export function appendCutLayerStyleVisual({
  filters,
  inputLabel,
  outputLabel,
  cut,
  id,
  width,
  height,
  fps,
  duration,
  sourceWidth,
  sourceHeight,
  transparentBackground = false,
}) {
  const transform = cut?.transform ?? {};
  const scale = positiveOr(transform.scale, 1);
  const rotate = finiteOr(transform.rotate, 0);
  const opacity = boundedOr(cut?.opacity, 1, 0, 1);

  const keyframed = hasUsableLayerKeyframes(cut);
  // cuts already rebase to PTS-STARTPTS before this function runs (appendFreezeAwareVideoTrim),
  // so -- unlike layers.mjs, which has two clock conventions depending on blend mode -- there is
  // only ever one: plain elapsed time within this cut's own trimmed stream.
  const localTExpr = "t";
  const transformKeyframes = keyframed ? layerTransformKeyframeExprs(cut, localTExpr) : null;
  const xExpr = transformKeyframes ? transformKeyframes.xExpr : formatNumber(finiteOr(transform.x, 0));
  const yExpr = transformKeyframes ? transformKeyframes.yExpr : formatNumber(finiteOr(transform.y, 0));

  const cropKeyframeDeclared = keyframed
    && Array.isArray(cut.keyframes)
    && cut.keyframes.some((point) => point && typeof point === "object" && point.crop);
  const sourceSize = cropKeyframeDeclared && isFiniteNumber(sourceWidth) && isFiniteNumber(sourceHeight)
    ? { width: sourceWidth, height: sourceHeight }
    : null;

  const extraScaleExpr = transformKeyframes ? transformKeyframes.scaleExpr : (scale !== 1 ? formatNumber(scale) : null);
  const cropKeyframeSteps = sourceSize
    ? layerCropKeyframeSteps(cut, localTExpr, sourceSize.width, sourceSize.height, extraScaleExpr)
    : null;
  const cropScaleFolded = Boolean(cropKeyframeSteps && extraScaleExpr);

  const raw = `[ct_${id}_lraw]`;
  filters.push(`${inputLabel}format=yuva420p${raw}`);

  const steps = [];
  const crop = cut?.crop;
  if (cropKeyframeSteps) {
    steps.push(...cropKeyframeSteps);
  } else if (crop) {
    const cropW = clamp(finiteOr(crop.w, 1), EPSILON, 1);
    const cropH = clamp(finiteOr(crop.h, 1), EPSILON, 1);
    const cropX = clamp(finiteOr(crop.x, 0), 0, 1 - cropW);
    const cropY = clamp(finiteOr(crop.y, 0), 0, 1 - cropH);
    steps.push(
      `crop=trunc(iw*${formatNumber(cropW)}/2)*2:trunc(ih*${formatNumber(cropH)}/2)*2:trunc(iw*${formatNumber(cropX)}/2)*2:trunc(ih*${formatNumber(cropY)}/2)*2`,
    );
  }
  if (cropScaleFolded) {
    // Already applied as part of cropKeyframeSteps' own final scale-down step above.
  } else if (transformKeyframes) {
    steps.push(
      `scale=w='trunc(iw*(${transformKeyframes.scaleExpr}))':h='trunc(ih*(${transformKeyframes.scaleExpr}))':eval=frame`,
    );
  } else if (scale !== 1) {
    steps.push(`scale=trunc(iw*${formatNumber(scale)}):trunc(ih*${formatNumber(scale)})`);
  }

  const perspective = cut?.perspective;
  if (perspective && Array.isArray(perspective.corners) && perspective.corners.length === 4) {
    const padFrac = PERSPECTIVE_PAD_FRAC;
    const denom = 1 + 2 * padFrac;
    const destCorners = computePerspectiveFfmpegCorners(perspective.corners, padFrac);
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = destCorners;
    const scaledBy = (value, axisExpr) => `${formatNumber(value)}*${axisExpr}`;
    steps.push(
      `pad=trunc(iw*${formatNumber(denom)}/2)*2:trunc(ih*${formatNumber(denom)}/2)*2:x=trunc(iw*${formatNumber(padFrac)}/2)*2:y=trunc(ih*${formatNumber(padFrac)}/2)*2:color=black@0`,
    );
    steps.push(
      `perspective=x0=${scaledBy(x0, "W")}:y0=${scaledBy(y0, "H")}:x1=${scaledBy(x1, "W")}:y1=${scaledBy(y1, "H")}:x2=${scaledBy(x2, "W")}:y2=${scaledBy(y2, "H")}:x3=${scaledBy(x3, "W")}:y3=${scaledBy(y3, "H")}:sense=destination:eval=init`,
    );
    steps.push(
      `crop=trunc((iw/${formatNumber(denom)})/2)*2:trunc((ih/${formatNumber(denom)})/2)*2:trunc((iw*${formatNumber(padFrac)}/${formatNumber(denom)})/2)*2:trunc((ih*${formatNumber(padFrac)}/${formatNumber(denom)})/2)*2`,
    );
  }
  if (rotate !== 0) {
    const radians = `(${formatNumber(rotate)}*PI/180)`;
    steps.push(`rotate=${radians}:fillcolor=black@0:ow=rotw(${radians}):oh=roth(${radians})`);
  }
  if (opacity !== 1) {
    steps.push(`colorchannelmixer=aa=${formatNumber(opacity)}`);
  }
  const processed = `[ct_${id}_lprocessed]`;
  filters.push(`${raw}${steps.length > 0 ? steps.join(",") : "null"}${processed}`);

  // See appendCutVisualTransform's own comment on transparentBackground: opaque unless the
  // caller knows this canvas overlays onto real content below it (a non-bottom
  // buildTrackStackPlan stage). A crop-declared item rendered standalone (nothing below) with
  // fractional opacity needs the same opaque-fade-to-black behavior cuts has always had.
  const background = `[ct_${id}_lbackground]`;
  filters.push(
    transparentBackground
      ? `color=c=black@0:s=${width}x${height}:r=${formatNumber(fps)}:d=${formatNumber(duration)},format=yuva420p${background}`
      : `color=c=black:s=${width}x${height}:r=${formatNumber(fps)}:d=${formatNumber(duration)}${background}`,
  );
  filters.push(
    `${background}${processed}overlay=x=(main_w-overlay_w)/2+${xExpr}:y=(main_h-overlay_h)/2+${yExpr}:format=auto:shortest=1${outputLabel}`,
  );
}

const EPSILON = 1e-6;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function boundedOr(value, fallback, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value)
    && value >= minimum && value <= maximum ? value : fallback;
}

function formatNumber(value) {
  return Number(Number(value).toFixed(6)).toString();
}
