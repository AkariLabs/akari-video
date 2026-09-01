export const DEFAULT_LEVEL_TARGETS = Object.freeze({
  narration: -16,
  sfx: -18,
  jingle: -18,
  music: -20,
  ambience: -26,
  bgm: -26,
});

export const DEFAULT_TRUE_PEAK_CEILING_DBTP = -1.0;
export const DEFAULT_FADES = Object.freeze({
  narration: Object.freeze([0, 0]),
  sfx: Object.freeze([0, 0]),
  jingle: Object.freeze([0, 0.3]),
  music: Object.freeze([0.2, 1.0]),
  ambience: Object.freeze([0.5, 0.5]),
  bgm: Object.freeze([0, 0]),
});
export const SHORT_CLIP_SEC = 1.0;
export const SHORT_PEAK_TARGET_DBFS = -3.0;

const ROLES = new Set(Object.keys(DEFAULT_LEVEL_TARGETS));

function normalizeRole(role) {
  return typeof role === "string" && ROLES.has(role.toLowerCase()) ? role.toLowerCase() : "sfx";
}

function rounded(value) {
  const result = Math.round(value * 10) / 10;
  return Object.is(result, -0) ? 0 : result;
}

function noMeasurement(role, fades) {
  const [fadeIn, fadeOut] = fades[role] ?? fades.sfx ?? [0, 0];
  return {
    gain_db: 0,
    fade_in: fadeIn,
    fade_out: fadeOut,
    basis: "none",
    detail: { target: null, measured_value: null, peak_guard_applied: false, clamped: false },
  };
}

export function computeInsertLevel({
  role,
  measured,
  targets = DEFAULT_LEVEL_TARGETS,
  ceilingDbtp = DEFAULT_TRUE_PEAK_CEILING_DBTP,
  fades = DEFAULT_FADES,
}) {
  const normalizedRole = normalizeRole(role);
  if (!measured || typeof measured !== "object") return noMeasurement(normalizedRole, fades);
  const short = Number.isFinite(measured.duration_sec) && measured.duration_sec < SHORT_CLIP_SEC;
  const usePeak = short || !Number.isFinite(measured.integrated_lufs);
  let basis;
  let target;
  let measuredValue;
  let gain;
  if (usePeak) {
    if (!Number.isFinite(measured.sample_peak_dbfs)) return noMeasurement(normalizedRole, fades);
    basis = "peak";
    target = SHORT_PEAK_TARGET_DBFS;
    measuredValue = measured.sample_peak_dbfs;
    gain = target - measuredValue;
  } else {
    basis = "lufs";
    target = Number.isFinite(targets[normalizedRole]) ? targets[normalizedRole] : DEFAULT_LEVEL_TARGETS[normalizedRole];
    measuredValue = measured.integrated_lufs;
    gain = target - measuredValue;
  }
  let peakGuardApplied = false;
  if (Number.isFinite(measured.true_peak_dbtp) && Number.isFinite(ceilingDbtp)) {
    const guarded = ceilingDbtp - measured.true_peak_dbtp;
    if (guarded < gain) {
      gain = guarded;
      peakGuardApplied = true;
    }
  }
  const unclamped = gain;
  gain = Math.min(12, Math.max(-60, gain));
  const [fadeIn, fadeOut] = fades[normalizedRole] ?? fades.sfx ?? [0, 0];
  return {
    gain_db: rounded(gain),
    fade_in: fadeIn,
    fade_out: fadeOut,
    basis,
    detail: {
      target,
      measured_value: measuredValue,
      peak_guard_applied: peakGuardApplied,
      clamped: gain !== unclamped,
    },
  };
}

export function roleForClip({ role, collection, path, durationSec }) {
  const normalizedRole = typeof role === "string" ? role.toLowerCase() : undefined;
  if (["narration", "bgm", "jingle", "music", "ambience"].includes(normalizedRole)) return normalizedRole;
  if (collection === "bgm" || collection === "narration") return collection;
  const name = String(path ?? "").toLowerCase();
  if (name.includes("jingle") || name.includes("sting")) return "jingle";
  if (name.includes("ambien") || name.includes("room") || name.includes("env")) return "ambience";
  if (Number.isFinite(durationSec) && durationSec >= 20) return "music";
  return "sfx";
}
