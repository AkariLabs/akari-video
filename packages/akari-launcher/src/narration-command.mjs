// 原稿テキストから VOICEVOX（ローカル）または fal Qwen3-TTS（自声クローン）でナレーション音声を
// 生成し、docs/contract-2026-07-20-edit-json-v1-narration.md 準拠のエントリを組み立てる。

import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { preloadMediaBin, resolveMediaCommand } from "./media-bin-loader.mjs";
import { resolveLauncherAssets } from "./repo-assets.mjs";
import { listProfiles, readFalKey, readProviderKey, resolveVoiceProfile } from "./voice-command.mjs";
import { FAL_TTS_ENGINES, DIRECT_TTS_ENGINES, falTtsEngine, ttsEngine, estimateTtsCost, referenceDataUri } from "./tts-engines.mjs";
import { cliText, cliValue } from './i18n.mjs';

await preloadMediaBin();

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
  try { url = new URL(raw); } catch { throw new PublicError(cliText('cli.narration.error.irodoriUrl'), 2); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new PublicError(cliText('cli.narration.error.irodoriServerUrl'), 2);
  }
  return { base: `${url.origin}${url.pathname.replace(/\/+$/, "")}`, server: `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`,
    network: !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) };
}
function irodoriTimeout(env = process.env) {
  const value = Number(env.AKARI_IRODORI_TIMEOUT_MS ?? 600_000);
  if (!Number.isSafeInteger(value) || value <= 0) throw new PublicError(cliText('cli.narration.error.irodoriTimeout'), 2);
  return value;
}
const GEMINI_VOICES = falTtsEngine('gemini-tts').voices;

async function projectLanguage(projectRoot, cliLang) {
  const sourceDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(sourceDir, '..', '..', 'content-language', 'src', 'node.mjs'),
    path.resolve(sourceDir, '..', 'vendor', 'packages', 'content-language', 'src', 'node.mjs')];
  const modulePath = candidates.find(candidate => fs.existsSync(candidate));
  if (!modulePath) throw new PublicError(cliText('cli.narration.error.contentLanguageMissing'), 3);
  const { readContentLanguage } = await import(pathToFileURL(modulePath).href);
  return (await readContentLanguage(projectRoot, { cliLang })).language;
}

const usage = (language) => [
  cliText('cli.narration.help.usage', {}, language),
  "  akari narration generate \\",
  "    --project <projectDir> [--engine <voicevox|gemini-tts|irodori|fal-qwen3|gemini-3.1-flash-tts|elevenlabs-v3|minimax-2.6-hd|chatterbox|index-tts-2|fish-s2.1-pro|gemini-3.8-flash-tts>] \\",
  cliText('cli.narration.help.reading', {}, language),
  cliText('cli.narration.help.timeline', {}, language),
  "    [--lang <code>] [--speaker 3] [--voice Leda] [--style <text>] [--speed 1] \\",
  "    [--profile owner-ja] [--irodori-url http://127.0.0.1:8088] [--caption-ref c-0001] [--dry-run] [--yes] [--apply] [--json]",
].join("\n");
const commandUsage = (language) => [
  cliText('cli.narration.help.commandUsage', {}, language),
  "",
  cliText('cli.narration.help.commands', {}, language),
  ...['generate', 'engines', 'start', 'stop', 'voices', 'verify'].map((name) => cliText(`cli.narration.help.${name}`, {}, language)),
  "",
  usage(language),
].join("\n");
const verifyUsage = () => cliText('cli.narration.help.verifyUsage');
export const VERIFY_THRESHOLDS = Object.freeze({ ok: 0.9, check: 0.7 });

export function normalizeVerifyText(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}\s]/gu, "");
}

export function verifyLanguage(expected) {
  return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(String(expected ?? "").normalize("NFKC")) ? "ja" : "auto";
}

export function compareNarrationText(expected, heard) {
  const a = [...normalizeVerifyText(expected)], b = [...normalizeVerifyText(heard)];
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  const operations = [];
  let i = a.length, j = b.length;
  while (i || j) {
    if (i && j && a[i - 1] === b[j - 1] && dp[i][j] === dp[i - 1][j - 1]) {
      operations.push({ equal: true }); i--; j--;
    } else if (i && j && dp[i][j] === dp[i - 1][j - 1] + 1) {
      operations.push({ expected: a[--i], heard: b[--j] });
    } else if (i && dp[i][j] === dp[i - 1][j] + 1) {
      operations.push({ expected: a[--i], heard: "" });
    } else {
      operations.push({ expected: "", heard: b[--j] });
    }
  }
  const diffs = [];
  let current;
  for (const operation of operations.reverse()) {
    if (operation.equal) { if (current) diffs.push(current); current = null; }
    else {
      current ??= { expected: "", heard: "" };
      current.expected += operation.expected; current.heard += operation.heard;
    }
  }
  if (current) diffs.push(current);
  const rawScore = a.length || b.length ? 1 - dp[a.length][b.length] / Math.max(a.length, b.length) : 1;
  const score = Number(rawScore.toFixed(3));
  return { score, verdict: score >= VERIFY_THRESHOLDS.ok ? "ok" : score >= VERIFY_THRESHOLDS.check ? "check" : "ng", diffs };
}

function parseVerifyArguments(args) {
  const options = { backend: "auto", reading: null, record: null, checkBackend: false };
  const keys = new Set(["--project", "--id", "--audio", "--text", "--reading", "--backend", "--record"]);
  for (let index = 1; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--json" || flag === "--check-backend") { if (flag === "--check-backend") options.checkBackend = true; continue; }
    if (!keys.has(flag) || !args[index + 1] || args[index + 1].startsWith("--")) throw new PublicError(`${cliText('cli.narration.error.invalidArgument', { argument: flag })}\n${verifyUsage()}`, 2);
    options[flag.slice(2)] = args[++index];
  }
  if (!options.project || !["auto", "speechanalyzer", "whisper"].includes(options.backend)) throw new PublicError(verifyUsage(), 2);
  if (!options.checkBackend && ((!!options.id) === (!!options.audio)) ) throw new PublicError(verifyUsage(), 2);
  if (options.id && !/^n-\d{4}$/.test(options.id)) throw new PublicError(cliText('cli.narration.error.idFormat'), 2);
  if (options.audio && options.text === undefined) throw new PublicError(cliText('cli.narration.error.audioTextRequired'), 2);
  return options;
}

function resolveTranscribeModulePath(runtime = {}) {
  const assets = (runtime.resolveLauncherAssets ?? resolveLauncherAssets)();
  const relative = path.join("packages", "akari-tools", "src", "media", "transcribe.mjs");
  const candidates = [path.join(assets.repoRoot, relative),
    assets.mediaScript ? path.resolve(path.dirname(assets.mediaScript), "..", "src", "media", "transcribe.mjs") : null,
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "vendor", relative)];
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) ?? null;
}

async function loadTranscribeModule(runtime = {}) {
  const modulePath = (runtime.resolveTranscribeModulePath ?? resolveTranscribeModulePath)(runtime);
  if (!modulePath) throw new PublicError(cliText('cli.narration.error.localTranscriberMissing'), 3);
  try { return await import(pathToFileURL(modulePath).href); }
  catch { throw new PublicError(cliText('cli.narration.error.localTranscriberUnreadable'), 3); }
}

function verifyBackend(requested, runtime, transcribe) {
  const speech = (runtime.speechAnalyzerAvailable ?? transcribe.speechAnalyzerAvailable)();
  const whisper = (runtime.resolveWhisper ?? transcribe.resolveWhisper)();
  if (requested === "speechanalyzer" && speech || requested === "whisper" && whisper || requested === "auto" && (speech || whisper)) {
    return requested === "auto" ? speech ? "speech-analyzer" : "whisper-cpp" : requested === "whisper" ? "whisper-cpp" : "speech-analyzer";
  }
  throw new PublicError(requested === "speechanalyzer" ? cliText('cli.narration.error.speechUnavailable') : requested === "whisper" ? cliText('cli.narration.error.whisperMissing') : cliText('cli.narration.error.noLocalBackend'), 3);
}

async function runVerify(options, io, runtime = {}) {
  let backend;
  let transcribe;
  try {
    transcribe = await (runtime.loadTranscribeModule ?? loadTranscribeModule)(runtime);
    backend = verifyBackend(options.backend, runtime, transcribe);
  }
  catch (error) {
    if (error instanceof PublicError && error.exitCode === 3) { printCompactJson({ status: "unavailable", reason: error.message }, io.log); return 3; }
    throw error;
  }
  if (options.checkBackend) { printCompactJson({ status: "ok", backend }, io.log); return 0; }
  const root = path.resolve(options.project);
  let entry;
  if (options.id) {
    const edit = JSON.parse(fs.readFileSync(path.join(root, "edit.json"), "utf8"));
    entry = edit.audio?.narration?.find(item => item.id === options.id);
    if (!entry?.path || typeof entry.script !== "string") throw new PublicError(cliText('cli.narration.error.audioOrCaptionMissing', { id: options.id }), 2);
  }
  const expected = entry?.script ?? options.text;
  const audio = path.resolve(root, entry?.path ?? options.audio);
  if (entry && !audio.startsWith(root + path.sep)) throw new PublicError(cliText('cli.narration.error.audioOutside'), 2);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "akari-narration-verify-"));
  const started = performance.now();
  try {
    const copy = path.join(temporary, path.basename(audio));
    fs.copyFileSync(audio, copy);
    const transcript = await (runtime.transcribeMedia ?? transcribe.transcribeMedia)(copy, {
      cwd: temporary, noRecord: true, wordBook: false, lang: verifyLanguage(expected),
      ...(options.backend === "auto" ? {} : { backend }),
    });
    const heard = (transcript.segments ?? []).map(segment => segment.text ?? "").join("").trim();
    const comparison = compareNarrationText(expected, heard);
    const result = { version: 1, status: "ok", id: options.id ?? null, ...comparison, expected, heard,
      ...(options.reading !== null ? { reading: options.reading } : {}),
      backend: transcript.backend ?? backend, elapsed_s: Number(((performance.now() - started) / 1000).toFixed(3)) };
    if (options.record) {
      fs.mkdirSync(options.record, { recursive: true });
      fs.appendFileSync(path.join(options.record, "narration-verify.jsonl"), `${JSON.stringify({ expected, reading: options.reading ?? entry?.reading ?? null,
        heard, score: result.score, verdict: result.verdict, engine: entry?.provenance?.engine ?? null,
        voice: entry?.provenance?.voice ?? null, backend: result.backend, generated_at: new Date().toISOString() })}\n`);
    }
    printCompactJson(result, io.log);
    return 0;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

// 録音の原稿照合を、narration verify と同じ backend・正規化・一致率で再利用する。
export async function verifyNarrationAudio(audio, expected, backend = "auto", runtime = {}) {
  const lines = [];
  const code = await runVerify({ project: path.dirname(audio), audio, text: expected, backend,
    reading: null, record: null, checkBackend: false }, { log: line => lines.push(line), logError: () => {} }, runtime);
  return { code, result: JSON.parse(lines.at(-1)) };
}

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
  "--voice", "--style", "--speed", "--text", "--caption-ref", "--irodori-url", "--out", "--lang",
]);
const FLAG_OPTIONS = new Set(["--dry-run", "--yes", "--apply", "--json"]);

async function parseArguments(argv) {
  if (argv[0] !== "generate") {
    throw new PublicError(`${cliText('cli.narration.error.unknownCommand', {})}\n${usage()}`, 2);
  }
  const options = {
    project: null, lang: null,
    engine: null,
    readingFile: null,
    scriptFile: null,
    t: null,
    gainDb: 0,
    id: null,
    speaker: "3",
    profile: null,
    voice: null, style: null, speed: null, text: null, captionRef: null, irodoriUrl: null, out: null, json: false,
    dryRun: false,
    yes: false,
    apply: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (VALUE_OPTIONS.has(argument)) {
      const value = argv[index + 1];
      if (value === undefined || FLAG_OPTIONS.has(value) || VALUE_OPTIONS.has(value)) {
        throw new PublicError(cliText('cli.narration.error.valueMissing', { argument }));
      }
      index += 1;
      switch (argument) {
        case "--project": options.project = value; break;
        case "--lang": options.lang = value; break;
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
        case "--out": options.out = value; break;
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
      throw new PublicError(`${cliText('cli.narration.error.unknownArgument', { argument })}\n${usage()}`, 2);
    }
  }

  if (!options.project) throw new PublicError(cliText('cli.narration.error.projectRequired', {}));
  options.project = path.resolve(options.project);
  options.language = await projectLanguage(options.project, options.lang);
  options.engine ??= options.language === 'ja' ? 'voicevox' : 'gemini-tts';
  if (!["voicevox", "irodori"].includes(options.engine) && !ttsEngine(options.engine)) {
    throw new PublicError(cliText('cli.narration.error.invalidEngine', { engines: [...FAL_TTS_ENGINES, ...DIRECT_TTS_ENGINES].map(engine => engine.id).join(cliText('cli.narration.list.separator', {})) }), 2);
  }
  if (options.engine === "irodori") {
    options.voice ??= "narrator-male";
    if (!options.profile && !IRODORI_RECIPES.some(recipe => recipe.id === options.voice) && options.voice !== "custom") throw new PublicError(cliText('cli.narration.error.irodoriVoiceUnknown'), 2);
    if (options.voice === "custom" && !options.style?.trim()) throw new PublicError(cliText('cli.narration.error.customVoiceStyle'), 2);
    options.irodori = irodoriEndpoint(options.irodoriUrl);
    irodoriTimeout();
  } else {
    const engine = ttsEngine(options.engine);
    options.voice ??= engine ? (engine.id === 'fish-s2.1-pro' && options.language !== 'ja' ? null
      : engine.default_voices && Object.hasOwn(engine.default_voices, options.language)
      ? engine.default_voices[options.language] : engine.default_voice) : 'Leda';
    if (options.engine === 'fish-s2.1-pro' && !options.voice && !options.profile) {
      throw new PublicError(cliText('cli.narration.error.fishDefaultVoiceMissing'), 2);
    }
  }
  if (!options.readingFile && !options.text) throw new PublicError(cliText('cli.narration.error.scriptRequired'));
  const catalogVoices = ttsEngine(options.engine)?.voices;
  if (catalogVoices && !options.profile && !catalogVoices.some(({ id }) => id === options.voice)) {
    throw new PublicError(cliText('cli.narration.error.voicesAvailable', { voices: catalogVoices.map(({ id }) => id).join(", ") }), 2);
  }
  if (options.speed !== null && (!isFiniteNumber(options.speed) || options.speed < (options.engine === "irodori" ? 0.25 : 0.5) || options.speed > (options.engine === "irodori" ? 4 : 2))) {
    throw new PublicError(options.engine === "irodori" ? cliText('cli.narration.error.irodoriSpeed') : cliText('cli.narration.error.cloudSpeed'), 2);
  }
  if (options.captionRef !== null && !/^c-\d{4}$/.test(options.captionRef)) {
    throw new PublicError(cliText('cli.narration.error.captionRefFormat'), 2);
  }
  if (options.t === null && !options.apply) options.t = 0;
  if (!isFiniteNumber(options.t) || options.t < 0) {
    throw new PublicError(cliText('cli.narration.error.timelineNonNegative'));
  }
  if (!isFiniteNumber(options.gainDb) || options.gainDb < -60 || options.gainDb > 12) {
    throw new PublicError(cliText('cli.narration.error.gainRange'));
  }
  if (options.id !== null && !/^n-\d{4}$/.test(options.id)) {
    throw new PublicError(cliText('cli.narration.error.narrationIdFormat'));
  }
  if ((options.engine === "fal-qwen3" || options.engine === "index-tts-2") && !options.profile) {
    throw new PublicError(cliText('cli.narration.error.profileRequired', { engine: options.engine }));
  }
  if (options.engine === 'elevenlabs-v3' && (options.text?.length ?? 0) > 5000) {
    throw new PublicError(cliText('cli.narration.error.elevenlabsLength'), 2);
  }

  if (options.out !== null) {
    const out = options.out.replace(/\\/gu, '/');
    if (options.apply || options.id || !/^assets\/generated\/candidates\/[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*\.(?:wav|mp3)$/u.test(out)
        || out.split('/').some(part => part === '..') || !out.endsWith(`.${extensionFor(options.engine)}`)) {
      throw new PublicError(cliText('cli.narration.error.outputCandidate'), 2);
    }
    const directory = path.dirname(path.join(options.project, out));
    const root = fs.realpathSync(options.project);
    for (let parent = path.dirname(directory); parent !== options.project && parent.startsWith(`${options.project}${path.sep}`); parent = path.dirname(parent)) {
      if (fs.existsSync(parent) && !fs.realpathSync(parent).startsWith(`${root}${path.sep}`)) {
        throw new PublicError(cliText('cli.narration.error.outputOutside'), 2);
      }
    }
    fs.mkdirSync(directory, { recursive: true });
    if (!fs.realpathSync(directory).startsWith(`${root}${path.sep}`)
        || fs.existsSync(path.join(options.project, out)) || fs.existsSync(path.join(options.project, `${out}.meta.json`))) {
      throw new PublicError(cliText('cli.narration.error.outputUnavailable'), 2);
    }
    options.out = out;
  }
  return options;
}

function readTextFile(filePath, label) {
  let resolved;
  try {
    resolved = path.resolve(filePath);
    const text = fs.readFileSync(resolved, "utf8").trim();
    if (!text) throw new PublicError(cliText('cli.narration.error.textEmpty', { label, path: resolved }));
    return text;
  } catch (error) {
    if (error instanceof PublicError) throw error;
    throw new PublicError(cliText('cli.narration.error.textUnreadable', { label, path: resolved ?? filePath }));
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
  return ["voicevox", "irodori", 'chatterbox', 'gemini-3.8-flash-tts'].includes(engine) ? "wav" : "mp3";
}

function relativeOutputPath(id, engine) {
  return `out/narration/${id}.${extensionFor(engine)}`;
}

function resolveFalKey() {
  const secret = readFalKey(process.env);
  if (!secret) {
    throw new PublicError(
      cliText('cli.narration.error.falKeyGuidance'),
    );
  }
  return secret;
}

function readProfileMeta(profileName) {
  let meta;
  try { meta = resolveVoiceProfile(profileName).meta; }
  catch { throw new PublicError(cliText('cli.narration.error.profileMissing', { name: profileName }), 2); }
  const embedding_source_url = meta.engines?.["fal-qwen3"]?.embedding_source_url;
  if (!embedding_source_url) throw new PublicError(cliText('cli.narration.error.falCopyMissing'), 2);
  if (!meta.reference_text) throw new PublicError(cliText('cli.narration.error.referenceTextMissing', { name: profileName }), 2);
  return { ...meta, embedding_source_url };
}

function guardedProfile(profileName, engine) {
  let record;
  try { record = resolveVoiceProfile(profileName); }
  catch { throw new PublicError(cliText('cli.narration.error.profileMissing', { name: profileName }), 2); }
  const { meta } = record;
  if (meta.consent?.self_voice !== true || meta.consent?.cloud_upload !== true ||
      !(meta.reference?.verification?.score >= 0.7)) {
    throw new PublicError(cliText('cli.narration.error.cloudConsent'), 2);
  }
  if (engine.supports.clone === 'registered' &&
      (engine.id === 'gemini-3.8-flash-tts' ?
        (!/^voice_[A-Za-z0-9_-]+$/.test(meta.engines?.[engine.id]?.voice_id ?? '') || meta.engines[engine.id].stale) :
        (!meta.engines?.[engine.id]?.custom_voice_id || meta.engines[engine.id].stale))) {
    throw new PublicError(cliText('cli.narration.error.providerCopyMissing'), 2);
  }
  const name = meta.reference?.file;
  if (engine.supports.clone === 'per-request' &&
      (!name || path.basename(name) !== name || !fs.existsSync(path.join(record.dir, name)))) {
    throw new PublicError(cliText('cli.narration.error.referenceMissing'), 2);
  }
  if (engine.supports.clone === 'per-request' && meta.reference.sha256 &&
      crypto.createHash('sha256').update(fs.readFileSync(path.join(record.dir, name))).digest('hex') !== meta.reference.sha256) {
    throw new PublicError(cliText('cli.narration.error.referenceChanged'), 2);
  }
  return record;
}

function profileReferenceDataUri(record) {
  try { return referenceDataUri(fs.readFileSync(path.join(record.dir, record.meta.reference.file))); }
  catch (error) { throw new PublicError(error.message, 2); }
}

function irodoriProfileVoice(profileName) {
  let meta;
  try { meta = resolveVoiceProfile(profileName).meta; }
  catch { throw new PublicError(cliText('cli.narration.error.profileMissing', { name: profileName }), 2); }
  const voiceId = meta.engines?.irodori?.voice_id;
  if (!voiceId) throw new PublicError(cliText('cli.narration.error.irodoriCopyMissing'), 2);
  return voiceId;
}

function buildFalPayload(readingText, meta, language = 'ja') {
  return falTtsEngine('fal-qwen3').buildPayload({ text: readingText, profileMeta: meta, language });
}

function estimateFalCostUsd(readingText) {
  return Number(((readingText.length / 1000) * FAL_USD_PER_1000_CHARS).toFixed(6));
}
function estimateGeminiTtsCostUsd(chars) {
  return Number(((chars / 1000) * GEMINI_USD_PER_1000_CHARS).toFixed(6));
}

async function synthesizeCatalog(engine, payload, falKey) {
  let response;
  try {
    const request = engine.request(payload, falKey);
    response = await fetch(request.url, request.options);
  } catch { throw new PublicError(cliText('cli.narration.error.falNetwork')); }
  if (!response.ok) throw new PublicError(cliText('cli.narration.error.falHttp', { status: response.status }));
  const audioUrl = engine.parseAudio(await response.json());
  if (!audioUrl) throw new PublicError(cliText('cli.narration.error.falAudioMissing'));
  const audioResponse = await fetch(audioUrl);
  if (!audioResponse.ok) throw new PublicError(cliText('cli.narration.error.audioFetchHttp', { status: audioResponse.status }));
  return Buffer.from(await audioResponse.arrayBuffer());
}

async function synthesizeDirect(engine, payload, key) {
  let response;
  try { const request = engine.request(payload, key); response = await fetch(request.url, request.options); }
  catch { throw new PublicError(cliText('cli.narration.error.providerNetwork', { provider: cliValue('cli.narration.engine.', engine.label) })); }
  if (!response.ok) throw new PublicError(cliText('cli.narration.error.providerHttp', { provider: cliValue('cli.narration.engine.', engine.label), status: response.status }));
  if (engine.provider === 'fish-audio') return Buffer.from(await response.arrayBuffer());
  try { return engine.parseAudio(await response.json()); }
  catch (error) { throw new PublicError(error.message); }
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
    cliText('cli.narration.error.voicevoxInstallPath', { platform, variable: VOICEVOX_RUN_ENV }),
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
    throw new PublicError(cliText('cli.narration.error.voicevoxPathMissing', { path: runPath }));
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
    cliText('cli.narration.error.voicevoxStartupTimeout', { seconds: VOICEVOX_STARTUP_TIMEOUT_MS / 1000, n: VOICEVOX_STARTUP_TIMEOUT_MS / 1000 }),
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
  if (!response.ok) throw new PublicError(cliText('cli.narration.error.voicevoxVersionHttp', { status: response.status }));
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
  if (!fileSystem.existsSync(runPath)) throw new PublicError(cliText('cli.narration.error.voicevoxMissing'));
  const child = (runtime.spawnImpl || spawn)(runPath, [], { detached: true, windowsHide: true, stdio: "ignore", env });
  child.on?.('error', () => { /* pid が無い場合は直後に失敗として扱う */ });
  if (!Number.isSafeInteger(child.pid) || child.pid <= 0) throw new PublicError(cliText('cli.narration.error.voicevoxStart'));
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
  throw new PublicError(cliText('cli.narration.error.voicevoxTimeout'));
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
  if (!response.ok) throw new PublicError(cliText('cli.narration.error.voicevoxSpeakersHttp', { status: response.status }));
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
    throw new PublicError(cliText('cli.narration.error.voicevoxQueryHttp', { status: queryResponse.status }));
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
    throw new PublicError(cliText('cli.narration.error.voicevoxSynthesisHttp', { status: synthesisResponse.status }));
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
    throw new PublicError(cliText('cli.narration.error.applyEditMissing', { path: editPath }));
  }
  let edit;
  try {
    edit = JSON.parse(originalText);
  } catch {
    throw new PublicError(cliText('cli.narration.error.editJsonUnreadable', { path: editPath }));
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
      cliText('cli.narration.error.applyRolledBack', { detail }),
    );
  }
  io.logError(cliText('cli.narration.status.editUpdated', { id: entry.id }));
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
  const caption = options.profile ? null : options.style?.trim() || IRODORI_RECIPES.find(recipe => recipe.id === options.voice)?.caption;
  const profileVoice = options.profile ? irodoriProfileVoice(options.profile) : null;
  let response;
  try {
    response = await fetchImpl(`${options.irodori.base}/v1/audio/speech`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(irodoriTimeout()),
      body: JSON.stringify({ model: "irodori-tts", input: readingText, voice: profileVoice ?? "none", response_format: "wav",
        speed: options.speed ?? 1, ...(caption ? { irodori: { caption } } : {}) }),
    });
  } catch (error) { throw new PublicError(cliText('cli.narration.error.irodoriConnection', { message: error?.message ?? error })); }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!response.ok || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new PublicError(cliText('cli.narration.error.irodoriAudioHttp', { status: response.status, message: buffer.toString("utf8", 0, 300) }));
  }
  return buffer;
}

function resolveProfileEnv(runtime = {}) {
  const env = runtime.env || process.env;
  const homeDir = env.HOME || env.USERPROFILE || os.homedir();
  return { ...env, HOME: homeDir, AKARI_HOME: env.AKARI_HOME || path.join(homeDir, ".akari") };
}

function listFalProfiles(runtime = {}) {
  try {
    return listProfiles(resolveProfileEnv(runtime)).filter((profile) => profile.legacy || profile.engines.includes("fal-qwen3"));
  } catch {
    // listProfiles はメタデータの読み取り失敗時に throw する。CLI の一覧は維持する。
    return [];
  }
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
    voicevox = { state: "available", label: cliText('cli.narration.engine.voicevoxAvailable'), detail };
  } else {
    voicevox = appFound
      ? { state: "needs", label: cliText('cli.narration.engine.voicevoxStart'), detail }
      : { state: "unconfigured", label: cliText('cli.narration.engine.voicevoxInstall'), detail: { ...detail, setup_url: "https://voicevox.hiroshiba.jp/" } };
  }
  let configured = false;
  try { configured = Boolean(readFalKey(runtime.env || process.env)); }
  catch { /* 配布物の creator-root や鍵ファイルを読めなくても一覧は返す。 */ }
  const falAvailability = configured
    ? { state: "available", label: cliText('cli.narration.engine.falAvailable') }
    : { state: "unconfigured", label: cliText('cli.narration.engine.falKey') };
  const directAvailability = Object.fromEntries([['fish-audio', 'FISH_AUDIO_API_KEY', 'Fish Audio'],
    ['google-ai', 'GEMINI_API_KEY', 'Google AI']].map(([provider, name, label]) => {
    let hasKey = false;
    try { hasKey = Boolean(readProviderKey(name, runtime.env || process.env)); } catch { /* 一覧は維持する */ }
    return [provider, hasKey ? { state: 'available', label: cliText('cli.narration.engine.providerAvailable', { provider: label }) }
      : { state: 'unconfigured', label: cliText('cli.narration.engine.providerKey', { provider: label }) }];
  }));
  const profilesWithFal = listFalProfiles(runtime).length;
  let endpoint;
  try { endpoint = irodoriEndpoint(runtime.irodoriUrl, runtime.env || process.env); }
  catch (error) { if (!(error instanceof PublicError)) throw error; }
  const irodoriAvailable = endpoint ? await probeIrodori(endpoint, runtime.fetchImpl || fetch) : false;
  return { version: 1, engines: [
    { id: "voicevox", label: "VOICEVOX", languages: ['ja'], place: "local", price: { usd_per_1000_chars: 0, verified: true }, availability: voicevox, credit_required: true, supports: { speed: true, style: false, clone: 'none' }, group: 'local' },
    { id: "gemini-tts", label: "Gemini 2.5 Flash TTS", languages: falTtsEngine('gemini-tts').languages, place: "cloud", provider: "fal", price: { usd_per_1000_chars: GEMINI_USD_PER_1000_CHARS, verified: false, as_of: "2026-09-22" }, availability: falAvailability, default_voice: "Leda", credit_required: false, supports: { speed: false, style: true, clone: 'none' }, group: 'cloud' },
    { id: "irodori", label: cliText('cli.narration.engine.irodoriName'), languages: ['ja'], place: endpoint?.network ? "network" : "local", experimental: true,
      price: { usd_per_1000_chars: 0, verified: true }, credit_required: false, default_voice: "narrator-male",
      supports: { speed: true, style: true, clone: 'registered' }, group: 'local', availability: !endpoint
        ? { state: "unconfigured", label: cliText('cli.narration.engine.irodoriUrl'), detail: { setup_url: IRODORI_SETUP_URL } }
        : irodoriAvailable
        ? { state: "available", label: cliText('cli.narration.engine.irodoriConnected'), detail: { url: endpoint.server } }
        : { state: "unconfigured", label: cliText('cli.narration.engine.irodoriUnreachable'), detail: { setup_url: IRODORI_SETUP_URL } } },
    { id: "fal-qwen3", label: "fal Qwen3-TTS", languages: falTtsEngine('fal-qwen3').languages, place: "cloud", provider: "fal", price: { usd_per_1000_chars: FAL_USD_PER_1000_CHARS, verified: false }, availability: !configured ? { ...falAvailability, detail: { profiles_with_fal: profilesWithFal } } : profilesWithFal ? { state: "available", label: cliText('cli.narration.engine.profileAvailable'), detail: { profiles_with_fal: profilesWithFal } } : { state: "needs", label: cliText('cli.narration.engine.profileMissing'), detail: { profiles_with_fal: 0 } }, credit_required: false, supports: { speed: false, style: false, clone: 'registered' }, group: 'cloud' },
    ...FAL_TTS_ENGINES.filter(engine => !['gemini-tts', 'fal-qwen3'].includes(engine.id)).map(engine => ({
      id: engine.id, label: cliText(`cli.narration.engine.${engine.id.replace(/[^a-z0-9]/g, '')}Name`), languages: engine.languages, place: engine.place, provider: engine.provider,
      group: 'cloud', endpoint: engine.endpoint, price: engine.price, ...(engine.caution ? { caution: cliText('cli.narration.engine.chatterboxCaution') } : {}),
      availability: falAvailability, default_voice: engine.default_voice, credit_required: false,
      supports: engine.supports,
    })),
    ...DIRECT_TTS_ENGINES.map(engine => ({
      id: engine.id, label: engine.label, languages: engine.languages, place: engine.place, provider: engine.provider,
      group: 'cloud', endpoint: engine.endpoint, price: engine.price,
      availability: directAvailability[engine.provider], default_voice: engine.default_voice,
      credit_required: false, supports: engine.supports,
    })),
  ] };
}

async function listVoices(engine, runtime = {}) {
  if (engine === "irodori") return [...IRODORI_RECIPES.map(({ id, label, default: isDefault }) => ({ id, label: cliValue('cli.narration.voice.', label), ...(isDefault ? { default: true } : {}) })),
    { id: "custom", label: cliText('cli.narration.voice.custom') }];
  if (engine === "gemini-tts") return GEMINI_VOICES;
  const catalog = ttsEngine(engine);
  if (catalog && !['fal-qwen3'].includes(engine)) {
    if (catalog.voices) return catalog.voices.map(voice => ({ ...voice, label: cliValue('cli.narration.voice.', voice.label) }));
    return catalog.supports.clone === 'per-request' ? listProfiles(resolveProfileEnv(runtime))
      .filter(profile => profile.consent.self_voice && profile.consent.cloud_upload && profile.verification?.score >= 0.7)
      .map(profile => ({ id: profile.id, label: profile.label })) : [];
  }
  if (engine === "voicevox") {
    const handle = await ensureVoicevoxEngine();
    try {
      const response = await fetch(`${VOICEVOX_BASE_URL}/speakers`);
      if (!response.ok) throw new PublicError(cliText('cli.narration.error.voicevoxSpeakersHttp', { status: response.status }), 3);
      const speakers = await response.json();
      return speakers.flatMap((speaker) => (speaker.styles ?? []).map((style) => ({
        id: String(style.id), label: `${speaker.name} ${style.name}`, group: speaker.name,
      })));
    } finally {
      if (handle.startedByUs) await stopVoicevoxEngine(handle.child);
    }
  }
  if (engine === "fal-qwen3") {
    return listFalProfiles(runtime).map(({ id, label, legacy }) => ({ id, label, ...(legacy ? { legacy: true } : {}) }));
  }
  throw new PublicError(cliText('cli.narration.error.voicesUnsupported', { engine }), 2);
}

function parseListArguments(args) {
  let engine = null;
  let irodoriUrl = null;
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === "--json") continue;
    if (args[index] === "--engine" && args[index + 1]) { engine = args[++index]; continue; }
    if (args[index] === "--irodori-url" && args[index + 1]) { irodoriUrl = args[++index]; continue; }
    throw new PublicError(cliText('cli.narration.error.unknownArgument', { argument: args[index] }), 2);
  }
  if (args[0] === "voices" && !engine) throw new PublicError(cliText('cli.narration.error.voicesEngineRequired'), 2);
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
          cliText('cli.narration.dryRun.voicevoxRequest', { speaker: options.speaker }),
          `POST /synthesis?speaker=${options.speaker}`,
        ],
        speaker: Number(options.speaker),
        text: readingText,
      },
    }, io.log);
    return;
  }
  if (DIRECT_TTS_ENGINES.some(engine => engine.id === options.engine)) {
    const engine = ttsEngine(options.engine);
    const record = options.profile ? guardedProfile(options.profile, engine) : null;
    if (record && engine.supports.clone === 'per-request') {
      profileReferenceDataUri(record); // 送信前と同じ容量ガード。録音は表示しない。
      if (!record.meta.reference_text) throw new PublicError(cliText('cli.narration.error.referenceTextMissing'), 2);
    }
    const body = engine.buildPayload({ text: readingText, language: options.language,
      voice: engine.id === 'gemini-3.8-flash-tts' && record ? record.meta.engines[engine.id].voice_id : options.voice, style: options.style,
      ...(record && engine.supports.clone === 'per-request' ? { referenceAudio: Buffer.from('<audio bytes>'), referenceText: record.meta.reference_text } : {}) });
    if (record && engine.supports.clone === 'per-request') body.references[0].audio = '<audio bytes>';
    emit({ dry_run: true, engine: engine.id, output_path: outputPath,
      estimated_cost_usd: estimateTtsCost(engine, readingText),
      request: { endpoint: engine.endpoint, headers: engine.provider === 'fish-audio'
        ? { Authorization: `Bearer ${maskKey(readProviderKey('FISH_AUDIO_API_KEY'))}`, model: 's2.1-pro',
          'Content-Type': record ? 'application/msgpack' : 'application/json' }
        : { 'x-goog-api-key': maskKey(readProviderKey('GEMINI_API_KEY')), 'Content-Type': 'application/json' }, body } }, io.log);
    return;
  }

  if (options.engine === "gemini-tts") {
    emit({
      dry_run: true, engine: options.engine, output_path: outputPath,
      estimated_cost_usd: estimateGeminiTtsCostUsd(readingText.length),
      request: { endpoint: GEMINI_TTS_URL, headers: { Authorization: `Key ${maskKey(readFalKey(process.env))}` },
        body: falTtsEngine('gemini-tts').buildPayload({ text: readingText, voice: options.voice, style: options.style, language: options.language }) },
    }, io.log);
    return;
  }
  if (options.engine === "irodori") {
    const profileVoice = options.profile ? irodoriProfileVoice(options.profile) : null;
    emit({ dry_run: true, engine: options.engine, output_path: outputPath, estimated_cost_usd: 0,
      request: { endpoint: `${options.irodori.base}/v1/audio/speech`, body: { model: "irodori-tts", input: readingText,
        voice: profileVoice ?? "none", response_format: "wav", speed: options.speed ?? 1,
        ...(profileVoice ? {} : { irodori: { caption: options.style?.trim() || IRODORI_RECIPES.find(recipe => recipe.id === options.voice)?.caption } }) } } }, io.log);
    return;
  }
  if (!['fal-qwen3'].includes(options.engine)) {
    const engine = ttsEngine(options.engine);
    const record = options.profile && engine.supports.clone !== 'none' ? guardedProfile(options.profile, engine) : null;
    let audioUrl;
    if (record && engine.supports.clone === 'per-request') {
      profileReferenceDataUri(record); // 容量を確認し、録音そのものは dry-run に表示しない。
      audioUrl = '<data:audio/wav;base64,...>';
    }
    const payload = engine.buildPayload({ text: readingText, voice: options.voice, style: options.style, language: options.language,
      speed: options.speed, profileMeta: record?.meta, audioUrl });
    emit({ dry_run: true, engine: engine.id, output_path: outputPath,
      estimated_cost_usd: estimateTtsCost(engine, readingText),
      request: { endpoint: `https://fal.run/${engine.endpoint}`, body: payload } }, io.log);
    return;
  }
  const falKey = resolveFalKey();
  const meta = readProfileMeta(options.profile);
  const payload = buildFalPayload(readingText, meta, options.language);
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
  if (["voicevox", "irodori", 'chatterbox', 'gemini-3.8-flash-tts'].includes(engine)) {
    if (buffer.length >= 44 && buffer.toString("ascii", 0, 4) === "RIFF") {
      const bytesPerSecond = buffer.readUInt32LE(28);
      const dataOffset = buffer.indexOf("data", 36, "ascii");
      if (bytesPerSecond > 0 && dataOffset >= 0 && dataOffset + 8 <= buffer.length) {
        return Number((buffer.readUInt32LE(dataOffset + 4) / bytesPerSecond).toFixed(3));
      }
    }
  } else {
    const result = spawnSync(resolveMediaCommand("ffprobe"), ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", outputPath], { encoding: "utf8" });
    const seconds = Number(result.stdout?.trim());
    if (result.status === 0 && Number.isFinite(seconds) && seconds >= 0) return Number(seconds.toFixed(3));
  }
  warnings.push(cliText('cli.narration.warning.durationUnknown'));
  return null;
}

// --- generate 本体 ---

async function runGenerate(options, io) {
  const readingText = options.readingFile ? readTextFile(options.readingFile, cliText('cli.narration.label.spokenScript')) : options.text.trim();
  const scriptText = options.scriptFile ? readTextFile(options.scriptFile, cliText('cli.narration.label.displayScript')) : options.text;
  if (!readingText) throw new PublicError(cliText('cli.narration.error.readingEmpty'), 2);
  if (options.engine === 'elevenlabs-v3' && readingText.length > 5000) {
    throw new PublicError(cliText('cli.narration.error.elevenlabsLength'), 2);
  }
  if (options.engine === 'chatterbox' && readingText.length > 300) {
    throw new PublicError(cliText('cli.narration.error.chatterboxLength'), 2);
  }

  if (options.dryRun) {
    await runDryRun(options, readingText, io);
    return 0;
  }

  const id = options.out ? null : options.id ?? computeNextId(options.project);
  const relativePath = options.out ?? relativeOutputPath(id, options.engine);
  const outputPath = path.join(options.project, relativePath);

  let audioBuffer;
  let provenance;
  let costUsd = 0;
  const warnings = [];
  if (options.speed !== null && !["voicevox", "irodori", 'minimax-2.6-hd'].includes(options.engine)) {
    const warning = cliText('cli.narration.warning.speedIgnored', { engine: options.engine });
    warnings.push(warning);
    io.logError(warning);
  }

  if (options.engine === "voicevox") {
    const speakerId = Number(options.speaker);
    if (!Number.isInteger(speakerId) || speakerId < 0) {
      throw new PublicError(cliText('cli.narration.error.speakerNonNegative'));
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
    provenance = { provider: "irodori", engine: "irodori-tts-v4-small", voice: options.profile ? `profile:${options.profile}` : options.style?.trim() ? "caption:custom" : `recipe:${options.voice}`,
      generated_at: new Date().toISOString(), experimental: true, server: options.irodori.server };
  } else {
    const engine = ttsEngine(options.engine);
    const estimatedCostUsd = estimateTtsCost(engine, readingText);
    costUsd = estimatedCostUsd;
    io.logError(estimatedCostUsd === null ? cliText('cli.narration.cost.unavailable', { engine: options.engine, characters: readingText.length, n: readingText.length }) :
      cliText('cli.narration.cost.estimated', { engine: options.engine, cost: estimatedCostUsd, characters: readingText.length, n: readingText.length }));
    if (!options.yes) {
      if (options.json) printCompactJson({ version: 1, status: "needs_approval", estimate_usd: estimatedCostUsd, chars: readingText.length,
        ...(estimatedCostUsd === null ? { reason: cliText('cli.narration.cost.unavailableShort') } : {}),
        ...(options.speed !== null ? { speed_applied: false, warnings } : {}) }, io.log);
      else printJson({ sent: false, engine: options.engine, estimated_cost_usd: estimatedCostUsd,
        reason: cliText('cli.narration.cost.approvalMissing') }, io.log);
      return 2;
    }
    // --yes が明示された場合のみ、ここで初めて課金の発生する API を呼び出す。
    if (engine.provider !== 'fal') {
      const name = engine.provider === 'fish-audio' ? 'FISH_AUDIO_API_KEY' : 'GEMINI_API_KEY';
      const key = readProviderKey(name);
      if (!key) throw new PublicError(cliText('cli.narration.error.keyMissing', { name }), 2);
      const record = options.profile ? guardedProfile(options.profile, engine) : null;
      let referenceAudio;
      if (record && engine.supports.clone === 'per-request') {
        profileReferenceDataUri(record); // 正本 wav と 20 MB 上限を確認する。
        if (!record.meta.reference_text) throw new PublicError(cliText('cli.narration.error.referenceTextMissing'), 2);
        referenceAudio = fs.readFileSync(path.join(record.dir, record.meta.reference.file));
      }
      const payload = engine.buildPayload({ text: readingText, language: options.language,
        voice: engine.id === 'gemini-3.8-flash-tts' && record ? record.meta.engines[engine.id].voice_id : options.voice, style: options.style,
        referenceAudio, referenceText: record?.meta.reference_text });
      audioBuffer = await synthesizeDirect(engine, payload, key);
      provenance = { provider: engine.provider, engine: engine.id,
        model: engine.provider === 'fish-audio' ? 's2.1-pro' : 'gemini-3.8-flash-tts',
        voice: record ? `profile:${options.profile}` : options.voice,
        generated_at: new Date().toISOString(), price_verified: engine.price.verified };
    } else if (options.engine === "gemini-tts") {
      const falKey = resolveFalKey();
      audioBuffer = await synthesizeCatalog(engine, engine.buildPayload({ text: readingText, voice: options.voice, style: options.style, language: options.language }), falKey);
      provenance = { provider: "fal", engine: "gemini-2.5-flash-tts", voice: `gemini:${options.voice}`,
        generated_at: new Date().toISOString(), price_verified: false, endpoint: engine.endpoint };
    } else if (options.engine === 'fal-qwen3') {
      const falKey = resolveFalKey();
      const meta = readProfileMeta(options.profile);
      audioBuffer = await synthesizeCatalog(engine, engine.buildPayload({ text: readingText, profileMeta: meta, language: options.language }), falKey);
      provenance = { provider: "fal", engine: "qwen-3-tts-1.7b", voice: `profile:${options.profile}`,
        generated_at: new Date().toISOString(), endpoint: engine.endpoint, price_verified: false };
    } else {
      const falKey = resolveFalKey();
      const record = options.profile && engine.supports.clone !== 'none' ? guardedProfile(options.profile, engine) : null;
      const audioUrl = record && engine.supports.clone === 'per-request' ? profileReferenceDataUri(record) : undefined;
      const payload = engine.buildPayload({ text: readingText, voice: options.voice, style: options.style, language: options.language,
        speed: options.speed, profileMeta: record?.meta, audioUrl });
      audioBuffer = await synthesizeCatalog(engine, payload, falKey);
      provenance = { provider: 'fal', engine: engine.id, endpoint: engine.endpoint,
        voice: record ? `profile:${options.profile}` : options.voice ?? 'default',
        generated_at: new Date().toISOString(), price_verified: engine.price.verified };
    }
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  if (options.out) fs.writeFileSync(outputPath, audioBuffer, { flag: 'wx' });
  else fs.writeFileSync(outputPath, audioBuffer);
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
    ...(options.speed !== null ? { speed_applied: ["voicevox", "irodori", 'minimax-2.6-hd'].includes(options.engine) } : {}) }, io.log);
  else printJson(entry, io.log);
  return 0;
}

export async function runNarrationCommand(args, commandOptions = {}) {
  const io = {
    log: commandOptions.log ?? ((line) => console.log(line)),
    logError: commandOptions.logError ?? ((line) => console.error(line)),
  };

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    io.log(commandUsage());
    return { exitCode: 0 };
  }
  if (args[0] === 'generate' && (args.includes('--help') || args.includes('-h'))) {
    io.log(usage());
    return { exitCode: 0 };
  }
  if (args[0] === 'verify') {
    try { return { exitCode: await runVerify(parseVerifyArguments(args), io, commandOptions.verifyRuntime) }; }
    catch (error) {
      const code = error instanceof PublicError ? error.exitCode : 1;
      const message = error instanceof PublicError ? error.message : cliText('cli.narration.error.verifyFailed', { message: error?.message ?? error });
      io.logError(message);
      printCompactJson({ error: message }, io.log);
      return { exitCode: code };
    }
  }
  if (["start", "stop"].includes(args[0])) {
    try {
      if (args.length !== 4 || args[1] !== "--engine" || args[2] !== "voicevox" || args[3] !== "--json") {
        throw new PublicError(cliText('cli.narration.error.startStopArguments'), 2);
      }
      printCompactJson(args[0] === "start" ? await startVoicevox(commandOptions.engineRuntime) : await stopManagedVoicevox(commandOptions.engineRuntime), io.log);
      return { exitCode: 0 };
    } catch (error) {
      const message = error instanceof PublicError ? error.message : cliText('cli.narration.error.voicevoxOperationFailed', { message: error?.message ?? error });
      io.logError(message); printCompactJson({ error: message }, io.log);
      return { exitCode: error instanceof PublicError ? error.exitCode : 1 };
    }
  }
  if (["engines", "voices"].includes(args[0])) {
    try {
      const { engine, irodoriUrl } = parseListArguments(args);
      printCompactJson(args[0] === "engines" ? await listEngines({ ...commandOptions.engineRuntime, irodoriUrl }) :
        { version: 1, engine, voices: await listVoices(engine, commandOptions.engineRuntime) }, io.log);
      return { exitCode: 0 };
    } catch (error) {
      const message = error instanceof PublicError ? error.message : cliText('cli.narration.error.voicesUnavailable');
      io.logError(message);
      printCompactJson({ error: message }, io.log);
      return { exitCode: args[0] === "voices" ? 3 : 2 };
    }
  }

  let parsedOptions;
  try {
    parsedOptions = await parseArguments(args);
    const exitCode = await runGenerate(parsedOptions, io);
    return { exitCode };
  } catch (error) {
    const exitCode = error instanceof PublicError ? error.exitCode : 1;
    const message = error instanceof PublicError ? error.message : cliText('cli.narration.error.internalFailed', { message: error?.message ?? error });
    io.logError(message);
    if (args.includes("--json")) printCompactJson({ error: message }, io.log);
    else printJson({ error: message }, io.log);
    return { exitCode };
  }
}
