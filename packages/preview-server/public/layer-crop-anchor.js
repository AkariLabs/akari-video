// docs/contract-2026-08-02-preview-parity.md §2.4.1 crop pivot: layers[] are placed with the
// *crop rectangle's center* as the anchor point (left/top = outputSize/2 + transform.(x,y),
// transform-origin = crop-rect center%, transform: translate(-pivot%,-pivot%) rotate(deg)). A
// crop-handle edit moves that center, so without correction the anchor itself moves and the whole
// image visibly shifts on screen (2026-08-06 owner field-test report, crop-handle-anchor-fix).
// This function returns the transform.x/y that must be written back in the SAME patch as the new
// crop so every *retained* source pixel keeps the same screen position -- i.e. "only the dragged
// edge moves; every other edge/corner stays put" for all 8 handle directions at once (the
// correction is derived for an arbitrary point, not per-handle).
//
// Derivation: placement is screenPos(s) = P + Rot(rotate)·scale·(s − pivot), where
// P = (outputW/2+x, outputH/2+y) and pivot = crop-rect center (source px). Holding screenPos(s)
// invariant across pivot: c -> c' requires P' = P + Rot(rotate)·scale·(c' − c) -- independent of
// s, so it fixes every retained point simultaneously. rotate=0 reduces to plain axis-aligned
// addition (the rotation matrix is the identity).
//
// 2026-08-06 web-layer-placement-parity: Web's <video> placement convention now matches shell's
// (left/top = outputSize/2+x,y; width/height = videoWidth/Height×scale; transform-origin =
// crop-rect center%; transform = translate(-pivot%,-pivot%) rotate(deg)) -- previously Web used a
// different convention (static position + translate(x,y) scale(s), no compensating
// translate(-pivot%)) and needed an independently-derived formula here. Now that the conventions
// are unified, this is byte-for-byte the same formula as shell's
// apps/shell/extensions/akari-preview/src/common/layer-crop-anchor.ts -- kept as a SEPARATE file
// per §2.2.1's "3 surfaces, intentional code duplication" convention (both unit-tested against the
// same reference points; Web's app.js and shell's webview cannot share an import).

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
  const scale = Number.isFinite(transform.scale) ? transform.scale : 1;
  const dxPx = (nextCx - prevCx) * (videoWidth || 0) * scale;
  const dyPx = (nextCy - prevCy) * (videoHeight || 0) * scale;
  const rad = (Number.isFinite(transform.rotate) ? transform.rotate : 0) * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    x: transform.x + (dxPx * cos - dyPx * sin),
    y: transform.y + (dxPx * sin + dyPx * cos),
  };
}
