export function cutSpeed(cut) {
  const value = cut?.speed;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

export function segmentDuration(cut) {
  return (cut.out - cut.in) / cutSpeed(cut);
}

// cuts[] の各カットについて、合成後タイムライン上の開始位置と尺を返す。
// xfade の重複時間と speed による尺の伸縮は plan.mjs のフィルタグラフと同じ式で扱う。
export function computeCutTimelineOffsets(cuts) {
  if (!Array.isArray(cuts) || cuts.length === 0) return [];
  const offsets = [];
  let start = 0;
  let duration = segmentDuration(cuts[0]);
  offsets.push({ start, duration });
  for (let index = 1; index < cuts.length; index += 1) {
    const boundary = cuts[index - 1].transition_out;
    const transitionDuration = boundary ? boundary.duration : 0;
    start = start + duration - transitionDuration;
    duration = segmentDuration(cuts[index]);
    offsets.push({ start, duration });
  }
  return offsets;
}
