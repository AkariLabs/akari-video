#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isMainModule } from "./is-main-module.mjs";

const PROVIDERS = {
  scribe: {
    connectionId: "elevenlabs",
    byteLimit: 1_000_000_000,
    rtf: 0.025,
    hourlyUsd: 0.40,
    qualityNote: "句読点あり・フィラー保持・字幕適合が最良",
  },
  groq: {
    connectionId: "groq",
    byteLimit: 25_000_000,
    rtf: 0.002,
    hourlyUsd: 0.04,
    qualityNote: "句読点なし・フィラー脱落・速度最優先",
  },
};

class PublicError extends Error {}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function concise(value, fallback = "処理に失敗しました") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 500) : fallback;
}

function rounded(value) {
  return Number(value.toFixed(6));
}

function parseArguments(argv) {
  const options = {
    mode: null,
    projectRoot: process.cwd(),
    duration: null,
    provider: null,
    input: null,
    approved: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--decision-card" || argument === "--send") {
      const mode = argument.slice(2);
      if (options.mode && options.mode !== mode) throw new PublicError("実行モードは 1 つだけ指定してください");
      options.mode = mode;
    } else if (argument === "--approved") {
      options.approved = true;
    } else if (["--project-root", "--duration", "--provider", "--input"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new PublicError(`${argument} の値がありません`);
      if (argument === "--project-root") options.projectRoot = path.resolve(value);
      if (argument === "--duration") options.duration = Number(value);
      if (argument === "--provider") options.provider = value;
      if (argument === "--input") options.input = path.resolve(value);
      index += 1;
    } else {
      throw new PublicError(`不明な引数です: ${argument}`);
    }
  }
  if (!options.mode) throw new PublicError("--decision-card または --send が必要です");
  return options;
}

function credentialsPath() {
  return path.resolve(
    process.env.AKARI_CREDENTIALS_FILE
      ?? path.join(os.homedir(), ".config", "akari-video", "credentials.env"),
  );
}

function readRegistry(projectRoot) {
  const registryPath = path.join(projectRoot, ".akari", "connections.json");
  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  } catch {
    throw new PublicError("connections.json を読めません");
  }
  if (!registry || !Array.isArray(registry.providers)) {
    throw new PublicError("connections.json の providers が不正です");
  }
  return registry;
}

function readCredentials() {
  let source;
  try {
    source = fs.readFileSync(credentialsPath(), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return new Map();
    throw new PublicError("credentials.env を読めません");
  }
  const values = new Map();
  for (const originalLine of source.split(/\r?\n/)) {
    const line = originalLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    let value = line.slice(separator + 1).trim();
    if (
      value.length >= 2
      && ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values.set(name, value);
  }
  return values;
}

function extractEnvName(value) {
  if (typeof value !== "string") return null;
  return /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value)?.[1] ?? null;
}

function configuredProvider(registry, credentials, connectionId) {
  const provider = registry.providers.find((candidate) => candidate?.id === connectionId);
  if (!provider || provider.doctor?.status !== "ok") return null;
  const envName = extractEnvName(provider.env);
  if (!envName) return null;
  const secret = credentials.get(envName);
  if (typeof secret !== "string" || secret.length === 0) return null;
  return { provider, secret };
}

function decisionOption(id, rtf, qualityNote, duration, hourlyUsd) {
  const rawCostEstimateUsd = (duration / 3600) * hourlyUsd;
  const costEstimateUsd = rounded(rawCostEstimateUsd);
  // JPY は USD × 150 の概算レートであり、実勘定ではない。
  return {
    id,
    rtf,
    estimated_wait_seconds: rounded(duration * rtf),
    quality_note: qualityNote,
    cost_estimate_usd: costEstimateUsd,
    cost_estimate_jpy: rounded(rawCostEstimateUsd * 150),
  };
}

function runDecisionCard(options) {
  if (!Number.isFinite(options.duration) || options.duration <= 0) {
    throw new PublicError("--duration には正の source 秒を指定してください");
  }
  const registry = readRegistry(options.projectRoot);
  const credentials = readCredentials();
  const availableCloud = Object.entries(PROVIDERS).filter(([, configuration]) => (
    configuredProvider(registry, credentials, configuration.connectionId)
  ));
  if (availableCloud.length === 0) {
    printJson({
      decision_card: null,
      reason: "connections.json に doctor ok のクラウド provider がありません（既定はローカル）。",
    });
    return;
  }

  const optionsList = [
    decisionOption(
      "speechanalyzer",
      0.08,
      "ローカル既定・句読点とフィラーを保持",
      options.duration,
      0,
    ),
  ];
  for (const [id, configuration] of availableCloud) {
    optionsList.push(decisionOption(
      id,
      configuration.rtf,
      configuration.qualityNote,
      options.duration,
      configuration.hourlyUsd,
    ));
  }
  printJson({
    decision_card: {
      material_duration_seconds: options.duration,
      options: optionsList,
      requires_explicit_approval: true,
    },
  });
}

function spawnFfmpeg(args) {
  let result;
  try {
    result = spawnSync("ffmpeg", args, { encoding: "utf8" });
  } catch {
    throw new PublicError("ffmpeg を起動できません");
  }
  if (result.error?.code === "ENOENT") throw new PublicError("ffmpeg が PATH 上にありません");
  if (result.error || result.status !== 0) {
    throw new PublicError(`ffmpeg failed: ${concise(result.stderr, "終了コードが 0 ではありません")}`);
  }
  return result;
}

function detectSilences(input, duration) {
  const result = spawnFfmpeg([
    "-hide_banner", "-nostdin", "-i", input,
    "-af", "silencedetect=noise=-30dB:d=0.5",
    "-f", "null", "-",
  ]);
  const intervals = [];
  let openStart = null;
  for (const line of String(result.stderr ?? "").split(/\r?\n/)) {
    const startMatch = /silence_start:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (startMatch) openStart = Number(startMatch[1]);
    const endMatch = /silence_end:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (endMatch && Number.isFinite(openStart)) {
      const end = Number(endMatch[1]);
      if (Number.isFinite(end) && end > openStart) intervals.push({ start: openStart, end });
      openStart = null;
    }
  }
  if (Number.isFinite(openStart) && duration > openStart) intervals.push({ start: openStart, end: duration });
  return intervals;
}

function chooseSplitPoints(duration, targetSeconds, silences) {
  const points = [];
  const used = new Set();
  for (let goal = targetSeconds; goal < duration; goal += targetSeconds) {
    const candidates = silences
      .map((interval, index) => ({ index, midpoint: (interval.start + interval.end) / 2 }))
      .filter((candidate) => (
        !used.has(candidate.index)
        && candidate.midpoint > (points.at(-1) ?? 0)
        && candidate.midpoint < duration
        && Math.abs(candidate.midpoint - goal) <= targetSeconds * 0.2
      ))
      .sort((left, right) => Math.abs(left.midpoint - goal) - Math.abs(right.midpoint - goal));
    if (candidates.length > 0) {
      points.push(candidates[0].midpoint);
      used.add(candidates[0].index);
    } else {
      const fallback = Math.min(goal, duration);
      if (fallback > (points.at(-1) ?? 0) && fallback < duration) points.push(fallback);
      process.stderr.write(`無音区間が目標 ${rounded(goal)} 秒の ±20% にないため固定境界へフォールバックしました\n`);
    }
  }
  return points;
}

function prepareChunks(input, duration, byteLimit) {
  const inputSize = fs.statSync(input).size;
  if (inputSize <= byteLimit) return { chunks: [{ file: input, offset: 0 }], temporaryDirectory: null };

  const estimatedBitrate = (inputSize * 8) / duration;
  if (!Number.isFinite(estimatedBitrate) || estimatedBitrate <= 0) {
    throw new PublicError("入力音声の推定ビットレートを計算できません");
  }
  const targetSeconds = ((byteLimit * 8) / estimatedBitrate) * 0.9;
  if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) {
    throw new PublicError("分割目標長を計算できません");
  }
  const silences = detectSilences(input, duration);
  const splitPoints = chooseSplitPoints(duration, targetSeconds, silences);
  const boundaries = [0, ...splitPoints, duration];
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "akari-stt-"));
  const chunks = [];
  try {
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const start = boundaries[index];
      const end = boundaries[index + 1];
      if (!(end > start)) continue;
      const output = path.join(temporaryDirectory, `chunk-${String(index).padStart(4, "0")}.m4a`);
      spawnFfmpeg([
        "-hide_banner", "-nostdin", "-y",
        "-ss", String(start), "-to", String(end),
        "-i", input, "-c", "copy", output,
      ]);
      chunks.push({ file: output, offset: start });
    }
    if (chunks.length === 0) throw new PublicError("音声チャンクを作成できません");
    return { chunks, temporaryDirectory };
  } catch (error) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function postForm(url, headers, form) {
  let response;
  try {
    response = await fetch(url, { method: "POST", headers, body: form });
  } catch {
    throw new PublicError("ネットワークエラーで送信できませんでした");
  }
  if (!response.ok) throw new PublicError(`クラウド API が HTTP ${response.status} を返しました`);
  try {
    return await response.json();
  } catch {
    throw new PublicError("クラウド API の応答が有効な JSON ではありません");
  }
}

function timed(value) {
  return Number.isFinite(value?.start) && Number.isFinite(value?.end) && value.end > value.start;
}

export function normalizeGroq(response) {
  const words = (Array.isArray(response?.words) ? response.words : [])
    .filter(timed)
    .map((word) => ({ start: word.start, end: word.end, text: String(word.word ?? "") }));
  const segments = (Array.isArray(response?.segments) ? response.segments : [])
    .filter(timed)
    .map((segment) => ({
      start: segment.start,
      end: segment.end,
      text: String(segment.text ?? ""),
      words: [],
    }));
  for (const word of words) {
    const midpoint = (word.start + word.end) / 2;
    let destination = segments.find((segment) => midpoint >= segment.start && midpoint <= segment.end);
    if (!destination) {
      destination = segments
        .map((segment) => ({
          segment,
          overlap: Math.max(0, Math.min(word.end, segment.end) - Math.max(word.start, segment.start)),
        }))
        .sort((left, right) => right.overlap - left.overlap)[0];
      destination = destination?.overlap > 0 ? destination.segment : null;
    }
    if (destination) destination.words.push(word);
  }
  return segments;
}

export function normalizeScribe(response) {
  const sourceWords = Array.isArray(response?.words) ? response.words : [];
  const words = [];
  let pendingPrefix = "";
  for (const sourceWord of sourceWords) {
    const text = String(sourceWord?.text ?? "");
    const start = sourceWord?.start;
    const end = sourceWord?.end;
    // 句読点のみのトークンは speech 実体を持たない。直前語へテキストとして結合し、
    // 直前語の end は据え置く（token 自身の end を採用しない）。Scribe は文末の無音を
    // 句読点トークンの end へ吸わせるため、その end を末尾語へ持ち込むと無音区間まで
    // caption.end が膨張して「隙間の原則」を破る（v4.1 実測: 「。」token が 2〜4 秒に及ぶ）。
    // ゼロ幅・非ゼロ幅（無音吸着）のいずれの句読点トークンもここで吸収する。
    if (/^[。、！？!?,.]+$/.test(text)) {
      if (words.length > 0) words[words.length - 1].text += text;
      else pendingPrefix += text;
      continue;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    words.push({ start, end, text: `${pendingPrefix}${text}` });
    pendingPrefix = "";
  }

  const segments = [];
  let current = [];
  const hasSentencePunctuation = words.some((word) => /[。！？!?]/.test(word.text));
  const flush = () => {
    if (current.length === 0) return;
    segments.push({
      start: current[0].start,
      end: current[current.length - 1].end,
      text: current.map((word) => word.text).join(""),
      words: current,
    });
    current = [];
  };
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    current.push(word);
    const next = words[index + 1];
    if (/[。！？!?]/.test(word.text) || (!hasSentencePunctuation && next && next.start - word.end >= 2)) flush();
  }
  flush();
  return segments;
}

async function transcribeChunk(provider, secret, file) {
  const data = fs.readFileSync(file);
  const form = new FormData();
  form.append("file", new Blob([data]), path.basename(file));
  if (provider === "groq") {
    form.append("model", "whisper-large-v3-turbo");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");
    const response = await postForm(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      { Authorization: `Bearer ${secret}` },
      form,
    );
    return normalizeGroq(response);
  }

  form.append("model_id", "scribe_v1");
  form.append("timestamps_granularity", "word");
  const response = await postForm(
    "https://api.elevenlabs.io/v1/speech-to-text",
    { "xi-api-key": secret },
    form,
  );
  return normalizeScribe(response);
}

function addOffset(segments, offset) {
  return segments.map((segment) => ({
    start: segment.start + offset,
    end: segment.end + offset,
    text: segment.text,
    words: segment.words.map((word) => ({
      start: word.start + offset,
      end: word.end + offset,
      text: word.text,
    })),
  }));
}

async function runSend(options) {
  if (!options.approved) {
    printJson({ sent: false, reason: "承認（--approved）がありません" });
    process.exitCode = 1;
    return;
  }
  if (!Object.hasOwn(PROVIDERS, options.provider)) {
    throw new PublicError("--provider は scribe または groq を指定してください");
  }
  if (!options.input) throw new PublicError("--input が必要です");
  if (!Number.isFinite(options.duration) || options.duration <= 0) {
    throw new PublicError("--duration には正の source 秒を指定してください");
  }

  const configuration = PROVIDERS[options.provider];
  const registry = readRegistry(options.projectRoot);
  const credentials = readCredentials();
  const connection = configuredProvider(registry, credentials, configuration.connectionId);
  if (!connection) throw new PublicError("provider は doctor ok かつ credentials.env 設定済みである必要があります");

  let prepared = null;
  try {
    prepared = prepareChunks(options.input, options.duration, configuration.byteLimit);
    const segments = [];
    // 並列送信は実装しない（契約 §3・オーナー裁定）。各チャンクを必ず逐次送信する。
    for (const chunk of prepared.chunks) {
      const chunkSegments = await transcribeChunk(options.provider, connection.secret, chunk.file);
      segments.push(...addOffset(chunkSegments, chunk.offset));
    }
    segments.sort((left, right) => left.start - right.start);
    for (const segment of segments) segment.words.sort((left, right) => left.start - right.start);
    printJson({ backend: options.provider, segments });
  } finally {
    if (prepared?.temporaryDirectory) {
      fs.rmSync(prepared.temporaryDirectory, { recursive: true, force: true });
    }
  }
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    if (options.mode === "decision-card") runDecisionCard(options);
    else await runSend(options);
  } catch (error) {
    const reason = error instanceof PublicError ? error.message : "内部処理に失敗しました";
    if (options?.mode === "decision-card") printJson({ decision_card: null, reason });
    else printJson({ backend: options?.provider ?? "cloud", sent: false, reason });
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main();
}
