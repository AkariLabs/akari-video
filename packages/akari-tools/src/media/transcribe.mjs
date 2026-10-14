import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readContentLanguage } from "../../../content-language/src/node.mjs";
import { normalizeLanguage } from "../../../content-language/src/index.mjs";
import { isMainModule } from "../common/main-module.mjs";
import { toolsText, toolsLanguage } from '../i18n.mjs';

import {
  formatNumber,
  generatedAt,
  probeRaw,
  resolveTarget,
  resolveTools,
  runChecked,
  sha256File,
} from "./common.mjs";
import { analysisPathForTarget, recordEngineTranscript, recordObservation, updateAnalysisTranscript } from "./record.mjs";
import {
  classifyWhisperMarker,
  detectUnrecognizedSpans,
  UNRECOGNIZED_ALGO_VERSION,
  UNRECOGNIZED_DEFAULTS,
} from "./unrecognized-spans.mjs";
import { whisperModelCandidates, whisperModelLocations, isWhisperModelExcluded } from "./whisper-model-candidates.mjs";
import { parseSilences } from "./waveform.mjs";
import {
  detectLanguageGaps,
  insertRecoveredSegments,
  LANGUAGE_GAP_MAX_RETRIES,
  LANGUAGE_GAP_MIN_DETECT_PROBABILITY,
  LANGUAGE_GAP_PADDING_SECONDS,
} from "./language-gaps.mjs";
import {
  clampAdjacentSegments,
  detectSpeechChunks,
  snapSegmentsToWords,
  snapWordsToSpeech,
  SPEECH_SNAP_DEFAULTS,
} from "./speech-align.mjs";
import {
  applyWordBook,
  buildMatcher,
  resolveWordBook,
} from "../../../word-book/src/index.mjs";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDirectory, "../../../..");
const speechAnalyzerRequirements = (language) => toolsText('tools.transcribe.error.speechRequirements', {}, language);
const SPEECH_LOCALES = Object.freeze({ en: "en-US", ja: "ja-JP", de: "de-DE", es: "es-ES", fr: "fr-FR", it: "it-IT", pt: "pt-BR", ko: "ko-KR", yue: "yue-CN", zh: "zh-CN" });
const languageNames = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });
const knownLanguage = (tag) => {
  const code = normalizeLanguage(tag);
  return code && languageNames.of(code) ? code : null;
};
export const speechLocaleForLanguage = (lang) => SPEECH_LOCALES[normalizeLanguage(lang)] ?? null;
export const WHISPER_FILLER_PROMPT = "Um, uh, erm, uhm, hmm, like, you know, I mean, sort of, kind of.";

async function transcribeLanguageSelection(projectRoot, explicitLang) {
  if (explicitLang !== undefined && explicitLang !== "auto") {
    return { language: normalizeLanguage(explicitLang) ?? explicitLang, retryLanguageGaps: false };
  }
  if (!projectRoot) return { language: "auto", retryLanguageGaps: true };
  const resolved = await readContentLanguage(projectRoot);
  if (resolved.source === "intake") {
    return { language: resolved.language, retryLanguageGaps: true };
  }
  return { language: "auto", retryLanguageGaps: true };
}

export async function resolveTranscribeLanguage(projectRoot, explicitLang) {
  return (await transcribeLanguageSelection(projectRoot, explicitLang)).language;
}

function transcriptLanguage(lang, backend) {
  if (backend === "speech-analyzer") return speechLocaleForLanguage(lang) ?? (lang === "auto" ? "ja-JP" : lang);
  return lang === "auto" ? "und" : normalizeLanguage(lang) ?? lang;
}

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
  return toolsText('tools.transcribe.error.scriptMissing', { label, paths: analyzeFootageScriptCandidates(name, options).join(" / ") }, options.uiLanguage);
}

function writeBackendLog(options, message) {
  (options.logger ?? options.stderr ?? console.error)(String(message).replace(/[\r\n]+/g, " "));
}

export async function transcribeMedia(targetArgument, options = {}) {
  const started = performance.now();
  const target = resolveTarget(targetArgument, options);
  const { ffmpeg, ffprobe } = resolveTools(options);
  const { value, duration } = probeRaw(target.inputPath, ffprobe, options);
  const range = normalizeRange(options.in, options.out, duration, options.uiLanguage);
  const { language: lang, retryLanguageGaps } = await transcribeLanguageSelection(target.projectRoot, options.lang);
  const sha256 = await sha256File(target.inputPath);
  // 配布版に声のエンジンがまだ無い場合も、通常の文字起こしは読み込めるようにする。
  const voice = options.diarize || options.identify || options.people || options.speakers !== undefined
    ? await prepareVoice(options) : null;
  const asrResult = await transcribeAsr({ target, ffmpeg, value, range, lang, retryLanguageGaps, sha256, options });
  const silenceDetection = await detectTranscribeSilences(asrResult.segments, target.inputPath, range, ffmpeg, options);
  // 未認識は ASR cache と独立した派生値。hit / miss とも現在の設定で付与する。
  const withUnrecognized = {
    ...asrResult,
    segments: await attachUnrecognizedSpans(asrResult.segments, target.inputPath, range, ffmpeg, options, silenceDetection),
  };
  const rawResult = applyTimingSnap(withUnrecognized, silenceDetection, range, options);
  const result = await applyResolvedWordBook(rawResult, target, options);
  const recordedResult = result.cache.hit ? { ...result, generated_at: generatedAt(options) } : result;
  await recordTranscribe(target, recordedResult, options.in === undefined && options.out === undefined ? undefined : range, result.backend, lang, options.noRecord, rawResult, started);
  if (!voice) return result;
  return attachVoice(result, { target, range, sha256, ffmpeg, options, voice });
}

async function prepareVoice(options) {
  const voice = await import("../../../akari-voice/src/index.mjs");
  const status = options.voiceEngine?.status ?? voice.voiceEngineStatus({ home: voice.resolveVoiceHome({ env: options.env ?? process.env }) });
  if ((typeof status === "string" ? status : status?.status) !== "ready") {
    throw Object.assign(new Error(voice.VOICE_MISSING_MESSAGE), { exitCode: 2 });
  }
  if (options.voiceEngine) return { api: voice, engine: options.voiceEngine,
    canIdentify: (typeof status === "string" ? options.voiceEngine.canIdentify : status.canIdentify) !== false,
    version: options.voiceEngine.version ?? voice.VOICE_ENGINE_VERSION };
  const runtime = voice.loadVoiceRuntime(status);
  const embeddingModel = path.join(status.modelsDir, "wespeaker_en_voxceleb_resnet34_LM.onnx");
  const diarizers = new Map();
  const embedder = status.canIdentify ? await voice.createEmbedder(runtime, embeddingModel) : null;
  return {
    api: voice,
    canIdentify: status.canIdentify,
    version: voice.voiceEngineVersion(status.manifest),
    engine: {
      diarize(samples, { numClusters, threshold }) {
        if (!diarizers.has(numClusters)) diarizers.set(numClusters, voice.createDiarizer(runtime, {
          segmentationModel: path.join(status.modelsDir, "pyannote-segmentation-3.0.onnx"),
          embeddingModel, numClusters, threshold,
        }));
        return diarizers.get(numClusters).process(samples);
      },
      embed: (samples, mean) => embedder?.embed(samples, mean),
    },
  };
}

function voiceLog(options, message) {
  (options.stderr ?? ((line) => process.stderr.write(`${line}\n`)))(message.replace(/[\r\n]+/g, " "));
}

async function attachVoice(result, { target, range, sha256, ffmpeg, options, voice }) {
  const started = performance.now();
  const { api, engine, canIdentify } = voice;
  const speakers = options.speakers ?? "auto";
  const cacheDirectory = target.projectRoot
    ? path.join(target.projectRoot, ".akari", "cache", "diarize")
    : path.join(os.tmpdir(), "akari-diarize-cache");
  const fixedCount = api.clusterCountFor(speakers);
  const key = createHash("sha256").update(JSON.stringify([sha256, range.in, range.out, speakers, voice.version,
    ...([2, 3].includes(fixedCount) ? ["count-v4"] : [])])).digest("hex");
  const cachePath = path.join(cacheDirectory, `${key}.json`);
  const decode = options.voiceDecode ?? ((file, start, duration) => api.decodeAudio16k({ ffmpeg, file, start, duration }));
  const readStarted = performance.now();
  const samples = await decode(target.inputPath, range.in, range.out - range.in);
  const readSeconds = (performance.now() - readStarted) / 1000;
  let turns;
  let countResult;
  if (existsSync(cachePath)) {
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    turns = cached.turns;
    countResult = cached.countResult ?? { requested: speakers === "auto" ? "auto" : Number(speakers), fallback: false };
  }
  else {
    countResult = await api.diarizeToCount(engine.diarize.bind(engine), samples, speakers, api.DIARIZE_THRESHOLD);
    turns = api.relabelTurns(countResult.turns).map(turn => ({ ...turn, start: formatNumber(turn.start + range.in), end: formatNumber(turn.end + range.in) }));
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(cachePath, `${JSON.stringify({ turns, countResult: {
      requested: countResult.requested, used: countResult.used, fallback: countResult.fallback,
    } }, null, 2)}\n`, "utf8");
  }
  if (countResult?.fallback) voiceLog(options, api.diarizeCountFallbackMessage(countResult.requested, countResult.used));
  let embeddings = {};
  if (!canIdentify && (options.identify || options.people)) voiceLog(options, api.VOICE_IDENTIFY_UNAVAILABLE_MESSAGE);
  if (canIdentify) try {
    embeddings = await api.embedSpeakers({ embedder: { embed: (audio, mean) => engine.embed(audio, mean) }, samples, turns, offsetSeconds: range.in });
  } catch (error) {
    voiceLog(options, toolsText('tools.transcribe.voice.embeddingError', { message: error.message }));
  }
  let identify;
  if (options.identify && canIdentify) {
    const located = options.people
      ? { peoplePath: path.resolve(options.cwd ?? process.cwd(), options.people), channel: path.basename(path.dirname(path.resolve(options.cwd ?? process.cwd(), options.people))) }
      : api.channelPeopleForProject(target.projectRoot ?? "");
    if (!located || !existsSync(located.peoplePath)) voiceLog(options, toolsText('tools.transcribe.voice.peopleMissing'));
    else {
      const found = await api.loadCentroids({
        ...located, embedder: { embed: (audio, mean) => engine.embed(audio, mean) },
        decode: (file) => decode(file),
      });
      for (const warning of found.warnings) voiceLog(options, toolsText('tools.transcribe.voice.identificationWarning', { message: warning }));
      if (!found.centroids.length) {
        voiceLog(options, toolsText('tools.transcribe.voice.noSamples'));
        identify = { compared: [], suggestions: {} };
      } else {
        let suggestions = Object.fromEntries(Object.entries(embeddings).map(([id, vector]) => [id, api.suggestFor(vector, found.centroids) ?? { score: 0, level: "none" }]));
        if (speakers === "auto" || speakers === 4 || speakers === "4") {
          const mapping = api.bundleBySuggestion(suggestions);
          if (Object.keys(mapping).length) {
            turns = api.mergeSpeakers(turns, mapping);
            try {
              embeddings = await api.embedSpeakers({ embedder: { embed: (audio, mean) => engine.embed(audio, mean) }, samples, turns, offsetSeconds: range.in });
              suggestions = Object.fromEntries(Object.entries(embeddings).map(([id, vector]) => [id, api.suggestFor(vector, found.centroids) ?? { score: 0, level: "none" }]));
            } catch (error) { voiceLog(options, toolsText('tools.transcribe.voice.embeddingError', { message: error.message })); embeddings = {}; suggestions = {}; }
          }
        }
        identify = { compared: found.compared, suggestions };
      }
    }
  }
  const seconds = api.speakerSeconds(turns);
  const ids = Object.keys(seconds);
  const shortSpeakers = api.shortSpeakerIds(turns);
  const speakerInfo = { requested: countResult.requested, fallback: countResult.fallback,
    count: ids.length, ids, seconds, ...(shortSpeakers.length ? { shortSpeakers } : {}) };
  if (target.projectRoot && target.projectRelative) {
    const file = api.voicesPathFor(target.projectRoot, target.projectRelative);
    const entries = Object.fromEntries(ids.filter(id => embeddings[id]?.length === 256).map(id => [id, {
      seconds: seconds[id], embedding: embeddings[id], suggestion: identify?.suggestions[id],
    }]));
    api.writeVoicesFile(file, api.buildVoicesFile({ previous: api.readVoicesFile(file), speakers: entries,
      requested: countResult.requested, fallback: countResult.fallback, shortSpeakers }));
    if (!options.noRecord) await updateAnalysisTranscript(target, (before, analysis) => {
      analysis.tracks ??= { speakers: [], faces: [], person_matte: null };
      const oldTracks = Array.isArray(analysis.tracks.speakers) ? analysis.tracks.speakers : [];
      const outside = oldTracks.flatMap(track => track.spans.flatMap(([start, end]) => {
        const spans = [];
        if (start < range.in) spans.push([start, Math.min(end, range.in)]);
        if (end > range.out) spans.push([Math.max(start, range.out), end]);
        return spans.filter(([from, to]) => to > from).map(span => ({ id: track.id, span }));
      }));
      const combined = new Map();
      for (const { id, span } of outside) {
        if (!combined.has(id)) combined.set(id, []);
        combined.get(id).push(span);
      }
      for (const track of api.speakerTracks(turns)) {
        if (!combined.has(track.id)) combined.set(track.id, []);
        combined.get(track.id).push(...track.spans);
      }
      analysis.tracks.speakers = [...combined].map(([id, spans]) => ({ id, spans: spans.sort((a, b) => a[0] - b[0]) }));
      return before.map(segment => segment.start >= range.in && segment.end <= range.out
        ? api.assignSpeakers([segment], turns)[0] : segment);
    });
  }
  voiceLog(options, toolsText('tools.transcribe.voice.separationComplete', {
    count: ids.length, seconds: ((performance.now() - started) / 1000).toFixed(1), readSeconds: readSeconds.toFixed(1),
  }));
  return { ...result, segments: api.assignSpeakers(result.segments, turns), speakers: {
    ...speakerInfo,
    ...(identify ? { identify } : {}),
  } };
}

// ASR 層は normalizeSegments 直後の結果を保存し、markers を含む根拠を保持する。
async function transcribeAsr({ target, ffmpeg, value, range, lang, retryLanguageGaps, sha256, options }) {
  let backendInfo = await selectBackend(options.backend, target, { ...options, lang });
  let backend = backendInfo.name;
  const cacheDirectory = target.projectRoot
    ? path.join(target.projectRoot, ".akari", "cache", "transcribe")
    : path.join(os.tmpdir(), "akari-transcribe-cache");
  await mkdir(cacheDirectory, { recursive: true });
  let { key, cachePath } = cacheIdentity({ sha256, range, backend, lang, retryLanguageGaps, cacheDirectory, whisperPrompt: options.whisperPrompt });

  if (existsSync(cachePath)) {
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    return { ...cached, cache: { hit: true, key } };
  }

  let segments = [];
  if (value.streams?.some((stream) => stream.codec_type === "audio")) {
    try {
      segments = options.backendRunner
        ? await options.backendRunner({ backend, inputPath: target.inputPath, range, lang, target })
        : await runBackend({ backendInfo, ffmpeg, target, range, lang, retryLanguageGaps, options });
    } catch (error) {
      const unsupportedLocale = /Unsupported SpeechTranscriber locale/.test(error instanceof Error ? error.message : String(error));
      const fallback = backend === "speech-analyzer" && (options.backend === undefined || unsupportedLocale)
        ? resolveWhisper({ ...options, lang }) : null;
      if (backend === "speech-analyzer" && !fallback && (options.backend === undefined || unsupportedLocale)) throw whisperUnavailableError(error, { lang, unsupportedLocale, options });
      if (!fallback) throw error;
      writeBackendLog(options, toolsText('tools.transcribe.warning.speechFallback', { message: error instanceof Error ? error.message : String(error) }, options.uiLanguage));
      backendInfo = { name: "whisper-cpp", ...fallback };
      backend = backendInfo.name;
      ({ key, cachePath } = cacheIdentity({ sha256, range, backend, lang, retryLanguageGaps, cacheDirectory, whisperPrompt: options.whisperPrompt }));
      if (existsSync(cachePath)) {
        const cached = JSON.parse(await readFile(cachePath, "utf8"));
        return { ...cached, cache: { hit: true, key } };
      }
      segments = options.backendRunner
        ? await options.backendRunner({ backend, inputPath: target.inputPath, range, lang, target })
        : await runBackend({ backendInfo, ffmpeg, target, range, lang, retryLanguageGaps, options });
    }
  }
  const backendOutput = segments;
  const costUsd = backend.startsWith("cloud:") ? backendOutput?.cost_estimate_usd ?? null : null;
  segments = normalizeSegments(Array.isArray(backendOutput) ? backendOutput : backendOutput?.segments, range);
  const rawResult = {
    path: target.displayPath,
    range,
    backend,
    no_speech: segments.length === 0,
    ...(backend.startsWith("cloud:") ? { cost_usd: costUsd } : {}),
    ...(backend === "whisper-cpp" ? { dtw: backendOutput?.dtw === true } : {}),
    segments,
    cache: { hit: false, key },
    generated_at: generatedAt(options),
  };
  await writeFile(cachePath, `${JSON.stringify(rawResult, null, 2)}\n`, "utf8");
  return rawResult;
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
    writeWordBookLog(options, toolsText('tools.transcribe.warning.wordBookLoad', { scope: layer.scope, message: layer.error.message }, options.uiLanguage));
  }
  const applied = applyWordBook(result.segments, buildMatcher(resolved.entries), { mode: "transcript" });
  if (applied.stats.replaced > 0) {
    writeWordBookLog(options, toolsText('tools.transcribe.notice.wordBookReplaced', { count: applied.stats.replaced, n: applied.stats.replaced, layers: resolved.layers.map((layer) => layer.scope).join(", ") }, options.uiLanguage));
  }
  return { ...result, segments: applied.records };
}

function writeWordBookLog(options, message) {
  if (typeof options.stderr === "function") options.stderr(message);
  else process.stderr.write(`${message}\n`);
}

function normalizeRange(input, output, duration, language) {
  const range = { in: input ?? 0, out: output ?? duration };
  if (!Number.isFinite(range.in) || !Number.isFinite(range.out) || range.in < 0 || range.out > duration || range.out <= range.in) {
    throw new Error(toolsText('tools.transcribe.error.invalidRange', { duration, n: duration }, language));
  }
  return { in: formatNumber(range.in), out: formatNumber(range.out) };
}

async function selectBackend(requested, target, options) {
  if (requested?.startsWith("cloud:")) return validateCloudBackend(requested, target);
  if (requested && !["speech-analyzer", "whisper-cpp"].includes(requested)) {
    throw new Error(toolsText('tools.transcribe.error.unsupportedBackend', { backend: requested }, options.uiLanguage));
  }
  if (requested === "speech-analyzer") {
    if (options.lang !== "auto" && normalizeLanguage(options.lang) && !speechLocaleForLanguage(options.lang)) {
      const whisper = resolveWhisper(options);
      if (!whisper) throw whisperUnavailableError(null, { lang: options.lang, unsupportedLocale: true, options });
      return { name: "whisper-cpp", ...whisper };
    }
    const availability = speechAnalyzerAvailability(options);
    if (!availability.available) throw new Error(availability.message);
    return { name: requested };
  }
  if (requested === "whisper-cpp") {
    const whisper = resolveWhisper(options);
    if (!whisper) throw new Error(`${toolsText('tools.transcribe.error.whisperMissing', {}, options.uiLanguage)}\n${whisperHint(options)}`);
    return { name: requested, ...whisper };
  }
  const availability = speechAnalyzerAvailability(options);
  if (availability.available && (options.lang === "auto" || !normalizeLanguage(options.lang) || speechLocaleForLanguage(options.lang))) return { name: "speech-analyzer" };
  const whisper = resolveWhisper(options);
  if (whisper) {
    writeBackendLog(options, toolsText('tools.transcribe.warning.speechUnavailable', { reason: availability.reason }, options.uiLanguage));
    return { name: "whisper-cpp", ...whisper };
  }
  if (options.lang !== "auto" && normalizeLanguage(options.lang) && !speechLocaleForLanguage(options.lang)) throw whisperUnavailableError(null, { lang: options.lang, unsupportedLocale: true, options });
  throw new Error(`${toolsText('tools.transcribe.error.noLocalBackend', {}, options.uiLanguage)}\n${whisperHint(options)}`);
}

export function speechAnalyzerAvailable(options = {}) {
  return speechAnalyzerAvailability(options).available;
}

function speechAnalyzerAvailability(options) {
  if (typeof options.speechAnalyzerAvailable === "boolean") {
    return { available: options.speechAnalyzerAvailable, reason: speechAnalyzerRequirements(options.uiLanguage), message: speechAnalyzerRequirements(options.uiLanguage) };
  }
  const speechAnalyzerScript = resolveAnalyzeFootageScript("transcribe-sa.mjs", options);
  if (!speechAnalyzerScript) {
    return {
      available: false,
      reason: toolsText('tools.transcribe.error.speechScriptMissing', { paths: analyzeFootageScriptCandidates("transcribe-sa.mjs", options).join(" / ") }, options.uiLanguage),
      message: missingScriptMessage(toolsText('tools.transcribe.label.speechAnalyzer', {}, options.uiLanguage), "transcribe-sa.mjs", options),
    };
  }
  try {
    const result = runChecked(process.execPath, [speechAnalyzerScript, "--check"], options);
    const value = JSON.parse(result.stdout);
    const detail = String(value.reason ?? speechAnalyzerRequirements(options.uiLanguage));
    const localizedDetail = options.uiLanguage === 'ja' || (options.uiLanguage === undefined && toolsLanguage() === 'ja') ? detail
      : /macOS.*26 未満/.test(detail) ? toolsText('tools.transcribe.error.macOsDetail', { version: detail.match(/macOS\s+([\d.]+)/)?.[1] ?? '?' })
      : /swiftc.*(?:ありません|無い)/.test(detail) ? toolsText('tools.transcribe.error.swiftcDetail') : detail;
    const reason = /macOS.*26 未満/.test(detail) ? toolsText('tools.transcribe.error.macOsBelow', { detail: localizedDetail }, options.uiLanguage)
      : /swiftc.*(?:ありません|無い)/.test(detail) ? toolsText('tools.transcribe.error.swiftcMissing', { detail: localizedDetail }, options.uiLanguage) : localizedDetail;
    return { available: value.available === true, reason, message: speechAnalyzerRequirements(options.uiLanguage) };
  } catch (error) {
    const message = toolsText('tools.transcribe.error.speechCheckFailed', { message: error instanceof Error ? error.message : String(error) }, options.uiLanguage);
    return { available: false, reason: message, message };
  }
}

export function resolveWhisper(options = {}) {
  if (options.whisperAvailable === false) return null;
  if (options.whisperBin && options.whisperModel) return { bin: options.whisperBin, model: options.whisperModel };
  const bin = findWhisperBin();
  if (!bin) return null;
  const modelCandidates = whisperModelCandidates({ env: process.env, homeDir: os.homedir(), repoRoot, bin });
  const model = modelCandidates.find((candidate) => existsSync(candidate) && !isWhisperModelExcluded(candidate, options.lang));
  return model ? { bin, model } : null;
}

function findWhisperBin() {
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
  return binCandidates.find(executableFile) ?? null;
}

// SpeechAnalyzer が失敗し whisper.cpp にも逃げられないとき、元の理由を残したまま次の一手を示す。
// 元のエラー（helper の JSON など）は末尾の 1 行にそのまま入れ、cause にも付ける。
function whisperUnavailableError(error, { lang, unsupportedLocale, options }) {
  const language = options.uiLanguage;
  const head = toolsText(unsupportedLocale ? 'tools.transcribe.error.whisperFallback.localeUnsupported' : 'tools.transcribe.error.whisperFallback.speechFailed', { lang }, language);
  const reason = error ? toolsText('tools.transcribe.error.whisperFallback.reason', { reason: error instanceof Error ? error.message : String(error) }, language) : null;
  const message = [head, whisperHint(options), reason].filter(Boolean).join("\n");
  return Object.assign(new Error(message, error ? { cause: error } : undefined), { code: "WHISPER_UNAVAILABLE" });
}

// whisper.cpp が使えない理由（実行ファイルなし / モデルなし）と、探した場所・直し方。
function whisperHint(options) {
  const binMissing = options.whisperAvailable !== false && !findWhisperBin();
  const locations = whisperModelLocations({ env: process.env, homeDir: os.homedir(), repoRoot, bin: "" })
    .map((location) => `  ${location.path}`).join("\n");
  return toolsText(binMissing ? 'tools.transcribe.error.whisperFallback.noBin' : 'tools.transcribe.error.whisperFallback.noModel', { locations }, options.uiLanguage);
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
  if (!target.projectRoot) throw new Error(toolsText('tools.transcribe.error.cloudProjectRequired', {}, options.uiLanguage));
  const id = requested.slice("cloud:".length);
  const connectionsPath = path.join(target.projectRoot, ".akari", "connections.json");
  if (!existsSync(connectionsPath)) throw new Error(toolsText('tools.transcribe.error.connectionsMissing', {}, options.uiLanguage));
  const connections = JSON.parse(readFileSync(connectionsPath, "utf8"));
  const provider = connections.providers?.find((item) => item.id === id);
  if (!provider || provider.doctor?.status !== "ok") throw new Error(toolsText('tools.transcribe.error.connectionUnhealthy', { id }, options.uiLanguage));
  return { name: requested, connectionId: id };
}

async function runBackend({ backendInfo, ffmpeg, target, range, lang, retryLanguageGaps, options }) {
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
    if (backendInfo.name === "speech-analyzer") return await runSpeechAnalyzer(inputPath, temporaryDirectory, lang, options);
    if (backendInfo.name === "whisper-cpp") {
      const first = runWhisper(inputPath, temporaryDirectory, backendInfo, lang, options);
      if (!retryLanguageGaps || !first.language) return first;
      const relativeRange = { in: 0, out: range.out - range.in };
      if (detectLanguageGaps(first.segments, [], relativeRange).length === 0) return first;
      let silences;
      try {
        const runner = options.silencesRunner ?? runSilenceDetect;
        const detected = await runner({ inputPath, range: relativeRange, ffmpeg,
          silenceDb: UNRECOGNIZED_DEFAULTS.silenceDb,
          silenceMinSec: UNRECOGNIZED_DEFAULTS.silenceMinSec, options });
        silences = Array.isArray(detected) ? detected : detected?.silences ?? [];
      } catch (error) {
        writeBackendLog(options, toolsText('tools.transcribe.languageGap.silenceFailed', { message: error instanceof Error ? error.message : String(error) }, options.uiLanguage));
        return first;
      }
      const gaps = detectLanguageGaps(first.segments, silences, relativeRange).slice(0, LANGUAGE_GAP_MAX_RETRIES);
      for (const [index, gap] of gaps.entries()) {
        const cutStart = Math.max(0, gap.start - LANGUAGE_GAP_PADDING_SECONDS);
        const cutEnd = Math.min(relativeRange.out, gap.end + LANGUAGE_GAP_PADDING_SECONDS);
        if (cutStart <= 0 && cutEnd >= relativeRange.out) continue;
        const gapDirectory = path.join(temporaryDirectory, `gap-${index}`);
        const gapPath = path.join(gapDirectory, "input.wav");
        try {
          await mkdir(gapDirectory);
          runChecked(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-y",
            "-ss", String(cutStart), "-i", inputPath, "-t", String(cutEnd - cutStart),
            "-map", "0:a:0", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", gapPath], options);
          const detectedLanguage = detectWhisperLanguage(gapPath, gapDirectory, backendInfo, options);
          const decision = !detectedLanguage ? toolsText('tools.transcribe.languageGap.undetermined', {}, options.uiLanguage)
            : detectedLanguage.language === first.language ? toolsText('tools.transcribe.languageGap.sameLanguage', {}, options.uiLanguage)
            : detectedLanguage.probability < LANGUAGE_GAP_MIN_DETECT_PROBABILITY
              ? toolsText('tools.transcribe.languageGap.lowProbability', { threshold: LANGUAGE_GAP_MIN_DETECT_PROBABILITY.toFixed(2) }, options.uiLanguage)
              : toolsText('tools.transcribe.languageGap.retry', {}, options.uiLanguage);
          const unknown = toolsText('tools.transcribe.languageGap.unknown', {}, options.uiLanguage);
          writeBackendLog(options, toolsText('tools.transcribe.languageGap.detected', {
            index: index + 1, start: gap.start.toFixed(2), end: gap.end.toFixed(2),
            language: detectedLanguage?.language ?? unknown,
            probability: detectedLanguage ? detectedLanguage.probability.toFixed(3) : unknown,
            firstLanguage: first.language, decision,
          }, options.uiLanguage));
          if (!detectedLanguage || detectedLanguage.language === first.language
            || detectedLanguage.probability < LANGUAGE_GAP_MIN_DETECT_PROBABILITY) continue;
          const recovered = runWhisper(gapPath, gapDirectory, backendInfo, "auto", options);
          if (recovered.language && recovered.language !== first.language) {
            first.segments = insertRecoveredSegments(first.segments, recovered.segments, gap, cutStart);
          } else if (recovered.language === first.language) {
            writeBackendLog(options, toolsText('tools.transcribe.languageGap.recoveredSame', {
              index: index + 1, start: gap.start.toFixed(2), end: gap.end.toFixed(2), language: recovered.language,
            }, options.uiLanguage));
          }
        } catch (error) {
          writeBackendLog(options, toolsText('tools.transcribe.languageGap.retryFailed', {
            index: index + 1, message: error instanceof Error ? error.message : String(error),
          }, options.uiLanguage));
        }
      }
      return first;
    }
    if (options.cloudRunner) return await options.cloudRunner({ inputPath, projectRoot: target.projectRoot, connectionId: backendInfo.connectionId, range });
    return runCloud(inputPath, target.projectRoot, backendInfo.connectionId, range, options);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function runSpeechAnalyzer(wavPath, temporaryDirectory, lang, options) {
  const outputPath = path.join(temporaryDirectory, "speech-analyzer-output.json");
  const speechAnalyzerScript = resolveAnalyzeFootageScript("transcribe-sa.mjs", options);
  if (!speechAnalyzerScript) throw new Error(missingScriptMessage(toolsText('tools.transcribe.label.speechAnalyzer', {}, options.uiLanguage), "transcribe-sa.mjs", options));
  const helperDirectory = path.join(os.tmpdir(), "akari-speech-analyzer");
  const moduleCache = path.join(helperDirectory, "clang-module-cache");
  await mkdir(helperDirectory, { recursive: true });
  const result = runChecked(process.execPath, [speechAnalyzerScript, "--input", wavPath, "--helper-bin", path.join(helperDirectory, "speechanalyzer-helper"), "--output", outputPath, "--locale", speechLocaleForLanguage(lang) ?? "ja-JP"], {
    ...options,
    spawnOptions: {
      ...options.spawnOptions,
      env: { ...process.env, ...options.spawnOptions?.env, CLANG_MODULE_CACHE_PATH: moduleCache, SWIFT_MODULECACHE_PATH: moduleCache },
    },
  });
  const value = JSON.parse(await readFile(outputPath, "utf8"));
  if (!value.available) throw new Error(value.reason || toolsText('tools.transcribe.error.speechFailed', {}, options.uiLanguage));
  return { segments: value.segments ?? [], locale: value.locale ?? speechLocaleForLanguage(lang) ?? "ja-JP" };
}

export function whisperDtwPreset(modelPath) {
  const name = path.basename(String(modelPath ?? "")).toLowerCase();
  if (/large-v3-turbo/.test(name)) return "large.v3.turbo";
  if (/large-v3/.test(name)) return "large.v3";
  for (const preset of ["medium", "small", "base", "tiny"]) {
    if (name.includes(preset)) return preset;
  }
  return null;
}

function runWhisper(wavPath, temporaryDirectory, backendInfo, lang, options) {
  const prefix = path.join(temporaryDirectory, "whisper.raw");
  const baseArgs = whisperArguments(backendInfo.model, wavPath, lang, prefix, options);
  const preset = whisperDtwPreset(backendInfo.model);
  let dtw = false;
  if (preset) {
    try {
      runChecked(backendInfo.bin, [...baseArgs, "-dtw", preset], options);
      dtw = true;
    } catch (error) {
      if (!/unknown|invalid/i.test(error instanceof Error ? error.message : String(error))) throw error;
      writeBackendLog(options, toolsText('tools.transcribe.warning.dtwUnsupported', { message: error instanceof Error ? error.message : String(error) }, options.uiLanguage));
      runChecked(backendInfo.bin, baseArgs, options);
    }
  } else {
    runChecked(backendInfo.bin, baseArgs, options);
  }
  const jsonPath = [`${prefix}.json`, prefix].find(existsSync);
  if (!jsonPath) throw new Error(toolsText('tools.transcribe.error.jsonMissing', {}, options.uiLanguage));
  const output = JSON.parse(readFileSync(jsonPath, "utf8"));
  return { segments: normalizeWhisperJson(output, lang), language: output.result?.language, dtw };
}

export function whisperArguments(model, input, lang, output, options = {}) {
  return ["-m", model, "-f", input, "-l", lang, "-oj", "-ojf", "-of", output,
    ...(typeof options.whisperPrompt === 'string' && options.whisperPrompt ? ["--prompt", options.whisperPrompt]
      : lang === "en" && options.whisperPrompt === true ? ["--prompt", WHISPER_FILLER_PROMPT] : [])];
}

function detectWhisperLanguage(wavPath, temporaryDirectory, backendInfo, options) {
  const prefix = path.join(temporaryDirectory, "language-detect");
  const result = runChecked(backendInfo.bin, ["-m", backendInfo.model, "-f", wavPath, "-l", "auto", "-dl", "-oj", "-of", prefix], options);
  const detected = result.stderr?.match(/auto-detected language:\s*([a-z]{2,3})\s*\(p\s*=\s*([0-9.]+)\)/iu);
  if (!detected) return null;
  const probability = Number(detected[2]);
  if (!Number.isFinite(probability)) return null;
  const jsonPath = `${prefix}.json`;
  const jsonLanguage = existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, "utf8")).result?.language : null;
  const language = typeof jsonLanguage === "string" && jsonLanguage ? jsonLanguage : detected[1];
  return { language, probability };
}

function runCloud(wavPath, projectRoot, connectionId, range, options) {
  const cloudScript = resolveAnalyzeFootageScript("transcribe-cloud.mjs", options);
  if (!cloudScript) throw new Error(missingScriptMessage(toolsText('tools.transcribe.label.cloud', {}, options.uiLanguage), "transcribe-cloud.mjs", options));
  const provider = /groq/i.test(connectionId) ? "groq" : "scribe";
  try {
    const result = runChecked(process.execPath, [
      cloudScript, "--send", "--provider", provider, "--input", wavPath,
      "--duration", String(range.out - range.in), "--project-root", projectRoot, "--approved",
    ], options);
    const value = JSON.parse(result.stdout);
    return { segments: value.segments ?? value.transcript ?? [], cost_estimate_usd: value.cost_estimate_usd ?? null };
  } catch (error) {
    throw new Error(toolsText('tools.transcribe.error.cloudFailed', { message: error instanceof Error ? error.message : String(error) }, options.uiLanguage), { cause: error });
  }
}

export function normalizeWhisperJson(value, language = "ja") {
  const requestedLanguage = knownLanguage(language);
  const detectedLanguage = [value.result?.language, value.result?.lang, value.language,
    value.detected_language, value.metadata?.language]
    .map(knownLanguage).find(Boolean);
  const resolvedLanguage = requestedLanguage ?? detectedLanguage ?? "ja";
  const spacedWords = resolvedLanguage !== "ja" && resolvedLanguage !== "zh";
  const source = value.transcription ?? value.segments ?? [];
  return source.map((segment) => {
    const start = Number(segment.offsets?.from ?? segment.start) / (segment.offsets ? 1000 : 1);
    const end = Number(segment.offsets?.to ?? segment.end) / (segment.offsets ? 1000 : 1);
    const markers = [];
    const words = spacedWords ? normalizeSpacedWhisperWords(segment, markers, start, end) : [];
    if (!spacedWords) {
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
      const text = String(token.text ?? "").replace(/\uFFFD/g, "");
      if (!text || !Number.isFinite(wordStart) || !Number.isFinite(wordEnd)) continue;
      if (!text.trim()) {
        pending = { start: pending?.start ?? wordStart, text: (pending?.text ?? "") + text };
        continue;
      }
      if (wordEnd <= wordStart) {
        // 連続する 0 長・負長トークンは、最初の from と文字順を保持する。
        pending = { start: pending?.start ?? wordStart, text: (pending?.text ?? "") + text };
        continue;
      }
      words.push({ start: pending?.start ?? wordStart, end: wordEnd, text: (pending?.text ?? "") + text });
      pending = null;
      }
      if (pending && words.length) words.at(-1).text += pending.text;
    }
    normalizeWordSpaces(words);
    const text = normalizeCjkSpaces(String(segment.text ?? "").replace(/\uFFFD/g, "")).trim();
    const aligned = words.length && words.every((word) => word.end > word.start)
      ? alignWordsToText(words, text) : null;
    return {
      start,
      end,
      text,
      ...(aligned ? { words: aligned } : {}),
      ...(markers.length ? { markers } : {}),
    };
  });
}

function normalizeSpacedWhisperWords(segment, markers, segmentStart, segmentEnd) {
  const words = [];
  for (const token of segment.tokens ?? segment.words ?? []) {
    const start = Number(token.offsets?.from ?? token.start) / (token.offsets ? 1000 : 1);
    const end = Number(token.offsets?.to ?? token.end) / (token.offsets ? 1000 : 1);
    const markerKind = classifyWhisperMarker(token.text);
    if (markerKind === "non-speech") {
      if (end > start) markers.push({ start, end });
      continue;
    }
    if (markerKind === "control") continue;
    const rawText = String(token.text ?? "").replace(/\uFFFD/g, "");
    const text = rawText.trim();
    if (!text || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (/^\s/u.test(rawText) || !words.length) words.push({ start, end: end > start ? end : start, text });
    else {
      const last = words.at(-1);
      last.text += text;
      if (end > start && /[\p{L}\p{N}]/u.test(text)) last.end = Math.max(last.end, end);
    }
  }

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word.end > word.start) continue;
    let next = index + 1;
    while (next < words.length && words[next].start <= word.start && words[next].end <= word.start) next += 1;
    if (next < words.length && words[next].start > word.start) {
      const duration = (words[next].start - word.start) / (next - index);
      for (let at = index; at < next; at += 1) {
        words[at].start = word.start + duration * (at - index);
        words[at].end = word.start + duration * (at - index + 1);
      }
      index = next - 1;
    } else {
      const limit = next < words.length ? words[next].end : segmentEnd;
      if (limit > word.start) {
        const duration = (limit - word.start) / (next - index + (next < words.length ? 1 : 0));
        for (let at = index; at < next + (next < words.length ? 1 : 0); at += 1) {
          words[at].start = word.start + duration * (at - index);
          words[at].end = word.start + duration * (at - index + 1);
        }
        index = next;
      } else if (index > 0 && words[index - 1].end > words[index - 1].start) {
        const previous = words[index - 1];
        const middle = (previous.start + previous.end) / 2;
        previous.end = middle;
        word.start = middle;
        word.end = Math.max(segmentEnd, middle + 0.001);
      } else {
        word.start = Math.min(segmentStart, word.start);
        word.end = Math.max(segmentEnd, word.start + 0.001);
      }
    }
  }
  return words;
}

function normalizeCjkSpaces(value) {
  return value.replace(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu, "$1");
}

function normalizeWordSpaces(words) {
  for (const [index, word] of words.entries()) {
    word.text = normalizeCjkSpaces(word.text);
    if (index === 0) word.text = word.text.trimStart();
    else if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(words[index - 1].text)
      && /^\s+[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(word.text)) {
      word.text = word.text.trimStart();
    }
  }
  if (words.length) words.at(-1).text = words.at(-1).text.trimEnd();
}

function alignWordsToText(words, text) {
  if (words.map((word) => word.text).join("") === text) return words;
  if (words.map((word) => word.text).join("").replace(/\s/gu, "") !== text.replace(/\s/gu, "")) return null;
  let cursor = 0;
  const aligned = [];
  for (const word of words) {
    const surface = word.text.replace(/\s/gu, "");
    if (!surface) return null;
    const position = text.slice(cursor).search(/\S/u) + cursor;
    if (position < cursor) return null;
    let end = position;
    for (const char of surface) {
      while (/\s/u.test(text[end] ?? "")) end += 1;
      if (!text.startsWith(char, end)) return null;
      end += char.length;
    }
    aligned.push({ ...word, text: text.slice(cursor, end) });
    cursor = end;
  }
  if (aligned.length) aligned.at(-1).text += text.slice(cursor);
  return aligned;
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
    if (typeof segment.speaker === "string" && segment.speaker.length > 0) normalized.speaker = segment.speaker;
    const words = [];
    let pending = null;
    const clampWordTime = (time) => formatNumber(Math.max(normalized.start, Math.min(normalized.end, time + offset)));
    for (const word of segment.words ?? []) {
      if (!Number.isFinite(Number(word.start)) || !Number.isFinite(Number(word.end))) continue;
      const wordStart = clampWordTime(Number(word.start));
      const wordEnd = clampWordTime(Number(word.end));
      const wordText = String(word.text ?? "").replace(/\uFFFD/g, "");
      if (!wordText) continue;
      if (!wordText.trim()) {
        pending = { start: pending?.start ?? wordStart, text: (pending?.text ?? "") + wordText };
        continue;
      }
      if (wordEnd <= wordStart) {
        pending = { start: pending?.start ?? wordStart, text: (pending?.text ?? "") + wordText };
        continue;
      }
      words.push({ start: pending?.start ?? wordStart, end: wordEnd, text: (pending?.text ?? "") + wordText });
      pending = null;
    }
    if (pending && words.length) words.at(-1).text += pending.text;
    normalizeWordSpaces(words);
    if (words.length && words.every((word) => word.end > word.start)) {
      const aligned = alignWordsToText(words, text);
      if (aligned) normalized.words = aligned;
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

async function detectTranscribeSilences(segments, inputPath, range, ffmpeg, options) {
  if (!segments.length || (options.unrecognized === false && (options.snap === false || options.timingSnap === false))) return null;
  const silenceDb = numericOption(options.silenceDb, UNRECOGNIZED_DEFAULTS.silenceDb, "silenceDb", false);
  const silenceMinSec = numericOption(options.silenceMinSec, UNRECOGNIZED_DEFAULTS.silenceMinSec, "silenceMinSec");
  const runner = options.silencesRunner ?? runSilenceDetect;
  const detected = await runner({ inputPath, range, ffmpeg, silenceDb, silenceMinSec, options });
  return {
    silences: Array.isArray(detected) ? detected : detected?.silences ?? [],
    silenceDb,
    silenceMinSec,
  };
}

function applyTimingSnap(result, detection, range, options) {
  if (options.snap === false || options.timingSnap === false || !detection) return result;
  const chunks = detectSpeechChunks({ silences: detection.silences, duration: range.out });
  const words = result.segments.flatMap((segment) => segment.words ?? []);
  const snapped = snapWordsToSpeech(words, chunks, options.timingSnapOptions);
  let offset = 0;
  const withWords = result.segments.map((segment) => {
    if (!Array.isArray(segment.words) || !segment.words.length) return { ...segment };
    const next = snapped.words.slice(offset, offset + segment.words.length);
    offset += segment.words.length;
    const moved = next.some((word, index) => word.start !== segment.words[index].start || word.end !== segment.words[index].end);
    if (!moved) return { ...segment, words: next };
    return snapSegmentsToWords([{ ...segment, words: next }], options.timingSnapOptions)[0];
  });
  const clamped = clampAdjacentSegments(withWords, options.timingSnapOptions);
  return {
    ...result,
    segments: clamped.segments,
    timing_snap: {
      method: "silencedetect",
      moved_words: snapped.moved,
      total_words: snapped.total,
      clamped_pairs: clamped.clamped_pairs,
      overlaps_left: clamped.overlaps_left,
      params: {
        silence_db: detection.silenceDb,
        silence_min_sec: detection.silenceMinSec,
        tolerance_sec: options.timingSnapOptions?.toleranceSec ?? SPEECH_SNAP_DEFAULTS.toleranceSec,
        pad_in_sec: options.timingSnapOptions?.padInSec ?? SPEECH_SNAP_DEFAULTS.padInSec,
        pad_out_sec: options.timingSnapOptions?.padOutSec ?? SPEECH_SNAP_DEFAULTS.padOutSec,
        min_duration_sec: options.timingSnapOptions?.minDurSec ?? SPEECH_SNAP_DEFAULTS.minDurSec,
        min_word_sec: options.timingSnapOptions?.minWordSec ?? SPEECH_SNAP_DEFAULTS.minWordSec,
      },
      silences: detection.silences,
      ...(result.backend === "whisper-cpp" ? { dtw: result.dtw === true } : {}),
    },
  };
}

async function attachUnrecognizedSpans(segments, inputPath, range, ffmpeg, options, detection) {
  // 旧 cache の判定と版は持ち越さない。markers は再計算の入力として残す。
  segments = segments.map(({ unrecognized: _unrecognized, unrecognized_algo_version: _version, ...segment }) => segment);
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
  const silences = detection?.silences ?? [];
  return segments.map((segment) => {
    const unrecognized = detectUnrecognizedSpans(segment, silences, { minGapSec, minVoicedSec });
    const clean = withoutInternalMarkers(segment);
    return unrecognized.length ? { ...clean, unrecognized, unrecognized_algo_version: UNRECOGNIZED_ALGO_VERSION } : clean;
  });
}

export function runSilenceDetect({ inputPath, range, ffmpeg, silenceDb, silenceMinSec, options }) {
  const result = runChecked(ffmpeg, [
    "-hide_banner", "-nostdin",
    "-ss", String(range.in), "-to", String(range.out), "-i", inputPath, "-vn", "-sn", "-dn",
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
    throw new Error(toolsText('tools.transcribe.error.numericOption', { label, qualifier: positive ? toolsText('tools.transcribe.error.positiveQualifier') : '' }));
  }
  return resolved;
}

async function recordTranscribe(target, result, range, backend, lang, noRecord, rawResult, started) {
  const language = transcriptLanguage(lang, backend);
  if (!noRecord) {
    const sidecar = await recordEngineTranscript(target, {
      backend,
      generated_at: result.generated_at,
      source: { path: target.displayPath, range: result.range },
      elapsed_sec: formatNumber((performance.now() - started) / 1000),
      cost_usd: backend.startsWith("cloud:") ? rawResult.cost_usd ?? null : null,
      segments: rawResult.segments,
      timing_snap: rawResult.timing_snap,
    });
    if (sidecar) {
      const value = JSON.parse(await readFile(sidecar, "utf8"));
      value.transcript_language = language;
      await writeFile(sidecar, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    }
  }
  await recordObservation({
    target,
    kind: "transcribe",
    result,
    range,
    args: { backend, lang },
    outputs: [],
    noRecord,
  });
  const analysisPath = !noRecord && analysisPathForTarget(target);
  if (analysisPath) {
    const analysis = JSON.parse(await readFile(analysisPath, "utf8"));
    analysis.transcript_language = language;
    await writeFile(analysisPath, `${JSON.stringify(analysis, null, 2)}\n`, "utf8");
  }
}

function safeCacheName(value) {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

function cacheIdentity({ sha256, range, backend, lang, retryLanguageGaps, cacheDirectory, whisperPrompt }) {
  const promptKey = typeof whisperPrompt === 'string' && whisperPrompt ? `-prompt-${createHash('sha256').update(whisperPrompt).digest('hex').slice(0, 12)}` : lang === 'en' && whisperPrompt === true ? '-filler-prompt' : '';
  const normalized = knownLanguage(lang);
  const wordKey = backend === 'whisper-cpp' && normalized && !['ja', 'zh'].includes(normalized) ? '-words3' : '';
  const gapKey = retryLanguageGaps && lang !== 'auto' ? '-intake-gaps-v1' : '';
  const key = `${sha256}-${formatNumber(range.in)}-${formatNumber(range.out)}-${backend}-${lang}${backend === 'whisper-cpp' ? `-mixed-v3${gapKey}${promptKey}${wordKey}` : ''}`;
  return { key, cachePath: path.join(cacheDirectory, `${safeCacheName(key)}.json`) };
}

// Direct CLI for the optional whisper prompt; the shared media CLI owns its own argument table.
if (isMainModule(import.meta.url)) {
  const [target, ...argv] = process.argv.slice(2);
  const options = {};
  try {
    for (let index = 0; index < argv.length; index += 2) {
      const flag = argv[index], value = argv[index + 1];
      if (!value || !["--lang", "--backend", "--whisper-prompt", "--in", "--out"].includes(flag)) throw new Error(`Unknown or incomplete option: ${flag}`);
      if (flag === "--lang") options.lang = value;
      if (flag === "--backend") options.backend = value;
      if (flag === "--in" || flag === "--out") options[flag.slice(2)] = Number(value);
      if (flag === "--whisper-prompt") {
        if (!["on", "off"].includes(value)) throw new Error("--whisper-prompt must be on or off");
        options.whisperPrompt = value === "on";
      }
    }
    const result = await transcribeMedia(target, options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
