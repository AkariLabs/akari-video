import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function concise(value, fallback = "処理に失敗しました") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 500) : fallback;
}

function run(command, args, options = {}) {
  try {
    return spawnSync(command, args, {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    return { error, status: null, stdout: "", stderr: "" };
  }
}

function parseJsonOutput(result) {
  if (result.error) return null;
  try {
    return JSON.parse(String(result.stdout ?? "").trim());
  } catch {
    return null;
  }
}

function executable(file) {
  try {
    fs.accessSync(file, fs.constants.R_OK | fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function findOnPath(name) {
  for (const directory of String(process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    if (executable(candidate)) return candidate;
  }
  return null;
}

function walkModels(root, depth = 0) {
  if (depth > 4) return [];
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const results = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) results.push(...walkModels(candidate, depth + 1));
    if (
      entry.isFile()
      && /^ggml-.*\.bin$/.test(entry.name)
      && !/^for-tests-/.test(entry.name)
      && !/\.en\.bin$/.test(entry.name)
    ) {
      results.push(candidate);
    }
  }
  return results;
}

function findWhisperBinary(repoRoot) {
  if (process.env.WHISPER_CPP_BIN && executable(process.env.WHISPER_CPP_BIN)) {
    return process.env.WHISPER_CPP_BIN;
  }
  const fromPath = findOnPath("whisper-cli");
  if (fromPath) return fromPath;
  const candidates = [
    path.join(repoRoot, "whisper.cpp", "build", "bin", "whisper-cli"),
    path.join(path.dirname(repoRoot), "whisper.cpp", "build", "bin", "whisper-cli"),
  ];
  return candidates.find(executable) ?? null;
}

function findWhisperModel(repoRoot) {
  if (process.env.WHISPER_CPP_MODEL) {
    try {
      if (fs.statSync(process.env.WHISPER_CPP_MODEL).isFile()) return process.env.WHISPER_CPP_MODEL;
    } catch {
      // 続く既定探索へ進む。
    }
  }
  const roots = [
    path.join(repoRoot, "models"),
    path.join(repoRoot, "whisper.cpp", "models"),
    path.join(os.homedir(), ".cache", "whisper.cpp"),
    path.join(os.homedir(), "Library", "Caches", "whisper.cpp"),
  ];
  const brew = run("brew", ["--prefix", "whisper-cpp"]);
  if (!brew.error && brew.status === 0) {
    roots.push(path.join(String(brew.stdout).trim(), "share", "whisper-cpp"));
  }
  roots.push(path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "com.prakashjoshipax.VoiceInk",
    "WhisperModels",
  ));
  for (const root of roots) {
    const found = walkModels(root);
    if (found.length > 0) return found[0];
  }
  return null;
}

function wavChunks(buffer) {
  if (
    buffer.length < 12
    || buffer.toString("ascii", 0, 4) !== "RIFF"
    || buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("タイムスタンプ健全性ゲート: audio.wav が RIFF/WAVE ではありません");
  }
  const chunks = [];
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = Math.min(buffer.length, start + size);
    chunks.push({ id, start, end });
    offset = start + size + (size % 2);
  }
  return chunks;
}

function wavSample(buffer, offset, format, bitsPerSample) {
  if (format === 1 && bitsPerSample === 8) return (buffer.readUInt8(offset) - 128) * 256;
  if (format === 1 && bitsPerSample === 16) return buffer.readInt16LE(offset);
  if (format === 1 && bitsPerSample === 24) {
    const value = buffer.readUIntLE(offset, 3);
    return (value & 0x800000 ? value - 0x1000000 : value) / 256;
  }
  if (format === 1 && bitsPerSample === 32) return buffer.readInt32LE(offset) / 65536;
  if (format === 3 && bitsPerSample === 32) return buffer.readFloatLE(offset) * 32768;
  if (format === 3 && bitsPerSample === 64) return buffer.readDoubleLE(offset) * 32768;
  throw new Error(
    `タイムスタンプ健全性ゲート: 未対応の WAV 形式です（format=${format}, bits=${bitsPerSample}）`,
  );
}

export async function detectVadSpans(audioPath, {
  windowSeconds = 0.05,
  minimumRms = 300,
  noiseFloorRatio = 3,
  mergeGapSeconds = 0.6,
  minimumSpanSeconds = 0.2,
} = {}) {
  const buffer = await fsp.readFile(audioPath);
  const chunks = wavChunks(buffer);
  const formatChunk = chunks.find((chunk) => chunk.id === "fmt ");
  const dataChunk = chunks.find((chunk) => chunk.id === "data");
  if (!formatChunk || formatChunk.end - formatChunk.start < 16 || !dataChunk) {
    throw new Error("タイムスタンプ健全性ゲート: audio.wav の fmt/data chunk が不正です");
  }

  const format = buffer.readUInt16LE(formatChunk.start);
  const channels = buffer.readUInt16LE(formatChunk.start + 2);
  const sampleRate = buffer.readUInt32LE(formatChunk.start + 4);
  const blockAlign = buffer.readUInt16LE(formatChunk.start + 12);
  const bitsPerSample = buffer.readUInt16LE(formatChunk.start + 14);
  const bytesPerSample = bitsPerSample / 8;
  if (
    ![1, 3].includes(format)
    || channels < 1
    || sampleRate < 1
    || !Number.isInteger(bytesPerSample)
    || blockAlign < channels * bytesPerSample
  ) {
    throw new Error("タイムスタンプ健全性ゲート: audio.wav の音声形式が不正です");
  }

  const frameCount = Math.floor((dataChunk.end - dataChunk.start) / blockAlign);
  const duration = frameCount / sampleRate;
  if (frameCount === 0) {
    throw new Error("タイムスタンプ健全性ゲート: audio.wav にサンプルがありません");
  }
  const windowFrames = Math.max(1, Math.round(sampleRate * windowSeconds));
  const windows = [];
  for (let frameStart = 0; frameStart < frameCount; frameStart += windowFrames) {
    const frameEnd = Math.min(frameCount, frameStart + windowFrames);
    let sumSquares = 0;
    let sampleCount = 0;
    for (let frame = frameStart; frame < frameEnd; frame += 1) {
      const frameOffset = dataChunk.start + frame * blockAlign;
      for (let channel = 0; channel < channels; channel += 1) {
        const sample = wavSample(
          buffer,
          frameOffset + channel * bytesPerSample,
          format,
          bitsPerSample,
        );
        sumSquares += sample * sample;
        sampleCount += 1;
      }
    }
    windows.push({
      start: frameStart / sampleRate,
      end: frameEnd / sampleRate,
      rms: Math.sqrt(sumSquares / sampleCount),
    });
  }

  const sortedRms = windows.map((window) => window.rms).sort((left, right) => left - right);
  const noiseFloor = sortedRms[Math.floor((sortedRms.length - 1) * 0.2)] ?? 0;
  const peakRms = sortedRms.at(-1) ?? 0;
  const adaptiveThreshold = Math.min(noiseFloor * noiseFloorRatio, peakRms * 0.25);
  const threshold = Math.max(minimumRms, adaptiveThreshold);
  const spans = [];
  for (const window of windows) {
    if (window.rms <= threshold) continue;
    const previous = spans.at(-1);
    if (previous && window.start - previous.end < mergeGapSeconds - 1e-9) {
      previous.end = window.end;
    } else {
      spans.push({ start: window.start, end: window.end });
    }
  }

  return {
    duration,
    noiseFloor,
    threshold,
    spans: spans.filter((span) => span.end - span.start + 1e-9 >= minimumSpanSeconds),
  };
}

function mergeIntervals(intervals) {
  const merged = [];
  for (const interval of intervals.sort((left, right) => left.start - right.start)) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

export function measureTimestampCoverage(segments, vadSpans, {
  toleranceSeconds = 0.25,
  duration = Infinity,
} = {}) {
  const transcriptIntervals = mergeIntervals(
    (Array.isArray(segments) ? segments : []).flatMap((segment) => (
      Number.isFinite(segment?.start)
      && Number.isFinite(segment?.end)
      && segment.end > segment.start
        ? [{
          start: Math.max(0, segment.start - toleranceSeconds),
          end: Math.min(duration, segment.end + toleranceSeconds),
        }]
        : []
    )),
  );
  const speechDuration = vadSpans.reduce((sum, span) => sum + span.end - span.start, 0);
  if (speechDuration <= 0) {
    return { coverage: 1, coveredDuration: 0, speechDuration: 0 };
  }
  let coveredDuration = 0;
  for (const speech of vadSpans) {
    for (const transcript of transcriptIntervals) {
      coveredDuration += Math.max(
        0,
        Math.min(speech.end, transcript.end) - Math.max(speech.start, transcript.start),
      );
    }
  }
  return {
    coverage: Math.min(1, coveredDuration / speechDuration),
    coveredDuration,
    speechDuration,
  };
}

function detectSpeechWindows(audioPath, duration) {
  const result = run("ffmpeg", [
    "-hide_banner", "-nostdin", "-i", audioPath,
    "-af", "silencedetect=noise=-35dB:d=0.5",
    "-f", "null", "-",
  ]);
  if (result.error || result.status !== 0) return [{ start: 0, end: duration }];
  const silences = [];
  let start = null;
  for (const line of String(result.stderr ?? "").split(/\r?\n/)) {
    const startMatch = /silence_start:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (startMatch) start = Math.max(0, Number(startMatch[1]));
    const endMatch = /silence_end:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (endMatch && Number.isFinite(start)) {
      silences.push({ start, end: Math.min(duration, Number(endMatch[1])) });
      start = null;
    }
  }
  if (Number.isFinite(start)) silences.push({ start, end: duration });
  const windows = [];
  let cursor = 0;
  for (const silence of silences) {
    if (silence.start - cursor >= 0.1) windows.push({ start: cursor, end: silence.start });
    cursor = Math.max(cursor, silence.end);
  }
  if (duration - cursor >= 0.1) windows.push({ start: cursor, end: duration });
  return windows.length > 0 ? windows : [{ start: 0, end: duration }];
}

function distanceToWindow(value, window) {
  if (value < window.start) return window.start - value;
  if (value > window.end) return value - window.end;
  return 0;
}

function joinText(parts) {
  return parts.reduce((result, value) => {
    const text = String(value ?? "").trim();
    if (!text) return result;
    if (!result) return text;
    return `${result}${/[A-Za-z0-9]$/.test(result) && /^[A-Za-z0-9]/.test(text) ? " " : ""}${text}`;
  }, "");
}

export function alignSegmentsToSpeech(segments, audioPath, duration) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  const windows = detectSpeechWindows(audioPath, duration);
  const groups = windows.map((window) => ({ window, segments: [] }));
  for (const segment of segments) {
    const midpoint = (segment.start + segment.end) / 2;
    const destination = groups
      .map((group) => ({ group, distance: distanceToWindow(midpoint, group.window) }))
      .sort((left, right) => left.distance - right.distance)[0]?.group;
    if (destination) destination.segments.push(segment);
  }

  return groups.flatMap(({ window, segments: assigned }) => {
    if (assigned.length === 0) return [];
    const rawStart = Math.min(...assigned.map((segment) => segment.start));
    const rawEnd = Math.max(...assigned.map((segment) => segment.end));
    const rawDuration = Math.max(0.001, rawEnd - rawStart);
    const targetDuration = window.end - window.start;
    const mapTime = (value) => (
      window.start + Math.max(0, Math.min(1, (value - rawStart) / rawDuration)) * targetDuration
    );
    const words = assigned.flatMap((segment) => (
      Array.isArray(segment.words) ? segment.words : []
    )).flatMap((word) => {
      const start = mapTime(word.start);
      const end = mapTime(word.end);
      const text = String(word.text ?? "").replace(/\uFFFD/g, "");
      return end > start && text.trim() ? [{ start, end, text }] : [];
    }).sort((left, right) => left.start - right.start);
    return [{
      start: window.start,
      end: window.end,
      text: joinText(assigned.map((segment) => segment.text)),
      words,
    }];
  });
}

function normalizeTimedSegments(value) {
  return (Array.isArray(value) ? value : []).flatMap((segment) => {
    if (!Number.isFinite(segment?.start) || !Number.isFinite(segment?.end) || segment.end <= segment.start) {
      return [];
    }
    const words = (Array.isArray(segment.words) ? segment.words : []).flatMap((word) => (
      Number.isFinite(word?.start)
      && Number.isFinite(word?.end)
      && word.end > word.start
      && String(word?.text ?? "").trim()
        ? [{ start: word.start, end: word.end, text: String(word.text) }]
        : []
    ));
    return [{
      start: segment.start,
      end: segment.end,
      text: String(segment.text ?? "").trim(),
      words,
    }];
  });
}

function rawJsonStringBytes(value) {
  const text = String(value ?? "");
  return [...text].some((character) => character.codePointAt(0) > 255)
    ? Buffer.from(text, "utf8")
    : Buffer.from(text, "latin1");
}

function decodeRawJsonString(value, fatal = false) {
  return new TextDecoder("utf-8", { fatal }).decode(rawJsonStringBytes(value));
}

export function restoreWhisperTokenWords(tokens, segmentStart, segmentEnd) {
  const words = [];
  let pendingBytes = [];
  let pendingStart = null;
  let pendingEnd = null;

  const flush = () => {
    if (pendingBytes.length === 0) return false;
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(pendingBytes));
    } catch {
      return false;
    }
    if (pendingEnd > pendingStart && text.trim()) {
      words.push({
        start: Math.max(segmentStart, pendingStart),
        end: Math.min(segmentEnd, pendingEnd),
        text,
      });
      pendingBytes = [];
      pendingStart = null;
      pendingEnd = null;
      return true;
    }
    return false;
  };

  for (const token of Array.isArray(tokens) ? tokens : []) {
    const rawText = String(token?.text ?? "");
    let controlText;
    try {
      controlText = decodeRawJsonString(rawText, true);
    } catch {
      controlText = "";
    }
    if (controlText.startsWith("[") || rawText.startsWith("[") || !rawText) continue;
    const start = Number(token?.offsets?.from) / 1000;
    const end = Number(token?.offsets?.to) / 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (pendingStart === null) pendingStart = start;
    pendingEnd = Math.max(pendingEnd ?? end, end);
    pendingBytes.push(rawJsonStringBytes(rawText));
    flush();
  }

  if (pendingBytes.length > 0) {
    let tail = "";
    try {
      tail = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(pendingBytes));
    } catch {
      // 復元不能な末尾バイトは捨てる。segment.text は完全な原文を保持する。
    }
    if (tail && words.length > 0) words.at(-1).text += tail;
  }
  return words.filter((word) => word.end > word.start);
}

function normalizeWhisperJson(value) {
  return (Array.isArray(value?.transcription) ? value.transcription : []).flatMap((segment) => {
    const start = Number(segment?.offsets?.from) / 1000;
    const end = Number(segment?.offsets?.to) / 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    const words = restoreWhisperTokenWords(segment.tokens, start, end);
    return [{ start, end, text: decodeRawJsonString(segment.text).trim(), words }];
  });
}

async function trySpeechAnalyzer({ audioPath, repoRoot }) {
  const helper = path.join(repoRoot, "skills", "analyze-footage", "bin", "transcribe-sa.mjs");
  const cacheRoot = path.join(os.tmpdir(), "akari-video-compile-review-session");
  await fsp.mkdir(cacheRoot, { recursive: true });
  const environment = {
    ...process.env,
    CLANG_MODULE_CACHE_PATH: path.join(cacheRoot, "swift-module-cache"),
    SWIFT_MODULECACHE_PATH: path.join(cacheRoot, "swift-module-cache"),
  };
  await fsp.mkdir(environment.CLANG_MODULE_CACHE_PATH, { recursive: true });
  const check = run(process.execPath, [helper, "--check"], { env: environment });
  const availability = parseJsonOutput(check);
  if (!availability?.available) {
    return { result: null, reason: `SpeechAnalyzer: ${availability?.reason ?? concise(check.stderr)}` };
  }
  const transcribed = run(process.execPath, [
    helper,
    "--input", audioPath,
    "--helper-bin", path.join(cacheRoot, "speechanalyzer-helper"),
  ], { env: environment });
  const value = parseJsonOutput(transcribed);
  const segments = normalizeTimedSegments(value?.segments);
  if (!value?.available || segments.length === 0 || segments.some((segment) => segment.words.length === 0)) {
    return { result: null, reason: `SpeechAnalyzer: ${value?.reason ?? "word 時刻付き発話を取得できませんでした"}` };
  }
  return {
    result: {
      backend: "speechanalyzer",
      segments,
    },
    reason: null,
  };
}

async function tryWhisper({ audioPath, repoRoot }) {
  const binary = findWhisperBinary(repoRoot);
  if (!binary) return { result: null, reason: "whisper.cpp: whisper-cli が見つかりません" };
  const help = run(binary, ["-h"]);
  const helpText = `${help.stdout ?? ""}\n${help.stderr ?? ""}`;
  if (!["-m", "-f", "-l", "-oj", "-ojf", "-of"].every((option) => helpText.includes(option))) {
    return { result: null, reason: `whisper.cpp: 必要な CLI オプションに非対応です（${binary}）` };
  }
  const model = findWhisperModel(repoRoot);
  if (!model) return { result: null, reason: "whisper.cpp: 適合する多言語モデルが見つかりません" };

  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "akari-review-stt-"));
  try {
    const input = path.join(temporary, "whisper-input.wav");
    const prefix = path.join(temporary, "whisper-output");
    const conversion = run("ffmpeg", [
      "-hide_banner", "-nostdin", "-y", "-i", audioPath,
      "-map", "0:a:0", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", input,
    ]);
    if (conversion.error || conversion.status !== 0) {
      return { result: null, reason: `whisper.cpp: 音声変換に失敗しました（${concise(conversion.stderr)}）` };
    }
    const common = [
      "-m", model,
      "-f", input,
      "-l", "auto",
      "-bs", "1",
      "-bo", "1",
      "-oj",
      "-ojf",
      "-of", prefix,
    ];
    let inference = run(binary, common);
    if (inference.error || inference.status !== 0) {
      inference = run(binary, ["-ng", ...common]);
    }
    if (inference.error || inference.status !== 0) {
      return { result: null, reason: `whisper.cpp: 推論に失敗しました（${concise(inference.stderr)}）` };
    }
    let raw;
    try {
      // whisper.cpp は token 境界で UTF-8 文字を分断することがある。latin1 で各 byte を
      // 1 code point に保ったまま JSON を読み、restoreWhisperTokenWords で連結後に decode する。
      raw = JSON.parse((await fsp.readFile(`${prefix}.json`)).toString("latin1"));
    } catch {
      return { result: null, reason: "whisper.cpp: full JSON を読めません" };
    }
    const segments = normalizeWhisperJson(raw);
    if (segments.length === 0 || segments.some((segment) => segment.words.length === 0)) {
      return { result: null, reason: "whisper.cpp: word 時刻付き発話を取得できませんでした" };
    }
    return {
      result: {
        backend: "whisper-cpp",
        segments,
      },
      reason: null,
    };
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
}

async function tryCloud({
  audioPath,
  projectRoot,
  repoRoot,
  duration,
  cloudProvider,
  cloudApproved,
}) {
  const helper = path.join(repoRoot, "skills", "analyze-footage", "bin", "transcribe-cloud.mjs");
  const cardResult = run(process.execPath, [
    helper,
    "--decision-card",
    "--project-root", projectRoot,
    "--duration", String(duration),
  ]);
  const card = parseJsonOutput(cardResult);
  if (!card?.decision_card) {
    return { result: null, reason: `cloud STT: ${card?.reason ?? concise(cardResult.stderr)}` };
  }
  if (!cloudApproved || !["scribe", "groq"].includes(cloudProvider)) {
    return {
      result: null,
      reason: "cloud STT: 候補はありますが --cloud-provider と --cloud-approved による明示承認がありません",
      decisionCard: card.decision_card,
    };
  }

  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), "akari-review-cloud-stt-"));
  try {
    const cloudInput = path.join(temporary, "cloud-input.m4a");
    const bitrate = cloudProvider === "groq" ? "32k" : "64k";
    const conversion = run("ffmpeg", [
      "-hide_banner", "-nostdin", "-y", "-i", audioPath,
      "-map", "0:a:0", "-ac", "1", "-c:a", "aac", "-b:a", bitrate, cloudInput,
    ]);
    if (conversion.error || conversion.status !== 0) {
      return { result: null, reason: `cloud STT: 音声変換に失敗しました（${concise(conversion.stderr)}）` };
    }
    const sent = run(process.execPath, [
      helper,
      "--send",
      "--provider", cloudProvider,
      "--input", cloudInput,
      "--duration", String(duration),
      "--project-root", projectRoot,
      "--approved",
    ]);
    const value = parseJsonOutput(sent);
    const segments = normalizeTimedSegments(value?.segments);
    if (sent.error || sent.status !== 0 || segments.length === 0 || segments.some((segment) => segment.words.length === 0)) {
      return { result: null, reason: `cloud STT: ${value?.reason ?? concise(sent.stderr)}` };
    }
    return {
      result: {
        backend: value.backend === "scribe" ? "scribe" : "groq",
        segments,
      },
      reason: null,
      decisionCard: card.decision_card,
    };
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
}

export async function transcribeAudio(options) {
  const vad = await detectVadSpans(options.audioPath);
  const duration = vad.duration;
  const reasons = [];
  let timestampFallback = null;
  const transcribers = {
    speechAnalyzer: trySpeechAnalyzer,
    whisper: tryWhisper,
    cloud: tryCloud,
    ...options.transcribers,
  };
  const warn = typeof options.logger?.warn === "function"
    ? options.logger.warn
    : console.warn;
  const acceptHealthyResult = (attempt) => {
    if (!attempt.result) return null;
    const measurement = measureTimestampCoverage(attempt.result.segments, vad.spans, { duration });
    if (measurement.coverage < 0.7) {
      const reason = (
        `timestamp coverage=${measurement.coverage.toFixed(3)}`
        + ` (${measurement.coveredDuration.toFixed(3)}/${measurement.speechDuration.toFixed(3)}秒)`
        + " < 0.700"
      );
      const warning = (
        `${attempt.result.backend}: タイムスタンプ健全性ゲートで結果を破棄します（${reason}）`
      );
      warn(warning);
      reasons.push(warning);
      timestampFallback = { backend: attempt.result.backend, reason };
      return null;
    }
    return {
      ...attempt.result,
      reasons: reasons.filter(Boolean),
      provenance: {
        backend: attempt.result.backend,
        ...(timestampFallback
          ? { fallbackFrom: timestampFallback.backend, reason: timestampFallback.reason }
          : {}),
      },
    };
  };

  const speechAnalyzer = await transcribers.speechAnalyzer({ ...options, duration });
  const acceptedSpeechAnalyzer = acceptHealthyResult(speechAnalyzer);
  if (acceptedSpeechAnalyzer) return acceptedSpeechAnalyzer;
  if (speechAnalyzer.reason) reasons.push(speechAnalyzer.reason);

  const whisper = await transcribers.whisper({ ...options, duration });
  const acceptedWhisper = acceptHealthyResult(whisper);
  if (acceptedWhisper) return acceptedWhisper;
  if (whisper.reason) reasons.push(whisper.reason);

  if (options.allowCloudStt) {
    const cloud = await transcribers.cloud({ ...options, duration });
    const acceptedCloud = acceptHealthyResult(cloud);
    if (acceptedCloud) {
      return { ...acceptedCloud, decisionCard: cloud.decisionCard };
    }
    if (cloud.reason) reasons.push(cloud.reason);
    return {
      backend: "unavailable",
      segments: [],
      reasons: reasons.filter(Boolean),
      provenance: {
        backend: "unavailable",
        ...(timestampFallback
          ? { fallbackFrom: timestampFallback.backend, reason: timestampFallback.reason }
          : {}),
      },
      decisionCard: cloud.decisionCard,
    };
  }
  reasons.push("cloud STT: --allow-cloud-stt がないため既定オフ");
  return {
    backend: "unavailable",
    segments: [],
    reasons: reasons.filter(Boolean),
    provenance: {
      backend: "unavailable",
      ...(timestampFallback
        ? { fallbackFrom: timestampFallback.backend, reason: timestampFallback.reason }
        : {}),
    },
  };
}
