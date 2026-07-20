#!/usr/bin/env node

// 原稿テキストから VOICEVOX（ローカル）または fal Qwen3-TTS（自声クローン）でナレーション音声を
// 生成し、docs/contract-2026-07-20-edit-json-v1-narration.md 準拠のエントリを組み立てる。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const VOICEVOX_BASE_URL = "http://127.0.0.1:50021";
const VOICEVOX_RUN_PATH = "/Applications/VOICEVOX.app/Contents/Resources/vv-engine/run";
const VOICEVOX_STARTUP_TIMEOUT_MS = 60_000;
const FAL_TTS_URL = "https://fal.run/fal-ai/qwen-3-tts/text-to-speech/1.7b";
const FAL_USD_PER_1000_CHARS = 0.09;

const usage = [
  "使い方:",
  "  node generate-narration.mjs generate \\",
  "    --project <projectDir> --engine <voicevox|fal-qwen3> \\",
  "    --reading-file <読み原稿.txt> [--script-file <表示原稿.txt>] \\",
  "    --t <タイムライン秒> [--gain-db 0] [--id n-0001] \\",
  "    [--speaker 3] [--profile owner-ja] [--dry-run] [--yes] [--apply]",
].join("\n");

class PublicError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

const VALUE_OPTIONS = new Set([
  "--project", "--engine", "--reading-file", "--script-file",
  "--t", "--gain-db", "--id", "--speaker", "--profile",
]);
const FLAG_OPTIONS = new Set(["--dry-run", "--yes", "--apply"]);

function parseArguments(argv) {
  if (argv[0] !== "generate") {
    throw new PublicError(`不明なサブコマンドです。\n${usage}`, 2);
  }
  const options = {
    project: null,
    engine: null,
    readingFile: null,
    scriptFile: null,
    t: null,
    gainDb: 0,
    id: null,
    speaker: "3",
    profile: null,
    dryRun: false,
    yes: false,
    apply: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (VALUE_OPTIONS.has(argument)) {
      const value = argv[index + 1];
      if (value === undefined || FLAG_OPTIONS.has(value) || VALUE_OPTIONS.has(value)) {
        throw new PublicError(`${argument} の値がありません`);
      }
      index += 1;
      switch (argument) {
        case "--project": options.project = value; break;
        case "--engine": options.engine = value; break;
        case "--reading-file": options.readingFile = value; break;
        case "--script-file": options.scriptFile = value; break;
        case "--t": options.t = Number(value); break;
        case "--gain-db": options.gainDb = Number(value); break;
        case "--id": options.id = value; break;
        case "--speaker": options.speaker = value; break;
        case "--profile": options.profile = value; break;
        default: break;
      }
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--yes") {
      options.yes = true;
    } else if (argument === "--apply") {
      options.apply = true;
    } else {
      throw new PublicError(`不明な引数です: ${argument}\n${usage}`, 2);
    }
  }

  if (!options.project) throw new PublicError("--project が必要です");
  if (options.engine !== "voicevox" && options.engine !== "fal-qwen3") {
    throw new PublicError("--engine には voicevox または fal-qwen3 を指定してください");
  }
  if (!options.readingFile) throw new PublicError("--reading-file が必要です");
  if (!isFiniteNumber(options.t) || options.t < 0) {
    throw new PublicError("--t には 0 以上の有限数を指定してください");
  }
  if (!isFiniteNumber(options.gainDb) || options.gainDb < -60 || options.gainDb > 12) {
    throw new PublicError("--gain-db は -60 から 12 の範囲の有限数である必要があります");
  }
  if (options.id !== null && !/^n-\d{4}$/.test(options.id)) {
    throw new PublicError("--id は n- に続く 4 桁の数字である必要があります（例: n-0001）");
  }
  if (options.engine === "fal-qwen3" && !options.profile) {
    throw new PublicError("--engine fal-qwen3 には --profile が必要です");
  }

  options.project = path.resolve(options.project);
  return options;
}

function readTextFile(filePath, label) {
  let resolved;
  try {
    resolved = path.resolve(filePath);
    const text = fs.readFileSync(resolved, "utf8").trim();
    if (!text) throw new PublicError(`${label} が空です: ${resolved}`);
    return text;
  } catch (error) {
    if (error instanceof PublicError) throw error;
    throw new PublicError(`${label} を読めません: ${resolved ?? filePath}`);
  }
}

function computeNextId(projectDir) {
  const editPath = path.join(projectDir, "edit.json");
  let ids = [];
  try {
    const edit = JSON.parse(fs.readFileSync(editPath, "utf8"));
    const narration = edit?.audio?.narration;
    if (Array.isArray(narration)) {
      ids = narration
        .map((item) => item?.id)
        .filter((id) => typeof id === "string" && /^n-\d{4}$/.test(id));
    }
  } catch {
    // edit.json が無い、または narration 配列が無い場合は n-0001 から開始する。
  }
  const max = ids.reduce((accumulator, id) => Math.max(accumulator, Number(id.slice(2))), 0);
  return `n-${String(max + 1).padStart(4, "0")}`;
}

function extensionFor(engine) {
  return engine === "voicevox" ? "wav" : "mp3";
}

function relativeOutputPath(id, engine) {
  return `out/narration/${id}.${extensionFor(engine)}`;
}

// --- credentials.env（fal-qwen3 用。skills/analyze-footage/bin/transcribe-cloud.mjs と同型） ---

function credentialsPath() {
  return path.resolve(
    process.env.AKARI_CREDENTIALS_FILE
      ?? path.join(os.homedir(), ".config", "akari-video", "credentials.env"),
  );
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

function resolveFalKey() {
  const secret = readCredentials().get("FAL_KEY");
  if (!secret) {
    throw new PublicError(
      `FAL_KEY が未設定です。${credentialsPath()} に FAL_KEY=... を 1 行追加してください`
      + "（取得先: https://fal.ai/dashboard/keys）。",
    );
  }
  return secret;
}

function profileMetaPath(profileName) {
  return path.join(os.homedir(), ".config", "akari-video", "voice-profiles", profileName, "meta.json");
}

function readProfileMeta(profileName) {
  const metaPath = profileMetaPath(profileName);
  let raw;
  try {
    raw = fs.readFileSync(metaPath, "utf8");
  } catch {
    throw new PublicError(`声プロファイルが見つかりません: ${metaPath}`);
  }
  let meta;
  try {
    meta = JSON.parse(raw);
  } catch {
    throw new PublicError(`声プロファイルの meta.json が不正な JSON です: ${metaPath}`);
  }
  if (typeof meta.embedding_source_url !== "string" || !meta.embedding_source_url) {
    throw new PublicError(`声プロファイルの meta.json に embedding_source_url がありません: ${metaPath}`);
  }
  if (typeof meta.reference_text !== "string" || !meta.reference_text) {
    throw new PublicError(`声プロファイルの meta.json に reference_text がありません: ${metaPath}`);
  }
  return meta;
}

function buildFalPayload(readingText, meta) {
  return {
    text: readingText,
    language: "Japanese",
    speaker_voice_embedding_file_url: meta.embedding_source_url,
    reference_text: meta.reference_text,
    max_new_tokens: 2048,
  };
}

function estimateFalCostUsd(readingText) {
  return Number(((readingText.length / 1000) * FAL_USD_PER_1000_CHARS).toFixed(6));
}

async function synthesizeFal(readingText, meta, falKey) {
  const payload = buildFalPayload(readingText, meta);
  let response;
  try {
    response = await fetch(FAL_TTS_URL, {
      method: "POST",
      headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new PublicError("fal API へのネットワーク接続に失敗しました");
  }
  if (!response.ok) throw new PublicError(`fal API が HTTP ${response.status} を返しました`);
  const result = await response.json();
  const audioUrl = result?.audio?.url;
  if (typeof audioUrl !== "string" || !audioUrl) {
    throw new PublicError("fal API の応答に audio.url がありません");
  }
  const audioResponse = await fetch(audioUrl);
  if (!audioResponse.ok) {
    throw new PublicError(`生成音声の取得に失敗しました（HTTP ${audioResponse.status}）`);
  }
  return Buffer.from(await audioResponse.arrayBuffer());
}

// --- VOICEVOX ローカルエンジン ---

async function isVoicevoxUp() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(`${VOICEVOX_BASE_URL}/version`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureVoicevoxEngine() {
  if (await isVoicevoxUp()) return { startedByUs: false, child: null };
  if (!fs.existsSync(VOICEVOX_RUN_PATH)) {
    throw new PublicError(`VOICEVOX エンジンが見つかりません: ${VOICEVOX_RUN_PATH}`);
  }
  const child = spawn(VOICEVOX_RUN_PATH, [], { stdio: "ignore" });
  const deadline = Date.now() + VOICEVOX_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isVoicevoxUp()) return { startedByUs: true, child };
    await sleep(1_000);
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // 起動確認前にプロセスが落ちている場合は無視する。
  }
  throw new PublicError(
    `VOICEVOX エンジンの起動が ${VOICEVOX_STARTUP_TIMEOUT_MS / 1000} 秒でタイムアウトしました。`,
  );
}

async function stopVoicevoxEngine(child) {
  if (!child) return;
  try {
    child.kill("SIGTERM");
  } catch {
    // 既に終了している場合は無視する。
  }
}

async function getVoicevoxVersion() {
  const response = await fetch(`${VOICEVOX_BASE_URL}/version`);
  if (!response.ok) throw new PublicError(`VOICEVOX /version が HTTP ${response.status} を返しました`);
  return String(await response.json()).trim();
}

async function resolveVoicevoxSpeakerName(speakerId) {
  const response = await fetch(`${VOICEVOX_BASE_URL}/speakers`);
  if (!response.ok) throw new PublicError(`VOICEVOX /speakers が HTTP ${response.status} を返しました`);
  const speakers = await response.json();
  for (const speaker of Array.isArray(speakers) ? speakers : []) {
    const styles = Array.isArray(speaker?.styles) ? speaker.styles : [];
    if (styles.some((style) => style.id === speakerId)) return String(speaker.name);
  }
  return "unknown";
}

async function synthesizeVoicevox(readingText, speakerId) {
  const queryUrl = `${VOICEVOX_BASE_URL}/audio_query?speaker=${speakerId}&text=${encodeURIComponent(readingText)}`;
  const queryResponse = await fetch(queryUrl, { method: "POST" });
  if (!queryResponse.ok) {
    throw new PublicError(`VOICEVOX /audio_query が HTTP ${queryResponse.status} を返しました`);
  }
  const query = await queryResponse.json();

  const synthesisUrl = `${VOICEVOX_BASE_URL}/synthesis?speaker=${speakerId}`;
  const synthesisResponse = await fetch(synthesisUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(query),
  });
  if (!synthesisResponse.ok) {
    throw new PublicError(`VOICEVOX /synthesis が HTTP ${synthesisResponse.status} を返しました`);
  }
  return Buffer.from(await synthesisResponse.arrayBuffer());
}

// --- edit.json への --apply ---

function validateEditScriptPath() {
  return fileURLToPath(new URL("../../../packages/schemas/bin/validate-edit.mjs", import.meta.url));
}

function applyToEditJson(projectDir, entry) {
  const editPath = path.join(projectDir, "edit.json");
  let originalText;
  try {
    originalText = fs.readFileSync(editPath, "utf8");
  } catch {
    throw new PublicError(`--apply には既存の edit.json が必要です: ${editPath}`);
  }
  let edit;
  try {
    edit = JSON.parse(originalText);
  } catch {
    throw new PublicError(`edit.json を JSON として読めません: ${editPath}`);
  }

  if (!isPlainObject(edit.audio)) edit.audio = {};
  if (!Array.isArray(edit.audio.narration)) edit.audio.narration = [];
  edit.audio.narration.push(entry);

  fs.writeFileSync(editPath, `${JSON.stringify(edit, null, 2)}\n`, "utf8");

  const validateResult = spawnSync("node", [validateEditScriptPath(), editPath], { encoding: "utf8" });
  if (validateResult.status !== 0) {
    fs.writeFileSync(editPath, originalText, "utf8");
    const detail = `${validateResult.stdout ?? ""}${validateResult.stderr ?? ""}`.trim();
    throw new PublicError(
      `validate-edit が NG のため edit.json への書き込みをロールバックしました。\n${detail}`,
    );
  }
  process.stderr.write(`edit.json に ${entry.id} を追加しました（validate-edit: PASS）。\n`);
}

// --- dry-run ---

function maskKey(secret) {
  // 実際のキー文字は 1 文字も出力しない（manage-connections ハードルール「表示は常にマスク」）。
  return secret ? "***configured***" : "***unconfigured***";
}

async function runDryRun(options, readingText) {
  const outputPath = relativeOutputPath(options.id ?? computeNextId(options.project), options.engine);
  if (options.engine === "voicevox") {
    printJson({
      dry_run: true,
      engine: "voicevox",
      output_path: outputPath,
      estimated_cost_usd: 0,
      request: {
        base_url: VOICEVOX_BASE_URL,
        steps: [
          `POST /audio_query?speaker=${options.speaker}&text=<読み原稿>`,
          `POST /synthesis?speaker=${options.speaker}`,
        ],
        speaker: Number(options.speaker),
        text: readingText,
      },
    });
    return;
  }

  const falKey = resolveFalKey();
  const meta = readProfileMeta(options.profile);
  const payload = buildFalPayload(readingText, meta);
  const estimatedCostUsd = estimateFalCostUsd(readingText);
  printJson({
    dry_run: true,
    engine: "fal-qwen3",
    output_path: outputPath,
    estimated_cost_usd: estimatedCostUsd,
    request: {
      endpoint: FAL_TTS_URL,
      headers: { Authorization: `Key ${maskKey(falKey)}` },
      body: payload,
    },
  });
}

// --- generate 本体 ---

async function runGenerate(options) {
  const readingText = readTextFile(options.readingFile, "読み原稿");
  const scriptText = options.scriptFile ? readTextFile(options.scriptFile, "表示原稿") : null;

  if (options.dryRun) {
    await runDryRun(options, readingText);
    return;
  }

  const id = options.id ?? computeNextId(options.project);
  const relativePath = relativeOutputPath(id, options.engine);
  const outputPath = path.join(options.project, relativePath);

  let audioBuffer;
  let provenance;

  if (options.engine === "voicevox") {
    const speakerId = Number(options.speaker);
    if (!Number.isInteger(speakerId) || speakerId < 0) {
      throw new PublicError("--speaker には 0 以上の整数を指定してください");
    }
    const engineHandle = await ensureVoicevoxEngine();
    try {
      audioBuffer = await synthesizeVoicevox(readingText, speakerId);
      const [version, speakerName] = await Promise.all([
        getVoicevoxVersion(),
        resolveVoicevoxSpeakerName(speakerId),
      ]);
      provenance = {
        provider: "voicevox",
        engine: `voicevox-${version}`,
        voice: `speaker:${speakerId}(${speakerName})`,
        credit: `VOICEVOX:${speakerName}`,
        generated_at: new Date().toISOString(),
      };
    } finally {
      if (engineHandle.startedByUs) await stopVoicevoxEngine(engineHandle.child);
    }
  } else {
    const falKey = resolveFalKey();
    const meta = readProfileMeta(options.profile);
    const estimatedCostUsd = estimateFalCostUsd(readingText);
    process.stderr.write(
      `fal-qwen3 推定費用: 約 $${estimatedCostUsd}（${readingText.length} 文字 × $${FAL_USD_PER_1000_CHARS}/1000字）\n`,
    );
    if (!options.yes) {
      printJson({
        sent: false,
        engine: "fal-qwen3",
        estimated_cost_usd: estimatedCostUsd,
        reason: "費用承認（--yes）がありません。実リクエストは送信していません。",
      });
      process.exitCode = 2;
      return;
    }
    // --yes が明示された場合のみ、ここで初めて課金の発生する fal API を呼び出す。
    audioBuffer = await synthesizeFal(readingText, meta, falKey);
    provenance = {
      provider: "fal",
      engine: "qwen-3-tts-1.7b",
      voice: `profile:${options.profile}`,
      generated_at: new Date().toISOString(),
    };
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, audioBuffer);

  const entry = {
    id,
    path: relativePath,
    t: options.t,
    gain_db: options.gainDb,
    ...(scriptText ? { script: scriptText } : {}),
    reading: readingText,
    provenance,
  };

  if (options.apply) applyToEditJson(options.project, entry);

  printJson(entry);
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
    await runGenerate(options);
  } catch (error) {
    const exitCode = error instanceof PublicError ? error.exitCode : 1;
    const message = error instanceof PublicError ? error.message : `内部処理に失敗しました: ${error?.message ?? error}`;
    process.stderr.write(`${message}\n`);
    printJson({ error: message });
    process.exitCode = exitCode;
  }
}

await main();
