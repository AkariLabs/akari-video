import { totalmem } from "node:os";

const MIB = 1024 * 1024;
// 既定の予算は 1080p（1920×1080）で較正した値。出力ピクセル数が 1080p を超えるぶんだけ比例で増やす
// （4K = 4 倍。RGBA 1 枚 33 MB × 複数サーフェス + エンコード待ち行列 + デコードプールが素直に 4 倍になる）。
// hard stop にはさらに物理メモリの MEMORY_MACHINE_FLOOR_RATIO（25%）を下限として入れる（解像度に関係なく常に適用）。
// 720p / 1080p 出力でも入力素材の大きさ（例: 4K HEVC 88 分 × 4 本）で RSS は膨らみ、1 GiB 固定では 15.7 GB 機が
// hard stop に当たった（issue #28）。下限が効いたときの warning は hard stop の MEMORY_WARNING_TO_HARD_STOP_RATIO。
// 上限は物理メモリの MEMORY_MACHINE_CAP_RATIO（50%）— この安全弁はマシンを守るためのもので、8 GB 機で 4K を通すために
// 予算だけ外すとスワップ暴走→カーネルパニックに至る。下限 < 上限は比率上つねに成立するので、切り詰めが効くのはスケール側だけ。
// env 上書き（AKARI_OSR_MEMORY_*_MIB）は絶対値で、スケールも下限も上限も受けない（人間の明示判断を尊重）。
// 4K の実測はまだ無い: 初回の peak を calibration に残し、この係数を較正すること（2026-09-01）。
export const MEMORY_REFERENCE_PIXELS = 1920 * 1080;
export const MEMORY_MACHINE_FLOOR_RATIO = 0.25;
export const MEMORY_MACHINE_CAP_RATIO = 0.5;
export const MEMORY_WARNING_TO_HARD_STOP_RATIO = 0.75;
export const GPU_MEMORY_WARNING_BYTES = 768 * 1024 * 1024;
export const GPU_MEMORY_HARD_STOP_BYTES = 1024 * 1024 * 1024;
// SwiftShader の 1080p 実測は 1.1 GiB 台なので、ソフト描画には独立した余裕を持たせる。
export const SOFT_MEMORY_WARNING_BYTES = 1536 * 1024 * 1024;
export const SOFT_MEMORY_HARD_STOP_BYTES = 2048 * 1024 * 1024;
export const MEMORY_WARNING_BYTES = GPU_MEMORY_WARNING_BYTES;
export const MEMORY_HARD_STOP_BYTES = GPU_MEMORY_HARD_STOP_BYTES;

// hard stop に当たったときの identity。GPU 経路はこの reasonCode を見て OSR へフォールバックする
// （issue #52: 98% 地点で落ちて成果物ゼロ = 前版で出せていたものが出せない退行だった）。
export const MEMORY_HARD_STOP_MARKER = "RSS hard stop:";
export const MEMORY_HARD_STOP_REASON = "memory-hard-stop";

export function memoryHardStopError(bytes) {
  return new Error(`${MEMORY_HARD_STOP_MARKER} ${bytes} bytes`);
}

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
  let machineFloor = false;
  let machineCapped = false;
  const machineBytes = Number(totalMemoryBytes) > 0 ? Number(totalMemoryBytes) : null;
  if (machineBytes !== null) {
    // 下限: derivedHardStop = max(基準値 × ピクセル比, floorMib(totalmem × 25%))。同値のときは「下限が効いた」と数えない
    const floor = floorMib(machineBytes * MEMORY_MACHINE_FLOOR_RATIO);
    if (floor > derivedHardStopBytes) {
      derivedHardStopBytes = floor;
      derivedWarningBytes = floorMib(floor * MEMORY_WARNING_TO_HARD_STOP_RATIO);
      machineFloor = true;
    }
    // 上限: 物理メモリの 50%（1080p 以下にも常に適用。下限 < 上限なので下限が効いた直後に切り詰めることは無い）
    const cap = floorMib(machineBytes * MEMORY_MACHINE_CAP_RATIO);
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
  // hard stop だけ上書きされ、既定（スケール / 下限適用後）の warning がそれ以上になったときは warning を追従させる
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
    // machineFloor / machineCapped は budget scale と同じく既定値の導出を表す（env 上書き時も導出結果を残す）
    machineFloor,
    machineCapped,
    totalMemoryBytes: machineBytes,
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
        machineFloor: budget.machineFloor ?? false,
        machineCapped: budget.machineCapped ?? false,
        totalMemoryBytes: budget.totalMemoryBytes ?? null,
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
