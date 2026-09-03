#!/usr/bin/env node

// person-matte.mjs — 人物マット（VP9 alpha WebM）を 1 本作るラッパー
//
// 3 プロセスを繋いだだけの薄い層である。
//   ffmpeg（デコード: 回転補正・幅統一・fps 統一） → person-matte-helper（Vision で人物を抜く）
//   → ffmpeg（エンコード: VP9 alpha WebM）
// 中間ファイル（PNG 連番など）を作らず、raw BGRA のまま繋ぐ。
//
// 契約: docs/contract-2026-07-23-analysis-person-matte.md
// 手順: ../../person-matte.md（人物演出を使う素材でだけ実行する任意工程）
//
// 使い方:
//   node person-matte.mjs --check
//   node person-matte.mjs --input <video> --out <matte.webm>
//                         [--quality fast|balanced|accurate|best]
//                         [--model mobilenetv3|resnet50] [--fps 24] [--decode-width 1280]
//
// 出力は stdout の 1 行 JSON。成功時 `ok: true` と実測値、失敗時 `ok: false` と `reason`。
// 外部 npm 依存ゼロ・ネットワーク禁止（edit-lint と同じ規律）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { findAlphaModeTag } from "./alpha-tag.mjs";
import { MASK_FORMAT, maskOutputArguments } from "./mask-format.mjs";
import { importPackage, resolvePackageFile } from "./resolve-packages.mjs";

let resolveFfmpeg;
let resolveFfprobe;

async function loadMediaPackage() {
  const media = await importPackage("media-bin/src/index.mjs", { from: import.meta.url });
  resolveFfmpeg = media.resolveFfmpeg;
  resolveFfprobe = media.resolveFfprobe;
}

async function loadRvmPackage() {
  try {
    const rvm = await importPackage("matte-rvm/src/index.mjs", { from: import.meta.url });
    return {
      resolveModel: rvm.resolveRvmModel,
      helper: resolvePackageFile("matte-rvm/bin/rvm-helper.mjs", { from: import.meta.url }),
    };
  } catch {
    return null;
  }
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const helperSource = path.join(scriptDir, "person-matte-helper.swift");
const defaultHelperBin = path.join(scriptDir, "person-matte-helper");

// スパイク実測（2026-07-23）で確定した既定値。入力解像度は Vision の速度にほぼ無関係
// （quality ごとに内部で固定リサイズされる）ため、デコード幅は 1280 で統一する。
const DEFAULT_DECODE_WIDTH = 1280;
const DEFAULT_FPS = 24;
const DEFAULT_QUALITY = "balanced";
const QUALITIES = ["fast", "balanced", "accurate", "best"];
const RVM_MODELS = ["mobilenetv3", "resnet50"];
// packages/matte-rvm の正本と同じ既定モデル名を、RVM 未読込の経路でも使えるよう保持する。
const DEFAULT_RVM_MODEL = "mobilenetv3";
const TOOL_ID = "vision-person-segmentation";
const RVM_TOOL_ID = "rvm-person-matting";
const RVM_UNAVAILABLE_REASON = "RVM が入っていないため、この品質では人物マットを生成できません";

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function summarize(value, fallback) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 500) : fallback;
}

function spawnSyncSafe(command, args) {
  try {
    return spawnSync(command, args, { encoding: "utf8" });
  } catch (error) {
    return { error };
  }
}

function checkAvailability({
  platform = os.platform(),
  runSync = spawnSyncSafe,
  resolveFfmpegBin = resolveFfmpeg,
  resolveFfprobeBin = resolveFfprobe,
  resolveModel,
  fileExists = fs.existsSync,
} = {}) {
  if (platform !== "darwin" && platform !== "win32") {
    return { available: false, reason: `未対応のプラットフォームです（${platform}）` };
  }

  if (platform === "darwin") {
    const hasHelperSource = fileExists(helperSource);
    const hasBuiltHelper = fileExists(defaultHelperBin);
    if (!hasHelperSource && !hasBuiltHelper) {
      return { available: false, reason: "Vision の人物マット用ヘルパーがありません" };
    }
    if (hasHelperSource) {
      const swift = runSync("swiftc", ["-version"]);
      if (swift.error?.code === "ENOENT") {
        return { available: false, reason: "swiftc が PATH 上にありません" };
      }
      if (swift.error || swift.status !== 0) {
        return { available: false, reason: "swiftc を起動できません" };
      }
    }
  }

  let ffmpegBin;
  let ffprobeBin;
  try {
    ffmpegBin = resolveFfmpegBin();
  } catch (error) {
    return { available: false, reason: summarize(error?.message, "ffmpeg が見つかりません") };
  }
  try {
    ffprobeBin = resolveFfprobeBin();
  } catch (error) {
    return { available: false, reason: summarize(error?.message, "ffprobe が見つかりません") };
  }

  for (const [label, command] of [["ffmpeg", ffmpegBin], ["ffprobe", ffprobeBin]]) {
    const probe = runSync(command, ["-version"]);
    if (probe.error?.code === "ENOENT") {
      return { available: false, reason: `${label} が見つかりません` };
    }
    if (probe.error || probe.status !== 0) {
      return { available: false, reason: `${label} を起動できません` };
    }
  }

  // VP9 alpha WebM を書けるかは libvpx-vp9 の有無で決まる（ffmpeg 内蔵の vp9 エンコーダは別物）。
  const encoders = runSync(ffmpegBin, ["-hide_banner", "-encoders"]);
  if (encoders.error || encoders.status !== 0) {
    return { available: false, reason: "ffmpeg -encoders を取得できません" };
  }
  if (!String(encoders.stdout ?? "").includes("libvpx-vp9")) {
    return { available: false, reason: "ffmpeg に libvpx-vp9 エンコーダがありません" };
  }

  if (platform === "win32") {
    if (typeof resolveModel !== "function") {
      return { available: false, reason: RVM_UNAVAILABLE_REASON };
    }
    const model = resolveModel(DEFAULT_RVM_MODEL);
    if (model.missing) {
      return {
        available: false,
        reason: `RVM model is not installed: ${model.path}. ${model.fetchHint}`,
      };
    }
  }

  return { available: true };
}

function parseArguments(argv) {
  const result = {
    check: false,
    input: null,
    out: null,
    quality: DEFAULT_QUALITY,
    fps: DEFAULT_FPS,
    decodeWidth: DEFAULT_DECODE_WIDTH,
    helperBin: defaultHelperBin,
    model: DEFAULT_RVM_MODEL,
    modelExplicit: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      result.check = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} の値がありません`);
    index += 1;
    switch (argument) {
      case "--input":
        result.input = path.resolve(value);
        break;
      case "--out":
        result.out = path.resolve(value);
        break;
      case "--helper-bin":
        result.helperBin = path.resolve(value);
        break;
      case "--quality":
        result.quality = value;
        break;
      case "--model":
        result.model = value;
        result.modelExplicit = true;
        break;
      case "--fps":
        result.fps = Number(value);
        break;
      case "--decode-width":
        result.decodeWidth = Number(value);
        break;
      default:
        throw new Error(`不明な引数です: ${argument}`);
    }
  }
  if (!QUALITIES.includes(result.quality)) {
    throw new Error(`--quality は ${QUALITIES.join(" / ")} のいずれかです`);
  }
  if (!RVM_MODELS.includes(result.model)) {
    throw new Error(`--model は ${RVM_MODELS.join(" / ")} のいずれかです`);
  }
  if (result.modelExplicit && result.quality !== "best") {
    throw new Error("--model は --quality best のときだけ指定できます");
  }
  if (!Number.isFinite(result.fps) || result.fps <= 0 || result.fps > 240) {
    throw new Error("--fps は 0 より大きく 240 以下の数値です");
  }
  if (!Number.isFinite(result.decodeWidth) || result.decodeWidth < 16) {
    throw new Error("--decode-width は 16 以上の数値です");
  }
  return result;
}

function needsBuild(helperBin) {
  let sourceStat;
  try {
    sourceStat = fs.statSync(helperSource);
  } catch (error) {
    if (error?.code === "ENOENT" && fs.existsSync(helperBin)) return false;
    throw error;
  }
  try {
    return fs.statSync(helperBin).mtimeMs < sourceStat.mtimeMs;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

function buildHelper(helperBin) {
  if (!needsBuild(helperBin)) return null;
  const result = spawnSyncSafe("swiftc", ["-O", "-parse-as-library", helperSource, "-o", helperBin]);
  if (result.error || result.status !== 0) {
    return summarize(
      result.stderr,
      result.error?.code === "ENOENT" ? "swiftc が PATH 上にありません" : "終了コードが 0 ではありません",
    );
  }
  return null;
}

function engineForPlatform(quality, platform = os.platform()) {
  return platform === "win32" || quality === "best" ? "rvm" : "vision";
}

function prepareExecution(options, {
  platform = os.platform(),
  resolveModel,
  buildVisionHelper = buildHelper,
} = {}) {
  const engine = engineForPlatform(options.quality, platform);
  if (engine === "rvm") {
    if (typeof resolveModel !== "function") throw new Error(RVM_UNAVAILABLE_REASON);
    const resolved = resolveModel(options.model);
    if (resolved.missing) {
      throw new Error(`RVM model is not installed: ${resolved.path}. ${resolved.fetchHint}`);
    }
    return { ...options, engine, modelPath: resolved.path };
  }

  const buildError = buildVisionHelper(options.helperBin);
  if (buildError) throw new Error(`swiftc build failed: ${buildError}`);
  return { ...options, engine };
}

function ffprobeJson(args, ffprobeBin = resolveFfprobe()) {
  const result = spawnSyncSafe(ffprobeBin, ["-v", "error", ...args, "-of", "json"]);
  if (result.error || result.status !== 0) {
    throw new Error(summarize(result.stderr, "ffprobe に失敗しました"));
  }
  try {
    return JSON.parse(String(result.stdout ?? ""));
  } catch {
    throw new Error("ffprobe の出力が JSON ではありません");
  }
}

function frameCount(stream) {
  for (const value of [stream?.nb_frames, stream?.nb_read_frames]) {
    const count = Number(value);
    if (Number.isFinite(count) && count >= 0) return count;
  }
  return null;
}

/// 素材の表示上の寸法（回転を反映した幅・高さ）と尺を得る。
function probeSource(input, ffprobeBin) {
  const probed = ffprobeJson([
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,r_frame_rate,duration:stream_side_data=rotation:format=duration",
    input,
  ], ffprobeBin);
  const stream = probed?.streams?.[0];
  if (!stream) throw new Error("映像ストリームが見つかりません");
  const width = Number(stream.width);
  const height = Number(stream.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("映像ストリームの寸法を取得できません");
  }
  // ffmpeg はデコード時に回転を自動補正するため、90 度系の回転がある素材では
  // フィルタへ入る時点で幅と高さが入れ替わっている。
  const rotation = Number(
    (Array.isArray(stream.side_data_list) ? stream.side_data_list : []).find((entry) =>
      Number.isFinite(Number(entry?.rotation)),
    )?.rotation ?? 0,
  );
  const quarterTurns = Math.abs(Math.round(rotation / 90)) % 2;
  const duration = Number(stream.duration ?? probed?.format?.duration ?? Number.NaN);
  return {
    width: quarterTurns === 1 ? height : width,
    height: quarterTurns === 1 ? width : height,
    rotation,
    duration: Number.isFinite(duration) ? duration : null,
  };
}

/// 偶数へ丸めた出力寸法。入力より大きくは伸ばさない（Vision の品質は入力解像度に依存しない）。
function outputSize(source, decodeWidth) {
  const width = Math.max(16, Math.floor(Math.min(decodeWidth, source.width) / 2) * 2);
  const height = Math.max(16, Math.floor((source.height / source.width) * width / 2) * 2);
  return { width, height };
}

function stage(name, command, args, stdio) {
  const child = spawn(command, args, { stdio });
  const chunks = [];
  child.stderr?.on("data", (chunk) => chunks.push(chunk));
  const exited = new Promise((resolve) => {
    child.once("error", (error) => resolve({ name, code: null, error }));
    child.once("close", (code, signal) => resolve({ name, code, signal }));
  });
  return { name, child, exited, stderr: () => Buffer.concat(chunks).toString("utf8") };
}

async function generate(options) {
  const ffmpegBin = resolveFfmpeg();
  const ffprobeBin = resolveFfprobe();
  const source = probeSource(options.input, ffprobeBin);
  const size = outputSize(source, options.decodeWidth);
  const metricsPath = path.join(
    os.tmpdir(),
    `person-matte-metrics-${process.pid}-${Date.now()}.json`,
  );
  fs.mkdirSync(path.dirname(options.out), { recursive: true });

  const decoder = stage(
    "decode",
    ffmpegBin,
    [
      "-hide_banner", "-nostdin", "-loglevel", "error",
      "-i", options.input,
      "-map", "0:v:0",
      "-vf", `scale=${size.width}:${size.height}:flags=bicubic`,
      "-r", String(options.fps),
      "-f", "rawvideo", "-pix_fmt", "bgra", "-",
    ],
    ["ignore", "pipe", "pipe"],
  );
  const helper = options.engine === "rvm"
    ? stage(
      "segment",
      process.execPath,
      [
        options.rvmHelper,
        "--width", String(size.width),
        "--height", String(size.height),
        "--model", options.modelPath,
        "--metrics", metricsPath,
        "--total-frames", String(source.duration ? Math.round(source.duration * options.fps) : 0),
      ],
      ["pipe", "pipe", "pipe"],
    )
    : stage(
      "segment",
      options.helperBin,
      [
        "--width", String(size.width),
        "--height", String(size.height),
        "--quality", options.quality,
        "--metrics", metricsPath,
      ],
      ["pipe", "pipe", "pipe"],
    );
  const encoder = stage(
    "encode",
    ffmpegBin,
    [
      "-hide_banner", "-loglevel", "error",
      "-f", "rawvideo", "-pix_fmt", "bgra",
      "-s", `${size.width}x${size.height}`,
      "-r", String(options.fps),
      "-i", "-",
      "-an",
      // VP9 alpha WebM。yuva420p が alpha_mode=1 のコンテナを作る唯一の経路であり、
      // -auto-alt-ref 0 は alpha 付き libvpx-vp9 で必要（alt-ref フレームと併用できない）。
      // この工程が全体の壁時計時間を支配するため row-mt で並列化する（実測 143s → 75s）。
      "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
      "-b:v", "0", "-crf", "30", "-auto-alt-ref", "0",
      "-row-mt", "1", "-threads", "4",
      "-y", options.out,
    ],
    ["pipe", "ignore", "pipe"],
  );
  const parsedOutput = path.parse(options.out);
  const maskPath = path.join(parsedOutput.dir, `${parsedOutput.name}.mask.mp4`);
  const maskEncoder = stage(
    "mask-encode",
    ffmpegBin,
    [
      "-hide_banner", "-loglevel", "error",
      "-f", "rawvideo", "-pix_fmt", "bgra",
      "-s", `${size.width}x${size.height}`,
      "-r", String(options.fps),
      "-i", "-",
      ...maskOutputArguments({ fps: options.fps, output: maskPath }),
    ],
    ["pipe", "ignore", "pipe"],
  );

  // 途中の段が先に落ちたときの EPIPE で Node ごと落ちないようにする。
  for (const stream of [
    decoder.child.stdout,
    helper.child.stdin,
    helper.child.stdout,
    encoder.child.stdin,
    maskEncoder.child.stdin,
  ]) {
    stream?.on("error", () => {});
  }
  decoder.child.stdout?.pipe(helper.child.stdin);
  helper.child.stdout?.pipe(encoder.child.stdin);
  const maskStartedAt = Date.now();
  helper.child.stdout?.pipe(maskEncoder.child.stdin);
  if (options.engine === "rvm") {
    helper.child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  }

  const startedAt = Date.now();
  let maskEndedAt = maskStartedAt;
  const results = await Promise.all([
    decoder.exited,
    helper.exited,
    encoder.exited,
    maskEncoder.exited.then((result) => {
      maskEndedAt = Date.now();
      return result;
    }),
  ]);
  const elapsedSeconds = (Date.now() - startedAt) / 1000;

  const stderrOf = {
    decode: decoder.stderr(),
    segment: helper.stderr(),
    encode: encoder.stderr(),
    "mask-encode": maskEncoder.stderr(),
  };
  for (const result of results.slice(0, 3)) {
    if (result.error?.code === "ENOENT") {
      throw new Error(`${result.name} を起動できません（${result.error.path ?? "不明なコマンド"}）`);
    }
    if (result.error || result.code !== 0) {
      throw new Error(
        `${result.name} が失敗しました: ${summarize(stderrOf[result.name] || result.error?.message, `終了コード ${result.code}`)}`,
      );
    }
  }

  let metrics = null;
  try {
    metrics = JSON.parse(fs.readFileSync(metricsPath, "utf8"));
    fs.rmSync(metricsPath, { force: true });
  } catch {
    throw new Error("ヘルパーの実測値を読み取れません");
  }
  if (!metrics || metrics.frames <= 0) {
    throw new Error("フレームを 1 枚も処理していません");
  }

  const verified = verifyOutput(options.out, ffprobeBin);
  const maskExit = results[3];
  let maskResult;
  if (maskExit.error || maskExit.code !== 0) {
    maskResult = {
      ok: false,
      reason: summarize(
        stderrOf[maskExit.name] || maskExit.error?.message,
        `mask-encode 終了コード ${maskExit.code}`,
      ),
    };
  } else {
    try {
      const maskProbe = verifyMaskOutput(maskPath, verified, metrics.frames, ffprobeBin);
      maskResult = {
        ok: true,
        mask_path: maskPath,
        mask_elapsed_seconds: (maskEndedAt - maskStartedAt) / 1000,
        mask_bytes: fs.statSync(maskPath).size,
        mask_probe: maskProbe,
      };
    } catch (error) {
      maskResult = { ok: false, reason: summarize(error?.message, "マスクの検証に失敗しました") };
    }
  }
  if (!maskResult.ok) fs.rmSync(maskPath, { force: true });
  const engine = options.engine;
  return {
    ok: true,
    path: options.out,
    engine,
    ...(engine === "rvm" ? { model: options.model } : {}),
    // analysis.json へ貼る形。path は analysis.json のディレクトリ基準へ書き換えること。
    person_matte: {
      path: options.out,
      fps: options.fps,
      quality: options.quality,
      generated_at: new Date().toISOString(),
      tool: engine === "rvm" ? RVM_TOOL_ID : TOOL_ID,
      ...(maskResult.ok ? { mask_path: maskResult.mask_path, mask_format: MASK_FORMAT } : {}),
    },
    source: { path: options.input, ...source },
    width: size.width,
    height: size.height,
    frames: metrics.frames,
    bytes: fs.statSync(options.out).size,
    elapsed_seconds: elapsedSeconds,
    realtime_ratio: source.duration ? elapsedSeconds / source.duration : null,
    ...(engine === "rvm"
      ? { rvm_ms_per_frame: metrics.ms_per_frame }
      : { vision_ms_per_frame: metrics.vision_ms_per_frame }),
    mask_size: { width: metrics.mask_width, height: metrics.mask_height },
    alpha_transparent_ratio: metrics.alpha_transparent_ratio,
    alpha_partial_ratio: metrics.alpha_partial_ratio,
    probe: verified,
    ...(maskResult.ok
      ? {
        mask_path: maskResult.mask_path,
        mask_elapsed_seconds: maskResult.mask_elapsed_seconds,
        mask_bytes: maskResult.mask_bytes,
        mask_probe: maskResult.mask_probe,
      }
      : { mask: maskResult }),
  };
}

/// 書き出した WebM が本当に VP9 かつアルファ付きかを ffprobe で確かめる。
/// ffmpeg 自身は VP9 の alpha レイヤをデコードできない（pix_fmt は yuv420p と報告される）ので、
/// アルファの有無はコンテナの alpha_mode タグで判定する。
function verifyOutput(out, ffprobeBin) {
  const probed = ffprobeJson([
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=codec_name,width,height,r_frame_rate,nb_frames:stream_tags=alpha_mode:format=duration",
    out,
  ], ffprobeBin);
  const stream = probed?.streams?.[0];
  if (!stream) throw new Error("書き出した WebM に映像ストリームがありません");
  if (stream.codec_name !== "vp9") {
    throw new Error(`書き出した WebM の codec が vp9 ではありません（${stream.codec_name}）`);
  }
  const alphaModeTag = findAlphaModeTag(stream.tags);
  if (String(alphaModeTag ?? "") !== "1") {
    throw new Error("書き出した WebM に alpha_mode=1 がありません（アルファが落ちています）");
  }
  return {
    codec_name: stream.codec_name,
    alpha_mode: String(alphaModeTag),
    width: Number(stream.width),
    height: Number(stream.height),
    r_frame_rate: stream.r_frame_rate,
    nb_frames: stream.nb_frames ? Number(stream.nb_frames) : null,
    duration: probed?.format?.duration ? Number(probed.format.duration) : null,
  };
}

function verifyMaskOutput(out, alphaProbe, expectedFrames, ffprobeBin) {
  const probed = ffprobeJson([
    "-select_streams",
    "v:0",
    "-count_frames",
    "-show_entries",
    "stream=codec_name,profile,pix_fmt,color_range,width,height,r_frame_rate,nb_frames,nb_read_frames,start_pts,duration",
    out,
  ], ffprobeBin);
  const stream = probed?.streams?.[0];
  if (!stream) throw new Error("書き出したマスクに映像ストリームがありません");
  const probe = {
    codec_name: stream.codec_name,
    profile: stream.profile,
    pix_fmt: stream.pix_fmt,
    color_range: stream.color_range,
    width: Number(stream.width),
    height: Number(stream.height),
    r_frame_rate: stream.r_frame_rate,
    nb_frames: frameCount(stream),
    start_pts: Number(stream.start_pts ?? 0),
    duration: stream.duration ? Number(stream.duration) : null,
  };
  const failures = [];
  if (probe.codec_name !== "h264") failures.push(`codec=${probe.codec_name}`);
  if (probe.profile !== "High") failures.push(`profile=${probe.profile}`);
  if (probe.color_range !== "pc") failures.push(`color_range=${probe.color_range}`);
  if (probe.width !== alphaProbe.width || probe.height !== alphaProbe.height) failures.push("size mismatch");
  if (probe.r_frame_rate !== alphaProbe.r_frame_rate) failures.push("fps mismatch");
  if (probe.nb_frames !== expectedFrames) failures.push("frame count mismatch");
  if (probe.start_pts !== 0) failures.push(`start_pts=${probe.start_pts}`);
  if (failures.length > 0) throw new Error(`マスクの規格検証に失敗しました: ${failures.join(", ")}`);
  return probe;
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    printJson({ ok: false, reason: summarize(error?.message, "引数が不正です") });
    process.exitCode = 2;
    return;
  }

  await loadMediaPackage();
  const platform = os.platform();
  const engine = engineForPlatform(options.quality, platform);
  const rvm = engine === "rvm" ? await loadRvmPackage() : null;
  let availability = checkAvailability({ platform, resolveModel: rvm?.resolveModel });
  if (engine === "rvm" && !rvm && availability.available) {
    availability = { available: false, reason: RVM_UNAVAILABLE_REASON };
  } else if (engine === "rvm" && rvm) {
    const executionModel = rvm.resolveModel(options.model);
    if (executionModel.missing) {
      availability = {
        available: false,
        reason: `RVM model is not installed: ${executionModel.path}. ${executionModel.fetchHint}`,
      };
    }
  }
  if (options.check) {
    const rvmModel = rvm
      ? rvm.resolveModel(DEFAULT_RVM_MODEL)
      : { model: DEFAULT_RVM_MODEL, missing: true, reason: RVM_UNAVAILABLE_REASON };
    printJson({ ...availability, rvm_model: rvmModel });
    return;
  }
  if (!options.input || !options.out) {
    printJson({ ok: false, reason: "--input と --out が必要です" });
    process.exitCode = 2;
    return;
  }
  if (!availability.available) {
    printJson({ ok: false, ...availability });
    process.exitCode = 1;
    return;
  }

  try {
    const prepared = prepareExecution(options, { platform, resolveModel: rvm?.resolveModel });
    if (prepared.engine === "rvm") prepared.rvmHelper = rvm?.helper;
    printJson(await generate(prepared));
  } catch (error) {
    printJson({ ok: false, reason: summarize(error?.message, "人物マットの生成に失敗しました") });
    process.exitCode = 1;
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(process.argv[1]));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  try {
    await main();
  } catch (error) {
    console.error(error?.message ?? "人物マットを開始できませんでした。");
    process.exit(1);
  }
}

export {
  DEFAULT_DECODE_WIDTH,
  DEFAULT_FPS,
  DEFAULT_QUALITY,
  QUALITIES,
  RVM_MODELS,
  checkAvailability,
  engineForPlatform,
  parseArguments,
  prepareExecution,
};
