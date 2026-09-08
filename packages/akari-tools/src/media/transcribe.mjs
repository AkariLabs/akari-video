import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  formatNumber,
  generatedAt,
  probeRaw,
  resolveTarget,
  resolveTools,
  runChecked,
  sha256File,
} from "./common.mjs";
import { recordEngineTranscript, recordObservation } from "./record.mjs";
import {
  classifyWhisperMarker,
  detectUnrecognizedSpans,
  UNRECOGNIZED_DEFAULTS,
} from "./unrecognized-spans.mjs";
import { whisperModelCandidates, isWhisperModelExcluded } from "./whisper-model-candidates.mjs";
import { parseSilences } from "./waveform.mjs";
import {
  applyWordBook,
  buildMatcher,
  resolveWordBook,
} from "../../../word-book/src/index.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDirectory, "../../../..");
const speechAnalyzerRequirements = "SpeechAnalyzer は macOS 26 以上 + Command Line Tools が必要です";

function analyzeFootageScriptCandidates(name, options) {
  const root = path.resolve(options.repoRoot ?? repoRoot);
  return [
    path.join(root, "skills", "analyze-footage", "bin", name),
    path.join(root, "packages", "akari-launcher", "vendor", "skills", "analyze-footage", "bin", name),
  ];
}

export function resolveAnalyzeFootageScript(name, options = {}) {
  return analyzeFootageScriptCandidates(name, options).find((candidate) => existsSync(candidate)) ?? null;
}

function missingScriptMessage(label, name, options) {
  return `${label}実装が同梱されていません（${analyzeFootageScriptCandidates(name, options).join(" / ")}）`;
}

function writeBackendLog(options, message) {
  (options.logger ?? options.stderr ?? console.error)(String(message).replace(/[\r\n]+/g, " "));
}

export async function transcribeMedia(targetArgument, options = {}) {
  const started = performance.now();
  const target = resolveTarget(targetArgument, options);
  const { ffmpeg, ffprobe } = resolveTools(options);
  const { value, duration } = probeRaw(target.inputPath, ffprobe, options);
  const range = normalizeRange(options.in, options.out, duration);
  const lang = options.lang ?? "auto";
  const sha256 = sha256File(target.inputPath);
  let backendInfo = await selectBackend(options.backend, target, options);
  let backend = backendInfo.name;
  const cacheDirectory = target.projectRoot
    ? path.join(target.projectRoot, ".akari", "cache", "transcribe")
    : path.join(os.tmpdir(), "akari-transcribe-cache");
  await mkdir(cacheDirectory, { recursive: true });
  let { key, cachePath } = cacheIdentity({ sha256, range, backend, lang, cacheDirectory });

  if (existsSync(cachePath)) {
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    const rawResult = { ...cached, cache: { hit: true, key } };
    const result = await applyResolvedWordBook(rawResult, target, options);
    await recordTranscribe(target, { ...result, generated_at: generatedAt(options) }, options.in === undefined && options.out === undefined ? undefined : range, backend, lang, options.noRecord, rawResult, started);
    return result;
  }

  let segments = [];
  if (value.streams?.some((stream) => stream.codec_type === "audio")) {
    try {
      segments = options.backendRunner
        ? await options.backendRunner({ backend, inputPath: target.inputPath, range, lang, target })
        : await runBackend({ backendInfo, ffmpeg, target, range, lang, options });
    } catch (error) {
      const fallback = options.backend === undefined && backend === "speech-analyzer" ? resolveWhisper(options) : null;
      if (!fallback) throw error;
      writeBackendLog(options, `SpeechAnalyzer が失敗したため whisper.cpp へフォールバックします: ${error instanceof Error ? error.message : String(error)}`);
      backendInfo = { name: "whisper-cpp", ...fallback };
      backend = backendInfo.name;
      ({ key, cachePath } = cacheIdentity({ sha256, range, backend, lang, cacheDirectory }));
      if (existsSync(cachePath)) {
        const cached = JSON.parse(await readFile(cachePath, "utf8"));
        const rawResult = { ...cached, cache: { hit: true, key } };
        const result = await applyResolvedWordBook(rawResult, target, options);
        await recordTranscribe(target, { ...result, generated_at: generatedAt(options) }, options.in === undefined && options.out === undefined ? undefined : range, backend, lang, options.noRecord, rawResult, started);
        return result;
      }
      segments = options.backendRunner
        ? await options.backendRunner({ backend, inputPath: target.inputPath, range, lang, target })
        : await runBackend({ backendInfo, ffmpeg, target, range, lang, options });
    }
  }
  const costUsd = backend.startsWith("cloud:") ? segments?.cost_estimate_usd ?? null : null;
  segments = normalizeSegments(Array.isArray(segments) ? segments : segments?.segments, range);
  segments = await attachUnrecognizedSpans(segments, target.inputPath, range, ffmpeg, options);
  const rawResult = {
    path: target.displayPath,
    range,
    backend,
    no_speech: segments.length === 0,
    ...(backend.startsWith("cloud:") ? { cost_usd: costUsd } : {}),
    segments,
    cache: { hit: false, key },
    generated_at: generatedAt(options),
  };
  await writeFile(cachePath, `${JSON.stringify(rawResult, null, 2)}\n`, "utf8");
  const result = await applyResolvedWordBook(rawResult, target, options);
  await recordTranscribe(target, result, options.in === undefined && options.out === undefined ? undefined : range, backend, lang, options.noRecord, rawResult, started);
  return result;
}

async function applyResolvedWordBook(result, target, options) {
  if (options.wordBook === false) return result;
  const resolved = await resolveWordBook({
    projectRoot: target.projectRoot,
    extraPath: options.wordBookPath,
    env: options.env ?? process.env,
  });
  for (const layer of resolved.layers) {
    if (!layer.error) continue;
    writeWordBookLog(options, `単語帳: ${layer.scope} を読めません（${layer.error.message}）`);
  }
  const applied = applyWordBook(result.segments, buildMatcher(resolved.entries), { mode: "transcript" });
  if (applied.stats.replaced > 0) {
    writeWordBookLog(options, `単語帳: ${applied.stats.replaced} 語を置換（layers: ${resolved.layers.map((layer) => layer.scope).join(", ")}）`);
  }
  return { ...result, segments: applied.records };
}

function writeWordBookLog(options, message) {
  if (typeof options.stderr === "function") options.stderr(message);
  else process.stderr.write(`${message}\n`);
}

function normalizeRange(input, output, duration) {
  const range = { in: input ?? 0, out: output ?? duration };
  if (!Number.isFinite(range.in) || !Number.isFinite(range.out) || range.in < 0 || range.out > duration || range.out <= range.in) {
    throw new Error(`文字起こし範囲は 0〜${duration} 秒内で out > in にしてください`);
  }
  return { in: formatNumber(range.in), out: formatNumber(range.out) };
}

async function selectBackend(requested, target, options) {
  if (requested?.startsWith("cloud:")) return validateCloudBackend(requested, target);
  if (requested && !["speech-analyzer", "whisper-cpp"].includes(requested)) {
    throw new Error(`未対応の backend です: ${requested}`);
  }
  if (requested === "speech-analyzer") {
    const availability = speechAnalyzerAvailability(options);
    if (!availability.available) throw new Error(availability.message);
    return { name: requested };
  }
  if (requested === "whisper-cpp") {
    const whisper = resolveWhisper(options);
    if (!whisper) throw new Error("whisper.cpp の実行ファイルまたはモデルが見つかりません");
    return { name: requested, ...whisper };
  }
  const availability = speechAnalyzerAvailability(options);
  if (availability.available) return { name: "speech-analyzer" };
  const whisper = resolveWhisper(options);
  if (whisper) {
    writeBackendLog(options, `SpeechAnalyzer を利用できないため whisper.cpp へフォールバックします: ${availability.reason}`);
    return { name: "whisper-cpp", ...whisper };
  }
  throw new Error("利用できるローカル文字起こし backend がありません（SpeechAnalyzer / whisper.cpp）");
}

export function speechAnalyzerAvailable(options = {}) {
  return speechAnalyzerAvailability(options).available;
}

function speechAnalyzerAvailability(options) {
  if (typeof options.speechAnalyzerAvailable === "boolean") {
    return { available: options.speechAnalyzerAvailable, reason: speechAnalyzerRequirements, message: speechAnalyzerRequirements };
  }
  const speechAnalyzerScript = resolveAnalyzeFootageScript("transcribe-sa.mjs", options);
  if (!speechAnalyzerScript) {
    return {
      available: false,
      reason: `SpeechAnalyzer の実装スクリプトが見つからない（${analyzeFootageScriptCandidates("transcribe-sa.mjs", options).join(" / ")}）`,
      message: missingScriptMessage("SpeechAnalyzer の", "transcribe-sa.mjs", options),
    };
  }
  try {
    const result = runChecked(process.execPath, [speechAnalyzerScript, "--check"], options);
    const value = JSON.parse(result.stdout);
    const detail = String(value.reason ?? speechAnalyzerRequirements);
    const reason = /macOS.*26 未満/.test(detail) ? `macOS 26 未満（${detail}）`
      : /swiftc.*(?:ありません|無い)/.test(detail) ? `swiftc が無い（${detail}）` : detail;
    return { available: value.available === true, reason, message: speechAnalyzerRequirements };
  } catch (error) {
    const message = `SpeechAnalyzer の利用可否チェックに失敗しました: ${error instanceof Error ? error.message : String(error)}`;
    return { available: false, reason: message, message };
  }
}

export function resolveWhisper(options = {}) {
  if (options.whisperAvailable === false) return null;
  if (options.whisperBin && options.whisperModel) return { bin: options.whisperBin, model: options.whisperModel };
  const binCandidates = [
    process.env.AKARI_WHISPER_BIN,
    process.env.WHISPER_CPP_BIN,
    "/Applications/AKARI Video.app/Contents/Resources/media-bin/whisper-cli",
    path.join(repoRoot, "packages", "media-bin", "vendor", `${process.platform}-${process.arch}`, process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli"),
    path.join(os.homedir(), ".akari", "tools", "bin", process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli"),
    findOnPath(process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli"),
    path.join(repoRoot, "whisper.cpp", "build", "bin", process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli"),
    path.resolve(repoRoot, "..", "whisper.cpp", "build", "bin", process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli"),
  ].filter(Boolean);
  const bin = binCandidates.find(executableFile);
  if (!bin) return null;
  const modelCandidates = whisperModelCandidates({ env: process.env, homeDir: os.homedir(), repoRoot, bin });
  const model = modelCandidates.find((candidate) => existsSync(candidate) && !isWhisperModelExcluded(candidate));
  return model ? { bin, model } : null;
}

function executableFile(candidate) {
  try {
    accessSync(candidate, constants.R_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findOnPath(name) {
  for (const directory of String(process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, name);
    if (executableFile(candidate)) return candidate;
  }
  return null;
}

function validateCloudBackend(requested, target) {
  if (!target.projectRoot) throw new Error("cloud backend は AKARI Video プロジェクト内でのみ使えます");
  const id = requested.slice("cloud:".length);
  const connectionsPath = path.join(target.projectRoot, ".akari", "connections.json");
  if (!existsSync(connectionsPath)) throw new Error(".akari/connections.json が見つかりません");
  const connections = JSON.parse(readFileSync(connectionsPath, "utf8"));
  const provider = connections.providers?.find((item) => item.id === id);
  if (!provider || provider.doctor?.status !== "ok") throw new Error(`接続 ${id} の doctor が ok ではありません`);
  return { name: requested, connectionId: id };
}

async function runBackend({ backendInfo, ffmpeg, target, range, lang, options }) {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "akari-transcribe-"));
  try {
    const cloud = backendInfo.name.startsWith("cloud:");
    const inputPath = path.join(temporaryDirectory, cloud ? "cloud-input.m4a" : "input.wav");
    const codecArgs = cloud
      ? ["-ac", "1", "-c:a", "aac", "-b:a", /groq/i.test(backendInfo.connectionId) ? "32k" : "64k"]
      : ["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"];
    runChecked(ffmpeg, [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-ss", String(range.in), "-i", target.inputPath,
      "-t", String(range.out - range.in), "-map", "0:a:0", ...codecArgs, inputPath,
    ], options);
    if (backendInfo.name === "speech-analyzer") return await runSpeechAnalyzer(inputPath, options);
    if (backendInfo.name === "whisper-cpp") return runWhisper(inputPath, temporaryDirectory, backendInfo, lang, options);
    if (options.cloudRunner) return await options.cloudRunner({ inputPath, projectRoot: target.projectRoot, connectionId: backendInfo.connectionId, range });
    return runCloud(inputPath, target.projectRoot, backendInfo.connectionId, range, options);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function runSpeechAnalyzer(wavPath, options) {
  const speechAnalyzerScript = resolveAnalyzeFootageScript("transcribe-sa.mjs", options);
  if (!speechAnalyzerScript) throw new Error(missingScriptMessage("SpeechAnalyzer の", "transcribe-sa.mjs", options));
  const helperDirectory = path.join(os.tmpdir(), "akari-speech-analyzer");
  const moduleCache = path.join(helperDirectory, "clang-module-cache");
  await mkdir(helperDirectory, { recursive: true });
  const result = runChecked(process.execPath, [speechAnalyzerScript, "--input", wavPath, "--helper-bin", path.join(helperDirectory, "speechanalyzer-helper")], {
    ...options,
    spawnOptions: {
      ...options.spawnOptions,
      env: { ...process.env, ...options.spawnOptions?.env, CLANG_MODULE_CACHE_PATH: moduleCache, SWIFT_MODULECACHE_PATH: moduleCache },
    },
  });
  const value = JSON.parse(result.stdout);
  if (!value.available) throw new Error(value.reason || "SpeechAnalyzer が失敗しました");
  return value.segments ?? [];
}

function runWhisper(wavPath, temporaryDirectory, backendInfo, lang, options) {
  const prefix = path.join(temporaryDirectory, "whisper.raw");
  runChecked(backendInfo.bin, [
    "-m", backendInfo.model, "-f", wavPath, "-l", lang, "-oj", "-ojf", "-of", prefix,
  ], options);
  const jsonPath = [`${prefix}.json`, prefix].find(existsSync);
  if (!jsonPath) throw new Error("whisper.cpp の JSON 出力が見つかりません");
  return normalizeWhisperJson(JSON.parse(readFileSync(jsonPath, "utf8")));
}

function runCloud(wavPath, projectRoot, connectionId, range, options) {
  const cloudScript = resolveAnalyzeFootageScript("transcribe-cloud.mjs", options);
  if (!cloudScript) throw new Error(missingScriptMessage("クラウド文字起こしの", "transcribe-cloud.mjs", options));
  const provider = /groq/i.test(connectionId) ? "groq" : "scribe";
  try {
    const result = runChecked(process.execPath, [
      cloudScript, "--send", "--provider", provider, "--input", wavPath,
      "--duration", String(range.out - range.in), "--project-root", projectRoot, "--approved",
    ], options);
    const value = JSON.parse(result.stdout);
    return { segments: value.segments ?? value.transcript ?? [], cost_estimate_usd: value.cost_estimate_usd ?? null };
  } catch (error) {
    throw new Error(`クラウド文字起こしの実行に失敗しました: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

export function normalizeWhisperJson(value) {
  const source = value.transcription ?? value.segments ?? [];
  return source.map((segment) => {
    const start = Number(segment.offsets?.from ?? segment.start) / (segment.offsets ? 1000 : 1);
    const end = Number(segment.offsets?.to ?? segment.end) / (segment.offsets ? 1000 : 1);
    const markers = [];
    const words = [];
    let pending = null;
    for (const token of segment.tokens ?? segment.words ?? []) {
      const wordStart = Number(token.offsets?.from ?? token.start) / (token.offsets ? 1000 : 1);
      const wordEnd = Number(token.offsets?.to ?? token.end) / (token.offsets ? 1000 : 1);
      const markerKind = classifyWhisperMarker(token.text);
      if (markerKind === "non-speech") {
        if (wordEnd > wordStart) markers.push({ start: wordStart, end: wordEnd });
        continue;
      }
      if (markerKind === "control") continue;
      const text = String(token.text ?? "").replace(/\uFFFD/g, "").trim();
      if (!text || !Number.isFinite(wordStart) || !Number.isFinite(wordEnd)) continue;
      if (wordEnd <= wordStart) {
        // 連続する 0 長・負長トークンは、最初の from と文字順を保持する。
        pending = { start: pending?.start ?? wordStart, text: (pending?.text ?? "") + text };
        continue;
      }
      words.push({ start: pending?.start ?? wordStart, end: wordEnd, text: (pending?.text ?? "") + text });
      pending = null;
    }
    if (pending && words.length) words.at(-1).text += pending.text;
    const text = String(segment.text ?? "").replace(/\uFFFD/g, "").trim();
    const useWords = words.length && words.every((word) => word.end > word.start)
      && words.map((word) => word.text).join("").replace(/\s/g, "") === text.replace(/\s/g, "");
    return {
      start,
      end,
      text,
      ...(useWords ? { words } : {}),
      ...(markers.length ? { markers } : {}),
    };
  });
}

function normalizeSegments(segments, range) {
  const offset = range.in;
  return (Array.isArray(segments) ? segments : []).flatMap((segment) => {
    const relativeStart = Number(segment.start);
    const relativeEnd = Number(segment.end);
    const start = relativeStart + offset;
    const end = relativeEnd + offset;
    const text = String(segment.text ?? "").trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text) return [];
    const normalized = { start: formatNumber(Math.max(range.in, start)), end: formatNumber(Math.min(range.out, end)), text };
    const words = [];
    let pending = null;
    const clampWordTime = (time) => formatNumber(Math.max(normalized.start, Math.min(normalized.end, time + offset)));
    for (const word of segment.words ?? []) {
      if (!Number.isFinite(Number(word.start)) || !Number.isFinite(Number(word.end))) continue;
      const wordStart = clampWordTime(Number(word.start));
      const wordEnd = clampWordTime(Number(word.end));
      const wordText = String(word.text ?? "").replace(/\uFFFD/g, "").trim();
      if (!wordText) continue;
      if (wordEnd <= wordStart) {
        pending = { start: pending?.start ?? wordStart, text: (pending?.text ?? "") + wordText };
        continue;
      }
      words.push({ start: pending?.start ?? wordStart, end: wordEnd, text: (pending?.text ?? "") + wordText });
      pending = null;
    }
    if (pending && words.length) words.at(-1).text += pending.text;
    if (words.length && words.every((word) => word.end > word.start)
        && words.map((word) => word.text).join("").replace(/\s/g, "") === text.replace(/\s/g, "")) {
      normalized.words = words;
    }
    const markers = (segment.markers ?? []).flatMap((marker) => {
      const markerStart = Number(marker.start) + offset;
      const markerEnd = Number(marker.end) + offset;
      return Number.isFinite(markerStart) && Number.isFinite(markerEnd) && markerEnd > markerStart
        ? [{
            start: formatNumber(Math.max(normalized.start, markerStart)),
            end: formatNumber(Math.min(normalized.end, markerEnd)),
          }]
        : [];
    }).filter((marker) => marker.end > marker.start);
    if (markers.length) normalized.markers = markers;
    return normalized.end > normalized.start ? [normalized] : [];
  }).sort((left, right) => left.start - right.start);
}

async function attachUnrecognizedSpans(segments, inputPath, range, ffmpeg, options) {
  if (options.unrecognized === false || segments.length === 0) {
    return segments.map(withoutInternalMarkers);
  }
  const minGapSec = numericOption(
    options.unrecognizedMinGap,
    UNRECOGNIZED_DEFAULTS.minGapSec,
    "--unrecognized-min-gap",
  );
  const minVoicedSec = numericOption(
    options.unrecognizedMinVoiced,
    UNRECOGNIZED_DEFAULTS.minVoicedSec,
    "--unrecognized-min-voiced",
  );
  const silenceDb = numericOption(options.silenceDb, UNRECOGNIZED_DEFAULTS.silenceDb, "silenceDb", false);
  const silenceMinSec = numericOption(
    options.silenceMinSec,
    UNRECOGNIZED_DEFAULTS.silenceMinSec,
    "silenceMinSec",
  );
  const runner = options.silencesRunner ?? runSilenceDetect;
  const detected = await runner({ inputPath, range, ffmpeg, silenceDb, silenceMinSec, options });
  const silences = Array.isArray(detected) ? detected : detected?.silences ?? [];
  return segments.map((segment) => {
    const unrecognized = detectUnrecognizedSpans(segment, silences, { minGapSec, minVoicedSec });
    const clean = withoutInternalMarkers(segment);
    return unrecognized.length ? { ...clean, unrecognized } : clean;
  });
}

export function runSilenceDetect({ inputPath, range, ffmpeg, silenceDb, silenceMinSec, options }) {
  const result = runChecked(ffmpeg, [
    "-hide_banner", "-nostdin",
    "-ss", String(range.in), "-to", String(range.out), "-i", inputPath,
    "-af", `silencedetect=noise=${silenceDb}dB:d=${silenceMinSec}`,
    "-f", "null", "-",
  ], options);
  const duration = range.out - range.in;
  return parseSilences(result.stderr, duration).map((silence) => ({
    start: formatNumber(silence.start + range.in),
    end: formatNumber(silence.end + range.in),
  }));
}

function withoutInternalMarkers(segment) {
  const { markers: _markers, ...clean } = segment;
  return clean;
}

function numericOption(value, fallback, label, positive = true) {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved) || (positive ? resolved <= 0 : false)) {
    throw new Error(`${label} は${positive ? " 0 より大きい" : ""}数値で指定してください`);
  }
  return resolved;
}

async function recordTranscribe(target, result, range, backend, lang, noRecord, rawResult, started) {
  if (!noRecord) await recordEngineTranscript(target, {
    backend,
    generated_at: result.generated_at,
    source: { path: target.displayPath, range: result.range },
    elapsed_sec: formatNumber((performance.now() - started) / 1000),
    cost_usd: backend.startsWith("cloud:") ? rawResult.cost_usd ?? null : null,
    segments: rawResult.segments,
  });
  await recordObservation({
    target,
    kind: "transcribe",
    result,
    range,
    args: { backend, lang },
    outputs: [],
    noRecord,
  });
}

function safeCacheName(value) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

function cacheIdentity({ sha256, range, backend, lang, cacheDirectory }) {
  const key = `${sha256}-${formatNumber(range.in)}-${formatNumber(range.out)}-${backend}-${lang}`;
  return { key, cachePath: path.join(cacheDirectory, `${safeCacheName(key)}.json`) };
}
