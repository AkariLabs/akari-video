import { appendCutFraming, hasUsableFraming } from "./cut-framing.mjs";
import { computePerspectiveFfmpegCorners, PERSPECTIVE_PAD_FRAC } from "./perspective-homography.mjs";
import {
  hasUsableLayerKeyframes,
  layerCropKeyframeSteps,
  layerFixedCanvasKeyframeSteps,
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
  canvasBasisTransform = true,
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
  const framing = cut?.framing;
  const framingDeclared = hasUsableFraming(framing);
  // P0 2026-08-21 render-path-unification (BLOCKER fix r2->r3->r4, Codex review): this builder is
  // shared by two historically-distinct conventions that genuinely conflict -- "main content"
  // (old cuts[] semantics: transform.scale is relative to the CANVAS, applied AFTER letterbox-
  // fitting an arbitrarily-sized source into it -- the natural basis for a punch-in zoom on the
  // whole frame) and "PiP overlay" (old layers[] semantics: transform.scale is relative to the
  // source's OWN NATIVE pixel size, with no canvas-fit step at all -- the natural basis for
  // "shrink this clip to 30% of itself and place it in a corner"). r2's own fix (skip fit
  // whenever framing is absent) chose the PiP/native-basis convention unconditionally, which
  // fixed the PiP case but broke the FAR MORE COMMON main-content case: a main cut whose source
  // resolution differs from the output canvas (e.g. a 4K source in a 1080p project) with a plain
  // default transform rendered as a center CROP of the source instead of a full-frame DOWNSCALE
  // (verified: a 640x360 16:9 source in a 320x180 16:9 canvas, transform={x:0,y:0,scale:1}, no
  // framing, produced a center-cropped frame -- mean per-pixel diff of 68/255 against a plain
  // ffmpeg `scale=320:180` reference of the same source). Both r1 (canvas-basis unconditionally)
  // and r2 (native-basis unconditionally) were each correct for one convention and wrong for the
  // other; there is no way to tell which convention an item's own transform.scale was AUTHORED
  // under from the v2 schema alone (both are expressed with the identical `transform.scale`
  // field, and the ambiguous case -- a plain default transform on an item whose source doesn't
  // match canvas size -- is exactly what both regressions hit).
  //
  // `canvasBasisTransform` (a caller-supplied flag, plan.mjs) is the resolving signal, true
  // precisely when this item's own canvas IS the bottom of the whole composite -- i.e. nothing
  // real sits below it -- which is exactly where canvas-basis (fit first, then apply
  // transform.scale=1 by default) is the correct, and by far the most common, interpretation:
  // every flat/default (single visual track) dispatch, AND (r4) the true stageIndex-0 stage of a
  // buildTrackStackPlan stack (its own `previous` is always a plain black basePath with no real
  // content -- see that call site's own comment). It is false only for a genuine overlay/PiP
  // stage sitting ON TOP of real content below it -- the ONLY structural shape (verified against
  // both the original BLOCKER repro and the r1 report itself: "1本のbase cutsトラック+PiPトラック
  // の既定順プロジェクト", always >=2 'cuts' tracks, which usesDefaultInternalTrackOrder in
  // plan.mjs always routes through buildTrackStackPlan) a native-basis PiP scale can arise in.
  // r3 used `transparentBackground` itself for this decision, which was wrong on two counts fixed
  // in r4: (1) buildTrackStackPlan passed transparentBackground:true unconditionally to every
  // cuts-kind stage including the true bottom one, so moving an item down to stageIndex 0 (or
  // simply adding a second, non-overlapping 'cuts' track above an existing bottom-stage clip)
  // silently flipped that clip's own transform semantics with zero change to its own declaration;
  // (2) transparentBackground ALSO controls this stage's own intermediate encoding codec (qtrle,
  // to stay lossless ahead of further recompositing -- unrelated to alpha/transform semantics and
  // needed by every stage regardless of stageIndex), so conflating the two flags would have
  // silently degraded stageIndex-0 encoding quality in stacks with more than one stage. This also
  // resolves the "巻き込み" (drag-in) half of the same finding: because the decision is scoped to
  // `canvasBasisTransform` (one value per track/stage, threaded through from plan.mjs) rather
  // than to whether THIS SPECIFIC cut declares a transform, a "plain" cut sharing a track/stage
  // with a transform-bearing sibling gets the SAME (track-appropriate) fit behavior as its
  // sibling instead of being swept into native-basis math it never asked for. cuts[].framing (a
  // punch-in on the WHOLE canvas, contract-2026-07-22-render-basics.md #6) still forces the fit
  // step on its own whenever declared, independent of canvasBasisTransform -- framing's own math
  // (appendCutFraming) requires an already-fitted frame to crop percentages against regardless of
  // which stack stage it's on, and every one of its own separately-tested cases is a
  // canvasBasisTransform=true, main-content-style declaration anyway, so this is a superset of
  // r2/r3's own framing handling, not a behavior change for it.
  const shouldFitToCanvas = framingDeclared || canvasBasisTransform;
  const steps = shouldFitToCanvas
    ? [
        `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
        `fps=${formatNumber(fps)}`,
        "setsar=1",
        "format=yuva420p",
      ]
    : [
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
  const framed = framingDeclared ? `[ct_${id}_framed]` : fitted;
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
  // P0 2026-08-21 render-path-unification (MAJOR-1 fix, Codex review): a keyframed rotate needs
  // the same fixed bounding-square sizing layers.mjs's own rotate step uses (rotate's own ow/oh
  // expressions are only evaluated once at init, so a genuinely time-varying angle needs a size
  // that already fits the box at every angle it will ever reach -- see layers.mjs's own comment
  // next to this exact math, ported unchanged below). transformKeyframes.rotateVaries was already
  // computed by layerTransformKeyframeExprs; this function just wasn't reading it.
  const rotateVaries = Boolean(transformKeyframes?.rotateVaries);
  const effectiveRotate = transformKeyframes
    ? (rotateVaries ? null : transformKeyframes.rotateMin)
    : rotate;
  // Keep the fixed-canvas path aligned with layers.mjs: changing the processed bitmap bounds is
  // safe only for the ordinary normal-blend overlay compositor, without perspective or rotate.
  // needsLayersEngine already routes non-normal v2 media items away from cuts, but the explicit
  // blend guard also keeps this exported builder safe for direct callers.
  const fixedCanvasEligible = (cut?.blend ?? "normal") === "normal"
    && !cut?.perspective
    && rotate === 0
    && effectiveRotate === 0
    && (cropKeyframeDeclared || Boolean(transformKeyframes?.scaleDeclared));
  const sourceSize = (cropKeyframeDeclared || rotateVaries || fixedCanvasEligible)
    && isFiniteNumber(sourceWidth) && isFiniteNumber(sourceHeight)
    ? { width: sourceWidth, height: sourceHeight }
    : null;

  const extraScaleExpr = transformKeyframes ? transformKeyframes.scaleExpr : (scale !== 1 ? formatNumber(scale) : null);
  const cropKeyframeSteps = sourceSize
    ? layerCropKeyframeSteps(cut, localTExpr, sourceSize.width, sourceSize.height, extraScaleExpr)
    : null;
  const crop = cut?.crop;
  const staticCropWidth = sourceSize && crop && !cropKeyframeDeclared
    ? Math.max(2, Math.trunc(sourceSize.width * clamp(finiteOr(crop.w, 1), EPSILON, 1) / 2) * 2)
    : sourceSize?.width;
  const staticCropHeight = sourceSize && crop && !cropKeyframeDeclared
    ? Math.max(2, Math.trunc(sourceSize.height * clamp(finiteOr(crop.h, 1), EPSILON, 1) / 2) * 2)
    : sourceSize?.height;
  const fixedCanvasSteps = fixedCanvasEligible && sourceSize
    ? layerFixedCanvasKeyframeSteps({
        layer: cut,
        localTExpr,
        sourceWidth: staticCropWidth,
        sourceHeight: staticCropHeight,
        scaleExpr: transformKeyframes?.scaleExpr ?? formatNumber(scale),
        scaleMax: transformKeyframes?.scaleMax ?? scale,
      })
    : null;
  const cropScaleFolded = Boolean((fixedCanvasSteps || cropKeyframeSteps) && extraScaleExpr);

  const raw = `[ct_${id}_lraw]`;
  filters.push(`${inputLabel}format=yuva420p${raw}`);

  const steps = [];
  if (fixedCanvasSteps) {
    if (crop && !cropKeyframeDeclared) {
      const cropW = clamp(finiteOr(crop.w, 1), EPSILON, 1);
      const cropH = clamp(finiteOr(crop.h, 1), EPSILON, 1);
      const cropX = clamp(finiteOr(crop.x, 0), 0, 1 - cropW);
      const cropY = clamp(finiteOr(crop.y, 0), 0, 1 - cropH);
      steps.push(
        `crop=trunc(iw*${formatNumber(cropW)}/2)*2:trunc(ih*${formatNumber(cropH)}/2)*2:trunc(iw*${formatNumber(cropX)}/2)*2:trunc(ih*${formatNumber(cropY)}/2)*2`,
      );
    }
    steps.push(...fixedCanvasSteps);
  } else if (cropKeyframeSteps) {
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
    // Already applied by the fixed-canvas path or cropKeyframeSteps' final scale-down step above.
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
  // Ported unchanged from layers.mjs's own rotate step (same comment there explains the ow/oh
  // once-at-init limitation and the sqrt(2)*max(w,h) bounding-square derivation). cropVaries here
  // only ever means "this cut's own crop is keyframed" (cropKeyframeSteps), since a keyframed
  // perspective never reaches this function at all (needsLayersEngine routes it to the layers
  // engine instead) -- so, unlike layers.mjs, there is no keyframed-perspective case to fold in.
  const cropVaries = Boolean(cropKeyframeSteps);
  const rotateConstant = transformKeyframes ? (rotateVaries ? null : transformKeyframes.rotateMin) : rotate;
  if (rotateConstant !== 0 && (rotateVaries || cropVaries) && !sourceSize) {
    // Source size probe unavailable -- skip the rotate step entirely rather than risk a
    // wrongly-sized/clipped rotation built on an unknown box size (same fallback as the
    // crop-keyframe path above, which silently no-ops the same way when sourceWidth/sourceHeight
    // aren't available).
  } else if (rotateConstant !== 0 && (rotateVaries || cropVaries)) {
    const scaleMax = transformKeyframes ? transformKeyframes.scaleMax : scale;
    const boundSide = Math.ceil((Math.sqrt(2) * Math.max(sourceSize.width, sourceSize.height) * scaleMax) / 2) * 2;
    const radiansExpr = transformKeyframes ? `((${transformKeyframes.rotateExpr})*PI/180)` : `(${formatNumber(rotate)}*PI/180)`;
    steps.push(`rotate=${radiansExpr}:fillcolor=black@0:ow=${boundSide}:oh=${boundSide}`);
  } else if (rotateConstant !== 0) {
    const radians = `(${formatNumber(rotateConstant)}*PI/180)`;
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
  // P0 2026-08-21 render-path-unification (MAJOR-2 fix, Codex review): cut.framing
  // (docs/contract-2026-07-22-render-basics.md #6) was silently dropped whenever a cut also
  // declared crop/perspective/keyframes, because this function never referenced cut.framing at
  // all -- appendCutFraming's own contract requires an already width x height-fitted frame to
  // crop percentages against (cut-framing.mjs's header comment), and unlike
  // appendCutVisualTransform (which canvas-fits its source as its very first step, before
  // transform.scale/x/y even apply), this function has no canvas-sized frame available until
  // AFTER crop/perspective/rotate/keyframes have already been composited onto the background via
  // the overlay step directly above -- there is no earlier point in this pipeline where a
  // width x height frame exists. So framing here necessarily punches in on the fully-placed
  // result (crop/perspective/keyframes already fixed the item's own footprint and position; a
  // declared framing zooms into a region of that placed canvas), not on the pre-placement item
  // footprint the way appendCutVisualTransform's ordering does -- an inherent structural
  // difference between the two builders' pipelines, not a partial/approximate porting of the
  // feature. framing's own crop math is unchanged (reused verbatim via appendCutFraming), so its
  // existing separately-tested behavior (cut-framing.test.mjs) is preserved wherever it runs.
  const framing = cut?.framing;
  const framingDeclared = hasUsableFraming(framing);
  const composed = framingDeclared ? `[ct_${id}_lcanvas]` : outputLabel;
  filters.push(
    `${background}${processed}overlay=x=(main_w-overlay_w)/2+${xExpr}:y=(main_h-overlay_h)/2+${yExpr}:format=auto:shortest=1${composed}`,
  );
  if (framingDeclared) {
    appendCutFraming({ filters, inputLabel: composed, outputLabel, framing, width, height, id });
  }
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
