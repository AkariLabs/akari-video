import { totalmem } from "node:os";

const MIB = 1024 * 1024;
// 既定の予算は 1080p（1920×1080）で較正した値。出力ピクセル数が 1080p を超えるぶんだけ比例で増やす
// （4K = 4 倍。RGBA 1 枚 33 MB × 複数サーフェス + エンコード待ち行列 + デコードプールが素直に 4 倍になる）。
// ただしスケール後の hard stop は物理メモリの MEMORY_MACHINE_CAP_RATIO を超えない — この安全弁は
// マシンを守るためのもので、8 GB 機で 4K を通すために予算だけ外すとスワップ暴走→カーネルパニックに至る。
// env 上書き（AKARI_OSR_MEMORY_*_MIB）は絶対値で、スケールも上限も受けない（人間の明示判断を尊重）。
// 4K の実測はまだ無い: 初回の peak を calibration に残し、この係数を較正すること（2026-09-01）。
export const MEMORY_REFERENCE_PIXELS = 1920 * 1080;
export const MEMORY_MACHINE_CAP_RATIO = 0.5;
export const MEMORY_WARNING_TO_HARD_STOP_RATIO = 0.75;
export const GPU_MEMORY_WARNING_BYTES = 768 * 1024 * 1024;
export const GPU_MEMORY_HARD_STOP_BYTES = 1024 * 1024 * 1024;
// SwiftShader の 1080p 実測は 1.1 GiB 台なので、ソフト描画には独立した余裕を持たせる。
export const SOFT_MEMORY_WARNING_BYTES = 1536 * 1024 * 1024;
export const SOFT_MEMORY_HARD_STOP_BYTES = 2048 * 1024 * 1024;
export const MEMORY_WARNING_BYTES = GPU_MEMORY_WARNING_BYTES;
export const MEMORY_HARD_STOP_BYTES = GPU_MEMORY_HARD_STOP_BYTES;

export function memoryBudgetScale({ width = undefined, height = undefined } = {}) {
  if (!(Number(width) > 0) || !(Number(height) > 0)) return 1;
  return Math.max(1, (Number(width) * Number(height)) / MEMORY_REFERENCE_PIXELS);
}

export function resolveMemoryBudget({
  soft = false,
  env = process.env,
  width = undefined,
  height = undefined,
  totalMemoryBytes = totalmem(),
} = {}) {
  const profile = soft ? "soft" : "gpu";
  const scale = memoryBudgetScale({ width, height });
  let derivedWarningBytes = ceilMib((soft ? SOFT_MEMORY_WARNING_BYTES : GPU_MEMORY_WARNING_BYTES) * scale);
  let derivedHardStopBytes = ceilMib((soft ? SOFT_MEMORY_HARD_STOP_BYTES : GPU_MEMORY_HARD_STOP_BYTES) * scale);
  let machineCapped = false;
  // 上限はスケールした予算にだけ効かせる（1080p 以下の既定値は機種に関係なく従来どおり）
  if (scale > 1 && Number(totalMemoryBytes) > 0) {
    const cap = floorMib(Number(totalMemoryBytes) * MEMORY_MACHINE_CAP_RATIO);
    if (derivedHardStopBytes > cap) {
      derivedHardStopBytes = cap;
      derivedWarningBytes = Math.min(derivedWarningBytes, floorMib(cap * MEMORY_WARNING_TO_HARD_STOP_RATIO));
      machineCapped = true;
    }
  }
  const warningOverridden = env.AKARI_OSR_MEMORY_WARN_MIB !== undefined;
  const hardStopOverridden = env.AKARI_OSR_MEMORY_HARD_STOP_MIB !== undefined;
  let warningBytes = warningOverridden
    ? positiveMib(env.AKARI_OSR_MEMORY_WARN_MIB, "AKARI_OSR_MEMORY_WARN_MIB")
    : derivedWarningBytes;
  const hardStopBytes = hardStopOverridden
    ? positiveMib(env.AKARI_OSR_MEMORY_HARD_STOP_MIB, "AKARI_OSR_MEMORY_HARD_STOP_MIB")
    : derivedHardStopBytes;
  // hard stop だけ上書きされ、スケール後の既定 warning がそれ以上になったときは warning を追従させる
  if (hardStopOverridden && !warningOverridden && warningBytes >= hardStopBytes) {
    warningBytes = floorMib(hardStopBytes * MEMORY_WARNING_TO_HARD_STOP_RATIO);
  }
  if (warningBytes >= hardStopBytes) {
    throw new Error("AKARI OSR memory budget requires warning < hard stop");
  }
  return {
    profile,
    warningBytes,
    hardStopBytes,
    workerBudgetBytes: hardStopBytes,
    scale: Number(scale.toFixed(4)),
    machineCapped,
  };
}

function ceilMib(bytes) { return Math.ceil(bytes / MIB) * MIB; }
function floorMib(bytes) { return Math.floor(bytes / MIB) * MIB; }

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
        budgetScale: budget.scale ?? 1,
        machineCapped: budget.machineCapped ?? false,
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
