import { ENCODER_CHOICES, QUALITY_LEVELS } from "./encode-preset.mjs";
import { RefusalError } from "./errors.mjs";

export const RETIRED_ENGINE = "legacy";
const ENGINE_CHOICES = ["auto", "gpu", "osr"];
const RETIRED_ENGINE_MESSAGE = "--engine legacy は廃止されました（書き出しは gpu / osr の 2 出口。ffmpeg フィルタグラフ合成は v0.1.3x で終了）";
const OSR_ELECTRON_REFUSAL = "OSR 書き出しに必要な Electron が見つかりません。インストール済み AKARI Video の同梱 Electron を使うか、`npm install electron` を実行するか、`AKARI_OSR_ELECTRON=<path>` を指定してください。";
const GPU_PREFERENCE_CHOICES = ["auto", "off", "force"];
const CODEC_CHOICES = ["h264", "hevc", "prores422", "png"];

export function parseArguments(argv, env = process.env) {
  const options = {
    projectRoot: null,
    planOnly: false,
    out: null,
    force: false,
    help: false,
    // Left undefined (not null) unless the corresponding flag is actually present in argv: buildPlan
    // treats "flag absent" and "flag present with its default value" differently (see
    // src/encode-preset.mjs) so that omitting every new flag reproduces today's exact ffmpeg
    // command lines (task 2026-07-25-export-options's backward-compat requirement).
    quality: undefined,
    encoder: undefined,
    engine: "auto",
    codec: "h264",
    // undefined のまま exportWithGpu / exportWithOsr → launchElectronExport へ渡すと env AKARI_EXPORT_GPU_PREFERENCE → saved consent → off に落ちる。
    gpuPreference: undefined,
    decoderStallMs: undefined,
    decoderRetries: undefined,
    fps: undefined,
    scaleTo: undefined,
    progress: false,
    preview: undefined,
    verifyBlank: true,
    noAudio: false,
    settle: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--plan-only") options.planOnly = true;
    else if (argument === "--force") options.force = true;
    else if (argument === "--progress") options.progress = true;
    else if (argument === "--no-settle") options.settle = false;
    else if (argument === "--no-verify-blank") options.verifyBlank = false;
    else if (argument === "--no-audio") options.noAudio = true;
    else if (argument === "--preview") {
      if (index + 1 >= argv.length) throw new Error("--preview requires a value");
      options.preview = parsePreviewValue(argv[++index]);
    } else if (argument.startsWith("--preview=")) options.preview = parsePreviewValue(argument.slice(10));
    else if (argument === "--codec") {
      if (index + 1 >= argv.length) throw new Error("--codec requires a value");
      options.codec = parseCodecValue(argv[++index]);
    } else if (argument.startsWith("--codec=")) options.codec = parseCodecValue(argument.slice(8));
    else if (argument === "--engine") {
      if (index + 1 >= argv.length) throw new Error("--engine requires a value");
      options.engine = parseEngineValue(argv[++index]);
    } else if (argument.startsWith("--engine=")) options.engine = parseEngineValue(argument.slice(9));
    else if (argument === "--gpu-preference") {
      if (index + 1 >= argv.length) throw new Error("--gpu-preference requires a value");
      options.gpuPreference = parseGpuPreferenceValue(argv[++index]);
    } else if (argument.startsWith("--gpu-preference=")) options.gpuPreference = parseGpuPreferenceValue(argument.slice(17));
    else if (argument === "--decoder-stall-ms") {
      if (index + 1 >= argv.length) throw new Error("--decoder-stall-ms requires a value");
      options.decoderStallMs = parseDecoderInteger(argv[++index], "--decoder-stall-ms", false);
    } else if (argument.startsWith("--decoder-stall-ms=")) options.decoderStallMs = parseDecoderInteger(argument.slice(19), "--decoder-stall-ms", false);
    else if (argument === "--decoder-retries") {
      if (index + 1 >= argv.length) throw new Error("--decoder-retries requires a value");
      options.decoderRetries = parseDecoderInteger(argv[++index], "--decoder-retries", true);
    } else if (argument.startsWith("--decoder-retries=")) options.decoderRetries = parseDecoderInteger(argument.slice(18), "--decoder-retries", true);
    else if (argument === "--out") {
      if (index + 1 >= argv.length) throw new Error("--out requires a path");
      options.out = argv[++index];
    } else if (argument.startsWith("--out=")) options.out = argument.slice(6);
    else if (argument === "--quality") {
      if (index + 1 >= argv.length) throw new Error("--quality requires a value");
      options.quality = parseQualityValue(argv[++index]);
    } else if (argument.startsWith("--quality=")) options.quality = parseQualityValue(argument.slice(10));
    else if (argument === "--encoder") {
      if (index + 1 >= argv.length) throw new Error("--encoder requires a value");
      options.encoder = parseEncoderValue(argv[++index]);
    } else if (argument.startsWith("--encoder=")) options.encoder = parseEncoderValue(argument.slice(10));
    else if (argument === "--fps") {
      if (index + 1 >= argv.length) throw new Error("--fps requires a number");
      options.fps = parseFpsValue(argv[++index]);
    } else if (argument.startsWith("--fps=")) options.fps = parseFpsValue(argument.slice(6));
    else if (argument === "--scale-to") {
      if (index + 1 >= argv.length) throw new Error("--scale-to requires a value");
      options.scaleTo = parseScaleToValue(argv[++index]);
    } else if (argument.startsWith("--scale-to=")) options.scaleTo = parseScaleToValue(argument.slice(11));
    else if (argument.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    else if (options.projectRoot === null) options.projectRoot = argument;
    else throw new Error("Only one project root may be provided");
  }
  if (!options.help && options.projectRoot === null) throw new Error("A project root is required");
  return options;
}

function parseDecoderInteger(value, flag, allowZero) {
  const number = Number(value);
  if (value === "" || !Number.isSafeInteger(number) || (allowZero ? number < 0 : number <= 0)) {
    throw new Error(`${flag} requires ${allowZero ? "a non-negative" : "a positive"} integer`);
  }
  return number;
}

export function resolveEngineChoice(requested, platform, eligibility = null) {
  if (requested === RETIRED_ENGINE) throw new RefusalError(RETIRED_ENGINE_MESSAGE, 2);
  if (requested !== "auto") return requested;
  return eligibility?.eligible === true ? "gpu" : "osr";
}

export function assertCodecEngine(codec, requested) {
  if ((codec === "prores422" || codec === "png") && requested === "gpu") {
    throw new RefusalError("この形式は GPU 直結では出せません");
  }
}

export function buildEngineProvenance(requested, platform, launcher = undefined, eligibility = null, codec = "h264") {
  return {
    engine_requested: requested,
    engine: codec === "prores422" || codec === "png"
      ? "osr"
      : resolveEngineChoice(requested, platform, eligibility),
  };
}

export function readForceGpu(env) {
  return env?.AKARI_FORCE_GPU === "1";
}

export function assertGpuEligibility(requested, eligibility, { force = false } = {}) {
  if (requested !== "gpu" || eligibility?.eligible === true) return;
  if (force && eligibility?.summary?.unsupported === 0) return;
  const suffix = force ? "（AKARI_FORCE_GPU は degraded のみ対象）" : "";
  throw new RefusalError(`GPU export is ineligible: ${formatGpuEligibilityFailures(eligibility)}${suffix}`);
}

export function assertOsrLauncherAvailable(launcher) {
  if (launcher?.tier !== 3) return;
  throw new RefusalError(`${OSR_ELECTRON_REFUSAL} (${launcher.reason ?? "Electron unavailable"})`, 2);
}

export function formatGpuEligibilityFailures(eligibility) {
  if (!eligibility?.entries) return "eligibility result is missing";
  return eligibility.entries.filter((entry) => entry.forced === true || ["degraded", "unsupported"].includes(entry.classification))
    .map((entry) => `${entry.kind}:${entry.id}:${entry.reason}`).join("; ") || "unknown reason";
}

function parseEngineValue(value) {
  if (value === RETIRED_ENGINE) throw new RefusalError(RETIRED_ENGINE_MESSAGE, 2);
  if (!ENGINE_CHOICES.includes(value)) {
    throw new Error(`--engine must be one of ${ENGINE_CHOICES.join("|")}, got: ${value}`);
  }
  return value;
}

function parsePreviewValue(value) {
  if (value !== "auto" && value !== "off") throw new Error(`--preview must be auto|off, got: ${value}`);
  return value;
}

function parseCodecValue(value) {
  if (!CODEC_CHOICES.includes(value)) {
    throw new Error(`--codec must be one of ${CODEC_CHOICES.join("|")}, got: ${value}`);
  }
  return value;
}

function parseGpuPreferenceValue(value) {
  if (!GPU_PREFERENCE_CHOICES.includes(value)) {
    throw new Error(`--gpu-preference must be one of ${GPU_PREFERENCE_CHOICES.join("|")}, got: ${value}`);
  }
  return value;
}

function parseQualityValue(value) {
  if (!QUALITY_LEVELS.includes(value)) {
    throw new Error(`--quality must be one of ${QUALITY_LEVELS.join("|")}, got: ${value}`);
  }
  return value;
}

function parseEncoderValue(value) {
  if (!ENCODER_CHOICES.includes(value)) {
    throw new Error(`--encoder must be one of ${ENCODER_CHOICES.join("|")}, got: ${value}`);
  }
  return value;
}

function parseFpsValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--fps must be a positive number, got: ${value}`);
  }
  return parsed;
}

export function parseScaleToValue(value) {
  const match = /^(\d+)x(\d+)$/iu.exec(String(value).trim());
  if (!match) throw new Error(`--scale-to must be <width>x<height>, got: ${value}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`--scale-to dimensions must be positive integers, got: ${value}`);
  }
  if (width % 2 !== 0 || height % 2 !== 0) {
    throw new Error(`--scale-to dimensions must be even, got: ${value}`);
  }
  return { width, height };
}

export function applyOutputScaleToPlan(plan, editOutput, scaleTo) {
  if (!scaleTo) return plan;
  const fromWidth = Number(editOutput?.width);
  const fromHeight = Number(editOutput?.height);
  const toWidth = Number(scaleTo.width);
  const toHeight = Number(scaleTo.height);
  const fromRatio = fromWidth / fromHeight;
  const toRatio = toWidth / toHeight;
  const ratioDifference = Math.abs(toRatio - fromRatio) / fromRatio;
  if (![fromWidth, fromHeight, toWidth, toHeight, fromRatio, toRatio].every(Number.isFinite)
    || [fromWidth, fromHeight, toWidth, toHeight].some(value => value <= 0)) {
    throw new RefusalError("--scale-to requires valid positive source and target dimensions");
  }
  if (ratioDifference > 0.01) {
    throw new RefusalError(
      `--scale-to must preserve edit.output aspect ratio within 1%: ${fromWidth}x${fromHeight} -> ${toWidth}x${toHeight}`,
    );
  }
  const fromPixels = fromWidth * fromHeight;
  const toPixels = toWidth * toHeight;
  plan.preset = { ...plan.preset, width: toWidth, height: toHeight };
  plan.output_scale = {
    from: [fromWidth, fromHeight],
    to: [toWidth, toHeight],
    mode: toPixels > fromPixels ? "up" : toPixels < fromPixels ? "down" : "none",
  };
  return plan;
}

export function assertHevcPresetSupported(preset) {
  if (preset?.video_codec !== "hevc") return;
  const pixels = Number(preset.width) * Number(preset.height);
  const samplesPerSecond = pixels * Number(preset.fps);
  if (Number.isFinite(pixels) && Number.isFinite(samplesPerSecond)
    && pixels > 0 && pixels <= 8_912_896 && samplesPerSecond <= 1_069_547_520) return;
  throw new RefusalError(`HEVC Main profile Level 5.2 を超える出力には対応していません: ${preset.width}x${preset.height}@${preset.fps}fps`);
}
