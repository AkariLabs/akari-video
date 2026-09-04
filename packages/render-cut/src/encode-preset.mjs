import { spawnSync } from "node:child_process";

import { resolveFfmpeg } from "../../media-bin/src/index.mjs";

// Ported from akari-video-tauri/src-tauri/src/export/ffmpeg.rs (videotoolbox_available /
// append_encode_args) — read-only reference, task 2026-07-25-export-options. This render-cut
// (Node) pipeline does not split intermediate/final into two differently-tuned stages the way the
// compatibility Rust one did; instead the same resolved preset is applied to every video-encoding ffmpeg
// call a given render performs, so an overlay-composited intermediate is never coarser than the
// final output ("中間生成物は最終より劣化させない").
export const QUALITY_LEVELS = ["master", "high", "standard", "light"];
export const ENCODER_CHOICES = ["auto", "videotoolbox", "nvenc", "qsv", "amf", "mf", "x264"];

export const QUALITY_PRESETS = {
  master: {
    crf: 15,
    preset: "slow",
    videotoolboxBitrate: null,
    nvencPreset: null,
    qsvPreset: null,
    amfQuality: null,
    mfQuality: null,
  },
  high: {
    crf: 18,
    preset: "slow",
    videotoolboxBitrate: "12M",
    nvencPreset: "p6",
    qsvPreset: "slow",
    amfQuality: "quality",
    // h264_mf uses CODECAPI_AVEncCommonQuality (0..100, larger is better), not a CRF scale.
    mfQuality: 85,
  },
  standard: {
    crf: 23,
    preset: "medium",
    videotoolboxBitrate: "8M",
    nvencPreset: "p5",
    qsvPreset: "medium",
    amfQuality: "balanced",
    mfQuality: 70,
  },
  light: {
    crf: 26,
    preset: "fast",
    videotoolboxBitrate: "5M",
    nvencPreset: "p4",
    qsvPreset: "fast",
    amfQuality: "speed",
    mfQuality: 55,
  },
};

const PRORES_QSCALE = Object.freeze({ master: 5, high: 9, standard: 11, light: 13 });

const COLOR_ARGS = [
  "-colorspace",
  "bt709",
  "-color_primaries",
  "bt709",
  "-color_trc",
  "bt709",
  "-color_range",
  "tv",
];

// ffmpeg 7 以降は primaries / transfer をフレーム側のプロパティから取り、rawvideo / lavfi の
// unspecified 値で CLI 指定を上書きする。エンコーダ非依存で成果物へ bt709 を記録するため、
// metadata bitstream filter で符号化後の VUI を明示的に補正する。
const H264_COLOR_TAG_BSF = ["-bsf:v", "h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1"];
const HEVC_COLOR_TAG_BSF = ["-bsf:v", "hevc_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1"];

const CONTAINERS = Object.freeze({
  h264: Object.freeze({ ext: "mp4", kind: "file" }),
  hevc: Object.freeze({ ext: "mp4", kind: "file" }),
  prores422: Object.freeze({ ext: "mov", kind: "file" }),
  png: Object.freeze({ ext: null, kind: "directory" }),
});

export function containerForCodec(codec = "h264") {
  const resolved = normalizeVideoCodec(codec);
  return { ...CONTAINERS[resolved] };
}

export function audioArgsForCodec(codec = "h264") {
  const resolved = normalizeVideoCodec(codec);
  return resolved === "prores422" || resolved === "png"
    ? ["-c:a", "pcm_s16le", "-ar", "48000"]
    : ["-c:a", "aac", "-ar", "48000"];
}

/** Resolve CLI/edit/compatibility precedence once. Null means the byte-identical compatibility path. */
export function resolveEncodingPolicy({
  cli = {},
  edit = {},
  capabilities = {},
  env = process.env,
  spawnSyncImpl = spawnSync,
  platform = process.platform,
} = {}) {
  const editEncoding = edit?.output?.encoding ?? {};
  const codec = normalizeVideoCodec(cli.codec ?? "h264");
  const hasOptIn = cli.quality !== undefined || cli.encoder !== undefined
    || cli.codec !== undefined || editEncoding.quality !== undefined || editEncoding.encoder !== undefined;
  if (!hasOptIn) return null;
  const qualityRequested = fieldRequest(cli.quality, editEncoding.quality, "standard");
  const encoderRequested = fieldRequest(cli.encoder, editEncoding.encoder, "x264");
  if (!QUALITY_LEVELS.includes(qualityRequested.value)) throw new RangeError(`Unknown quality value: ${qualityRequested.value}`);
  if (!ENCODER_CHOICES.includes(encoderRequested.value)) throw new RangeError(`Unknown encoder value: ${encoderRequested.value}`);
  if (codec !== "prores422" && codec !== "png"
      && qualityRequested.value === "master" && encoderRequested.origin !== "compatibility-default"
      && encoderRequested.value !== "x264") {
    throw new RangeError("master quality requires x264; explicit auto/hardware encoders are not allowed");
  }
  const effectiveEncoder = qualityRequested.value === "master"
    ? { value: "x264", origin: encoderRequested.origin === "compatibility-default" ? "master-required" : encoderRequested.origin }
    : {
        value: resolveEncoderChoice({
          requested: encoderRequested.value,
          ffmpegCommand: capabilities.ffmpegCommand,
          env,
          spawnSyncImpl,
          platform,
          codec,
        }).engine,
        origin: encoderRequested.value === "auto" ? "capability-resolution" : encoderRequested.origin,
      };
  const effectiveQuality = { ...qualityRequested };
  const encoderChoice = { engine: effectiveEncoder.value };
  return {
    codec,
    requested: { quality: qualityRequested, encoder: encoderRequested },
    effective: { quality: effectiveQuality, encoder: effectiveEncoder },
    video_encode_args: buildVideoEncodeArgs({
      quality: effectiveQuality.value,
      encoderChoice,
      profile: codec === "hevc" ? "main" : codec === "prores422" ? "3" : "high",
      codec,
    }),
    non_encoding_stages: [
      {
        stage: "overlay_alpha_intermediate",
        reason: `qtrle/ProRes 4444 carries transparency into composite and is not a ${codec === "hevc" ? "HEVC" : "H.264"} delivery-video reencode`,
      },
      {
        stage: "audio_mix",
        reason: "audio-only mix/mux preserves the already encoded video with -c:v copy",
      },
    ],
  };
}

function fieldRequest(cliValue, editValue, compatibilityValue) {
  if (cliValue !== undefined) return { value: cliValue, origin: "cli" };
  if (editValue !== undefined) return { value: editValue, origin: "edit" };
  return { value: compatibilityValue, origin: "compatibility-default" };
}

const HARDWARE_ENCODERS = {
  h264: {
    videotoolbox: "h264_videotoolbox",
    nvenc: "h264_nvenc",
    qsv: "h264_qsv",
    amf: "h264_amf",
    mf: "h264_mf",
  },
  hevc: {
    videotoolbox: "hevc_videotoolbox",
    nvenc: "hevc_nvenc",
    qsv: "hevc_qsv",
    amf: "hevc_amf",
    mf: "hevc_mf",
  },
  prores: {
    videotoolbox: "prores_videotoolbox",
  },
};

// Process-wide cache keyed by ffmpeg binary and encoder name. A nested map avoids ambiguous
// string concatenation while preserving the compatibility once-per-binary VideoToolbox behavior.
const encoderProbeCache = new Map();

export function resetVideotoolboxCacheForTests() {
  for (const [ffmpegCommand, encoderResults] of encoderProbeCache) {
    encoderResults.delete("h264:videotoolbox");
    encoderResults.delete("hevc:videotoolbox");
    encoderResults.delete("prores422:videotoolbox");
    if (encoderResults.size === 0) encoderProbeCache.delete(ffmpegCommand);
  }
}

export function resetEncoderProbeCacheForTests() {
  encoderProbeCache.clear();
}

/**
 * `h264_videotoolbox` の可否判定。`AKARI_EXPORT_FORCE_X264=1` は無条件で false。
 * それ以外は `-encoders` 一覧に存在するか確認したうえで、実際に 1 フレームだけ
 * エンコードしてみるスモークテストが通るかまで確かめる（一覧にあっても実行時に
 * 失敗する環境があり得るため — compatibility videotoolbox_available の移植）。
 */
export function isVideotoolboxAvailable({
  ffmpegCommand,
  env = process.env,
  spawnSyncImpl = spawnSync,
  codec = "h264",
} = {}) {
  if (env.AKARI_EXPORT_FORCE_X264 === "1") return false;
  // Resolved lazily (only once the FORCE_X264 short-circuit above is ruled out) so a forced x264
  // choice never touches media-bin's resolveFfmpeg(), matching the pre-existing
  // "must not probe" contract this function has always had.
  const resolvedFfmpegCommand = ffmpegCommand ?? resolveFfmpeg();
  const resolvedCodec = normalizeVideoCodec(codec);
  const cacheKey = `${resolvedCodec}:videotoolbox`;
  const cached = cachedEncoderProbe(resolvedFfmpegCommand, cacheKey);
  if (cached !== undefined) return cached;
  const encoder = HARDWARE_ENCODERS[hardwareCodecKey(resolvedCodec)].videotoolbox;
  const available = hasEncoder(resolvedFfmpegCommand, encoder, spawnSyncImpl)
    && videotoolboxSmokeTest(resolvedFfmpegCommand, encoder, spawnSyncImpl);
  cacheEncoderProbe(resolvedFfmpegCommand, cacheKey, available);
  return available;
}

export function isHardwareEncoderAvailable({
  encoder,
  ffmpegCommand,
  env = process.env,
  spawnSyncImpl = spawnSync,
  platform = process.platform,
  codec = "h264",
} = {}) {
  if (env.AKARI_EXPORT_FORCE_X264 === "1") return false;
  const resolvedCodec = normalizeVideoCodec(codec);
  const encoders = HARDWARE_ENCODERS[hardwareCodecKey(resolvedCodec)] ?? {};
  if (!Object.hasOwn(encoders, encoder)) throw new RangeError(`Unknown hardware encoder: ${encoder}`);
  if (encoder === "videotoolbox") {
    return isVideotoolboxAvailable({ ffmpegCommand, env, spawnSyncImpl, platform, codec: resolvedCodec });
  }
  const resolvedFfmpegCommand = ffmpegCommand ?? resolveFfmpeg();
  const cacheKey = `${resolvedCodec}:${encoder}`;
  const cached = cachedEncoderProbe(resolvedFfmpegCommand, cacheKey);
  if (cached !== undefined) return cached;
  const ffmpegEncoder = encoders[encoder];
  const available = hasEncoder(resolvedFfmpegCommand, ffmpegEncoder, spawnSyncImpl)
    && hardwareEncoderSmokeTest(resolvedFfmpegCommand, encoder, ffmpegEncoder, spawnSyncImpl);
  cacheEncoderProbe(resolvedFfmpegCommand, cacheKey, available);
  return available;
}

function cachedEncoderProbe(ffmpegCommand, encoder) {
  return encoderProbeCache.get(ffmpegCommand)?.get(encoder);
}

function cacheEncoderProbe(ffmpegCommand, encoder, available) {
  let encoderResults = encoderProbeCache.get(ffmpegCommand);
  if (!encoderResults) {
    encoderResults = new Map();
    encoderProbeCache.set(ffmpegCommand, encoderResults);
  }
  encoderResults.set(encoder, available);
}

function hasEncoder(ffmpegCommand, encoder, spawnSyncImpl) {
  const result = spawnSyncImpl(ffmpegCommand, ["-hide_banner", "-encoders"], { encoding: "utf8" });
  if (result.error || result.status !== 0) return false;
  return result.stdout
    .split(/\r?\n/u)
    .some((line) => line.trim().split(/\s+/u)[1] === encoder);
}

// Encodes a single lavfi-generated 64x64 frame straight to /dev/null: no intermediate file, done
// in tens of milliseconds (compatibility videotoolbox_smoke_test).
function videotoolboxSmokeTest(ffmpegCommand, encoder, spawnSyncImpl) {
  const result = spawnSyncImpl(
    ffmpegCommand,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=64x64:r=24",
      "-frames:v",
      "1",
      "-c:v",
      encoder,
      "-allow_sw",
      "1",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  return !result.error && result.status === 0;
}

function hardwareEncoderSmokeTest(ffmpegCommand, encoder, ffmpegEncoder, spawnSyncImpl) {
  const result = spawnSyncImpl(
    ffmpegCommand,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=256x144:r=24",
      "-frames:v",
      "1",
      "-c:v",
      ffmpegEncoder,
      ...(encoder === "mf" ? ["-hw_encoding", "1"] : []),
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  return !result.error && result.status === 0;
}

/**
 * `requested` が未指定（undefined/null）なら null を返す — 呼び出し側はこれを
 * 「エンコーダ引数に一切触れない（既存の libx264 決め打ち引数列を保つ）」の合図として扱う。
 * これにより --encoder を渡さない既存呼び出しは videotoolbox 判定すら一切実行しない
 * （後方互換の絶対条件: 無引数のとき ffmpeg コマンド列は変更前と deepEqual）。
 */
export function resolveEncoderChoice({
  requested,
  ffmpegCommand,
  env = process.env,
  spawnSyncImpl = spawnSync,
  platform = process.platform,
  codec = "h264",
} = {}) {
  const resolvedCodec = normalizeVideoCodec(codec);
  if (requested === undefined || requested === null) return null;
  if (resolvedCodec === "png") return { engine: "x264" };
  if (requested === "x264") return { engine: "x264" };
  if (requested === "videotoolbox") return { engine: "videotoolbox" };
  if (["nvenc", "qsv", "amf", "mf"].includes(requested)) {
    const available = isHardwareEncoderAvailable({ encoder: requested, ffmpegCommand, env, spawnSyncImpl, platform });
    if (!available) {
      throw new Error(`Hardware encoder ${requested} is unavailable; use --encoder auto or --encoder x264`);
    }
    return { engine: requested };
  }
  if (requested === "auto") {
    if (platform === "darwin") {
      // Resolved lazily (only on a platform with an auto-probe) so explicit x264/videotoolbox and
      // Linux auto never touch media-bin's resolveFfmpeg().
      const resolvedFfmpegCommand = ffmpegCommand ?? resolveFfmpeg();
      const useVideotoolbox = isVideotoolboxAvailable({
        ffmpegCommand: resolvedFfmpegCommand,
        env,
        spawnSyncImpl,
        codec: resolvedCodec,
      });
      return { engine: useVideotoolbox ? "videotoolbox" : "x264" };
    }
    if (platform === "win32") {
      const resolvedFfmpegCommand = ffmpegCommand ?? resolveFfmpeg();
      for (const encoder of ["nvenc", "qsv", "amf", "mf"]) {
        if (isHardwareEncoderAvailable({
          encoder,
          ffmpegCommand: resolvedFfmpegCommand,
          env,
          spawnSyncImpl,
          platform,
          codec: resolvedCodec,
        })) return { engine: encoder };
      }
    }
    return { engine: "x264" };
  }
  throw new RangeError(`Unknown --encoder value: ${requested}`);
}

/**
 * `-c:v ...` 系の引数列を組み立てる。`quality`/`encoderChoice` が両方未指定なら null を返す
 * — 呼び出し側はこれを「既存の `-c:v libx264 -profile:v <profile>` 決め打ち引数を保つ」の
 * 合図として扱う（無引数時の後方互換）。どちらか一方でも明示指定されたら、既定 quality は
 * standard（crf 23 / preset medium。これは libx264 自体の既定と同値）、既定 encoder は x264
 * として解決する。
 */
export function buildVideoEncodeArgs({ quality, encoderChoice, profile = "high", codec = "h264" } = {}) {
  if (!quality && !encoderChoice) return null;
  const resolvedPreset = QUALITY_PRESETS[quality ?? "standard"];
  if (!resolvedPreset) throw new RangeError(`Unknown --quality value: ${quality}`);
  const engine = encoderChoice?.engine ?? "x264";
  const resolvedCodec = normalizeVideoCodec(codec);
  if (resolvedCodec === "png") return ["-c:v", "png"];
  if (resolvedCodec === "prores422") {
    if (engine === "videotoolbox") {
      return [
        "-c:v", "prores_videotoolbox",
        "-profile:v", "hq",
        "-allow_sw", "1",
        "-pix_fmt", "yuv422p10le",
      ];
    }
    if (engine !== "x264") throw new RangeError(`Unknown ProRes encoder engine: ${engine}`);
    return [
      "-c:v", "prores_ks",
      "-profile:v", "3",
      "-pix_fmt", "yuv422p10le",
      "-vendor", "apl0",
      "-qscale:v", String(PRORES_QSCALE[quality ?? "standard"]),
    ];
  }
  if (resolvedCodec === "hevc") {
    return buildHevcVideoEncodeArgs({ quality, engine, profile: profile ?? "main", preset: resolvedPreset });
  }
  if (engine === "videotoolbox") {
    if (quality === "master") throw new RangeError("master quality does not support videotoolbox");
    return [
      "-c:v",
      "h264_videotoolbox",
      "-allow_sw",
      "1",
      "-b:v",
      resolvedPreset.videotoolboxBitrate,
      ...(profile ? ["-profile:v", profile] : []),
      ...COLOR_ARGS,
      ...H264_COLOR_TAG_BSF,
    ];
  }
  if (["nvenc", "qsv", "amf", "mf"].includes(engine)) {
    if (quality === "master") throw new RangeError(`master quality does not support ${engine}; it requires x264`);
    if (engine === "nvenc") {
      return [
        "-c:v", "h264_nvenc",
        "-rc", "vbr",
        "-cq", String(resolvedPreset.crf),
        "-b:v", "0",
        "-preset", resolvedPreset.nvencPreset,
        ...(profile ? ["-profile:v", profile] : []),
        ...COLOR_ARGS,
        ...H264_COLOR_TAG_BSF,
      ];
    }
    if (engine === "qsv") {
      return [
        "-c:v", "h264_qsv",
        "-global_quality", String(resolvedPreset.crf),
        "-preset", resolvedPreset.qsvPreset,
        ...(profile ? ["-profile:v", profile] : []),
        ...COLOR_ARGS,
        ...H264_COLOR_TAG_BSF,
      ];
    }
    if (engine === "amf") {
      return [
        "-c:v", "h264_amf",
        "-rc", "cqp",
        "-qp_i", String(resolvedPreset.crf),
        "-qp_p", String(resolvedPreset.crf),
        "-quality", resolvedPreset.amfQuality,
        ...(profile ? ["-profile:v", profile] : []),
        ...COLOR_ARGS,
        ...H264_COLOR_TAG_BSF,
      ];
    }
    return [
      "-c:v", "h264_mf",
      "-rate_control", "quality",
      "-quality", String(resolvedPreset.mfQuality),
      "-hw_encoding", "1",
      ...(profile ? ["-profile:v", profile] : []),
      ...COLOR_ARGS,
      ...H264_COLOR_TAG_BSF,
    ];
  }
  if (engine !== "x264") throw new RangeError(`Unknown encoder engine: ${engine}`);
  return [
    "-c:v",
    "libx264",
    ...(profile ? ["-profile:v", profile] : []),
    "-preset",
    resolvedPreset.preset,
    "-crf",
    String(resolvedPreset.crf),
    ...COLOR_ARGS,
    ...H264_COLOR_TAG_BSF,
  ];
}

function buildHevcVideoEncodeArgs({ quality, engine, profile, preset }) {
  const tag = ["-tag:v", "hvc1"];
  if (engine === "videotoolbox") {
    if (quality === "master") throw new RangeError("master quality does not support videotoolbox");
    return [
      "-c:v", "hevc_videotoolbox", "-allow_sw", "1",
      "-b:v", scaledBitrateLabel(preset.videotoolboxBitrate, 0.6),
      ...(profile ? ["-profile:v", profile] : []),
      ...COLOR_ARGS, ...HEVC_COLOR_TAG_BSF, ...tag,
    ];
  }
  if (["nvenc", "qsv", "amf", "mf"].includes(engine)) {
    if (quality === "master") throw new RangeError(`master quality does not support ${engine}; it requires x264`);
    if (engine === "nvenc") {
      return ["-c:v", "hevc_nvenc", "-rc", "vbr", "-cq", String(preset.crf), "-b:v", "0", "-preset", preset.nvencPreset,
        ...(profile ? ["-profile:v", profile] : []), ...COLOR_ARGS, ...HEVC_COLOR_TAG_BSF, ...tag];
    }
    if (engine === "qsv") {
      return ["-c:v", "hevc_qsv", "-global_quality", String(preset.crf), "-preset", preset.qsvPreset,
        ...(profile ? ["-profile:v", profile] : []), ...COLOR_ARGS, ...HEVC_COLOR_TAG_BSF, ...tag];
    }
    if (engine === "amf") {
      return ["-c:v", "hevc_amf", "-rc", "cqp", "-qp_i", String(preset.crf), "-qp_p", String(preset.crf),
        "-quality", preset.amfQuality, ...(profile ? ["-profile:v", profile] : []), ...COLOR_ARGS, ...HEVC_COLOR_TAG_BSF, ...tag];
    }
    return ["-c:v", "hevc_mf", "-rate_control", "quality", "-quality", String(preset.mfQuality), "-hw_encoding", "1",
      ...(profile ? ["-profile:v", profile] : []), ...COLOR_ARGS, ...HEVC_COLOR_TAG_BSF, ...tag];
  }
  if (engine !== "x264") throw new RangeError(`Unknown encoder engine: ${engine}`);
  return [
    "-c:v", "libx265",
    ...(profile ? ["-profile:v", profile] : []),
    "-preset", preset.preset,
    "-crf", String(preset.crf),
    "-x265-params", "log-level=error",
    ...COLOR_ARGS,
    ...HEVC_COLOR_TAG_BSF,
    ...tag,
  ];
}

function scaledBitrateLabel(value, factor) {
  const match = /^(\d+(?:\.\d+)?)([kKmM]?)$/u.exec(String(value ?? "").trim());
  if (!match) throw new Error(`invalid VideoToolbox bitrate preset: ${value}`);
  return `${Number((Number(match[1]) * factor).toFixed(3))}${match[2]}`;
}

function normalizeVideoCodec(value) {
  if (["h264", "hevc", "prores422", "png"].includes(value)) return value;
  throw new RangeError(`Unknown codec value: ${value}`);
}

function hardwareCodecKey(codec) {
  return codec === "prores422" ? "prores" : codec;
}
