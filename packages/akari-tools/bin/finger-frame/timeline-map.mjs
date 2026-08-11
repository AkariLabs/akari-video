// finger-frame: source-time <-> timeline-time and source-frame <-> canvas-frame mapping.
//
// Reuses render-cut's own cut-timeline resolver (read-only import -- render-cut/src is owned by a
// different task/boundary, this module never edits it) instead of re-deriving cuts[]' gap-aware /
// sequential timeline placement rules, per task.md: "source 時間 → 出力タイムライン時間の写像は
// cuts（in/out/at/speed）から解く".
import { resolveCutSegments, needsGapAwareCutTimeline, computeCutTimelineOffsets, cutSpeed } from "../../../render-cut/src/cut-timeline.mjs";

export { cutSpeed };

// One {start, end} timeline entry per cuts[] entry (same index), regardless of whether the project
// uses the plain sequential model (computeCutTimelineOffsets -- accounts for transition_out
// crossfade overlap) or the gap-aware model (resolveCutSegments -- explicit `at`/`track`,
// transitions not applicable per cut-freeze.mjs's own "v0 は gap-aware タイムラインとの併用不可"
// precedent). needsGapAwareCutTimeline is the same switch render-cut's own plan.mjs uses.
export function resolveCutStartEnds(cuts) {
  if (!Array.isArray(cuts) || cuts.length === 0) return [];
  if (needsGapAwareCutTimeline(cuts)) {
    return resolveCutSegments(cuts).map(({ start, end }) => ({ start, end }));
  }
  return computeCutTimelineOffsets(cuts).map(({ start, duration }) => ({ start, end: start + duration }));
}

// sourceT must already be known to lie within [cut.in, cut.out) -- callers clip first.
export function mapSourceTimeToTimeline(cut, cutStart, sourceT) {
  return cutStart + (sourceT - cut.in) / cutSpeed(cut);
}

// A cut is safe to assume "source-frame-normalized coordinates == this cut's own displayed-frame-
// normalized coordinates, up to the letterbox math below" only when it does not itself reposition/
// crop/zoom the source (contract-2026-08-02-preview-parity.md's crop/scale/perspective/rotate
// pipeline applies to LAYERS; the base track has its own, separate cuts[].framing/cuts[].transform
// escape hatches -- see cut-framing.mjs / cut-transform.mjs). Non-default framing or transform on
// the cut breaks that assumption (framing re-crops/zooms the source before it ever reaches the
// canvas; transform re-positions/re-scales/rotates the whole fitted frame), so callers must check
// this before trusting letterboxContainTransform for a given cut and skip (with a reported warning)
// otherwise -- this is a deliberate v0 scope cut (matches the wider codebase's "declare, don't
// silently mis-map" convention for out-of-scope compositing paths), not a silent approximation.
export function cutHasDefaultFraming(cut) {
  const framing = cut?.framing;
  if (framing && (framing.crop || (Array.isArray(framing.keyframes) && framing.keyframes.length > 0))) {
    return false;
  }
  const transform = cut?.transform;
  if (!transform) return true;
  const x = Number(transform.x ?? 0);
  const y = Number(transform.y ?? 0);
  const scale = Number(transform.scale ?? 1);
  const rotate = Number(transform.rotate ?? 0);
  return x === 0 && y === 0 && scale === 1 && rotate === 0;
}

// render-cut's default fit for a cut with no framing/transform override (plan.mjs:
// `scale=W:H:force_original_aspect_ratio=decrease,pad=W:H:(ow-iw)/2:(oh-ih)/2` -- ffmpeg's
// "contain"/letterbox, centered). Returns a function mapping a source-normalized [x, y] (0..1,
// top-left origin, same convention hand-pose samples already use) to the equivalent
// canvas-normalized [x, y]. Identity when sourceWidth/sourceHeight already match the canvas
// aspect ratio (the common case; verified by this module's own test suite).
export function letterboxContainTransform(sourceWidth, sourceHeight, canvasWidth, canvasHeight) {
  const scale = Math.min(canvasWidth / sourceWidth, canvasHeight / sourceHeight);
  const displayedWidth = sourceWidth * scale;
  const displayedHeight = sourceHeight * scale;
  const offsetX = (canvasWidth - displayedWidth) / 2;
  const offsetY = (canvasHeight - displayedHeight) / 2;
  return ([x, y]) => [
    (offsetX + x * displayedWidth) / canvasWidth,
    (offsetY + y * displayedHeight) / canvasHeight,
  ];
}

// "cover" fit for the PASTED layer: crop the source to the canvas's own aspect ratio (centered),
// then scale that crop to exactly canvasWidth x canvasHeight. With the emitted layer's default
// transform.x/y = 0, layers.mjs's own centering (`overlay=x=(main_w-overlay_w)/2+x...`) then seats
// the layer's post-crop-post-scale box flush over the whole canvas, (0,0)-(canvasWidth,
// canvasHeight) -- which is exactly what makes layerPerspective's corners (declared "relative to
// crop 適用後の層ボックス", #layerPerspective) usable as plain canvas-normalized coordinates
// without any further indirection. Returns { crop, scale } for the layer's own static `crop` /
// `transform.scale` fields (crop is null when the source already matches the canvas aspect ratio,
// matching layerCrop's own "omit when not needed" convention).
export function coverFitLayer(sourceWidth, sourceHeight, canvasWidth, canvasHeight) {
  const sourceAspect = sourceWidth / sourceHeight;
  const canvasAspect = canvasWidth / canvasHeight;
  const ASPECT_EPSILON = 1e-6;
  let crop = null;
  let croppedWidth = sourceWidth;
  let croppedHeight = sourceHeight;
  if (sourceAspect - canvasAspect > ASPECT_EPSILON) {
    const w = canvasAspect / sourceAspect;
    crop = { x: (1 - w) / 2, y: 0, w, h: 1 };
    croppedWidth = sourceWidth * w;
  } else if (canvasAspect - sourceAspect > ASPECT_EPSILON) {
    const h = sourceAspect / canvasAspect;
    crop = { x: 0, y: (1 - h) / 2, w: 1, h };
    croppedHeight = sourceHeight * h;
  }
  const scale = canvasWidth / croppedWidth; // == canvasHeight / croppedHeight by construction
  return { crop, scale };
}
