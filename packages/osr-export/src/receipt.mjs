import { resolveMemoryBudget } from "./memory.mjs";

export function buildOsrReceipt({ tier, verify = "stamp", memory = {}, run = null, finalVerify = null, profile = "gpu" } = {}) {
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
      peak_bytes: memory.peakBytes ?? null,
      warning_exceeded: memory.warningExceeded ?? false,
      hard_stop_exceeded: memory.hardStopExceeded ?? false,
    },
    run,
    finalVerify,
  };
}
