// finger-frame: 4 fingertip points (left thumb/index + right thumb/index) -> a schema-compliant
// layerPerspective corners quad ([TL, TR, BL, BR] raster order, each [x, y]).
//
// The 4 raw points arrive in an UNKNOWN geometric arrangement -- chirality only tells us which
// point came from which hand, not where it sits on screen. Naively assigning
// [leftThumb, leftIndex, rightThumb, rightIndex] straight to [TL, TR, BL, BR] can produce a
// self-intersecting ("bowtie") quad whenever the physical hand layout doesn't happen to match
// that raster order, and packages/schemas/bin/validate-edit.mjs's shoelace-area check (near-zero
// signed area) only catches the degenerate limit of that, not a merely-twisted-but-nonzero-area
// bowtie -- ffmpeg's perspective filter would still receive it and warp unpredictably.
//
// ねじれ quad の正規化: sort the 4 points by polar angle around their own centroid. This is a
// standard technique (the centroid of a point set always lies inside that set's convex hull, so a
// radial sweep from an interior point visits the points in a simple, "star-shaped" cyclic order --
// see e.g. the standard "sort points to form a simple polygon" construction) and is GUARANTEED to
// produce a simple (non-self-intersecting) polygon regardless of the points' physical arrangement,
// convex or not. In image coordinates (x right, y down) ascending atan2(dy, dx) order sweeps
// right -> down -> left -> up, i.e. exactly the TL -> TR -> BR -> BL clockwise raster walk
// validate-edit.mjs's own shoelace ring already uses (see that file's `ring = [tl, tr, br, bl]`
// comment) -- verified by hand for the 4 canonical quadrant directions in orderCornersFromPoints's
// own test suite.
export const DEGENERATE_AREA_EPSILON = 4e-4; // validate-edit.mjs itself rejects |area2| < 1e-4;
// staying an order of magnitude inside that margin avoids emitting corners that pass here but fail
// there after JSON round-trip rounding.

function centroidOf(points) {
  const sum = points.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}

// Ascending-angle order around the centroid -- see header comment. Returns a NEW array; does not
// mutate `points`. Ties (coincident angles, e.g. two points on the same ray from the centroid) are
// broken by original input order (Array#sort is stable), which is deterministic but not otherwise
// meaningful -- such inputs are already close to degenerate and get caught by quadAreaOf below.
export function angleSortRing(points) {
  const [cx, cy] = centroidOf(points);
  return points
    .map((point, index) => ({ point, index, angle: Math.atan2(point[1] - cy, point[0] - cx) }))
    .sort((a, b) => a.angle - b.angle || a.index - b.index)
    .map((entry) => entry.point);
}

// Signed shoelace area (x2) of a ring already in TL,TR,BR,BL walk order -- same formula and same
// ring convention as validate-edit.mjs's validateLayerPerspective, duplicated intentionally (same
// "independent same-formula implementations" convention perspective-homography.mjs documents for
// the render/preview split) so this module can pre-filter degenerate quads before they ever reach
// edit.json, without importing a schemas-package internal (validate-edit.mjs exports nothing).
export function quadAreaOf(ring) {
  let area2 = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    area2 += x1 * y2 - x2 * y1;
  }
  return area2;
}

function rotateRing(ring, offset) {
  return [0, 1, 2, 3].map((i) => ring[(i + offset) % 4]);
}

function ringDistance2(ringA, ringB) {
  let total = 0;
  for (let i = 0; i < 4; i += 1) {
    const dx = ringA[i][0] - ringB[i][0];
    const dy = ringA[i][1] - ringB[i][1];
    total += dx * dx + dy * dy;
  }
  return total;
}

// Picks the ring index closest to "top-left" (smallest x+y) as a cheap, deterministic proxy for
// which physical point should become the TL slot -- without this, angleSortRing's own starting
// point is an arbitrary function of point order (whichever point happens to have the smallest raw
// atan2 value), which can seat any of the 4 fingertips as "TL" and make the pasted layer's content
// appear rotated/mirrored inside an otherwise-correct quad shape. Only used to seed the FIRST
// keyframe of an activation interval (see orderCornersFromPoints's `previousRing` branch for how
// subsequent samples stay stable instead of re-deriving this each time).
function mostTopLeftIndex(ring) {
  let bestIndex = 0;
  let bestScore = Infinity;
  ring.forEach(([x, y], index) => {
    const score = x + y;
    if (score < bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestIndex;
}

// Of the 4 cyclic rotations of `ring` (all equally valid simple-polygon walks of the same 4
// points), returns the one whose slots land closest to `previousRing`'s own slots -- keeps
// consecutive keyframes in one activation interval from visibly "flipping" which fingertip plays
// which corner as the hands drift, since layer-keyframes.mjs interpolates each corner SLOT
// independently (TL slot always interpolates from the previous point's TL to this point's TL).
function bestRotationMatching(ring, previousRing) {
  let bestOffset = 0;
  let bestDistance = Infinity;
  for (let offset = 0; offset < 4; offset += 1) {
    const distance = ringDistance2(rotateRing(ring, offset), previousRing);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestOffset = offset;
    }
  }
  return rotateRing(ring, bestOffset);
}

// Public entry point. `points` = exactly 4 raw [x, y] points in ANY order (this module does not
// care which fingertip is which). Returns:
//   - `corners`: [TL, TR, BL, BR] in schema raster order (#layerPerspective), or null if the 4
//     points are (near-)degenerate (see DEGENERATE_AREA_EPSILON) -- caller should treat that
//     sample as unusable, same as a missing detection.
//   - `ring`: the clockwise TL,TR,BR,BL walk this call settled on, to pass back in as the next
//     call's `previousRing` (chains temporal stability across an interval's samples).
//
// `previousRing`, when given, is used instead of the mostTopLeftIndex heuristic to choose the
// rotation -- pass it for every sample after the first one in the same activation interval, and
// omit it (or pass null) only for that first sample.
export function orderCornersFromPoints(points, previousRing = null) {
  if (!Array.isArray(points) || points.length !== 4) {
    throw new Error("orderCornersFromPoints: points には [x,y] を 4 個渡してください");
  }
  const angleRing = angleSortRing(points); // some clockwise rotation of TL,TR,BR,BL
  const ring = previousRing
    ? bestRotationMatching(angleRing, previousRing)
    : rotateRing(angleRing, mostTopLeftIndex(angleRing));
  const area2 = quadAreaOf(ring);
  if (Math.abs(area2) < DEGENERATE_AREA_EPSILON) {
    return { corners: null, ring: null };
  }
  const [tl, tr, br, bl] = ring;
  return { corners: [tl, tr, bl, br], ring };
}
