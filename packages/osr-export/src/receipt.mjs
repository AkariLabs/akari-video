import { normalizeGpuPreferenceRecord } from "./gpu-preference.mjs";
import { resolveMemoryBudget } from "./memory.mjs";

export function buildOsrReceipt({
  tier, verify = "stamp", memory = {}, run = null, finalVerify = null, profile = "gpu", viewport = null, gpuPreference = null, warmUp = null,
} = {}) {
  const fallbackBudget = resolveMemoryBudget({ soft: profile === "soft", env: {} });
  return {
    provenance: {
      engine: "osr",
      launcher_tier: tier ?? null,
      verify,
      // Windows のアプリ別 GPU 設定の一時上書き（launchElectronExport の gpuPreference 記録・契約 §11.7）。他 OS は理由だけ。
      gpu_preference: normalizeGpuPreferenceRecord(gpuPreference),
    },
    memory: {
      profile: memory.profile ?? fallbackBudget.profile,
      warning_bytes: memory.warningBytes ?? fallbackBudget.warningBytes,
      hard_stop_bytes: memory.hardStopBytes ?? fallbackBudget.hardStopBytes,
      worker_budget_bytes: memory.workerBudgetBytes ?? fallbackBudget.workerBudgetBytes,
      budget_scale: memory.budgetScale ?? fallbackBudget.scale,
      machine_capped: memory.machineCapped ?? fallbackBudget.machineCapped,
      machine_floor: memory.machineFloor ?? fallbackBudget.machineFloor,
      total_memory_bytes: memory.totalMemoryBytes ?? fallbackBudget.totalMemoryBytes,
      peak_bytes: memory.peakBytes ?? null,
      warning_exceeded: memory.warningExceeded ?? false,
      hard_stop_exceeded: memory.hardStopExceeded ?? false,
    },
    viewport: normalizeOsrViewport(viewport),
    // 起動直後の空 paint の warm-up（run.json warm_up・契約 §11.8）。無ければ null。
    warm_up: normalizeOsrWarmUp(warmUp),
    run,
    finalVerify,
  };
}

// run.json の viewport（offscreen 窓を出力寸法 + stamp 行 1 px に固定した記録）を receipt の snake_case に揃える。
// 4 寸法（requested / measured / display / work_area）が非負整数で emulated が boolean のときだけ残し、それ以外は null。
export function normalizeOsrViewport(value) {
  if (!value || typeof value !== "object") return null;
  const requested = normalizeSize(value.requested);
  const measured = normalizeSize(value.measured);
  const display = normalizeSize(value.display);
  const workArea = normalizeSize(value.work_area ?? value.workArea);
  if (!requested || !measured || !display || !workArea || typeof value.emulated !== "boolean") return null;
  return { requested, measured, emulated: value.emulated, display, work_area: workArea };
}

// run.json の warm_up（{ attempts, empty_attempts, elapsed_ms, satisfied }）を receipt の snake_case に揃える。
// attempts / empty_attempts が非負整数・elapsed_ms が非負の有限数・satisfied が boolean のときだけ残し、それ以外は null。
export function normalizeOsrWarmUp(value) {
  if (!value || typeof value !== "object") return null;
  const attempts = nonNegativeInteger(value.attempts);
  const emptyAttempts = nonNegativeInteger(value.empty_attempts ?? value.emptyAttempts);
  const elapsedMs = Number(value.elapsed_ms ?? value.elapsedMs);
  if (attempts === null || emptyAttempts === null || !Number.isFinite(elapsedMs) || elapsedMs < 0 || typeof value.satisfied !== "boolean") {
    return null;
  }
  return { attempts, empty_attempts: emptyAttempts, elapsed_ms: elapsedMs, satisfied: value.satisfied };
}

function normalizeSize(size) {
  const width = Number(size?.width);
  const height = Number(size?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) return null;
  return { width, height };
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}
