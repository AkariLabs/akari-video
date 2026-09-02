import { accessSync, constants, existsSync, readFileSync, readdirSync } from "node:fs";
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
import { recordObservation } from "./record.mjs";
import {
  classifyWhisperMarker,
  detectUnrecognizedSpans,
  UNRECOGNIZED_DEFAULTS,
} from "./unrecognized-spans.mjs";
import { parseSilences } from "./waveform.mjs";
import {
  applyWordBook,
  buildMatcher,
  resolveWordBook,
} from "../../../word-book/src/index.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDirectory, "../../../..");
const speechAnalyzerScript = path.join(repoRoot, "skills", "analyze-footage", "bin", "transcribe-sa.mjs");
const cloudScript = path.join(repoRoot, "skills", "analyze-footage", "bin", "transcribe-cloud.mjs");

export async function transcribeMedia(targetArgument, options = {}) {
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
    await recordTranscribe(target, { ...result, generated_at: generatedAt(options) }, options.in === undefined && options.out === undefined ? undefined : range, backend, lang, options.noRecord);
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
      process.stderr.write(`SpeechAnalyzer が失敗したため whisper.cpp へフォールバックします: ${error instanceof Error ? error.message : String(error)}\n`);
      backendInfo = { name: "whisper-cpp", ...fallback };
      backend = backendInfo.name;
      ({ key, cachePath } = cacheIdentity({ sha256, range, backend, lang, cacheDirectory }));
      if (existsSync(cachePath)) {
        const cached = JSON.parse(await readFile(cachePath, "utf8"));
        const rawResult = { ...cached, cache: { hit: true, key } };
        const result = await applyResolvedWordBook(rawResult, target, options);
        await recordTranscribe(target, { ...result, generated_at: generatedAt(options) }, options.in === undefined && options.out === undefined ? undefined : range, backend, lang, options.noRecord);
        return result;
      }
      segments = options.backendRunner
        ? await options.backendRunner({ backend, inputPath: target.inputPath, range, lang, target })
        : await runBackend({ backendInfo, ffmpeg, target, range, lang, options });
    }
  }
  segments = normalizeSegments(segments, range);
  segments = await attachUnrecognizedSpans(segments, target.inputPath, range, ffmpeg, options);
  const rawResult = {
    path: target.displayPath,
    range,
    backend,
    no_speech: segments.length === 0,
    segments,
    cache: { hit: false, key },
    generated_at: generatedAt(options),
  };
  await writeFile(cachePath, `${JSON.stringify(rawResult, null, 2)}\n`, "utf8");
  const result = await applyResolvedWordBook(rawResult, target, options);
  await recordTranscribe(target, result, options.in === undefined && options.out === undefined ? undefined : range, backend, lang, options.noRecord);
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
    if (!speechAnalyzerAvailable(options)) throw new Error("SpeechAnalyzer を利用できません");
    return { name: requested };
  }
  if (requested === "whisper-cpp") {
    const whisper = resolveWhisper(options);
    if (!whisper) throw new Error("whisper.cpp の実行ファイルまたはモデルが見つかりません");
    return { name: requested, ...whisper };
  }
  if (speechAnalyzerAvailable(options)) return { name: "speech-analyzer" };
  const whisper = resolveWhisper(options);
  if (whisper) return { name: "whisper-cpp", ...whisper };
  throw new Error("利用できるローカル文字起こし backend がありません（SpeechAnalyzer / whisper.cpp）");
}

function speechAnalyzerAvailable(options) {
  if (typeof options.speechAnalyzerAvailable === "boolean") return options.speechAnalyzerAvailable;
  if (!existsSync(speechAnalyzerScript)) return false;
  try {
    const result = runChecked(process.execPath, [speechAnalyzerScript, "--check"], options);
    return JSON.parse(result.stdout).available === true;
  } catch {
    return false;
  }
}

function resolveWhisper(options) {
  if (options.whisperAvailable === false) return null;
  if (options.whisperBin && options.whisperModel) return { bin: options.whisperBin, model: options.whisperModel };
  const binCandidates = [
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
  const modelCandidates = [
    process.env.WHISPER_CPP_MODEL,
    ...findModels(path.join(os.homedir(), ".akari", "tools", "models")),
    ...findModels(path.join(repoRoot, "models")),
    ...findModels(path.join(repoRoot, "whisper.cpp", "models")),
    ...findModels(path.join(os.homedir(), ".cache", "whisper.cpp")),
    ...findModels(path.join(os.homedir(), "Library", "Caches", "whisper.cpp")),
    ...findModels(path.resolve(path.dirname(bin), "..", "share", "whisper-cpp")),
    ...findModels("/opt/homebrew/share/whisper-cpp"),
    ...findModels("/usr/local/share/whisper-cpp"),
    ...findModels(path.join(os.homedir(), "Library", "Application Support", "com.prakashjoshipax.VoiceInk", "WhisperModels")),
  ].filter(Boolean);
  const model = modelCandidates.find((candidate) => existsSync(candidate) && !path.basename(candidate).startsWith("for-tests-") && !path.basename(candidate).includes(".en."));
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

function findModels(root) {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { recursive: true })
      .map((entry) => path.join(root, String(entry)))
      .filter((entry) => /^ggml-.*\.bin$/i.test(path.basename(entry)));
  } catch {
    return [];
  }
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
  if (!existsSync(cloudScript)) throw new Error("クラウド文字起こし実装が見つかりません");
  const provider = /groq/i.test(connectionId) ? "groq" : "scribe";
  const result = runChecked(process.execPath, [
    cloudScript, "--send", "--provider", provider, "--input", wavPath,
    "--duration", String(range.out - range.in), "--project-root", projectRoot, "--approved",
  ], options);
  const value = JSON.parse(result.stdout);
  return value.segments ?? value.transcript ?? [];
}

export function normalizeWhisperJson(value) {
  const source = value.transcription ?? value.segments ?? [];
  return source.map((segment) => {
    const start = Number(segment.offsets?.from ?? segment.start) / (segment.offsets ? 1000 : 1);
    const end = Number(segment.offsets?.to ?? segment.end) / (segment.offsets ? 1000 : 1);
    const markers = [];
    const words = (segment.tokens ?? segment.words ?? []).flatMap((token) => {
      const wordStart = Number(token.offsets?.from ?? token.start) / (token.offsets ? 1000 : 1);
      const wordEnd = Number(token.offsets?.to ?? token.end) / (token.offsets ? 1000 : 1);
      const markerKind = classifyWhisperMarker(token.text);
      if (markerKind === "non-speech" && wordEnd > wordStart) {
        markers.push({ start: wordStart, end: wordEnd });
        return [];
      }
      if (markerKind === "control") return [];
      const text = String(token.text ?? "").replace(/\uFFFD/g, "").trim();
      return text && wordEnd > wordStart ? [{ start: wordStart, end: wordEnd, text }] : [];
    });
    return {
      start,
      end,
      text: String(segment.text ?? "").replace(/\uFFFD/g, "").trim(),
      ...(words.length ? { words } : {}),
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
    const words = (segment.words ?? []).flatMap((word) => {
      const wordStart = Number(word.start) + offset;
      const wordEnd = Number(word.end) + offset;
      const wordText = String(word.text ?? "").replace(/\uFFFD/g, "").trim();
      return wordText && wordEnd > wordStart
        ? [{ start: formatNumber(Math.max(normalized.start, wordStart)), end: formatNumber(Math.min(normalized.end, wordEnd)), text: wordText }]
        : [];
    }).filter((word) => word.end > word.start);
    if (words.length) normalized.words = words;
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

function runSilenceDetect({ inputPath, range, ffmpeg, silenceDb, silenceMinSec, options }) {
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

async function recordTranscribe(target, result, range, backend, lang, noRecord) {
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
