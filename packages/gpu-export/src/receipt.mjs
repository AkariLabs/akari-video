import { resolveMemoryBudget } from "../../osr-export/src/memory.mjs";
import { normalizeGpuCaptionReceiptEntries } from "../../render-cut/src/render-receipt.mjs";

export function buildGpuReceipt({ tier, launcher = null, run = {}, eligibility = { entries: [] }, finalVerify = null, profile = "gpu" } = {}) {
  const fallbackBudget = resolveMemoryBudget({ soft: profile === "soft", env: {} });
  const memory = run?.memory ?? {};
  return {
    provenance: {
      engine: "gpu",
      launcher_tier: tier ?? launcher?.tier ?? null,
      mux: "mp4box-direct",
      video_reencode: false,
    },
    gpu: {
      encoder: run?.gpu?.encoder ?? null,
      hardware: run?.gpu?.hardware ?? (profile === "soft" ? "prefer-software" : "prefer-hardware"),
      uploadPath: run?.gpu?.uploadPath ?? null,
      quality: run?.gpu?.quality ?? null,
      bitrate: run?.gpu?.bitrate ?? null,
      queueDepth: run?.gpu?.queueDepth ?? null,
      queueWaits: run?.gpu?.queueWaits ?? null,
      rss_peak: memory.peakBytes ?? null,
      readback: run?.gpu?.readbackCounters ?? {},
      captions: normalizeGpuCaptionReceiptEntries(run?.gpu?.captions),
      captionLayoutMaxDeltaPx: finiteNonNegative(run?.gpu?.captionLayoutMaxDeltaPx),
      captionMeasureAttempts: normalizeAttemptSummary(run?.gpu?.captionMeasureAttempts),
      captionRasterTotalMs: finiteNonNegative(run?.gpu?.captionRasterTotalMs),
      captionRasterBatches: normalizeBatchSummary(run?.gpu?.captionRasterBatches),
      domLayer: run?.domLayer ?? null,
      eligibility: [...(eligibility?.entries ?? [])],
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
    run: run?.persistentPath ?? null,
    finalVerify,
  };
}

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeAttemptSummary(value) {
  if (!value || typeof value !== "object") return null;
  const count = nonNegativeInteger(value.count);
  if (count === 0 && value.p50 === null && value.max === null) return { count: 0, p50: null, max: null };
  const p50 = nonNegativeInteger(value.p50);
  const max = nonNegativeInteger(value.max);
  return count === null || p50 === null || max === null ? null : { count, p50, max };
}

function normalizeBatchSummary(value) {
  if (!value || typeof value !== "object") return null;
  const batches = nonNegativeInteger(value.batches);
  const unitsPerBatchMax = nonNegativeInteger(value.unitsPerBatchMax);
  const bandsMax = nonNegativeInteger(value.bandsMax);
  return batches === null || unitsPerBatchMax === null || bandsMax === null
    ? null
    : { batches, unitsPerBatchMax, bandsMax };
}

function nonNegativeInteger(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}
