// finger-frame: per-sample extraction of "the one usable left hand, the one usable right hand"
// out of a vision-tracks hand-pose track's raw `detections[]` (docs/contract-2026-08-11-analysis-
// vision-tracks-v0.md §2.2). Kept independent of gesture.mjs (the hysteresis state machine) and
// corners.mjs (the quad math) so each stays separately unit-testable.

function isUsablePoint(point) {
  return Array.isArray(point) && point.length === 2
    && Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

// Aspect-corrected thumb-index gap, normalized by source frame width. hand-pose coordinates are
// each normalized independently against the source's own width/height (contract §2), so a plain
// Euclidean distance in that raw (u, v) space is NOT proportional to true on-screen distance
// whenever width != height -- e.g. a purely-vertical gap on a 1920x1080 source reads ~1.78x
// smaller in raw units than an equal-looking horizontal gap. Multiplying each axis back out by its
// own pixel dimension before taking the distance (then normalizing by width, an arbitrary but
// fixed reference scale) fixes that, so a single --open-threshold/--close-threshold pair means the
// same physical "how wide is the gap" regardless of the source's aspect ratio.
function thumbIndexDistance(thumb, index, sourceWidth, sourceHeight) {
  const dxPx = (index[0] - thumb[0]) * sourceWidth;
  const dyPx = (index[1] - thumb[1]) * sourceHeight;
  return Math.sqrt(dxPx * dxPx + dyPx * dyPx) / sourceWidth;
}

// Picks the first detection of the given chirality whose thumb_tip AND index_tip both survived
// vision-tracks' --joint-confidence cutoff (contract §2.2's "捏造ゼロ" per-joint omission) --
// ties (two same-chirality detections, e.g. a misclassification) resolve to whichever is first in
// the track's own detections[] order, deterministically. Returns null if this hand isn't usable at
// this sample (not detected, wrong/unknown chirality only, or thumb/index omitted).
function pickHand(detections, chirality, sourceWidth, sourceHeight) {
  const detection = (detections ?? []).find((entry) => entry?.chirality === chirality
    && isUsablePoint(entry?.joints?.thumb_tip) && isUsablePoint(entry?.joints?.index_tip));
  if (!detection) return null;
  const thumb = detection.joints.thumb_tip;
  const index = detection.joints.index_tip;
  return { thumb, index, dist: thumbIndexDistance(thumb, index, sourceWidth, sourceHeight) };
}

// samples: hand-pose track's own `samples[]` (contract §2), in ascending `t` order.
// Returns one entry per input sample: { t, left: {thumb,index,dist} | null, right: (same) | null }.
export function extractHandSamples(samples, { sourceWidth, sourceHeight }) {
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) {
    throw new Error("extractHandSamples: sourceWidth/sourceHeight は正の数である必要があります");
  }
  return (samples ?? []).map((sample) => ({
    t: sample.t,
    left: pickHand(sample.detections, "left", sourceWidth, sourceHeight),
    right: pickHand(sample.detections, "right", sourceWidth, sourceHeight),
  }));
}
