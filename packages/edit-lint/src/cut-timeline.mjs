// Local port of packages/render-cut/src/cut-timeline.mjs's cutSpeed/segmentDuration and
// packages/render-cut/src/cut-freeze.mjs's freezeDurationSeconds. edit-lint is a lower-level
// package render-cut depends on, so it cannot import back from render-cut. Keep this copy in
// sync whenever the render-cut implementations change.
export function cutSpeed(cut) {
  const value = cut?.speed;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

export function freezeDurationSeconds(freeze) {
  const value = freeze?.duration_sec;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export function segmentDuration(cut) {
  return (cut.out - cut.in) / cutSpeed(cut) + freezeDurationSeconds(cut?.freeze);
}
