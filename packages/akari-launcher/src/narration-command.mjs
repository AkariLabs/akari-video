// 原稿テキストから VOICEVOX（ローカル）または fal Qwen3-TTS（自声クローン）でナレーション音声を
// 生成し、docs/contract-2026-07-20-edit-json-v1-narration.md 準拠のエントリを組み立てる。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const VOICEVOX_BASE_URL = "http://127.0.0.1:50021";
const VOICEVOX_RUN_ENV = "VOICEVOX_RUN";
const VOICEVOX_STARTUP_TIMEOUT_MS = 60_000;
const FAL_TTS_URL = "https://fal.run/fal-ai/qwen-3-tts/text-to-speech/1.7b";
const FAL_USD_PER_1000_CHARS = 0.09;
const GEMINI_TTS_URL = "https://fal.run/fal-ai/gemini-tts";
const GEMINI_USD_PER_1000_CHARS = 0.05;
const IRODORI_DEFAULT_URL = "http://127.0.0.1:8088";
const IRODORI_SETUP_URL = "https://github.com/Aratako/Irodori-TTS-Server";
const IRODORI_RECIPES = [
  { id: "narrator-male", label: "落ち着いた男性ナレーター", caption: "落ち着いた低めの男性の声。聞き取りやすく、ナレーションのように丁寧に話す。", default: true },
  { id: "bright-female", label: "明るい若い女性", caption: "明るく元気な若い女性の声。はきはきと楽しそうに話す。" },
  { id: "slow-explainer", label: "低くゆっくりした解説", caption: "低めで落ち着いた声。ゆっくり、一語ずつ丁寧に説明する。" },
];
function irodoriEndpoint(value, env = process.env) {
  const raw = value ?? env.AKARI_IRODORI_URL ?? IRODORI_DEFAULT_URL;
  let url;
  try { url = new URL(raw); } catch { throw new PublicError("--irodori-url は http または https の URL にしてください", 2); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new PublicError("--irodori-url は http または https のサーバー URL にしてください", 2);
  }
  return { base: `${url.origin}${url.pathname.replace(/\/+$/, "")}`, server: `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`,
    network: !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) };
}
function irodoriTimeout(env = process.env) {
  const value = Number(env.AKARI_IRODORI_TIMEOUT_MS ?? 600_000);
  if (!Number.isSafeInteger(value) || value <= 0) throw new PublicError("AKARI_IRODORI_TIMEOUT_MS は正の整数にしてください", 2);
  return value;
}
const GEMINI_VOICES = Object.entries({
  Leda: "Youthful", Achernar: "Soft", Achird: "Friendly", Algenib: "Gravelly",
  Algieba: "Smooth", Alnilam: "Firm", Aoede: "Breezy", Autonoe: "Bright",
  Callirrhoe: "Easy-going", Charon: "Informative", Despina: "Smooth",
  Enceladus: "Breathy", Erinome: "Clear", Fenrir: "Excitable", Gacrux: "Mature",
  Iapetus: "Clear", Kore: "Firm", Laomedeia: "Upbeat", Orus: "Firm",
  Pulcherrima: "Forward", Puck: "Upbeat", Rasalgethi: "Informative",
  Sadachbia: "Lively", Sadaltager: "Knowledgeable", Schedar: "Even",
  Sulafat: "Warm", Umbriel: "Easy-going", Vindemiatrix: "Gentle",
  Zephyr: "Bright", Zubenelgenubi: "Casual",
}).map(([id, description]) => ({ id, label: `${id}（${description}）`, ...(id === "Leda" ? { default: true } : {}) }));

const usage = [
  "使い方:",
  "  akari narration generate \\",
  "    --project <projectDir> --engine <voicevox|gemini-tts|irodori|fal-qwen3> \\",
  "    (--reading-file <読み原稿.txt> | --text <原稿>) [--script-file <表示原稿.txt>] \\",
  "    [--t <タイムライン秒>] [--gain-db 0] [--id n-0001] \\",
  "    [--speaker 3] [--voice Leda] [--style <text>] [--speed 1] \\",
  "    [--profile owner-ja] [--irodori-url http://127.0.0.1:8088] [--caption-ref c-0001] [--dry-run] [--yes] [--apply] [--json]",
].join("\n");
const commandUsage = [
  "使い方: akari narration <subcommand> [options]",
  "",
  "サブコマンド:",
  "  generate  原稿からナレーション音声を生成する",
  "  engines   エンジン一覧を表示する",
  "  start     VOICEVOX エンジンを起動する",
  "  stop      AKARI が起動した VOICEVOX エンジンを止める",
  "  voices    声一覧を表示する",
  "",
  usage,
].join("\n");

class PublicError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

function printJson(value, log = (line) => console.log(line)) {
  log(JSON.stringify(value, null, 2));
}
function printCompactJson(value, log) { log(JSON.stringify(value)); }

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
  "--voice", "--style", "--speed", "--text", "--caption-ref", "--irodori-url",
]);
const FLAG_OPTIONS = new Set(["--dry-run", "--yes", "--apply", "--json"]);

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
    voice: null, style: null, speed: null, text: null, captionRef: null, irodoriUrl: null, json: false,
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
        case "--voice": options.voice = value; break;
        case "--style": options.style = value; break;
        case "--speed": options.speed = Number(value); break;
        case "--text": options.text = value; break;
        case "--caption-ref": options.captionRef = value; break;
        case "--irodori-url": options.irodoriUrl = value; break;
        default: break;
      }
    } else if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--yes") {
      options.yes = true;
    } else if (argument === "--apply") {
      options.apply = true;
    } else if (argument === "--json") {
      options.json = true;
    } else {
      throw new PublicError(`不明な引数です: ${argument}\n${usage}`, 2);
    }
  }

  if (!options.project) throw new PublicError("--project が必要です");
  if (!["voicevox", "gemini-tts", "irodori", "fal-qwen3"].includes(options.engine)) {
    throw new PublicError("--engine には voicevox、gemini-tts、irodori または fal-qwen3 を指定してください", 2);
  }
  if (options.engine === "irodori") {
    options.voice ??= "narrator-male";
    if (!IRODORI_RECIPES.some(recipe => recipe.id === options.voice) && options.voice !== "custom") throw new PublicError("彩の声レシピが不明です", 2);
    if (options.voice === "custom" && !options.style?.trim()) throw new PublicError("自分で書く声には --style が必要です", 2);
    options.irodori = irodoriEndpoint(options.irodoriUrl);
    irodoriTimeout();
  } else options.voice ??= "Leda";
  if (!options.readingFile && !options.text) throw new PublicError("--reading-file または --text が必要です");
  if (options.engine === "gemini-tts" && !GEMINI_VOICES.some(({ id }) => id === options.voice)) {
    throw new PublicError(`--voice に使える声: ${GEMINI_VOICES.map(({ id }) => id).join(", ")}`, 2);
  }
  if (options.speed !== null && (!isFiniteNumber(options.speed) || options.speed < (options.engine === "irodori" ? 0.25 : 0.5) || options.speed > (options.engine === "irodori" ? 4 : 2))) {
    throw new PublicError(options.engine === "irodori" ? "--speed は 0.25 から 4.0 の範囲で指定してください" : "--speed は 0.5 から 2.0 の範囲で指定してください", 2);
  }
  if (options.captionRef !== null && !/^c-\d{4}$/.test(options.captionRef)) {
    throw new PublicError("--caption-ref は c- に続く 4 桁の数字で指定してください", 2);
  }
  if (options.t === null && !options.apply) options.t = 0;
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
    for (const track of edit?.tracks ?? []) for (const item of track?.items ?? []) {
      if (typeof item?.id === "string" && /^n-\d{4}$/.test(item.id)) ids.push(item.id);
    }
  } catch {
    // edit.json が無い、または narration 配列が無い場合は n-0001 から開始する。
  }
  const max = ids.reduce((accumulator, id) => Math.max(accumulator, Number(id.slice(2))), 0);
  return `n-${String(max + 1).padStart(4, "0")}`;
}

function extensionFor(engine) {
  return ["voicevox", "irodori"].includes(engine) ? "wav" : "mp3";
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
function estimateGeminiTtsCostUsd(chars) {
  return Number(((chars / 1000) * GEMINI_USD_PER_1000_CHARS).toFixed(6));
}

async function synthesizeGeminiTts(readingText, { voice, model, style, falKey }) {
  const payload = {
    prompt: readingText, voice, model,
    output_format: "mp3", language_code: "Japanese (Japan)",
    ...(style ? { style_instructions: style } : {}),
  };
  let response;
  try {
    response = await fetch(GEMINI_TTS_URL, {
      method: "POST",
      headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new PublicError("fal API へのネットワーク接続に失敗しました");
  }
  if (!response.ok) throw new PublicError(`fal API が HTTP ${response.status} を返しました`);
  const audioUrl = (await response.json())?.audio?.url;
  if (typeof audioUrl !== "string" || !audioUrl) throw new PublicError("fal API の応答に audio.url がありません");
  const audioResponse = await fetch(audioUrl);
  if (!audioResponse.ok) throw new PublicError(`生成音声の取得に失敗しました（HTTP ${audioResponse.status}）`);
  return Buffer.from(await audioResponse.arrayBuffer());
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

/**
 * VOICEVOX エンジン（vv-engine の `run` 実行ファイル）のパスを解決する。
 * 優先順位: 環境変数 `VOICEVOX_RUN`（絶対パス直指定）→ platform 別既定インストール先。
 * 純粋関数にして `platform` / `env` を注入でき、実プラットフォームに依存せずテストできる
 * ようにする（darwin 既定パスは不変。win32 既定パスの根拠は report.md 参照）。
 */
export function resolveVoicevoxRunPath(platform = process.platform, env = process.env, exists = fs.existsSync) {
  const override = env[VOICEVOX_RUN_ENV];
  if (override) return override;

  if (platform === "darwin") {
    const candidates = ["/Applications/VOICEVOX.app/Contents/Resources/vv-engine/run",
      path.join(env.HOME || os.homedir(), "Applications", "VOICEVOX.app", "Contents", "Resources", "vv-engine", "run")];
    return candidates.find(candidate => exists(candidate)) || candidates[0];
  }
  if (platform === "win32") {
    // VOICEVOX 0.16+ の既定インストーラ配置先（root repo 未検証・GitHub issue で確認済み。
    // 根拠: report.md 参照）。`%LOCALAPPDATA%` が無い実行環境向けに homedir から組み立てる
    // fallback も用意する。
    const localAppData = env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "Programs", "VOICEVOX", "vv-engine", "run.exe");
  }
  throw new PublicError(
    `VOICEVOX の既定インストール先を ${platform} 向けに解決できません。` +
      `環境変数 ${VOICEVOX_RUN_ENV} に run 実行ファイルの絶対パスを指定してください。`,
  );
}

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
  const runPath = resolveVoicevoxRunPath();
  if (!fs.existsSync(runPath)) {
    throw new PublicError(`VOICEVOX エンジンが見つかりません: ${runPath}`);
  }
  const child = spawn(runPath, [], { stdio: "ignore" });
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

function voicevoxPidPath(env = process.env, homeDir = os.homedir()) {
  return path.join(env.AKARI_HOME || path.join(homeDir, ".akari"), "run", "voicevox.pid");
}

async function probeVoicevox(fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetchImpl(`${VOICEVOX_BASE_URL}/version`, { signal: controller.signal });
    return response.ok ? { running: true, version: String(await response.json()).trim() } : { running: false };
  } catch { return { running: false }; }
  finally { clearTimeout(timer); }
}

function defaultProcessAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

function defaultProcessCommand(pid) {
  if (process.platform === "win32") return null;
  const result = spawnSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8", timeout: 3_000, maxBuffer: 64 * 1024,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function managedVoicevoxPid(runtime = {}) {
  const fileSystem = runtime.fsImpl || fs;
  const env = runtime.env || process.env;
  const pidPath = runtime.pidPath || voicevoxPidPath(env, runtime.homeDir);
  let pid;
  try {
    pid = Number(fileSystem.readFileSync(pidPath, "utf8").trim());
  } catch { return null; }
  let runPath;
  try {
    runPath = resolveVoicevoxRunPath(runtime.platform || process.platform, env,
      candidate => fileSystem.existsSync(candidate));
  } catch { /* 実行ファイルを特定できなければ停止しない */ }
  let command = null;
  try {
    if (Number.isSafeInteger(pid) && pid > 0 && (runtime.isProcessAlive || defaultProcessAlive)(pid)) {
      command = (runtime.readProcessCommand || defaultProcessCommand)(pid);
    }
  } catch { /* 照合できない PID は stale として扱う */ }
  const matches = runPath && typeof command === "string" &&
    [runPath, `"${runPath}"`].some(executable => command === executable || command.startsWith(`${executable} `));
  if (matches) return pid;
  fileSystem.rmSync(pidPath, { force: true });
  return null;
}

async function startVoicevox(runtime = {}) {
  const fetchImpl = runtime.fetchImpl || fetch;
  const fileSystem = runtime.fsImpl || fs;
  const env = runtime.env || process.env;
  const pidPath = runtime.pidPath || voicevoxPidPath(env, runtime.homeDir);
  managedVoicevoxPid(runtime); // 前回の PID が stale なら、既に別経路で起動したアプリを守るため削除する。
  const probe = await probeVoicevox(fetchImpl);
  if (probe.running) return { status: "ok", already_running: true, version: probe.version };
  const runPath = resolveVoicevoxRunPath(runtime.platform || process.platform, env, candidate => fileSystem.existsSync(candidate));
  if (!fileSystem.existsSync(runPath)) throw new PublicError("VOICEVOX エンジンが見つかりません。公式サイトから導入してください。");
  const child = (runtime.spawnImpl || spawn)(runPath, [], { detached: true, windowsHide: true, stdio: "ignore", env });
  child.on?.('error', () => { /* pid が無い場合は直後に失敗として扱う */ });
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) throw new PublicError("VOICEVOX を起動できませんでした。");
  child.unref();
  fileSystem.mkdirSync(path.dirname(pidPath), { recursive: true });
  fileSystem.writeFileSync(pidPath, `${child.pid}\n`, { mode: 0o600 });
  const now = runtime.now || Date.now;
  const pause = runtime.sleep || sleep;
  const deadline = now() + VOICEVOX_STARTUP_TIMEOUT_MS;
  while (now() < deadline) {
    const state = await probeVoicevox(fetchImpl);
    if (state.running) return { status: "ok", already_running: false, version: state.version };
    await pause(1000);
  }
  try { (runtime.killProcess || process.kill)(child.pid, "SIGTERM"); } catch { /* 終了済み */ }
  fileSystem.rmSync(pidPath, { force: true });
  throw new PublicError("VOICEVOX エンジンの起動が 60 秒でタイムアウトしました。");
}

async function stopManagedVoicevox(runtime = {}) {
  const fileSystem = runtime.fsImpl || fs;
  const pidPath = runtime.pidPath || voicevoxPidPath(runtime.env || process.env, runtime.homeDir);
  const pid = managedVoicevoxPid(runtime);
  if (!pid) return { status: "ok", stopped: false, managed: false };
  try { (runtime.killProcess || process.kill)(pid, "SIGTERM"); }
  catch (error) {
    if (error?.code !== "ESRCH") throw error;
    fileSystem.rmSync(pidPath, { force: true });
    return { status: "ok", stopped: false, managed: false };
  }
  fileSystem.rmSync(pidPath, { force: true });
  const pause = runtime.sleep || sleep;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (!(await probeVoicevox(runtime.fetchImpl || fetch)).running) break;
    await pause(250);
  }
  return { status: "ok", stopped: true, managed: true };
}

async function resolveVoicevoxSpeakerName(speakerId) {
  const response = await fetch(`${VOICEVOX_BASE_URL}/speakers`);
  if (!response.ok) throw new PublicError(`VOICEVOX /speakers が HTTP ${response.status} を返しました`);
  const speakers = await response.json();
  for (const speaker of Array.isArray(speakers) ? speakers : []) {
    const styles = Array.isArray(speaker?.styles) ? speaker.styles : [];
    const style = styles.find((candidate) => candidate.id === speakerId);
    if (style) return `${speaker.name} ${style.name}`;
  }
  return "unknown";
}

async function synthesizeVoicevox(readingText, speakerId, speed) {
  const queryUrl = `${VOICEVOX_BASE_URL}/audio_query?speaker=${speakerId}&text=${encodeURIComponent(readingText)}`;
  const queryResponse = await fetch(queryUrl, { method: "POST" });
  if (!queryResponse.ok) {
    throw new PublicError(`VOICEVOX /audio_query が HTTP ${queryResponse.status} を返しました`);
  }
  const query = await queryResponse.json();
  if (speed !== null) query.speedScale = speed;

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
  return fileURLToPath(new URL("../../schemas/bin/validate-edit.mjs", import.meta.url));
}

function applyToEditJson(projectDir, entry, io) {
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
  io.logError(`edit.json に ${entry.id} を追加しました（validate-edit: PASS）。`);
}

// --- dry-run ---

function maskKey(secret) {
  // 実際のキー文字は 1 文字も出力しない（manage-connections ハードルール「表示は常にマスク」）。
  return secret ? "***configured***" : "***unconfigured***";
}

async function probeIrodori(endpoint, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${endpoint.base}/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch { return false; }
}

async function synthesizeIrodori(readingText, options, fetchImpl = fetch) {
  const caption = options.style?.trim() || IRODORI_RECIPES.find(recipe => recipe.id === options.voice)?.caption;
  let response;
  try {
    response = await fetchImpl(`${options.irodori.base}/v1/audio/speech`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(irodoriTimeout()),
      body: JSON.stringify({ model: "irodori-tts", input: readingText, voice: "none", response_format: "wav",
        speed: options.speed ?? 1, irodori: { caption } }),
    });
  } catch (error) { throw new PublicError(`彩サーバーに接続できません: ${error?.message ?? error}`); }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new PublicError(`彩サーバーが音声を返しませんでした（HTTP ${response.status}）: ${buffer.toString("utf8", 0, 300)}`);
  }
  return buffer;
}

async function listEngines(runtime = {}) {
  let voicevox;
  const state = await probeVoicevox(runtime.fetchImpl || fetch);
  const fileSystem = runtime.fsImpl || fs;
  let appFound = false;
  try { appFound = fileSystem.existsSync(resolveVoicevoxRunPath(runtime.platform || process.platform, runtime.env || process.env,
    candidate => fileSystem.existsSync(candidate))); } catch { /* 未対応 OS */ }
  const ownedPid = managedVoicevoxPid(runtime);
  const detail = { running: state.running, ...(state.version ? { version: state.version } : {}), app_found: appFound,
    managed: state.running && Boolean(ownedPid) };
  if (state.running) {
    voicevox = { state: "available", label: "VOICEVOX を使用できます", detail };
  } else {
    voicevox = appFound
      ? { state: "needs", label: "VOICEVOX を起動します（自動）", detail }
      : { state: "unconfigured", label: "VOICEVOX をインストール", detail: { ...detail, setup_url: "https://voicevox.hiroshiba.jp/" } };
  }
  const configured = Boolean(readCredentials().get("FAL_KEY"));
  const falAvailability = configured
    ? { state: "available", label: "fal を使用できます" }
    : { state: "unconfigured", label: "fal の鍵を登録" };
  const profilesDir = path.join(os.homedir(), ".config", "akari-video", "voice-profiles");
  const hasProfiles = fs.existsSync(profilesDir) && fs.readdirSync(profilesDir, { withFileTypes: true }).some((entry) => entry.isDirectory());
  let endpoint;
  try { endpoint = irodoriEndpoint(runtime.irodoriUrl, runtime.env || process.env); }
  catch (error) { if (!(error instanceof PublicError)) throw error; }
  const irodoriAvailable = endpoint ? await probeIrodori(endpoint, runtime.fetchImpl || fetch) : false;
  return { version: 1, engines: [
    { id: "voicevox", label: "VOICEVOX", place: "local", price: { usd_per_1000_chars: 0, verified: true }, availability: voicevox, credit_required: true, supports: { speed: true, style: false } },
    { id: "gemini-tts", label: "Gemini 2.5 Flash TTS", place: "cloud", provider: "fal", price: { usd_per_1000_chars: GEMINI_USD_PER_1000_CHARS, verified: false, as_of: "2026-09-22" }, availability: falAvailability, default_voice: "Leda", credit_required: false, supports: { speed: false, style: true } },
    { id: "irodori", label: "彩（Irodori-TTS）", place: endpoint?.network ? "network" : "local", experimental: true,
      price: { usd_per_1000_chars: 0, verified: true }, credit_required: false, default_voice: "narrator-male",
      supports: { speed: true, style: true }, availability: !endpoint
        ? { state: "unconfigured", label: "接続先 URL が正しくありません（お試し）", detail: { setup_url: IRODORI_SETUP_URL } }
        : irodoriAvailable
        ? { state: "available", label: "お試し · 接続済み", detail: { url: endpoint.server } }
        : { state: "unconfigured", label: "Irodori サーバーにつながりません（お試し）", detail: { setup_url: IRODORI_SETUP_URL } } },
    { id: "fal-qwen3", label: "fal Qwen3-TTS", place: "cloud", provider: "fal", price: { usd_per_1000_chars: FAL_USD_PER_1000_CHARS, verified: false }, availability: !configured ? falAvailability : hasProfiles ? { state: "available", label: "声プロファイルを使用できます" } : { state: "needs", label: "声プロファイルを作成" }, credit_required: false, supports: { speed: false, style: false } },
  ] };
}

async function listVoices(engine) {
  if (engine === "irodori") return [...IRODORI_RECIPES.map(({ id, label, default: isDefault }) => ({ id, label, ...(isDefault ? { default: true } : {}) })),
    { id: "custom", label: "自分で書く（声の指示）" }];
  if (engine === "gemini-tts") return GEMINI_VOICES;
  if (engine === "voicevox") {
    const handle = await ensureVoicevoxEngine();
    try {
      const response = await fetch(`${VOICEVOX_BASE_URL}/speakers`);
      if (!response.ok) throw new PublicError(`VOICEVOX /speakers が HTTP ${response.status} を返しました`, 3);
      const speakers = await response.json();
      return speakers.flatMap((speaker) => (speaker.styles ?? []).map((style) => ({
        id: String(style.id), label: `${speaker.name} ${style.name}`, group: speaker.name,
      })));
    } finally {
      if (handle.startedByUs) await stopVoicevoxEngine(handle.child);
    }
  }
  if (engine === "fal-qwen3") {
    const profilesDir = path.join(os.homedir(), ".config", "akari-video", "voice-profiles");
    return fs.existsSync(profilesDir) ? fs.readdirSync(profilesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory()).map((entry) => ({ id: entry.name, label: entry.name })) : [];
  }
  throw new PublicError(`声一覧に対応していないエンジンです: ${engine}`, 2);
}

function parseListArguments(args) {
  let engine = null;
  let irodoriUrl = null;
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === "--json") continue;
    if (args[index] === "--engine" && args[index + 1]) { engine = args[++index]; continue; }
    if (args[index] === "--irodori-url" && args[index + 1]) { irodoriUrl = args[++index]; continue; }
    throw new PublicError(`不明な引数です: ${args[index]}`, 2);
  }
  if (args[0] === "voices" && !engine) throw new PublicError("voices には --engine が必要です", 2);
  return { engine, irodoriUrl };
}

async function runDryRun(options, readingText, io) {
  const outputPath = relativeOutputPath(options.id ?? computeNextId(options.project), options.engine);
  const emit = options.json ? printCompactJson : printJson;
  if (options.engine === "voicevox") {
    emit({
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
    }, io.log);
    return;
  }

  if (options.engine === "gemini-tts") {
    emit({
      dry_run: true, engine: options.engine, output_path: outputPath,
      estimated_cost_usd: estimateGeminiTtsCostUsd(readingText.length),
      request: { endpoint: GEMINI_TTS_URL, headers: { Authorization: `Key ${maskKey(readCredentials().get("FAL_KEY"))}` },
        body: { prompt: readingText, voice: options.voice, model: "gemini-2.5-flash-tts", output_format: "mp3", language_code: "Japanese (Japan)", ...(options.style ? { style_instructions: options.style } : {}) } },
    }, io.log);
    return;
  }
  if (options.engine === "irodori") {
    emit({ dry_run: true, engine: options.engine, output_path: outputPath, estimated_cost_usd: 0,
      request: { endpoint: `${options.irodori.base}/v1/audio/speech`, body: { model: "irodori-tts", input: readingText,
        voice: "none", response_format: "wav", speed: options.speed ?? 1,
        irodori: { caption: options.style?.trim() || IRODORI_RECIPES.find(recipe => recipe.id === options.voice)?.caption } } } }, io.log);
    return;
  }
  const falKey = resolveFalKey();
  const meta = readProfileMeta(options.profile);
  const payload = buildFalPayload(readingText, meta);
  const estimatedCostUsd = estimateFalCostUsd(readingText);
  emit({
    dry_run: true,
    engine: "fal-qwen3",
    output_path: outputPath,
    estimated_cost_usd: estimatedCostUsd,
    request: {
      endpoint: FAL_TTS_URL,
      headers: { Authorization: `Key ${maskKey(falKey)}` },
      body: payload,
    },
  }, io.log);
}

function durationForAudio(buffer, outputPath, engine, warnings) {
  if (["voicevox", "irodori"].includes(engine)) {
    if (buffer.length >= 44 && buffer.toString("ascii", 0, 4) === "RIFF") {
      const bytesPerSecond = buffer.readUInt32LE(28);
      const dataOffset = buffer.indexOf("data", 36, "ascii");
      if (bytesPerSecond > 0 && dataOffset >= 0 && dataOffset + 8 <= buffer.length) {
        return Number((buffer.readUInt32LE(dataOffset + 4) / bytesPerSecond).toFixed(3));
      }
    }
  } else {
    const result = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", outputPath], { encoding: "utf8" });
    const seconds = Number(result.stdout?.trim());
    if (result.status === 0 && Number.isFinite(seconds) && seconds >= 0) return Number(seconds.toFixed(3));
  }
  warnings.push("音声の実尺を取得できませんでした");
  return null;
}

// --- generate 本体 ---

async function runGenerate(options, io) {
  const readingText = options.readingFile ? readTextFile(options.readingFile, "読み原稿") : options.text.trim();
  const scriptText = options.scriptFile ? readTextFile(options.scriptFile, "表示原稿") : options.text;
  if (!readingText) throw new PublicError("読み原稿が空です", 2);

  if (options.dryRun) {
    await runDryRun(options, readingText, io);
    return 0;
  }

  const id = options.id ?? computeNextId(options.project);
  const relativePath = relativeOutputPath(id, options.engine);
  const outputPath = path.join(options.project, relativePath);

  let audioBuffer;
  let provenance;
  let costUsd = 0;
  const warnings = [];
  if (options.speed !== null && !["voicevox", "irodori"].includes(options.engine)) {
    const warning = `${options.engine} は --speed に対応していないため無視しました`;
    warnings.push(warning);
    io.logError(warning);
  }

  if (options.engine === "voicevox") {
    const speakerId = Number(options.speaker);
    if (!Number.isInteger(speakerId) || speakerId < 0) {
      throw new PublicError("--speaker には 0 以上の整数を指定してください");
    }
    const engineHandle = await ensureVoicevoxEngine();
    try {
      audioBuffer = await synthesizeVoicevox(readingText, speakerId, options.speed);
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
  } else if (options.engine === "irodori") {
    audioBuffer = await synthesizeIrodori(readingText, options);
    provenance = { provider: "irodori", engine: "irodori-tts-v4-small", voice: options.style?.trim() ? "caption:custom" : `recipe:${options.voice}`,
      generated_at: new Date().toISOString(), experimental: true, server: options.irodori.server };
  } else {
    const estimatedCostUsd = options.engine === "gemini-tts"
      ? estimateGeminiTtsCostUsd(readingText.length) : estimateFalCostUsd(readingText);
    costUsd = estimatedCostUsd;
    io.logError(`${options.engine} 推定費用: 約 $${estimatedCostUsd}（${readingText.length} 文字）`);
    if (!options.yes) {
      if (options.json) printCompactJson({ version: 1, status: "needs_approval", estimate_usd: estimatedCostUsd, chars: readingText.length,
        ...(options.speed !== null ? { speed_applied: false, warnings } : {}) }, io.log);
      else printJson({ sent: false, engine: options.engine, estimated_cost_usd: estimatedCostUsd,
        reason: "費用承認（--yes）がありません。実リクエストは送信していません。" }, io.log);
      return 2;
    }
    const falKey = resolveFalKey();
    // --yes が明示された場合のみ、ここで初めて課金の発生する fal API を呼び出す。
    if (options.engine === "gemini-tts") {
      audioBuffer = await synthesizeGeminiTts(readingText, { voice: options.voice, model: "gemini-2.5-flash-tts", style: options.style, falKey });
      provenance = { provider: "fal", engine: "gemini-2.5-flash-tts", voice: `gemini:${options.voice}`,
        generated_at: new Date().toISOString(), price_verified: false };
    } else {
      const meta = readProfileMeta(options.profile);
      audioBuffer = await synthesizeFal(readingText, meta, falKey);
      provenance = { provider: "fal", engine: "qwen-3-tts-1.7b", voice: `profile:${options.profile}`,
        generated_at: new Date().toISOString() };
    }
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, audioBuffer);
  const duration = durationForAudio(audioBuffer, outputPath, options.engine, warnings);

  const entry = {
    id,
    path: relativePath,
    t: options.t,
    gain_db: options.gainDb,
    ...(scriptText ? { script: scriptText } : {}),
    reading: readingText,
    ...(options.captionRef ? { caption_ref: options.captionRef } : {}),
    provenance,
  };

  if (options.apply) applyToEditJson(options.project, entry, io);

  if (options.json) printCompactJson({ version: 1, status: "ok", id, path: relativePath,
    duration_s: duration, engine: options.engine, voice: provenance.voice, cost_usd: costUsd,
    applied: options.apply, caption_ref: options.captionRef, provenance, warnings,
    ...(options.speed !== null ? { speed_applied: ["voicevox", "irodori"].includes(options.engine) } : {}) }, io.log);
  else printJson(entry, io.log);
  return 0;
}

export async function runNarrationCommand(args, commandOptions = {}) {
  const io = {
    log: commandOptions.log ?? ((line) => console.log(line)),
    logError: commandOptions.logError ?? ((line) => console.error(line)),
  };

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    io.log(commandUsage);
    return { exitCode: 0 };
  }
  if (args[0] === 'generate' && (args.includes('--help') || args.includes('-h'))) {
    io.log(usage);
    return { exitCode: 0 };
  }
  if (["start", "stop"].includes(args[0])) {
    try {
      if (args.length !== 4 || args[1] !== "--engine" || args[2] !== "voicevox" || args[3] !== "--json") {
        throw new PublicError("start/stop には --engine voicevox --json が必要です", 2);
      }
      printCompactJson(args[0] === "start" ? await startVoicevox(commandOptions.engineRuntime) : await stopManagedVoicevox(commandOptions.engineRuntime), io.log);
      return { exitCode: 0 };
    } catch (error) {
      const message = error instanceof PublicError ? error.message : `VOICEVOX を操作できませんでした: ${error?.message ?? error}`;
      io.logError(message); printCompactJson({ error: message }, io.log);
      return { exitCode: error instanceof PublicError ? error.exitCode : 1 };
    }
  }
  if (["engines", "voices"].includes(args[0])) {
    try {
      const { engine, irodoriUrl } = parseListArguments(args);
      printCompactJson(args[0] === "engines" ? await listEngines({ ...commandOptions.engineRuntime, irodoriUrl }) :
        { version: 1, engine, voices: await listVoices(engine) }, io.log);
      return { exitCode: 0 };
    } catch (error) {
      const message = error instanceof PublicError ? error.message : "声一覧を取得できませんでした";
      io.logError(message);
      printCompactJson({ error: message }, io.log);
      return { exitCode: args[0] === "voices" ? 3 : 2 };
    }
  }

  let parsedOptions;
  try {
    parsedOptions = parseArguments(args);
    const exitCode = await runGenerate(parsedOptions, io);
    return { exitCode };
  } catch (error) {
    const exitCode = error instanceof PublicError ? error.exitCode : 1;
    const message = error instanceof PublicError ? error.message : `内部処理に失敗しました: ${error?.message ?? error}`;
    io.logError(message);
    if (args.includes("--json")) printCompactJson({ error: message }, io.log);
    else printJson({ error: message }, io.log);
    return { exitCode };
  }
}
