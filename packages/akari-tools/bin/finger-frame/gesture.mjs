// finger-frame: "both hands open" activation-interval detector -- the 発動検出 (gesture ->
// timeline event) step task.md §4 calls for. Pure hysteresis state machine over
// hand-metrics.mjs's per-sample { t, left, right } output; no geometry, no I/O.
//
// Hysteresis (task.md: "開閉のバタつき防止・引数固定・決定論"): opening requires BOTH hands'
// thumb-index gap to clear openThreshold; once open, either hand's gap dropping below the (lower)
// closeThreshold -- or either hand going undetected outright -- starts a bounded loss gap. The dead
// zone between the two thresholds holds whatever state is already current, which is what actually
// suppresses flicker from a gap distance oscillating right at a single threshold.
export const DEFAULT_OPEN_THRESHOLD = 0.16;
export const DEFAULT_CLOSE_THRESHOLD = 0.11;
export const DEFAULT_MIN_OPEN_DURATION = 0.2;
export const DEFAULT_MAX_GAP = 0.15;

export function detectOpenIntervals(handSamples, {
  openThreshold = DEFAULT_OPEN_THRESHOLD,
  closeThreshold = DEFAULT_CLOSE_THRESHOLD,
  minOpenDuration = DEFAULT_MIN_OPEN_DURATION,
  maxGap = DEFAULT_MAX_GAP,
} = {}) {
  if (!(openThreshold > closeThreshold)) {
    throw new Error("detectOpenIntervals: openThreshold は closeThreshold より大きい必要があります（ヒステリシス）");
  }
  const samples = handSamples ?? [];
  const intervals = [];
  let isOpen = false;
  let openSince = null;
  let lossSince = null;

  for (const sample of samples) {
    if (isOpen && lossSince !== null && sample.t - lossSince > maxGap) {
      intervals.push({ startT: openSince, endT: lossSince });
      isOpen = false;
      openSince = null;
      lossSince = null;
    }

    const bothPresent = Boolean(sample.left) && Boolean(sample.right);
    const bothClearOpen = bothPresent
      && sample.left.dist >= openThreshold && sample.right.dist >= openThreshold;
    const forcesClose = !bothPresent
      || sample.left.dist < closeThreshold || sample.right.dist < closeThreshold;

    if (!isOpen && bothClearOpen) {
      isOpen = true;
      openSince = sample.t;
      lossSince = null;
    } else if (isOpen) {
      if (forcesClose) {
        lossSince ??= sample.t;
      } else {
        lossSince = null;
      }
    }
  }
  // Track ends while still open: hold through the last sampled instant. We do not know what
  // happens after the track's own last sample, so we do not extrapolate a close.
  if (isOpen && samples.length > 0) {
    intervals.push({ startT: openSince, endT: samples[samples.length - 1].t });
  }

  return intervals.filter((interval) => interval.endT - interval.startT >= minOpenDuration);
}
