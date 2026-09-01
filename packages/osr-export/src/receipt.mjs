import { resolveMemoryBudget } from "./memory.mjs";

export function buildOsrReceipt({ tier, verify = "stamp", memory = {}, run = null, finalVerify = null, profile = "gpu", viewport = null } = {}) {
  const fallbackBudget = resolveMemoryBudget({ soft: profile === "soft", env: {} });
  return {
    provenance: {
      engine: "osr",
      launcher_tier: tier ?? null,
      verify,
    },
    memory: {
      profile: memory.profile ?? fallbackBudget.profile,
      warning_bytes: memory.warningBytes ?? fallbackBudget.warningBytes,
      hard_stop_bytes: memory.hardStopBytes ?? fallbackBudget.hardStopBytes,
      worker_budget_bytes: memory.workerBudgetBytes ?? fallbackBudget.workerBudgetBytes,
      budget_scale: memory.budgetScale ?? fallbackBudget.scale,
      machine_capped: memory.machineCapped ?? fallbackBudget.machineCapped,
      peak_bytes: memory.peakBytes ?? null,
      warning_exceeded: memory.warningExceeded ?? false,
      hard_stop_exceeded: memory.hardStopExceeded ?? false,
    },
    viewport: normalizeOsrViewport(viewport),
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

function normalizeSize(size) {
  const width = Number(size?.width);
  const height = Number(size?.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 0 || height < 0) return null;
  return { width, height };
}
