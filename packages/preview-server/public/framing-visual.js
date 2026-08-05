// docs/contract-2026-07-22-render-basics.md #6/#7 (cuts[].framing / cuts[].freeze) preview
// reproduction for the Web UI. Mirrors packages/render-cut/src/cut-framing.mjs's
// isUsableCrop/usableKeyframes/piecewiseLinearExpr semantics and cut-freeze.mjs's at_sec
// clamping exactly, evaluated numerically at a single point in time instead of emitted as an
// ffmpeg filtergraph expression. This is an independent implementation from the shell's
// src/common/cut-framing-visual.ts / cut-freeze-visual.ts (contract-2026-08-02-preview-parity.md
// §2.2.1's "3 surfaces, intentional code duplication" convention -- the shell copy is serialized
// into a sandboxed webview via Function.prototype.toString() and cannot import this module).

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clamp(value, lo, hi) {
  return hi <= lo ? lo : Math.min(Math.max(value, lo), hi);
}

function round(value) {
  return Number(value.toFixed(6));
}

// Holds before the first point, holds after the last, linearly interpolates between -- matches
// render-cut's piecewiseLinearExpr, evaluated as a number instead of a string.
function piecewiseLinear(points, pick, t) {
  const first = points[0];
  const last = points[points.length - 1];
  if (t <= first.t) return pick(first);
  if (t >= last.t) return pick(last);
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    if (t >= start.t && t <= end.t) {
      const span = end.t - start.t;
      if (span <= 0) return pick(end);
      return pick(start) + (pick(end) - pick(start)) * (t - start.t) / span;
    }
  }
  return pick(last);
}

/**
 * Computes the CSS transform that reproduces cuts[].framing (a static crop window, or a
 * scale/pan keyframe zoom) in the Web preview. `cutLocalPlayedSeconds` must be the cut's own
 * elapsed *played* (post-speed) time -- the same clock as framing.keyframes[].t and
 * freeze.at_sec (contract-2026-07-22-render-basics.md #6/#7).
 *
 * Returns null when framing has no usable crop/keyframes (schema-invalid or absent) -- callers
 * should leave whatever transform/transformOrigin they would otherwise apply untouched, which
 * keeps framing-less cuts (the overwhelming majority of existing projects) byte-identical to
 * today's behavior.
 */
export function computeCutFramingVisual(framing, cutLocalPlayedSeconds) {
  const rawCrop = framing && typeof framing === 'object' ? framing.crop : null;
  const usableCrop = rawCrop && typeof rawCrop === 'object'
    && isFiniteNumber(rawCrop.x) && isFiniteNumber(rawCrop.y)
    && isFiniteNumber(rawCrop.w) && rawCrop.w > 0
    && isFiniteNumber(rawCrop.h) && rawCrop.h > 0
    ? rawCrop : null;

  const rawKeyframes = framing && typeof framing === 'object' ? framing.keyframes : null;
  const points = (Array.isArray(rawKeyframes) ? rawKeyframes : [])
    .filter(point => Boolean(point) && typeof point === 'object'
      && isFiniteNumber(point.t) && point.t >= 0
      && isFiniteNumber(point.scale) && point.scale > 0)
    .slice()
    .sort((a, b) => a.t - b.t);
  const usableKeyframes = points.length >= 2 ? points : null;

  if (!usableKeyframes && !usableCrop) return null;

  if (usableKeyframes) {
    const t = isFiniteNumber(cutLocalPlayedSeconds) ? cutLocalPlayedSeconds : 0;
    const scale = Math.max(1, piecewiseLinear(usableKeyframes, point => point.scale, t));
    const cx = piecewiseLinear(usableKeyframes, point => (isFiniteNumber(point.cx) ? point.cx : 0.5), t);
    const cy = piecewiseLinear(usableKeyframes, point => (isFiniteNumber(point.cy) ? point.cy : 0.5), t);
    // appendKeyframeZoom (cut-framing.mjs): the fitted frame is scaled up by `scale` (anchored
    // at its own top-left), then a fixed-size window is cropped out of it at (cropXFrac,
    // cropYFrac) of the *scaled* frame. Under transform-origin: 0 0, the same content point maps
    // as `p*scale - cropFrac`, i.e. `translate(-cropFrac%) scale(scale)` (translate
    // outer/leftmost so it applies to the already-scaled point).
    const cropXFrac = clamp(cx * scale - 0.5, 0, scale - 1);
    const cropYFrac = clamp(cy * scale - 0.5, 0, scale - 1);
    return {
      transformOrigin: '0 0',
      transform: `translate(${round(-cropXFrac * 100)}%, ${round(-cropYFrac * 100)}%) scale(${round(scale)})`
    };
  }

  const sx = 1 / usableCrop.w;
  const sy = 1 / usableCrop.h;
  // appendStaticCrop (cut-framing.mjs): crop out a (crop.w, crop.h) window at (crop.x, crop.y),
  // then rescale that window back up to fill the canvas -- q = (p - crop.xy) * (sx, sy), i.e.
  // `scale(sx, sy) translate(-crop.x%, -crop.y%)` under transform-origin: 0 0 (scale
  // outer/leftmost so it applies to the already-translated point).
  return {
    transformOrigin: '0 0',
    transform: `scale(${round(sx)}, ${round(sy)}) translate(${round(-usableCrop.x * 100)}%, ${round(-usableCrop.y * 100)}%)`
  };
}

/**
 * Determines whether playback has reached a cut's freeze point. `cutLocalPlayedSeconds` must be
 * the same "played" (post-speed) clock as framing.keyframes[].t
 * (contract-2026-07-22-render-basics.md #6/#7) -- for a cut with no freeze, or an invalid
 * declaration (missing/non-finite at_sec, non-positive duration_sec), this always reports
 * shouldHold: false. Pure/stateless: the caller owns "already triggered this pass" bookkeeping
 * (reset whenever the active segment changes) so a single crossing engages the hold exactly once.
 */
export function checkCutFreezeCrossing(freeze, cutLocalPlayedSeconds) {
  const at = freeze && typeof freeze === 'object' && isFiniteNumber(freeze.at_sec) && freeze.at_sec >= 0
    ? freeze.at_sec : null;
  const holdSeconds = freeze && typeof freeze === 'object' && isFiniteNumber(freeze.duration_sec) && freeze.duration_sec > 0
    ? freeze.duration_sec : 0;
  if (at === null || holdSeconds <= 0) return { shouldHold: false, holdSeconds: 0 };
  const played = isFiniteNumber(cutLocalPlayedSeconds) ? cutLocalPlayedSeconds : 0;
  return { shouldHold: played >= at, holdSeconds };
}
