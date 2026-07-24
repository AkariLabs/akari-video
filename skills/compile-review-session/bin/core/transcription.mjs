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

function audioDuration(audioPath) {
  const result = run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    audioPath,
  ]);
  const duration = Number(String(result.stdout ?? "").trim());
  if (result.error || result.status !== 0 || !Number.isFinite(duration) || duration <= 0) {
    throw new Error(`音声 duration を取得できません: ${concise(result.stderr)}`);
  }
  return duration;
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

async function trySpeechAnalyzer({ audioPath, repoRoot, duration }) {
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
      segments: alignSegmentsToSpeech(segments, audioPath, duration),
    },
    reason: null,
  };
}

async function tryWhisper({ audioPath, repoRoot, duration }) {
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
        segments: alignSegmentsToSpeech(segments, audioPath, duration),
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
        segments: alignSegmentsToSpeech(segments, audioPath, duration),
      },
      reason: null,
      decisionCard: card.decision_card,
    };
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
}

export async function transcribeAudio(options) {
  const duration = audioDuration(options.audioPath);
  const reasons = [];
  const speechAnalyzer = await trySpeechAnalyzer({ ...options, duration });
  if (speechAnalyzer.result) return { ...speechAnalyzer.result, reasons };
  reasons.push(speechAnalyzer.reason);

  const whisper = await tryWhisper({ ...options, duration });
  if (whisper.result) return { ...whisper.result, reasons };
  reasons.push(whisper.reason);

  if (options.allowCloudStt) {
    const cloud = await tryCloud({ ...options, duration });
    if (cloud.result) return { ...cloud.result, reasons, decisionCard: cloud.decisionCard };
    reasons.push(cloud.reason);
    return { backend: "unavailable", segments: [], reasons, decisionCard: cloud.decisionCard };
  }
  reasons.push("cloud STT: --allow-cloud-stt がないため既定オフ");
  return { backend: "unavailable", segments: [], reasons };
}
