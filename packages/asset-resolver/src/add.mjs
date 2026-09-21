// Local import: read-only planning followed by per-asset atomic registration.
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, open, opendir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAssetLibraryRoots } from '../../creator-root/src/index.mjs';
import { resolveFfprobe } from '../../media-bin/src/index.mjs';
import { generateWaveformPreview } from '../../audio-library-setup/shared/waveform-preview.mjs';
import { scanLocalLibrary, readLocalLibraryItem } from './library.mjs';
import { sha256File } from './hash.mjs';
import { writeImportPreview, writeImportFragment } from './import-artifacts.mjs';

export const ADD_PLAN_SCHEMA = 'akari-assets-add-plan/v0';
export const MAX_IMPORT_FILES = 5000;
const VALIDATOR = fileURLToPath(new URL('../../schemas/bin/validate-asset.mjs', import.meta.url));
const EXTENSIONS = {
  audio: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'aif', 'aiff'],
  still: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'],
  broll: ['mp4', 'mov', 'webm', 'm4v'],
  font: ['ttf', 'otf', 'woff', 'woff2'], scene3d: ['glb', 'gltf'],
};
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ignored = name => name.startsWith('.') || name.toLowerCase() === 'thumbs.db';
const categoryOf = name => Object.keys(EXTENSIONS).find(category => EXTENSIONS[category].includes(path.extname(name).slice(1).toLowerCase()));
const oneLine = text => typeof text === 'string' ? text.replace(/[\r\n]+/g, ' ').trim() : '';

export function proposedAssetId(name) {
  const stem = path.basename(name, path.extname(name));
  const ascii = stem.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const slug = ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80).replace(/-$/, '');
  const hash = createHash('sha256').update(stem).digest('hex').slice(0, 8);
  return /[^\x00-\x7f]/.test(ascii) || !slug ? `${slug || 'asset'}-${hash}` : slug;
}
function uniqueId(category, proposed, keys) {
  let id = proposed;
  for (let suffix = 2; keys.has(`${category}/${id}`); suffix++) id = `${proposed}-${suffix}`;
  keys.add(`${category}/${id}`);
  return id;
}

/** null means ffprobe unavailable; a failed probe must throw, never estimate. */
export function probeDuration(file, { env = process.env } = {}) {
  let binary;
  try { binary = resolveFfprobe({ env }); } catch { return null; }
  const result = spawnSync(binary, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file],
    { encoding: 'utf8', env, timeout: 30000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`ffprobe: ${result.error?.message || result.stderr?.trim() || `exit ${result.status}`}`);
  let duration;
  try { duration = Number(JSON.parse(result.stdout).format?.duration); } catch { /* reject below */ }
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('ffprobe: 有効な尺を取得できません');
  return duration;
}

function fileIndex(env) {
  const sizes = new Map();
  for (const key of scanLocalLibrary(env)) {
    const [category, id] = key.split('/');
    const item = readLocalLibraryItem(env, category, id);
    for (const file of item?.files ?? []) {
      if (!categoryOf(file.name) || path.basename(file.name).toLowerCase() === 'preview.png') continue;
      const entry = { category, id, libraryDir: item.libraryDir, path: path.join(item.libraryDir, file.name) };
      if (!sizes.has(file.bytes)) sizes.set(file.bytes, []);
      sizes.get(file.bytes).push(entry);
    }
  }
  return sizes;
}
async function findDuplicate(entry, sizes, hashFile = sha256File) {
  const candidates = sizes.get(entry.bytes) ?? [];
  if (!candidates.length) return null;
  const hash = entry.sha256 ??= await hashFile(entry.path);
  for (const existing of candidates) {
    try {
      existing.sha256 ??= await hashFile(existing.path);
      if (existing.sha256 === hash) return { category: existing.category, id: existing.id, libraryDir: existing.libraryDir };
    } catch { /* unreadable existing payload is not evidence of a duplicate */ }
  }
  return null;
}

/** The probe injection keeps duration boundaries independent of installed tools. */
export async function planAdd(paths, { env = process.env, probe = probeDuration, hashFile = sha256File } = {}) {
  if (!Array.isArray(paths) || !paths.length) throw new Error('add --plan にはファイルかフォルダが必要です');
  const result = { schema: ADD_PLAN_SCHEMA, items: [], duplicates: [], rejected: [], truncated: false, limit: MAX_IMPORT_FILES, warnings: [] };
  const seen = new Set();
  const keys = await occupiedKeys(env);
  const sizes = fileIndex(env);
  let count = 0;
  async function walk(input, folder) {
    const absolute = path.resolve(input);
    if (ignored(path.basename(absolute)) || seen.has(absolute) || result.truncated) return;
    seen.add(absolute);
    let info;
    try { info = await lstat(absolute); }
    catch (error) { result.rejected.push({ path: absolute, name: path.basename(absolute), reason: error.message }); return; }
    if (info.isSymbolicLink()) return;
    if (info.isDirectory()) {
      try {
        const dir = await opendir(absolute);
        for await (const child of dir) {
          await walk(path.join(absolute, child.name), folder ?? path.basename(absolute));
          if (result.truncated) break;
        }
      } catch (error) { result.rejected.push({ path: absolute, name: path.basename(absolute), reason: error.message }); }
      return;
    }
    if (!info.isFile()) return;
    if (count === MAX_IMPORT_FILES) { result.truncated = true; return; }
    count++;
    const name = path.basename(absolute);
    const category = categoryOf(name) ?? null;
    const entry = { path: absolute, name, bytes: info.size, mtimeMs: info.mtimeMs, category, kind: category,
      durationSec: null, durationSource: null, ambiguous: false,
      proposedId: proposedAssetId(name), ...(folder === undefined ? {} : { folder }) };
    try {
      if (!category) throw new Error(path.extname(name).toLowerCase() === '.cube'
        ? 'LUT（cube）は presets/ の管轄のため v0 では取り込めません' : '対応していない形式');
      if (!info.size) throw new Error('0 バイトのファイルは読み込めません');
      const handle = await open(absolute, 'r');
      try { await handle.read(Buffer.alloc(512), 0, 512, 0); }
      finally { await handle.close(); }
      if (category === 'audio') {
        entry.durationSec = await probe(absolute, { env });
        if (entry.durationSec !== null && (!Number.isFinite(entry.durationSec) || entry.durationSec <= 0)) throw new Error('ffprobe: 有効な尺を取得できません');
        entry.durationSource = entry.durationSec === null ? 'size' : 'ffprobe';
        entry.ambiguous = entry.durationSec === null ? info.size >= 1_200_000 && info.size <= 4_000_000
          : entry.durationSec >= 10 && entry.durationSec < 30;
        entry.kind = (entry.durationSec === null ? info.size > 4_000_000 : entry.durationSec >= 30) ? 'bgm' : 'sfx';
      }
      const duplicate = await findDuplicate(entry, sizes, hashFile);
      if (duplicate) { result.duplicates.push({ ...entry, ...duplicate, status: 'duplicate' }); return; }
      entry.proposedId = uniqueId(category, entry.proposedId, keys);
      result.items.push(entry);
    } catch (error) { result.rejected.push({ ...entry, reason: error.message }); }
  }
  for (const input of paths) {
    if (typeof input !== 'string' || !input) throw new Error('取り込み元のパスが不正です');
    await walk(input);
    if (result.truncated) break;
  }
  if (result.truncated) result.warnings.push(`${MAX_IMPORT_FILES} ファイルで打ち切りました。残りは別の plan で指定してください`);
  return result;
}

export function createImportMeta(entry, options = {}) {
  const origin = options.origin ?? 'own';
  if (!['own', 'site'].includes(origin)) throw new Error('origin は own または site で指定してください');
  const tags = [`origin:${origin}`];
  if (entry.folder) tags.push(`folder:${oneLine(entry.folder)}`);
  if (entry.category === 'audio' && entry.kind === 'sfx') tags.push('sfx');
  if (options.pack) tags.push(`pack:${options.pack.id}`);
  if (origin === 'site' && options.site) tags.push(`site:${oneLine(options.site)}`);
  if (origin === 'site' && options.subscription === true) tags.push('license:subscription');
  const credit = oneLine(options.credit);
  const meta = {
    id: entry.proposedId, category: entry.category, title: path.basename(entry.name, path.extname(entry.name)),
    description: '利用者がローカルから取り込んだ素材',
    when_to_use: '利用者のプロジェクトでこの素材を使うとき',
    tags, knobs: [], ai_usage: '利用者の利用条件の範囲で使用する。再配布・AI 学習には使用しない。',
    requires: [], provenance: { origin: '利用者がローカルから取り込み', generator: null },
    author: 'user',
    license: { spdx: 'LicenseRef-user-owned', scope: 'private-owned', attribution_required: Boolean(credit), ai_training_allowed: false },
    price: 0,
  };
  if (origin === 'site') {
    meta.source = {
      url: options.sourceUrl, acquisition: options.subscription === true ? 'login' : 'direct',
      license_at_source: options.licenseAtSource, attribution_required: Boolean(credit),
    };
  }
  return meta;
}

/** Every staged asset must pass the unchanged validator, with no exemptions. */
export function validateImport(dir) {
  const result = spawnSync(process.execPath, [VALIDATOR, dir], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`validate-asset 検証に失敗しました: ${result.stderr || result.stdout || result.status}`);
  }
  return [];
}

async function assertPlainPath(file) {
  if ((await lstat(file)).isSymbolicLink()) throw new Error(`シンボリックリンクは取り込みません: ${file}`);
}
async function occupiedKeys(env) {
  const keys = scanLocalLibrary(env);
  // Empty directories also reserve an id; never replace an existing directory.
  for (const root of resolveAssetLibraryRoots(env).read) {
    for (const category of Object.keys(EXTENSIONS)) {
      try {
        const dir = await opendir(path.join(root, category));
        for await (const entry of dir) keys.add(`${category}/${entry.name}`);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
  return keys;
}
async function copyPayload(source, dest) {
  if (process.platform === 'darwin') {
    const copy = spawnSync('/bin/cp', ['-c', source, dest], { stdio: 'ignore' });
    if (copy.status === 0) return;
    await rm(dest, { force: true });
  }
  await copyFile(source, dest, constants.COPYFILE_FICLONE);
}
async function preparePack(root, pack, category) {
  if (!pack || !ID_PATTERN.test(pack.id) || typeof pack.title !== 'string' || !pack.title.trim()) throw new Error('pack には有効な id と title が必要です');
  const file = path.join(root, 'packs.json');
  let index;
  try { index = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; index = { schema: 'akari-catalog-packs/v0', packs: [] }; }
  if (index.schema !== 'akari-catalog-packs/v0' || !Array.isArray(index.packs)) throw new Error('packs.json の形式が不正です');
  const existing = index.packs.find(row => row.id === pack.id);
  if (existing && existing.title !== pack.title) throw new Error(`pack id は既に使われています: ${pack.id}`);
  if (!existing) index.packs.push({ id: pack.id, title: pack.title, category, summary: 'ローカルから取り込んだ素材セット' });
  return { file, data: `${JSON.stringify(index, null, 2)}\n` };
}

export async function applyAdd(plan, { env = process.env, waveform = generateWaveformPreview, thumbnail, validate = validateImport, copy = copyPayload } = {}) {
  if (plan?.schema !== ADD_PLAN_SCHEMA || !Array.isArray(plan.items)) throw new Error('add plan の形式が不正です');
  const result = { added: [], duplicates: [...(plan.duplicates ?? [])], rejected: [...(plan.rejected ?? [])], failures: [] };
  const root = path.resolve(resolveAssetLibraryRoots(env).write);
  let lock;
  try {
    await mkdir(root, { recursive: true });
    lock = path.join(root, '.add-lock');
    await mkdir(lock);
  } catch (error) {
    result.failures.push({ reason: `取り込み先を確保できません: ${error.message}` });
    return result;
  }
  try {
    const keys = await occupiedKeys(env);
    const sizes = fileIndex(env);
    for (const entry of plan.items) {
      if (entry?.selected === false) continue;
      let tempRoot, committedDir, packTemp;
      try {
        if (!entry || typeof entry.path !== 'string' || !path.isAbsolute(entry.path)
          || !ID_PATTERN.test(entry.proposedId) || categoryOf(entry.path) !== entry.category) throw new Error('plan の path / category / proposedId が不正です');
        if (entry.category === 'audio' && !['sfx', 'bgm'].includes(entry.kind)) throw new Error('音の kind は sfx または bgm で指定してください');
        await assertPlainPath(entry.path);
        const info = await lstat(entry.path);
        if (!info.isFile() || !info.size || info.size !== entry.bytes) throw new Error('元ファイルが変更されたか読み込めません。plan を作り直してください');
        if (entry.mtimeMs !== undefined && entry.mtimeMs !== info.mtimeMs) throw new Error('元ファイルの内容が変更されました。plan を作り直してください');
        const hash = await sha256File(entry.path);
        if (entry.sha256 && entry.sha256 !== hash) throw new Error('元ファイルの内容が変更されました。plan を作り直してください');
        const duplicate = await findDuplicate({ ...entry, sha256: hash }, sizes);
        if (duplicate) { result.duplicates.push({ ...entry, ...duplicate, status: 'duplicate' }); continue; }
        const id = uniqueId(entry.category, entry.proposedId, keys);
        const options = { ...plan, ...entry, pack: plan.pack };
        const meta = createImportMeta({ ...entry, name: path.basename(entry.path), proposedId: id }, options);
        const pack = plan.pack ? await preparePack(root, plan.pack, entry.category) : null;
        tempRoot = await mkdtemp(path.join(root, '.tmp-add-'));
        const stage = path.join(tempRoot, entry.category, id);
        await mkdir(stage, { recursive: true });
        // preview.png is reserved for the thumbnail, even if that was the input name.
        const name = path.basename(entry.path).toLowerCase() === 'preview.png' ? 'media.png' : path.basename(entry.path);
        const payload = path.join(stage, name);
        await copy(entry.path, payload);
        if (await sha256File(payload) !== hash) throw new Error('コピー中に元ファイルが変更されたかコピーが破損しました');
        await writeFile(path.join(stage, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
        const credit = oneLine(options.credit);
        if (credit) await writeFile(path.join(stage, 'CREDIT.txt'), `${credit}\n`);
        const warnings = await writeImportPreview(payload, stage, { category: entry.category, env, waveform, thumbnail });
        await writeImportFragment(stage, entry.category, name);
        await validate(stage, { category: entry.category });
        if (pack) {
          packTemp = path.join(root, `.packs-${randomUUID()}.tmp`);
          await writeFile(packTemp, pack.data, { flag: 'wx' });
        }
        const dest = path.join(root, entry.category, id);
        await mkdir(path.dirname(dest), { recursive: true });
        // Another importer is excluded by .add-lock; do not overwrite outsiders either.
        try { await lstat(dest); throw new Error(`登録先が既に存在します: ${dest}`); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        await rename(stage, dest);
        committedDir = dest;
        if (pack) await rename(packTemp, pack.file);
        result.added.push({ category: entry.category, id, libraryDir: dest, ...(warnings.length ? { warnings } : {}) });
        if (!sizes.has(entry.bytes)) sizes.set(entry.bytes, []);
        sizes.get(entry.bytes).push({ category: entry.category, id, libraryDir: dest, path: path.join(dest, name), sha256: hash });
        committedDir = null;
      } catch (error) {
        if (committedDir) await rm(committedDir, { recursive: true, force: true });
        result.failures.push({ path: entry?.path, reason: error.message });
      } finally {
        if (packTemp) await rm(packTemp, { force: true });
        if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
      }
    }
  } finally { await rm(lock, { recursive: true, force: true }); }
  return result;
}
