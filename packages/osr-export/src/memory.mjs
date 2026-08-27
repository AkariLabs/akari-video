export const GPU_MEMORY_WARNING_BYTES = 768 * 1024 * 1024;
export const GPU_MEMORY_HARD_STOP_BYTES = 1024 * 1024 * 1024;
// SwiftShader の 1080p 実測は 1.1 GiB 台なので、ソフト描画には独立した余裕を持たせる。
export const SOFT_MEMORY_WARNING_BYTES = 1536 * 1024 * 1024;
export const SOFT_MEMORY_HARD_STOP_BYTES = 2048 * 1024 * 1024;
export const MEMORY_WARNING_BYTES = GPU_MEMORY_WARNING_BYTES;
export const MEMORY_HARD_STOP_BYTES = GPU_MEMORY_HARD_STOP_BYTES;

export function resolveMemoryBudget({ soft = false, env = process.env } = {}) {
  const profile = soft ? "soft" : "gpu";
  const defaultWarningBytes = soft ? SOFT_MEMORY_WARNING_BYTES : GPU_MEMORY_WARNING_BYTES;
  const defaultHardStopBytes = soft ? SOFT_MEMORY_HARD_STOP_BYTES : GPU_MEMORY_HARD_STOP_BYTES;
  const warningBytes = env.AKARI_OSR_MEMORY_WARN_MIB === undefined
    ? defaultWarningBytes
    : positiveMib(env.AKARI_OSR_MEMORY_WARN_MIB, "AKARI_OSR_MEMORY_WARN_MIB");
  const hardStopBytes = env.AKARI_OSR_MEMORY_HARD_STOP_MIB === undefined
    ? defaultHardStopBytes
    : positiveMib(env.AKARI_OSR_MEMORY_HARD_STOP_MIB, "AKARI_OSR_MEMORY_HARD_STOP_MIB");
  if (warningBytes >= hardStopBytes) {
    throw new Error("AKARI OSR memory budget requires warning < hard stop");
  }
  return { profile, warningBytes, hardStopBytes, workerBudgetBytes: hardStopBytes };
}

export function createMemorySampler({
  intervalMs = 10_000,
  sample = () => process.memoryUsage().rss,
  onWarning = () => {},
  onHardStop = () => {},
  budget = resolveMemoryBudget(),
} = {}) {
  const samples = [];
  let peakBytes = 0;
  let warningEmitted = false;
  let hardStopEmitted = false;
  const take = (phase = "running") => {
    const rssBytes = Number(sample());
    peakBytes = Math.max(peakBytes, rssBytes);
    samples.push({ elapsedMs: samples.length === 0 ? 0 : Date.now() - startedAt, phase, rssBytes });
    if (rssBytes > budget.warningBytes && !warningEmitted) {
      warningEmitted = true;
      onWarning(rssBytes);
    }
    if (rssBytes > budget.hardStopBytes && !hardStopEmitted) {
      hardStopEmitted = true;
      onHardStop(rssBytes);
    }
    return rssBytes;
  };
  const startedAt = Date.now();
  take("start");
  const timer = setInterval(() => take(), intervalMs);
  timer.unref?.();
  return {
    take,
    stop(phase = "stop") {
      clearInterval(timer);
      take(phase);
      return this.snapshot();
    },
    snapshot() {
      return {
        profile: budget.profile,
        warningBytes: budget.warningBytes,
        hardStopBytes: budget.hardStopBytes,
        workerBudgetBytes: budget.workerBudgetBytes,
        peakBytes,
        warningExceeded: warningEmitted,
        hardStopExceeded: hardStopEmitted,
        samples: [...samples],
      };
    },
  };
}

function positiveMib(value, label) {
  const mib = Number(value);
  if (!Number.isInteger(mib) || mib <= 0) throw new Error(`${label} must be a positive integer, got: ${value}`);
  return mib * 1024 * 1024;
}
