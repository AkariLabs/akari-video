// 本人の録音を正本として保存し、生成エンジンの写しを管理する。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolveLauncherAssets } from './repo-assets.mjs';
import { resolveAkariHome as fallbackResolveAkariHome } from './update-check.mjs';

// モノレポと配布物の両方で既存の資産解決を使う。creator-root が欠けた配布物でも
// voice 以外の CLI 起動を妨げないよう、同じ AKARI_HOME 規約の launcher 実装へ戻す。
let resolveAkariHome = fallbackResolveAkariHome;
let readCreatorCredentials;
try {
  const creatorRootModulePath = resolveLauncherAssets().creatorRootModulePath;
  if (creatorRootModulePath) {
    const module = await import(pathToFileURL(creatorRootModulePath).href);
    if (typeof module.resolveAkariHome === 'function') resolveAkariHome = module.resolveAkariHome;
    readCreatorCredentials = module.readCredentials;
  }
} catch {
  // 部分的な vendor や壊れた optional module でもランチャー全体は起動させる。
}

export const VOICE_SCRIPTS = Object.freeze({
  'quick-v1': 'こんにちは。今日は、いつもの調子で、ゆっくり話してみます。朝、コーヒーを淹れながら、今日やることを整理します。窓の外では、街がゆっくり動き出しています。準備ができたら、ひとつずつ、形にしていきましょう。',
  'extended-v1': '素材を集めて、流れを決めて、あとは少しずつ形にしていきます。朝、コーヒーを淹れながら、今日やることを整理します。窓の外では、街がゆっくり動き出しています。新しい技術は、毎日の暮らしを静かに変えていきます。動画の編集も、資料づくりも、これからはもっと自由になっていくはずです。音楽の音量は、ナレーションの邪魔にならないくらいが目安です。できあがった動画は、書き出す前に一度、通しで確認しましょう。細かいズレは、この段階で見つけるのがいちばん早いです。',
});
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FAL_CLONE_URL = 'https://fal.run/fal-ai/qwen-3-tts/clone-voice/1.7b';
const FAL_TTS_URL = 'https://fal.run/fal-ai/qwen-3-tts/text-to-speech/1.7b';
const IRODORI_DEFAULT_URL = 'http://127.0.0.1:8088';
const CLONE_ESTIMATE_USD = 0.01;

class VoiceError extends Error {
  constructor(message, result = {}, exitCode = 2) { super(message); this.result = result; this.exitCode = exitCode; }
}
function requireId(value, flag) {
  if (!ID.test(value ?? '')) throw new VoiceError(`${flag} は英小文字・数字・ハイフンで指定してください`);
  return value;
}
function home(env) { return path.resolve(resolveAkariHome(env)); }
function legacyRoot(env) { return path.join(env.HOME || os.homedir(), '.config', 'akari-video', 'voice-profiles'); }
function newRoot(env) { return path.join(home(env), 'avatars'); }
function profileDir(env, avatar, id) { return path.join(newRoot(env), requireId(avatar, '--avatar'), 'voice', requireId(id, '--id')); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writePrivateJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); fs.chmodSync(file, 0o600); }
function writePrivateJsonAtomic(file, value) {
  const temporary = path.join(path.dirname(file), `.meta-${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}
function normalizeLegacyConsent(value) {
  const object = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  const recorded = typeof value === 'string' ? value.trim().length > 0 : object ? Object.keys(object).length > 0 : false;
  return { self_voice: object && Object.hasOwn(object, 'self_voice') ? object.self_voice === true : recorded,
    cloud_upload: object?.cloud_upload === true,
    ...(object?.at ? { at: object.at } : {}), ...(object?.via ? { via: object.via } : {}),
    ...(value === undefined ? {} : { legacy_record: value }) };
}
function normalizeLegacyVerification(value) {
  if (value && typeof value === 'object' && Number.isFinite(value.score)) return value;
  if (value && typeof value === 'object' && value.status === 'unavailable') return value;
  return { status: 'unavailable', ...(value === undefined ? {} : { legacy_record: value }) };
}
function normalizeMeta(raw, legacy = false) {
  if (!legacy && raw.version === 2) return raw;
  return { ...raw, version: raw.version ?? 1,
    consent: normalizeLegacyConsent(raw.consent),
    reference: { ...raw.reference, file: raw.reference?.file || path.basename(raw.reference?.original_path || 'ref-recording.wav'),
      verification: normalizeLegacyVerification(raw.reference?.verification) },
    engines: { ...(raw.engines || {}), ...(raw.embedding_source_url ? { 'fal-qwen3': { embedding_source_url: raw.embedding_source_url, created_at: raw.created_at } } : {}) },
  };
}
export function resolveVoiceProfile(id, env = process.env) {
  requireId(id, '--profile');
  const avatars = newRoot(env);
  if (fs.existsSync(avatars)) for (const entry of fs.readdirSync(avatars, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !ID.test(entry.name)) continue;
    const dir = profileDir(env, entry.name, id), file = path.join(dir, 'meta.json');
    if (fs.existsSync(file)) return { dir, meta: normalizeMeta(readJson(file)), legacy: false };
  }
  const dir = path.join(legacyRoot(env), id), file = path.join(dir, 'meta.json');
  if (fs.existsSync(file)) return { dir, meta: normalizeMeta(readJson(file), true), legacy: true };
  throw new VoiceError(`声プロファイルが見つかりません: ${id}`);
}
function listProfiles(env, avatar) {
  const items = [];
  const avatars = newRoot(env);
  if (fs.existsSync(avatars)) for (const person of fs.readdirSync(avatars, { withFileTypes: true })) {
    if (!person.isDirectory() || !ID.test(person.name) || avatar && avatar !== person.name) continue;
    const voiceDir = path.join(avatars, person.name, 'voice');
    if (!fs.existsSync(voiceDir)) continue;
    for (const entry of fs.readdirSync(voiceDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !ID.test(entry.name)) continue;
      const file = path.join(voiceDir, entry.name, 'meta.json');
      if (fs.existsSync(file)) items.push(profileSummary(normalizeMeta(readJson(file)), entry.name, person.name, false));
    }
  }
  const old = legacyRoot(env);
  if (fs.existsSync(old)) for (const entry of fs.readdirSync(old, { withFileTypes: true })) {
    if (!entry.isDirectory() || !ID.test(entry.name)) continue;
    const file = path.join(old, entry.name, 'meta.json');
    if (!fs.existsSync(file)) continue;
    const meta = normalizeMeta(readJson(file), true);
    if (!avatar || avatar === meta.avatar || !meta.avatar) items.push(profileSummary(meta, entry.name, meta.avatar ?? null, true));
  }
  return items.sort((a, b) => a.id.localeCompare(b.id) || Number(a.legacy) - Number(b.legacy));
}
function profileSummary(meta, id, avatar, legacy) {
  return { id, label: meta.label ?? id, avatar, legacy, created_at: meta.created_at ?? null,
    duration_s: meta.reference?.duration_s ?? null, engines: Object.keys(meta.engines ?? {}),
    copies: Object.fromEntries(Object.entries(meta.engines ?? {}).map(([name, copy]) => [name, { stale: copy?.stale === true }])),
    consent: { self_voice: meta.consent?.self_voice === true, cloud_upload: meta.consent?.cloud_upload === true },
    verification: meta.reference?.verification ?? { status: 'unavailable' } };
}
function audioLevels(audio, runtime) {
  if (runtime.measureAudio) return runtime.measureAudio(audio);
  const result = spawnSync('ffmpeg', ['-v', 'error', '-i', audio, '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], { maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new VoiceError(result.error?.code === 'ENOENT' ? 'ffmpeg がありません' : `音声を測定できません: ${result.stderr?.toString().slice(0, 200)}`);
  const pcm = result.stdout, count = Math.floor(pcm.length / 2);
  if (!count) throw new VoiceError('音声が空です');
  let peak = 0, sum = 0, floor = Infinity, windowSum = 0, windowCount = 0;
  for (let i = 0; i < count; i++) {
    const sample = pcm.readInt16LE(i * 2) / 32768;
    const squared = sample * sample;
    peak = Math.max(peak, Math.abs(sample)); sum += squared; windowSum += squared; windowCount++;
    if (windowCount === 4000 || i === count - 1) { floor = Math.min(floor, Math.sqrt(windowSum / windowCount)); windowSum = 0; windowCount = 0; }
  }
  const db = value => value ? Number((20 * Math.log10(value)).toFixed(2)) : -Infinity;
  return { duration_s: count / 16000, peak_db: db(peak), mean_db: db(Math.sqrt(sum / count)), floor_db: db(floor) };
}
async function verifyScript(audio, script, backend, runtime) {
  if (runtime.verifyScript) return runtime.verifyScript(audio, VOICE_SCRIPTS[script], backend);
  const { verifyNarrationAudio } = await import('./narration-command.mjs');
  const { code, result: value } = await verifyNarrationAudio(audio, VOICE_SCRIPTS[script], backend, runtime.verifyRuntime);
  if (code === 3) return { status: 'unavailable' };
  if (code) throw new VoiceError(value.error || '原稿照合に失敗しました');
  return { score: value.score, verdict: value.verdict, backend: value.backend };
}
export async function checkVoiceRecording({ audio, script, backend = 'auto' }, runtime = {}) {
  if (!VOICE_SCRIPTS[script]) throw new VoiceError('原稿の種類が不明です');
  if (!['auto', 'speechanalyzer', 'whisper'].includes(backend)) throw new VoiceError('聞き取り backend が不明です');
  const level = await audioLevels(audio, runtime);
  const durationOk = level.duration_s >= (script === 'extended-v1' ? 45 : 15) && level.duration_s <= (script === 'extended-v1' ? 180 : 120);
  const levelOk = level.peak_db < -1 && level.mean_db >= -35 && level.mean_db <= -10;
  const noiseOk = level.floor_db <= -45;
  const verification = await verifyScript(audio, script, backend, runtime);
  const scriptCheck = verification.status === 'unavailable' ? { backend: null, ok: 'unavailable' } :
    { score: verification.score, verdict: verification.verdict, backend: verification.backend, ok: verification.score >= 0.7 };
  const reasons = [];
  if (!durationOk) reasons.push('録音の長さが範囲外です');
  if (!levelOk) reasons.push('録音の音量が範囲外です');
  if (scriptCheck.ok === false) reasons.push('原稿との一致率が 70% 未満です');
  return { checks: { duration: { value_s: Number(level.duration_s.toFixed(3)), ok: durationOk },
    level: { peak_db: level.peak_db, mean_db: level.mean_db, ok: levelOk },
    noise: { floor_db: level.floor_db, ok: noiseOk, warn: !noiseOk }, script: scriptCheck },
    pass: reasons.length === 0, reasons };
}
function ffmpegConvert(source, destination, runtime) {
  if (runtime.convertAudio) return runtime.convertAudio(source, destination);
  const result = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', source, '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', destination]);
  if (result.error || result.status !== 0) throw new VoiceError(result.error?.code === 'ENOENT' ? 'ffmpeg がありません' : '録音を wav に変換できません');
}
function addDefaultVoice(voiceDir, id) {
  const file = path.join(voiceDir, 'voice.json');
  const existing = fs.existsSync(file) ? readJson(file) : {};
  if (existing.default_profile === undefined) writePrivateJson(file, { ...existing, default_profile: id });
}
function endpoint(value, env) {
  let url;
  try { url = new URL(value ?? env.AKARI_IRODORI_URL ?? IRODORI_DEFAULT_URL); } catch { throw new VoiceError('彩サーバー URL が不正です'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new VoiceError('彩サーバー URL が不正です');
  return { base: `${url.origin}${url.pathname.replace(/\/+$/, '')}`, server: `${url.hostname}:${url.port || (url.protocol === 'https:' ? '443' : '80')}` };
}
export function readFalKey(env = process.env) {
  if (env.FAL_KEY) return env.FAL_KEY;
  if (typeof readCreatorCredentials !== 'function') throw new VoiceError('作業場の鍵読み取りモジュールが見つかりません');
  try { return readCreatorCredentials(env).values.get('FAL_KEY') || null; }
  catch { throw new VoiceError('credentials.env を読めません'); }
}
function durationFromWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
  const bytesPerSecond = buffer.readUInt32LE(28), offset = buffer.indexOf('data', 36, 'ascii');
  return bytesPerSecond && offset >= 0 ? Number((buffer.readUInt32LE(offset + 4) / bytesPerSecond).toFixed(3)) : null;
}
function probeDuration(file) {
  const result = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { encoding: 'utf8' });
  const value = Number(result.stdout?.trim());
  return result.status === 0 && Number.isFinite(value) && value >= 0 ? Number(value.toFixed(3)) : null;
}
function parse(args) {
  const sub = args[0];
  const allowed = { scripts: [], check: ['audio', 'script', 'backend'], create: ['avatar', 'id', 'label', 'audio', 'script', 'consent-self', 'consent-cloud'],
    rename: ['profile', 'label'], extend: ['profile', 'audio', 'script', 'backend'],
    copy: ['profile', 'engine', 'irodori-url', 'yes'], try: ['profile', 'engine', 'text', 'reading', 'irodori-url', 'yes'],
    profiles: ['avatar'], delete: ['profile', 'keep-server', 'irodori-url'], 'migrate-legacy': ['profile', 'avatar'] };
  if (!Object.hasOwn(allowed, sub)) throw new VoiceError('不明な voice サブコマンドです');
  const flags = new Set(['consent-self', 'consent-cloud', 'yes', 'keep-server']);
  const options = {};
  for (let i = 1; i < args.length; i++) {
    const token = args[i];
    if (token === '--json') continue;
    const name = token.startsWith('--') ? token.slice(2) : '';
    if (!allowed[sub].includes(name)) throw new VoiceError(`不明な引数です: ${token}`);
    if (flags.has(name)) options[name] = true;
    else { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new VoiceError(`${token} の値がありません`); options[name] = args[++i]; }
  }
  return { sub, options };
}
function need(options, ...names) { for (const name of names) if (!options[name]) throw new VoiceError(`--${name} が必要です`); }
function safeReference(record) {
  const name = record.meta.reference?.file;
  if (!name || path.basename(name) !== name) throw new VoiceError('録音ファイル名が不正です');
  const file = path.join(record.dir, name);
  if (!fs.existsSync(file)) throw new VoiceError('正本の録音が見つかりません');
  return file;
}
async function execute(sub, o, runtime, env) {
  const fetchImpl = runtime.fetchImpl ?? fetch;
  const now = runtime.now?.() ?? new Date().toISOString();
  if (sub === 'scripts') return { scripts: Object.entries(VOICE_SCRIPTS).map(([id, text]) => ({ id, text })) };
  if (sub === 'check') { need(o, 'audio', 'script'); return checkVoiceRecording(o, runtime); }
  if (sub === 'create') {
    need(o, 'avatar', 'id', 'label', 'audio', 'script'); requireId(o.avatar, '--avatar'); requireId(o.id, '--id');
    if (!o['consent-self']) throw new VoiceError('本人の声への同意（--consent-self）が必要です');
    const checked = await checkVoiceRecording(o, runtime);
    if (!checked.pass) throw new VoiceError('録音のチェックに合格していません', { check: checked, reasons: checked.reasons });
    const dir = profileDir(env, o.avatar, o.id), voiceDir = path.dirname(dir);
    if (fs.existsSync(dir)) throw new VoiceError('同じ声 ID が既にあります');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700);
    const recording = path.join(dir, 'ref-recording.wav');
    try {
      ffmpegConvert(o.audio, recording, runtime); fs.chmodSync(recording, 0o600);
      const meta = { version: 2, profile: o.id, label: o.label, avatar: o.avatar, created_at: now,
        consent: { self_voice: true, cloud_upload: !!o['consent-cloud'], at: now, via: 'akari voice create --consent-self' },
        reference: { file: 'ref-recording.wav', sha256: crypto.createHash('sha256').update(fs.readFileSync(recording)).digest('hex'),
          duration_s: checked.checks.duration.value_s, script_version: o.script,
          verification: checked.checks.script.ok === 'unavailable' ? { status: 'unavailable' } :
            { score: checked.checks.script.score, backend: checked.checks.script.backend },
          level: { peak_db: checked.checks.level.peak_db, mean_db: checked.checks.level.mean_db, floor_db: checked.checks.noise.floor_db } },
        reference_text: VOICE_SCRIPTS[o.script], engines: {} };
      writePrivateJson(path.join(dir, 'meta.json'), meta); addDefaultVoice(voiceDir, o.id);
      return { status: 'ok', profile: o.id, avatar: o.avatar, path: dir, meta };
    } catch (error) { fs.rmSync(dir, { recursive: true, force: true }); throw error; }
  }
  if (sub === 'profiles') return { profiles: listProfiles(env, o.avatar) };
  if (sub === 'migrate-legacy') {
    need(o, 'profile', 'avatar'); requireId(o.avatar, '--avatar'); requireId(o.profile, '--profile');
    const oldDir = path.join(legacyRoot(env), o.profile), oldFile = path.join(oldDir, 'meta.json');
    if (!fs.existsSync(oldFile)) throw new VoiceError('旧形式の声が見つかりません');
    const raw = readJson(oldFile), meta = normalizeMeta(raw, true);
    const oldName = fs.readdirSync(oldDir).find(name => /^ref-recording\.[a-z0-9]+$/i.test(name));
    if (!oldName) throw new VoiceError('旧録音ファイルが見つかりません');
    const dir = profileDir(env, o.avatar, o.profile);
    if (fs.existsSync(dir)) throw new VoiceError('移行先の声が既にあります');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      fs.copyFileSync(path.join(oldDir, oldName), path.join(dir, oldName)); fs.chmodSync(path.join(dir, oldName), 0o600);
      const copied = path.join(dir, oldName), bytes = fs.readFileSync(copied);
      const verification = meta.reference?.verification ?? { status: 'unavailable' };
      const migrated = { version: 2, profile: o.profile, label: meta.label ?? o.profile, avatar: o.avatar,
        created_at: meta.created_at ?? now, consent: meta.consent,
        reference: { file: oldName, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
          duration_s: meta.reference?.duration_s ?? (oldName.endsWith('.wav') ? durationFromWav(bytes) : null),
          script_version: meta.reference?.script_version ?? 'legacy', verification,
          level: meta.reference?.level ?? null }, reference_text: meta.reference_text ?? '',
        engines: meta.engines, migrated_from: 'legacy' };
      writePrivateJson(path.join(dir, 'meta.json'), migrated); addDefaultVoice(path.dirname(dir), o.profile);
      return { status: 'ok', profile: o.profile, avatar: o.avatar, migrated_from: 'legacy' };
    } catch (error) { fs.rmSync(dir, { recursive: true, force: true }); throw error; }
  }
  need(o, 'profile');
  const record = resolveVoiceProfile(o.profile, env);
  if (sub === 'rename') {
    need(o, 'label');
    if (record.legacy) throw new VoiceError('旧形式の声は先に migrate-legacy してください');
    const label = o.label.trim();
    if (!label) throw new VoiceError('表示名を指定してください');
    if (record.meta.version !== 2 || record.meta.profile !== o.profile) throw new VoiceError('声の記録が不正です');
    writePrivateJsonAtomic(path.join(record.dir, 'meta.json'), { ...record.meta, label });
    return { status: 'ok', profile: o.profile, label };
  }
  if (sub === 'extend') {
    need(o, 'audio', 'script');
    if (o.script !== 'extended-v1') throw new VoiceError('追加原稿は extended-v1 を指定してください');
    if (record.legacy) throw new VoiceError('旧形式の声は先に migrate-legacy してください');
    if (record.meta.version !== 2 || record.meta.profile !== o.profile || record.meta.reference?.script_version !== 'quick-v1') {
      throw new VoiceError('追加できる quick-v1 の正本がありません');
    }
    const recording = safeReference(record);
    if (path.basename(recording) !== 'ref-recording.wav') throw new VoiceError('正本は wav である必要があります');
    const original = fs.readFileSync(recording);
    if (record.meta.reference.sha256 && crypto.createHash('sha256').update(original).digest('hex') !== record.meta.reference.sha256) {
      throw new VoiceError('正本の録音が保存時から変わっています');
    }
    const checked = await checkVoiceRecording(o, runtime);
    if (!checked.pass) throw new VoiceError('追加録音のチェックに合格していません', { check: checked, reasons: checked.reasons });
    const staged = path.join(record.dir, `.ref-recording-${crypto.randomUUID()}.wav`);
    const previous = path.join(record.dir, 'ref-recording.prev.wav');
    try {
      if (runtime.concatAudio) await runtime.concatAudio(recording, o.audio, staged);
      else {
        const result = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', recording, '-i', o.audio,
          '-filter_complex', '[0:a][1:a]concat=n=2:v=0:a=1', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', staged]);
        if (result.error || result.status !== 0) throw new VoiceError(result.error?.code === 'ENOENT' ? 'ffmpeg がありません' : '録音を連結できません');
      }
      fs.chmodSync(staged, 0o600);
      const text = `${VOICE_SCRIPTS['quick-v1']}${VOICE_SCRIPTS['extended-v1']}`;
      let verification;
      if (runtime.verifyCombined) verification = await runtime.verifyCombined(staged, text, o.backend ?? 'auto');
      else {
        const { verifyNarrationAudio } = await import('./narration-command.mjs');
        const result = await verifyNarrationAudio(staged, text, o.backend ?? 'auto', runtime.verifyRuntime);
        verification = result.code === 3 ? { status: 'unavailable' } : result.code ? { status: 'error' } : result.result;
      }
      if (verification.status === 'error' || verification.status === 'unavailable' && checked.checks.script.ok !== 'unavailable') {
        throw new VoiceError('連結後の原稿照合ができません');
      }
      if (verification.score !== undefined && verification.score < 0.7) throw new VoiceError('連結後の原稿一致率が 70% 未満です');
      const level = audioLevels(staged, runtime);
      const bytes = fs.readFileSync(staged);
      const nextMeta = { ...record.meta, reference_text: text,
        reference: { ...record.meta.reference, sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
          duration_s: Number(level.duration_s.toFixed(3)), script_version: 'quick-v1+extended-v1',
          verification: verification.score !== undefined ? { score: verification.score, backend: verification.backend } : { status: 'unavailable' },
          level: { peak_db: level.peak_db, mean_db: level.mean_db, floor_db: level.floor_db } },
        engines: Object.fromEntries(Object.entries(record.meta.engines ?? {}).map(([name, copy]) => [name, { ...copy, stale: true }])) };
      fs.writeFileSync(previous, original, { mode: 0o600 }); fs.chmodSync(previous, 0o600);
      fs.renameSync(staged, recording);
      try { writePrivateJsonAtomic(path.join(record.dir, 'meta.json'), nextMeta); }
      catch (error) { fs.writeFileSync(recording, original, { mode: 0o600 }); throw error; }
      return { status: 'ok', profile: o.profile, duration_s: nextMeta.reference.duration_s,
        ...(verification.score !== undefined ? { score: verification.score } : {}),
        warnings: Object.keys(nextMeta.engines).length ? ['写しが古くなりました。akari voice copy で写しを作り直してください'] : [] };
    } finally { fs.rmSync(staged, { force: true }); }
  }
  if (sub === 'copy') {
    need(o, 'engine'); if (!['irodori', 'fal-qwen3'].includes(o.engine)) throw new VoiceError('作り手が不明です');
    if (record.legacy) throw new VoiceError('旧形式の声は先に migrate-legacy してください');
    if (record.meta.consent?.self_voice !== true) throw new VoiceError('本人の声への同意記録がありません');
    const recording = safeReference(record);
    if (record.meta.reference?.sha256 && crypto.createHash('sha256').update(fs.readFileSync(recording)).digest('hex') !== record.meta.reference.sha256) {
      throw new VoiceError('正本の録音が保存時から変わっています');
    }
    if (o.engine === 'fal-qwen3') {
      if (record.meta.consent?.cloud_upload !== true) throw new VoiceError('クラウド送信への同意がありません');
      if (!(record.meta.reference?.verification?.score >= 0.7)) throw new VoiceError('ローカルの原稿照合が 70% 以上ではありません');
      if (!o.yes) throw new VoiceError('有償操作への承認が必要です', { status: 'needs_approval', estimate_usd: CLONE_ESTIMATE_USD });
      const key = runtime.falKey ?? readFalKey(env);
      if (!key) throw new VoiceError('FAL_KEY が未設定です');
      const data = fs.readFileSync(recording);
      const response = await fetchImpl(FAL_CLONE_URL, { method: 'POST', headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_url: `data:audio/wav;base64,${data.toString('base64')}`, reference_text: record.meta.reference_text }) });
      if (!response.ok) throw new VoiceError(`fal API が HTTP ${response.status} を返しました`);
      const embedding_source_url = (await response.json())?.speaker_embedding?.url;
      if (!embedding_source_url) throw new VoiceError('fal API の応答に speaker_embedding.url がありません');
      record.meta.engines['fal-qwen3'] = { embedding_source_url, created_at: now };
    } else {
      const target = endpoint(o['irodori-url'], env), form = new FormData();
      form.set('voice_id', `akari-${o.profile}`); form.set('file', new Blob([fs.readFileSync(recording)], { type: 'audio/wav' }), path.basename(recording));
      const response = await fetchImpl(`${target.base}/v1/audio/voices`, { method: 'POST', body: form });
      if (!response.ok) throw new VoiceError(`彩サーバーが HTTP ${response.status} を返しました`);
      record.meta.engines.irodori = { server: target.server, voice_id: `akari-${o.profile}`, registered_at: now };
    }
    writePrivateJson(path.join(record.dir, 'meta.json'), record.meta);
    return { status: 'ok', profile: o.profile, engine: o.engine, copy: record.meta.engines[o.engine] };
  }
  if (sub === 'try') {
    need(o, 'engine', 'text'); if (!['irodori', 'fal-qwen3'].includes(o.engine)) throw new VoiceError('作り手が不明です');
    const copy = record.meta.engines?.[o.engine];
    if (!copy) throw new VoiceError('この声には指定した作り手の写しがありません。akari voice copy で作ってください');
    let buffer, ext;
    if (o.engine === 'irodori') {
      const target = endpoint(o['irodori-url'] ?? env.AKARI_IRODORI_URL ?? `http://${copy.server}`, env);
      const response = await fetchImpl(`${target.base}/v1/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'irodori-tts', input: o.reading ?? o.text, voice: copy.voice_id, response_format: 'wav', speed: 1 }) });
      if (!response.ok) throw new VoiceError(`彩サーバーが HTTP ${response.status} を返しました`);
      buffer = Buffer.from(await response.arrayBuffer()); ext = 'wav';
      if (durationFromWav(buffer) === null) throw new VoiceError('彩サーバーの応答が wav ではありません');
    } else {
      const estimate = Number(((o.reading ?? o.text).length * 0.09 / 1000).toFixed(6));
      if (!o.yes) throw new VoiceError('有償操作への承認が必要です', { status: 'needs_approval', estimate_usd: estimate });
      const key = runtime.falKey ?? readFalKey(env);
      if (!key) throw new VoiceError('FAL_KEY が未設定です');
      const response = await fetchImpl(FAL_TTS_URL, { method: 'POST', headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: o.reading ?? o.text, language: 'Japanese', speaker_voice_embedding_file_url: copy.embedding_source_url,
          reference_text: record.meta.reference_text, max_new_tokens: 2048 }) });
      if (!response.ok) throw new VoiceError(`fal API が HTTP ${response.status} を返しました`);
      const url = (await response.json())?.audio?.url;
      if (!url) throw new VoiceError('fal API の応答に audio.url がありません');
      const audio = await fetchImpl(url); if (!audio.ok) throw new VoiceError('生成音声を取得できません');
      buffer = Buffer.from(await audio.arrayBuffer()); ext = 'mp3';
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-voice-try-'));
    const file = path.join(dir, `try.${ext}`); fs.writeFileSync(file, buffer, { mode: 0o600 });
    let duration = ext === 'wav' ? durationFromWav(buffer) : null;
    if (duration === null) duration = (runtime.probeDuration ?? probeDuration)(file);
    return { path: file, duration_s: duration, engine: o.engine };
  }
  if (sub === 'delete') {
    if (record.legacy) throw new VoiceError('旧形式の声は削除できません');
    const warnings = [];
    const copy = record.meta.engines?.irodori;
    if (copy && !o['keep-server']) {
      const target = endpoint(o['irodori-url'] ?? env.AKARI_IRODORI_URL ?? `http://${copy.server}`, env);
      try {
        const response = await fetchImpl(`${target.base}/v1/audio/voices/${encodeURIComponent(copy.voice_id)}`, { method: 'DELETE' });
        if (!response.ok) warnings.push(`彩サーバーから削除できませんでした（HTTP ${response.status}）`);
      } catch { warnings.push('彩サーバーから削除できませんでした'); }
    }
    if (record.meta.engines?.['fal-qwen3']) warnings.push('fal 側の声は残ります');
    fs.rmSync(record.dir, { recursive: true });
    const voiceFile = path.join(path.dirname(record.dir), 'voice.json');
    if (fs.existsSync(voiceFile)) { const config = readJson(voiceFile); if (config.default_profile === o.profile) { delete config.default_profile; writePrivateJson(voiceFile, config); } }
    return { status: 'ok', profile: o.profile, warnings };
  }
  throw new VoiceError('不明な voice サブコマンドです');
}
export async function runVoiceCommand(args, commandOptions = {}) {
  const log = commandOptions.log ?? console.log;
  const logError = commandOptions.logError ?? console.error;
  const env = commandOptions.env ?? process.env;
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    log('使い方: akari voice <scripts|check|create|rename|extend|copy|try|profiles|delete|migrate-legacy> [options] --json');
    return { exitCode: 0 };
  }
  try {
    const { sub, options } = parse(args);
    const value = await execute(sub, options, commandOptions, env);
    log(JSON.stringify(value)); return { exitCode: 0 };
  } catch (error) {
    const message = error instanceof VoiceError ? error.message : `声を操作できません: ${error?.message ?? error}`;
    logError(message); log(JSON.stringify({ error: message, ...(error instanceof VoiceError ? error.result : {}) }));
    return { exitCode: error instanceof VoiceError ? error.exitCode : 1 };
  }
}
