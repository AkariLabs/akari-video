// contract-2026-08-02-preview-parity.md §2.4.4 (layers[].perspective — corner-pin, v0 static).
// Pure math shared conceptually with the shell/Web preview's matrix3d construction (each surface
// hosts its own independent implementation per the §2.2.1 "intentional code duplication"
// convention; this file is render-cut's copy, used to compute the ffmpeg `perspective` filter's
// destination-corner parameters).
//
// Heckbert's classic unit-square -> quadrilateral projective mapping ("Fundamentals of Texture
// Mapping and Image Warping", 1989). The declared corners are the schema's [TL, TR, BL, BR]
// raster order; Heckbert's own derivation expects the *circular* walk order p0=(0,0),
// p1=(1,0), p2=(1,1), p3=(0,1) -- i.e. TL, TR, BR, BL -- so callers must reorder before calling
// squareToQuadCircular (cornersToHomography below does this once, at the public boundary).

function squareToQuadCircular(p0, p1, p2, p3) {
  const [x0, y0] = p0;
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const [x3, y3] = p3;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  let a13;
  let a23;
  if (dx3 === 0 && dy3 === 0) {
    // Source and target are both parallelograms (affine case): no projective term needed.
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
  return { a11, a21, a31, a12, a22, a32, a13, a23 };
}

// Public entry point: corners = [TL, TR, BL, BR] (schema/raster order, each [x, y] normalized
// 0..1). Returns the 3x3 projective matrix (as its 8 free coefficients; the bottom-right entry
// is always 1) mapping the unit square's TL/TR/BL/BR corners onto the given quadrilateral.
export function cornersToHomography(corners) {
  const [tl, tr, bl, br] = corners;
  // Heckbert circular order: p0=(0,0)=TL, p1=(1,0)=TR, p2=(1,1)=BR, p3=(0,1)=BL.
  return squareToQuadCircular(tl, tr, br, bl);
}

// Evaluates the homography at unit-square point (u, v), returning the mapped [x, y] after the
// perspective (homogeneous) divide.
export function applyHomography(matrix, u, v) {
  const w = matrix.a13 * u + matrix.a23 * v + 1;
  const x = matrix.a11 * u + matrix.a21 * v + matrix.a31;
  const y = matrix.a12 * u + matrix.a22 * v + matrix.a32;
  return [x / w, y / w];
}

// Padding fraction applied to each side of the layer's own box before the ffmpeg `perspective`
// filter runs (see computePerspectiveFfmpegCorners below for why padding is required at all).
// 0.5 doubles the box on each axis (padded canvas = 2x width, 2x height) -- chosen for clean
// fractions (padFrac / (1+2*padFrac) = 0.25 exactly) as much as for safety margin; the actual
// correctness of "outside the trapezoid is transparent" only requires padFrac > 0 (ffmpeg's
// out-of-bounds sampling clamps to the nearest input pixel, which is guaranteed to be transparent
// padding as long as *some* padding ring exists — verified empirically against a real ffmpeg
// build, see the render-cut perspective test suite).
export const PERSPECTIVE_PAD_FRAC = 0.5;

// Computes the 4 destination-corner fractions (of the *padded* canvas, i.e. multiply by that
// stage's iw/ih to get pixel expressions) that make ffmpeg's `perspective` filter (sense=
// destination) reproduce the declared corner-pin when applied to a frame that has first been
// padded by PERSPECTIVE_PAD_FRAC on every side.
//
// Why padding + this indirection is needed: ffmpeg's `perspective` x0..y3 params describe where
// the INPUT FRAME'S OWN 4 corners land in the output -- not where some inner content rectangle's
// corners land. To make the *declared* corners (which describe the layer's own un-padded box)
// land exactly where requested, we must evaluate the same homography at the padded frame's own
// (now out-of-[0,1]) corners and feed ffmpeg *those* extrapolated positions. This is the padded
// frame's 4 corners expressed in the box's own normalized coordinates (e.g. top-left of a frame
// padded by PERSPECTIVE_PAD_FRAC on each side sits at (-PERSPECTIVE_PAD_FRAC, -PERSPECTIVE_PAD_FRAC)
// relative to the un-padded box), run through the same homography, then re-normalized to the
// padded canvas's own 0..1 space.
//
// Returns [[x,y] x4] in TL, TR, BL, BR order, each component a fraction of the padded canvas
// (i.e. 0..1 in the common case, but can fall outside that range for extreme corner-pins -- ffmpeg
// clamps those to its own frame edge, which computePerspectiveFfmpegCorners's padding guarantees
// is transparent).
export function computePerspectiveFfmpegCorners(corners, padFrac = PERSPECTIVE_PAD_FRAC) {
  const matrix = cornersToHomography(corners);
  const denom = 1 + 2 * padFrac;
  const frameCornersInBoxUnits = [
    [-padFrac, -padFrac], // TL
    [1 + padFrac, -padFrac], // TR
    [-padFrac, 1 + padFrac], // BL
    [1 + padFrac, 1 + padFrac], // BR
  ];
  return frameCornersInBoxUnits.map(([u, v]) => {
    const [nx, ny] = applyHomography(matrix, u, v);
    return [(padFrac + nx) / denom, (padFrac + ny) / denom];
  });
}
