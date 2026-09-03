import { normalizeGpuPreferenceRecord } from "../../osr-export/src/gpu-preference.mjs";
import { resolveMemoryBudget } from "../../osr-export/src/memory.mjs";
import { normalizeGpuCaptionReceiptEntries } from "../../render-cut/src/render-receipt.mjs";

export function buildGpuReceipt({ tier, launcher = null, run = {}, eligibility = { entries: [] }, finalVerify = null, audio = null, profile = "gpu", gpuPreference = null, codec = run?.codec ?? "h264" } = {}) {
  const fallbackBudget = resolveMemoryBudget({ soft: profile === "soft", env: {} });
  const memory = run?.memory ?? {};
  return {
    provenance: {
      engine: "gpu",
      launcher_tier: tier ?? launcher?.tier ?? null,
      // The mux result rides on the renderer's checkpoint payload as run.mux (page-runtime.js), so
      // the receipt reports the method actually used rather than a literal that silently goes stale
      // the next time this path changes. Runs recorded before the ffmpeg remux carry no mux block.
      mux: run?.mux?.method ?? "mp4box-direct",
      video_reencode: false,
      codec,
      // Windows のアプリ別 GPU 設定の一時上書き（launchElectronExport の gpuPreference 記録・osr 契約 §11.7）。他 OS は理由だけ。
      gpu_preference: normalizeGpuPreferenceRecord(gpuPreference),
    },
    gpu: {
      platform: run?.gpu?.platform ?? process.platform,
      chromium: run?.gpu?.chromium ?? process.versions.chrome ?? null,
      renderer: normalizeRenderer(run?.gpu?.renderer),
      encoder_support: normalizeEncoderSupport(run?.gpu?.encoder_support),
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
      captionMeasureDiffs: normalizeCaptionMeasureDiffSummary(run?.gpu?.captionMeasureDiffs),
      captionRasterTotalMs: finiteNonNegative(run?.gpu?.captionRasterTotalMs),
      captionRasterBatches: normalizeBatchSummary(run?.gpu?.captionRasterBatches),
      captionStartup: normalizeCaptionStartup(run?.gpu?.captionStartup),
      preview: normalizePreview(run?.preview),
      domLayer: run?.domLayer ?? null,
      three: normalizeThreeSummary(run?.three),
      viewport: normalizeViewport(run?.viewport),
      eligibility: [...(eligibility?.entries ?? [])],
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
    output_scale: normalizeOutputScale(run?.output_scale),
    run: run?.persistentPath ?? null,
    finalVerify,
    audio: normalizeGpuAudioRecord(audio),
  };
}

function normalizeOutputScale(value) {
  if (!value || typeof value !== "object" || !["up", "down", "none"].includes(value.mode)) return null;
  const from = Array.isArray(value.from) ? value.from.map(Number) : [];
  const to = Array.isArray(value.to) ? value.to.map(Number) : [];
  return from.length === 2 && to.length === 2 && [...from, ...to].every(entry => Number.isInteger(entry) && entry > 0)
    ? { from, to, mode: value.mode }
    : null;
}

function normalizePreview(value) {
  if (!value || typeof value !== "object") return { mode: "off", frames: 0 };
  const frames = Number.isInteger(value.frames) && value.frames >= 0 ? value.frames : 0;
  const mode = value.mode === "auto" ? "auto" : "off";
  return { mode, frames, ...(typeof value.disabledReason === "string" ? { disabledReason: value.disabledReason } : {}) };
}

function normalizeGpuAudioRecord(value) {
  if (!value || typeof value !== "object") return null;
  if (!["copy", "silent-carrier", "none"].includes(value.mode)) return null;
  if (!(typeof value.source === "string" || value.source === null)) return null;
  if (!(typeof value.source_has_audio === "boolean" || value.source_has_audio === null)) return null;
  return { mode: value.mode, source: value.source, source_has_audio: value.source_has_audio };
}

function normalizeViewport(value) {
  if (!value || typeof value !== "object") return null;
  const requested = normalizeSize(value.requested);
  const measured = normalizeSize(value.measured);
  const display = normalizeSize(value.display);
  return requested === null || measured === null || display === null || typeof value.emulated !== "boolean"
    ? null
    : { requested, measured, emulated: value.emulated, display };
}

function normalizeThreeSummary(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.overlays) || !value.sampling || typeof value.sampling !== "object") {
    return null;
  }
  const overlays = [];
  for (const overlay of value.overlays) {
    const mode = overlay?.entrance?.mode;
    if (typeof overlay?.id !== "string" || overlay.id === "" || !["curve", "sampled"].includes(mode)) return null;
    overlays.push({ id: overlay.id, entrance: { mode } });
  }
  const count = nonNegativeInteger(value.sampling.count);
  if (count === null) return null;
  if (count === 0) {
    if (value.sampling.p50 !== null || value.sampling.p95 !== null) return null;
    return { overlays, sampling: { count, p50: null, p95: null } };
  }
  const p50 = finiteNonNegative(value.sampling.p50);
  const p95 = finiteNonNegative(value.sampling.p95);
  return p50 === null || p95 === null ? null : { overlays, sampling: { count, p50, p95 } };
}

function normalizeSize(value) {
  if (!value || typeof value !== "object") return null;
  const width = Number(value.width);
  const height = Number(value.height);
  return Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0 ? { width, height } : null;
}

function normalizeRenderer(value) {
  if (!value || typeof value !== "object") return null;
  return typeof value.vendor === "string" && typeof value.renderer === "string"
    ? { vendor: value.vendor, renderer: value.renderer }
    : null;
}

function normalizeEncoderSupport(value) {
  if (!value || typeof value !== "object") return null;
  return typeof value["prefer-hardware"] === "boolean" && typeof value["prefer-software"] === "boolean"
    ? { "prefer-hardware": value["prefer-hardware"], "prefer-software": value["prefer-software"] }
    : null;
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

function normalizeCaptionMeasureDiffSummary(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.entries)) return null;
  const totalCount = nonNegativeInteger(value.totalCount);
  const shownCount = nonNegativeInteger(value.shownCount);
  if (totalCount === null || shownCount === null || shownCount !== value.entries.length) return null;
  return {
    totalCount,
    shownCount,
    truncated: Boolean(value.truncated),
    entries: value.entries.map((entry) => ({ ...entry })),
  };
}

function normalizeCaptionStartup(value) {
  if (!value || typeof value !== "object") return null;
  const totalMs = finiteNonNegative(value.totalMs);
  const fontEncodeMs = finiteNonNegative(value.fontEncodeMs);
  const fontBase64Bytes = nonNegativeInteger(value.fontBase64Bytes);
  const measure = normalizeCaptionStartupMeasure(value.measure);
  const raster = normalizeCaptionStartupRaster(value.raster);
  return totalMs === null || fontEncodeMs === null || fontBase64Bytes === null || measure === null || raster === null
    ? null
    : { totalMs, fontEncodeMs, fontBase64Bytes, measure, raster };
}

function normalizeCaptionStartupMeasure(value) {
  if (!value || typeof value !== "object") return null;
  const stableCalls = nonNegativeInteger(value.stableCalls);
  const reusedStableCalls = nonNegativeInteger(value.reusedStableCalls);
  const passes = nonNegativeInteger(value.passes);
  const variantMeasurements = nonNegativeInteger(value.variantMeasurements);
  const totalMs = finiteNonNegative(value.totalMs);
  const empty = passes === 0 && value.p50 === null && value.p95 === null && value.max === null;
  const p50 = empty ? null : finiteNonNegative(value.p50);
  const p95 = empty ? null : finiteNonNegative(value.p95);
  const max = empty ? null : finiteNonNegative(value.max);
  const fontWaitMs = finiteNonNegative(value.fontWaitMs);
  const layoutMs = finiteNonNegative(value.layoutMs);
  const rootMs = finiteNonNegative(value.rootMs);
  const distinctKeys = nonNegativeInteger(value.distinctKeys);
  const duplicatePasses = nonNegativeInteger(value.duplicatePasses);
  const degradedUnits = nonNegativeInteger(value.degradedUnits);
  const faultInjected = typeof value.faultInjected === "boolean" ? value.faultInjected : null;
  return [stableCalls, reusedStableCalls, passes, variantMeasurements, totalMs, fontWaitMs, layoutMs, rootMs,
    distinctKeys, duplicatePasses, degradedUnits, faultInjected]
    .some((entry) => entry === null)
      || (!empty && [p50, p95, max].some((entry) => entry === null))
    ? null
    : {
        stableCalls, reusedStableCalls, passes, variantMeasurements, totalMs, p50, p95, max,
        fontWaitMs, layoutMs, rootMs, distinctKeys, duplicatePasses, degradedUnits, faultInjected,
      };
}

function normalizeCaptionStartupRaster(value) {
  if (!value || typeof value !== "object") return null;
  const batches = nonNegativeInteger(value.batches);
  const bands = nonNegativeInteger(value.bands);
  const units = nonNegativeInteger(value.units);
  const svgBuildMs = finiteNonNegative(value.svgBuildMs);
  const svgChars = nonNegativeInteger(value.svgChars);
  const assertMs = finiteNonNegative(value.assertMs);
  const srcAssignMs = finiteNonNegative(value.srcAssignMs);
  const decodeMs = finiteNonNegative(value.decodeMs);
  const sheetDrawMs = finiteNonNegative(value.sheetDrawMs);
  const drawImageMs = finiteNonNegative(value.drawImageMs);
  const registerMs = finiteNonNegative(value.registerMs);
  const totalMs = finiteNonNegative(value.totalMs);
  const prefetchedBatches = nonNegativeInteger(value.prefetchedBatches);
  const prefetchMs = finiteNonNegative(value.prefetchMs);
  return [batches, bands, units, svgBuildMs, svgChars, assertMs, srcAssignMs, decodeMs, sheetDrawMs,
    drawImageMs, registerMs, totalMs, prefetchedBatches, prefetchMs]
    .some((entry) => entry === null)
    ? null
    : {
        batches, bands, units, svgBuildMs, svgChars, assertMs, srcAssignMs, decodeMs, sheetDrawMs,
        drawImageMs, registerMs, totalMs, prefetchedBatches, prefetchMs,
      };
}

function nonNegativeInteger(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}
