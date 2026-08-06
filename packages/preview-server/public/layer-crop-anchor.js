// docs/contract-2026-08-02-preview-parity.md §2.4.1 crop pivot: Web is an INDEPENDENT
// implementation of the same anchor-invariance contract as shell's
// apps/shell/extensions/akari-preview/src/common/layer-crop-anchor.ts (§2.2.1 "3 surfaces,
// intentional code duplication" -- both unit-tested against the same reference points).
//
// Web's placement convention differs from shell's: the layer <video> is CSS `position:absolute`
// at its own static (~0,0) box, with `transform: translate(x,y) scale(s) rotate(deg)` and
// `transform-origin: <crop-rect-center>%`. CSS composes these as
// screenPos(s) = origin + T + scale·Rot(rotate)·(s − origin) -- translate(T) sits OUTSIDE the
// origin-relative scale/rotate, so moving transform-origin alone leaves already-translated content
// unaffected only when scale=1 and rotate=0 (the "no crop yet" / "never resized" case, which is
// why this bug hid for so long). Whenever scale != 1 or rotate != 0 -- true for nearly every real
// PiP layer -- dragging a crop handle moves transform-origin (the crop-rect center) and visibly
// shifts the whole image, exactly like shell's bug.
//
// Derivation: requiring screenPos(s) invariant across origin: c -> c' (T, scale, rotate held
// fixed) gives T' = T + (scale·Rot(rotate) − I)·(c' − c), independent of s -- so it fixes every
// retained point at once, not just the anchor opposite the dragged handle. rotate=0 reduces to
// T' = T + (scale − 1)·(c' − c).

/**
 * Returns the corrected `{ x, y }` transform offset to write back alongside a crop-rect change so
 * every retained source pixel keeps its current screen position. `scale`/`rotate` are read from
 * `transform` but never altered -- only x/y move. Crop coordinates are 0..1 normalized (source
 * frame relative); videoWidth/videoHeight are the layer's native pixel size.
 */
export function cropAnchorCorrectedTransform(prevCrop, nextCrop, transform, videoWidth, videoHeight) {
  const prevCx = prevCrop.x + prevCrop.w / 2;
  const prevCy = prevCrop.y + prevCrop.h / 2;
  const nextCx = nextCrop.x + nextCrop.w / 2;
  const nextCy = nextCrop.y + nextCrop.h / 2;
  const dxPx = (nextCx - prevCx) * (videoWidth || 0);
  const dyPx = (nextCy - prevCy) * (videoHeight || 0);
  const scale = Number.isFinite(transform.scale) ? transform.scale : 1;
  const rad = (Number.isFinite(transform.rotate) ? transform.rotate : 0) * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = dxPx * cos - dyPx * sin;
  const ry = dxPx * sin + dyPx * cos;
  return {
    x: transform.x + (scale * rx - dxPx),
    y: transform.y + (scale * ry - dyPx),
  };
}
