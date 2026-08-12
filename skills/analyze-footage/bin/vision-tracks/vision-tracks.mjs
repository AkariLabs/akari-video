#!/usr/bin/env node

// vision-tracks.mjs — 顔ランドマーク・手ポーズのトラックファイルを 1 組作り、
// analysis.json の tracks へ追記するラッパー
//
// 2 プロセスを繋いだだけの薄い層である。
//   ffmpeg（デコード: 回転補正・幅統一・fps 統一） → vision-tracks-helper（Vision で検出）
// 中間ファイルを作らず、raw BGRA のまま helper へ繋ぐ。helper の標準出力（JSON Lines・
// 1 フレーム 1 行）を読み切ってから、契約 §2 のトラックファイル（kind ごとに 1 ファイル）
// を組み立て、analysis.json の tracks へ additive にマージして原子的に置き換える。
//
// 契約: docs/contract-2026-08-11-analysis-vision-tracks-v0.md
// 手順: ../../vision-tracks.md（人物・手が写る素材でだけ実行する任意工程）
//
// 使い方:
//   node vision-tracks.mjs --check
//   node vision-tracks.mjs --input <video> --analysis <analysis.json>
//                          [--kinds face,hand] [--fps 24] [--decode-width 1280]
//                          [--joint-confidence 0.3] [--metrics <path>]
//
// 出力は stdout の 1 行 JSON。成功時 `ok: true` と実測値、失敗時 `ok: false` と `reason`。
// 外部 npm 依存ゼロ・ネットワーク禁止（edit-lint / person-matte と同じ規律）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const helperSource = path.join(scriptDir, "vision-tracks-helper.swift");
const defaultHelperBin = path.join(scriptDir, "vision-tracks-helper");

const DEFAULT_DECODE_WIDTH = 1280;
const DEFAULT_FPS = 24;
const DEFAULT_JOINT_CONFIDENCE = 0.3;
const DEFAULT_KINDS = ["face", "hand"];
const KINDS = ["face", "hand"];
const TOOL_ID = "vision-tracks.mjs v0";
const PROVIDER_NAME = "apple-vision";

// 契約 §2 の kind 別ファイル名・analysis.json 側のトラックキー対応。
const KIND_INFO = {
  face: { trackKey: "face_landmarks", fileName: "face-landmarks.json", trackKind: "face-landmarks" },
  hand: { trackKey: "hand_pose", fileName: "hand-pose.json", trackKind: "hand-pose" },
};

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

function checkAvailability() {
  if (os.platform() !== "darwin") {
    return { available: false, reason: `macOS ではありません（${os.platform()}）` };
  }

  const swift = spawnSyncSafe("swiftc", ["-version"]);
  if (swift.error?.code === "ENOENT") {
    return { available: false, reason: "swiftc が PATH 上にありません" };
  }
  if (swift.error || swift.status !== 0) {
    return { available: false, reason: "swiftc を起動できません" };
  }

  for (const command of ["ffmpeg", "ffprobe"]) {
    const probe = spawnSyncSafe(command, ["-version"]);
    if (probe.error?.code === "ENOENT") {
      return { available: false, reason: `${command} が PATH 上にありません` };
    }
    if (probe.error || probe.status !== 0) {
      return { available: false, reason: `${command} を起動できません` };
    }
  }

  return { available: true };
}

function parseKinds(raw) {
  const kinds = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  if (kinds.length === 0) throw new Error("--kinds は 1 件以上指定してください");
  const unknown = kinds.filter((k) => !KINDS.includes(k));
  if (unknown.length > 0) {
    throw new Error(`--kinds に未知の種類があります（face,hand のみ）: ${unknown.join(", ")}`);
  }
  return kinds;
}

function parseArguments(argv) {
  const result = {
    check: false,
    input: null,
    analysis: null,
    kinds: DEFAULT_KINDS,
    fps: DEFAULT_FPS,
    decodeWidth: DEFAULT_DECODE_WIDTH,
    jointConfidence: DEFAULT_JOINT_CONFIDENCE,
    helperBin: defaultHelperBin,
    metricsOut: null,
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
      case "--analysis":
        result.analysis = path.resolve(value);
        break;
      case "--helper-bin":
        result.helperBin = path.resolve(value);
        break;
      case "--kinds":
        result.kinds = parseKinds(value);
        break;
      case "--fps":
        result.fps = Number(value);
        break;
      case "--decode-width":
        result.decodeWidth = Number(value);
        break;
      case "--joint-confidence":
        result.jointConfidence = Number(value);
        break;
      case "--metrics":
        result.metricsOut = path.resolve(value);
        break;
      default:
        throw new Error(`不明な引数です: ${argument}`);
    }
  }
  if (!Number.isFinite(result.fps) || result.fps <= 0 || result.fps > 240) {
    throw new Error("--fps は 0 より大きく 240 以下の数値です");
  }
  if (!Number.isFinite(result.decodeWidth) || result.decodeWidth < 16) {
    throw new Error("--decode-width は 16 以上の数値です");
  }
  if (
    !Number.isFinite(result.jointConfidence) ||
    result.jointConfidence < 0 ||
    result.jointConfidence > 1
  ) {
    throw new Error("--joint-confidence は 0 以上 1 以下の数値です");
  }
  return result;
}

function needsBuild(helperBin) {
  const sourceStat = fs.statSync(helperSource);
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

function ffprobeJson(args) {
  const result = spawnSyncSafe("ffprobe", ["-v", "error", ...args, "-of", "json"]);
  if (result.error || result.status !== 0) {
    throw new Error(summarize(result.stderr, "ffprobe に失敗しました"));
  }
  try {
    return JSON.parse(String(result.stdout ?? ""));
  } catch {
    throw new Error("ffprobe の出力が JSON ではありません");
  }
}

/// 素材の表示上の寸法（回転を反映した幅・高さ）と尺を得る（person-matte.mjs と同一ロジック）。
function probeSource(input) {
  const probed = ffprobeJson([
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,r_frame_rate,duration:stream_side_data=rotation:format=duration",
    input,
  ]);
  const stream = probed?.streams?.[0];
  if (!stream) throw new Error("映像ストリームが見つかりません");
  const width = Number(stream.width);
  const height = Number(stream.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("映像ストリームの寸法を取得できません");
  }
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

/// 偶数へ丸めた出力寸法。入力より大きくは伸ばさない。
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

/// helper の JSON Lines 標準出力をバッファし、改行区切りで JSON.parse する。
function collectLines(child) {
  const chunks = [];
  child.stdout?.on("data", (chunk) => chunks.push(chunk));
  return () => {
    const text = Buffer.concat(chunks).toString("utf8");
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
  };
}

/// helper の JSON Lines を読み切り、kind ごとの samples[] へ変換する（契約 §2）。
/// helper は既に画像全体基準・左上原点へ変換済みの座標を返すため、ここでは組み立てのみ行う
/// （座標変換はしない — 契約 §2「消費側は変換しない」と同じ理由で、ラッパーも変換しない）。
function buildSamples(lines, kind, fps) {
  return lines.map((line, index) => ({
    t: index / fps,
    detections: Array.isArray(line[kind]) ? line[kind] : [],
  }));
}

async function runHelper(options, size) {
  const decoder = stage(
    "decode",
    "ffmpeg",
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
  const helper = stage(
    "detect",
    options.helperBin,
    [
      "--width", String(size.width),
      "--height", String(size.height),
      "--kinds", options.kinds.join(","),
      "--joint-confidence", String(options.jointConfidence),
    ],
    ["pipe", "pipe", "pipe"],
  );

  for (const stream of [decoder.child.stdout, helper.child.stdin]) {
    stream?.on("error", () => {});
  }
  decoder.child.stdout?.pipe(helper.child.stdin);
  const readLines = collectLines(helper.child);

  const startedAt = Date.now();
  const results = await Promise.all([decoder.exited, helper.exited]);
  const elapsedSeconds = (Date.now() - startedAt) / 1000;

  const stderrOf = { decode: decoder.stderr(), detect: helper.stderr() };
  for (const result of results) {
    if (result.error?.code === "ENOENT") {
      throw new Error(`${result.name} を起動できません（${result.error.path ?? "不明なコマンド"}）`);
    }
    if (result.error || result.code !== 0) {
      throw new Error(
        `${result.name} が失敗しました: ${summarize(stderrOf[result.name] || result.error?.message, `終了コード ${result.code}`)}`,
      );
    }
  }

  let lines;
  try {
    lines = readLines();
  } catch {
    throw new Error("helper の JSON Lines 出力を読み取れません");
  }
  return { lines, elapsedSeconds };
}

/// analysis.json のディレクトリを基準に、`from`（analysis.json 内の相対 or 絶対パス）を
/// 解決した絶対パスを返す。
function resolveFromAnalysisDir(analysisDir, from) {
  return path.isAbsolute(from) ? from : path.resolve(analysisDir, from);
}

/// トラックファイルの `source.path`（トラックファイル自身のディレクトリ基準の相対パス、
/// 区切りは `/`）を、analysis.json の `source` から算出する。
function relativeSourcePath(trackFileDir, sourceAbsolutePath) {
  const rel = path.relative(trackFileDir, sourceAbsolutePath);
  return rel.split(path.sep).join("/");
}

async function generate(options) {
  if (!fs.existsSync(options.analysis)) {
    throw new Error(`analysis.json が見つかりません: ${options.analysis}`);
  }
  const analysisDir = path.dirname(options.analysis);
  let analysis;
  try {
    analysis = JSON.parse(fs.readFileSync(options.analysis, "utf8"));
  } catch (error) {
    throw new Error(`analysis.json が有効な JSON ではありません: ${error.message}`);
  }
  if (analysis === null || typeof analysis !== "object" || Array.isArray(analysis)) {
    throw new Error("analysis.json のルートは object である必要があります");
  }
  if (analysis.tracks === null || typeof analysis.tracks !== "object" || Array.isArray(analysis.tracks)) {
    throw new Error("analysis.json の tracks が object ではありません");
  }
  if (typeof analysis.source !== "string" || analysis.source.length === 0) {
    throw new Error("analysis.json の source が空でない文字列ではありません");
  }
  const sourceAbsolutePath = resolveFromAnalysisDir(analysisDir, analysis.source);

  const source = probeSource(options.input);
  const size = outputSize(source, options.decodeWidth);
  const { lines, elapsedSeconds } = await runHelper(options, size);
  if (lines.length === 0) {
    throw new Error("フレームを 1 枚も処理していません");
  }

  const visionDir = path.join(analysisDir, "vision");
  fs.mkdirSync(visionDir, { recursive: true });

  const generatedAt = new Date().toISOString();
  const tracksWritten = {};
  const detectionCounts = {};

  for (const kind of options.kinds) {
    const info = KIND_INFO[kind];
    const samples = buildSamples(lines, kind, options.fps);
    detectionCounts[kind] = samples.reduce((sum, s) => sum + s.detections.length, 0);

    const trackFilePath = path.join(visionDir, info.fileName);
    const trackFile = {
      version: 0,
      kind: info.trackKind,
      source: {
        path: relativeSourcePath(visionDir, sourceAbsolutePath),
        duration: source.duration,
      },
      sample_fps: options.fps,
      provider: { name: PROVIDER_NAME, os: `macOS ${os.release()}` },
      samples,
    };
    const tmpPath = `${trackFilePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(trackFile, null, 2)}\n`, "utf8");
    fs.renameSync(tmpPath, trackFilePath);

    analysis.tracks[info.trackKey] = {
      path: `vision/${info.fileName}`,
      sample_fps: options.fps,
      provider: PROVIDER_NAME,
      tool: TOOL_ID,
      generated_at: generatedAt,
      ...(kind === "face" ? { features: ["face_contour"] } : {}),
    };
    tracksWritten[info.trackKey] = analysis.tracks[info.trackKey];
  }

  const analysisTmpPath = `${options.analysis}.tmp`;
  fs.writeFileSync(analysisTmpPath, `${JSON.stringify(analysis, null, 2)}\n`, "utf8");
  fs.renameSync(analysisTmpPath, options.analysis);

  const metrics = {
    ok: true,
    analysis: options.analysis,
    tracks: tracksWritten,
    kinds: options.kinds,
    frames: lines.length,
    width: size.width,
    height: size.height,
    fps: options.fps,
    detection_counts: detectionCounts,
    elapsed_seconds: elapsedSeconds,
    realtime_ratio: source.duration ? elapsedSeconds / source.duration : null,
  };
  if (options.metricsOut) {
    fs.writeFileSync(options.metricsOut, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  }
  return metrics;
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

  const availability = checkAvailability();
  if (options.check) {
    printJson(availability);
    return;
  }
  if (!options.input || !options.analysis) {
    printJson({ ok: false, reason: "--input と --analysis が必要です" });
    process.exitCode = 2;
    return;
  }
  if (!availability.available) {
    printJson({ ok: false, ...availability });
    process.exitCode = 1;
    return;
  }

  try {
    // --helper-bin で既定以外を明示されたときはビルド管理をしない（差し替え先を
    // 常に上書きしない）。テストがダミー実行ファイルへ差し替えられるのはこのため。
    const buildError = options.helperBin === defaultHelperBin ? buildHelper(options.helperBin) : null;
    if (buildError) {
      printJson({ ok: false, reason: `swiftc build failed: ${buildError}` });
      process.exitCode = 1;
      return;
    }
    printJson(await generate(options));
  } catch (error) {
    printJson({ ok: false, reason: summarize(error?.message, "トラック生成に失敗しました") });
    process.exitCode = 1;
  }
}

await main();
