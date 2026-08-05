// docs/contract-2026-08-02-preview-parity.md §2.4.4 (layers[].perspective — corner-pin, v0
// static) preview reproduction for the Web UI. Mirrors packages/render-cut/src/
// perspective-homography.mjs's Heckbert unit-square -> quadrilateral projective mapping, but
// evaluated as a CSS `matrix3d` transform function instead of ffmpeg `perspective=` filter
// parameters. This is an independent implementation from the shell's
// apps/shell/extensions/akari-preview/src/common/layer-perspective-visual.ts
// (contract-2026-08-02-preview-parity.md §2.2.1's "3 surfaces, intentional code duplication"
// convention -- both are unit-tested against the same reference points to keep them numerically
// in sync).
//
// Composition contract for callers (app.js's applyLayerCropVisual / layer transform string,
// contract §2.4.1 crop pivot): this returns only the innermost `matrix3d(...)` transform
// FUNCTION -- callers append it as the last (rightmost/innermost) entry in the element's existing
// `transform` list (`translate(x,y) scale(s) rotate(deg) matrix3d(...)`), after whatever
// translate/scale/rotate they already emit, leaving `transform-origin` exactly as-is (crop-rect
// center, or 50%/50% when there is no crop). Every function in a CSS transform list is implicitly
// evaluated relative to transform-origin (browsers compute `origin + M(point - origin)` for the
// *whole* composed chain, not per-function), so matrix3d here is built to operate directly on
// box-CENTER-relative pixel coordinates: q = 0 at the box's own center (== transform-origin's
// pivot point), q = +/-boxWidthPx/2 at its left/right edge, etc.
//
// Web's box is the crop rect's own size in the element's *native* (un-scaled) pixel space --
// app.js's `scale(t.scale)` is a separate transform function applied outside (to the left of)
// matrix3d in the composed list, unlike shell which bakes scale into the element's CSS
// width/height and has no separate scale() function -- so the two surfaces pass different
// (correctly surface-appropriate) box sizes to what is otherwise numerically the same math.
//
// IMPORTANT: Heckbert's classic derivation assumes its *domain* is the standard unit square
// [0,1]x[0,1] -- the a11..a32 formulas are only valid when u,v range over [0,1], not an arbitrary
// re-centered range. So this does NOT simply re-run Heckbert with corners shifted by -0.5 (that
// produces a different, incorrect matrix). Instead it composes three straightforward 3x3
// homogeneous matrices via ordinary matrix multiplication: A converts a center-relative pixel
// point to a standard-domain [0,1] fraction, H is the *standard* (render-cut-identical) Heckbert
// matrix, and B converts the standard-domain [0,1] output back to a center-relative pixel value.
// The composed 3x3 (B * H * A) is then laid out into a 4x4 CSS matrix3d.

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function multiply3(a, b) {
  const result = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) sum += a[i][k] * b[k][j];
      result[i][j] = sum;
    }
  }
  return result;
}

/**
 * Computes the CSS `matrix3d(...)` transform function that reproduces layers[].perspective (a
 * static 4-corner corner-pin) in the Web preview, given the box's own native pixel size (post
 * crop -- the same box render-cut's ffmpeg chain applies perspective to, between scale and
 * rotate; Web keeps scale as a separate transform function, so this box is *not* pre-scaled).
 *
 * Returns null when perspective has no usable corners (schema-invalid, absent, or a
 * non-positive box size) -- callers should leave whatever transform they would otherwise apply
 * untouched, which keeps perspective-less layers (the overwhelming majority of existing
 * projects) byte-identical to today's behavior.
 */
export function computeLayerPerspectiveVisual(perspective, boxWidthPx, boxHeightPx) {
  if (!(boxWidthPx > 0) || !(boxHeightPx > 0)) return null;

  const rawCorners = perspective && typeof perspective === 'object' ? perspective.corners : null;
  if (!Array.isArray(rawCorners) || rawCorners.length !== 4) return null;
  const corners = [];
  for (const raw of rawCorners) {
    if (!Array.isArray(raw) || raw.length !== 2) return null;
    const [x, y] = raw;
    if (!isFiniteNumber(x) || x < 0 || x > 1 || !isFiniteNumber(y) || y < 0 || y > 1) return null;
    corners.push([x, y]);
  }

  // H: the standard (domain u,v in [0,1]) Heckbert unit-square -> quadrilateral projective
  // mapping -- byte-for-byte the same construction as render-cut's cornersToHomography, just
  // laid out as a 3x3 matrix instead of named coefficients. Heckbert's circular walk order is
  // p0=(0,0), p1=(1,0), p2=(1,1), p3=(0,1) -- i.e. TL, TR, BR, BL -- so the schema's
  // [TL,TR,BL,BR] raster order is reordered before the solve.
  const [tl, tr, bl, br] = corners;
  const [x0, y0] = tl;
  const [x1, y1] = tr;
  const [x2, y2] = br;
  const [x3, y3] = bl;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  let a13;
  let a23;
  if (dx3 === 0 && dy3 === 0) {
    a13 = 0;
    a23 = 0;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    a13 = (dx3 * dy2 - dx2 * dy3) / den;
    a23 = (dx1 * dy3 - dx3 * dy1) / den;
  }
  const a11 = x1 - x0 + a13 * x1;
  const a21 = x3 - x0 + a23 * x3;
  const a31 = x0;
  const a12 = y1 - y0 + a13 * y1;
  const a22 = y3 - y0 + a23 * y3;
  const a32 = y0;
  const heckbert = [
    [a11, a21, a31],
    [a12, a22, a32],
    [a13, a23, 1],
  ];

  // A: center-relative pixel (qx, qy) -> standard-domain [0,1] fraction (u, v) = (qx/boxW+0.5,
  // qy/boxH+0.5). B: standard-domain [0,1] output (X/W, Y/W) -> center-relative pixel, i.e.
  // (fraction - 0.5) * boxSize. Composing B * H * A gives a single 3x3 that maps
  // center-relative pixel input directly to center-relative pixel output.
  const toStandardFraction = [
    [1 / boxWidthPx, 0, 0.5],
    [0, 1 / boxHeightPx, 0.5],
    [0, 0, 1],
  ];
  const toCenteredPixel = [
    [boxWidthPx, 0, -boxWidthPx * 0.5],
    [0, boxHeightPx, -boxHeightPx * 0.5],
    [0, 0, 1],
  ];
  const pixelMatrix = multiply3(toCenteredPixel, multiply3(heckbert, toStandardFraction));

  // Lays the 3x3 (operating on (x,y,1) -> (X,Y,W)) into a 4x4 CSS matrix3d (column-major:
  // matrix3d(m11,m12,m13,m14, m21,m22,m23,m24, m31,m32,m33,m34, m41,m42,m43,m44), applied as
  // M*(x,y,z,1)). The z row/column is left as identity (z stays 0, unaffected -- this is a flat
  // 2D warp of a z=0 element, not a true 3D tilt) and w/homogeneous-divide is provided by row 4
  // (pixelMatrix's own bottom row), which is exactly what CSS's rasterizer performs when
  // compositing a transformed element -- no separate `perspective()` function is needed.
  const round = (value) => Number(value.toFixed(9));
  const values = [
    pixelMatrix[0][0], pixelMatrix[1][0], 0, pixelMatrix[2][0],
    pixelMatrix[0][1], pixelMatrix[1][1], 0, pixelMatrix[2][1],
    0, 0, 1, 0,
    pixelMatrix[0][2], pixelMatrix[1][2], 0, pixelMatrix[2][2],
  ].map(round);
  return { transformFunction: `matrix3d(${values.join(',')})` };
}
