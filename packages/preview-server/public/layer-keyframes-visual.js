// contract-2026-08-09-transform-keyframes-v0.md (layers[].keyframes) preview reproduction for
// the Web UI. Mirrors packages/render-cut/src/layer-keyframes.mjs's semantics (declaring-points-
// per-category, hold-before-first/hold-after-last/interpolate-between, per-point easing governing
// the segment it ends, easeInOutCubic formula) exactly, but evaluated numerically at a single
// instant instead of emitted as ffmpeg expression strings -- same relationship framing-visual.js
// has to cut-framing.mjs. This is an independent implementation from the shell's
// apps/shell/extensions/akari-preview/src/common/layer-keyframes-visual.ts
// (contract-2026-08-02-preview-parity.md §2.2.1's "3 surfaces, intentional code duplication"
// convention -- the shell copy is serialized into a sandboxed webview via
// Function.prototype.toString() and cannot import this module).
//
// Unlike render-cut, this surface does NOT need the segment-splitting fallback render-cut's own
// layerPerspectiveKeyframeSteps resorts to for perspective -- ffmpeg's perspective= filter cannot
// be driven by a per-frame expression at all, but this is plain JavaScript evaluated once per
// tick, so perspective interpolates exactly as continuously as transform/crop do here. The two
// surfaces' *sampled* values still agree (perspective corners interpolate the same
// declared-corner-lerp math either way); only the *between-sample* curve shape differs
// (continuous here vs. held-per-segment in the export).

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function easingOf(point) {
  return point && point.easing === 'ease-in-out' ? 'ease-in-out' : 'linear';
}

// easeInOutCubic(u) = u<0.5 ? 4u^3 : 1-(-2u+2)^3/2 -- keep in sync with render-cut's
// easeInOutCubicAt / the shell surface's own copy (contract §2.2.1).
function easeInOutCubicAt(u) {
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

// Holds before the first point, holds after the last, interpolates between -- linearly or eased
// per the *arriving* point's own easing (a point's easing governs the segment ending at that
// point, matching #layerKeyframe's schema $comment).
function piecewiseValueAt(points, pick, t) {
  if (points.length === 1) return pick(points[0]);
  if (t <= points[0].t) return pick(points[0]);
  const last = points[points.length - 1];
  if (t >= last.t) return pick(last);
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (t >= start.t && t <= end.t) {
      const span = end.t - start.t;
      if (span <= 0) return pick(end);
      const u = (t - start.t) / span;
      const eased = easingOf(end) === 'ease-in-out' ? easeInOutCubicAt(u) : u;
      return pick(start) + (pick(end) - pick(start)) * eased;
    }
  }
  return pick(last);
}

function isUsableCrop(crop) {
  return isPlainObject(crop)
    && isFiniteNumber(crop.x) && isFiniteNumber(crop.y)
    && isFiniteNumber(crop.w) && crop.w > 0
    && isFiniteNumber(crop.h) && crop.h > 0;
}

function isUsablePerspective(perspective) {
  if (!isPlainObject(perspective)) return false;
  const corners = perspective.corners;
  return Array.isArray(corners) && corners.length === 4
    && corners.every((corner) => Array.isArray(corner) && corner.length === 2 && isFiniteNumber(corner[0]) && isFiniteNumber(corner[1]));
}

/**
 * Resolves a layer's transform/crop/perspective at `layerLocalSeconds` (seconds since the
 * layer's own start -- the same clock layers[].keyframes[].t and layers[].t/duration use).
 *
 * Returns null when `keyframes` has fewer than 2 usable points (schema-invalid or absent) --
 * callers should leave the layer's existing static transform/crop/perspective untouched, which
 * keeps keyframe-less layers (the overwhelming majority of existing projects) byte-identical to
 * today's behavior. Otherwise returns { transform, crop, perspective }, each either null (that
 * category has no declaring point -- caller keeps the layer's own static value) or the resolved
 * numeric state for that category.
 */
export function computeLayerKeyframesVisual(keyframes, layerLocalSeconds) {
  if (!Array.isArray(keyframes)) return null;
  const points = keyframes
    .filter((point) => isPlainObject(point) && isFiniteNumber(point.t) && point.t >= 0)
    .slice()
    .sort((a, b) => a.t - b.t);
  if (points.length < 2) return null;

  const t = isFiniteNumber(layerLocalSeconds) ? layerLocalSeconds : 0;

  const transformDeclaring = points.filter((point) => isPlainObject(point.transform));
  let transform = null;
  if (transformDeclaring.length > 0) {
    const leaf = (name, fallback) => piecewiseValueAt(transformDeclaring, (point) => {
      const value = point.transform ? point.transform[name] : undefined;
      return isFiniteNumber(value) ? value : fallback;
    }, t);
    const scaleRaw = leaf('scale', 1);
    transform = { x: leaf('x', 0), y: leaf('y', 0), scale: scaleRaw > 0 ? scaleRaw : 1, rotate: leaf('rotate', 0) };
  }

  const cropDeclaring = points.filter((point) => isUsableCrop(point.crop));
  let crop = null;
  if (cropDeclaring.length > 0) {
    const leaf = (name) => piecewiseValueAt(cropDeclaring, (point) => point.crop[name], t);
    crop = { x: leaf('x'), y: leaf('y'), w: leaf('w'), h: leaf('h') };
  }

  const perspectiveDeclaring = points.filter((point) => isUsablePerspective(point.perspective));
  let perspective = null;
  if (perspectiveDeclaring.length > 0) {
    const corners = [0, 1, 2, 3].map((cornerIndex) => [
      piecewiseValueAt(perspectiveDeclaring, (point) => point.perspective.corners[cornerIndex][0], t),
      piecewiseValueAt(perspectiveDeclaring, (point) => point.perspective.corners[cornerIndex][1], t),
    ]);
    perspective = { corners };
  }

  return { transform, crop, perspective };
}
