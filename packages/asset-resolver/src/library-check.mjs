import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, open, readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAssetLibraryRoots } from '../../creator-root/src/index.mjs';
import { resolveFfprobe } from '../../media-bin/src/index.mjs';
import { ASSET_CATEGORIES, primaryMediaFile } from './library.mjs';
import { readProjectReferences } from './project-references.mjs';

const validator = fileURLToPath(new URL('../../schemas/bin/validate-asset.mjs', import.meta.url));
const conversion = /\.(aif|aiff|flac|ogg|webm|mkv|avi|gif|svg|woff|woff2|gltf)$/i;
const issue = (level, category, id, dir, code, message) => ({ level, category, id, dir, code, message });

async function directories(env) {
  const seen = new Set();
  const rows = [];
  for (const root of resolveAssetLibraryRoots(env).read) {
    for (const category of ASSET_CATEGORIES) {
      let names = [];
      try { names = await readdir(path.join(root, category)); } catch { continue; }
      for (const id of names.sort()) {
        if (id.startsWith('.') || id === '..' || seen.has(`${category}/${id}`)) continue;
        const dir = path.join(root, category, id);
        try { if (!(await lstat(dir)).isDirectory()) continue; } catch { continue; }
        seen.add(`${category}/${id}`);
        rows.push({ category, id, dir });
      }
    }
  }
  return rows;
}

function signatureOk(file, bytes) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.glb') return bytes.subarray(0, 4).toString() === 'glTF';
  if (ext === '.gltf') return bytes.toString('utf8').trimStart().startsWith('{');
  if (ext === '.ttf') return bytes.subarray(0, 4).toString('hex') === '00010000';
  if (ext === '.otf') return bytes.subarray(0, 4).toString() === 'OTTO';
  if (ext === '.woff') return bytes.subarray(0, 4).toString() === 'wOFF';
  if (ext === '.woff2') return bytes.subarray(0, 4).toString() === 'wOF2';
  return true;
}

export async function checkLibrary({ env = process.env, project } = {}) {
  if (project && !(await stat(project)).isDirectory()) throw new Error('プロジェクトがフォルダではありません');
  const findings = [];
  const rows = await directories(env);
  for (const { category, id, dir } of rows) {
    const validated = spawnSync(process.execPath, [validator, dir], { encoding: 'utf8', timeout: 30000 });
    if (validated.status !== 0 || validated.error) findings.push(issue('error', category, id, dir, 'meta',
      `meta.json / 素材契約: ${(validated.stderr || validated.stdout || validated.error?.message || '検証失敗').trim()}`));
    let meta;
    try { meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8')); } catch { /* validator reports this */ }
    let files;
    try { files = (await readdir(dir)).map(name => ({ name })); }
    catch (error) {
      findings.push(issue('error', category, id, dir, 'unreadable-directory', `素材ディレクトリを読めません: ${error.message}`));
      continue;
    }
    const media = primaryMediaFile(category, files);
    if (['audio', 'broll', 'font'].includes(category) && !media) {
      findings.push(issue('error', category, id, dir, 'media-missing', '主メディアが見つかりません'));
    } else if (media) {
      const file = path.join(dir, media);
      try {
        const handle = await open(file, 'r');
        let bytes;
        try {
          bytes = Buffer.alloc(512);
          const read = await handle.read(bytes, 0, bytes.length, 0);
          if (!read.bytesRead) throw new Error('内容を読めません');
        } finally { await handle.close(); }
        if (!signatureOk(file, bytes)) throw new Error('署名または内容を読めません');
        if (/\.gltf$/i.test(media)) JSON.parse(await readFile(file, 'utf8'));
        if (/\.svg$/i.test(media) && !(await readFile(file, 'utf8')).includes('<svg')) throw new Error('SVG を読めません');
        if (category === 'audio' || category === 'broll' || (category === 'still' && !/\.svg$/i.test(media))) {
          const probe = resolveFfprobe({ env });
          const tested = spawnSync(probe, ['-v', 'error', '-show_entries', 'stream=codec_name:format=duration', '-of', 'json', file], { encoding: 'utf8', timeout: 30000 });
          const data = JSON.parse(tested.stdout);
          if (tested.status !== 0 || !data.streams?.length
            || ((category === 'audio' || category === 'broll') && !Number.isFinite(Number(data.format?.duration)))) throw new Error('ffprobe で読めません');
        }
      } catch (error) { findings.push(issue('error', category, id, dir, 'media-unreadable', `主メディアを読めません: ${error.message}`)); }
      if (conversion.test(media)) findings.push(issue('warning', category, id, dir, 'conversion', '書き出し時に形式の変換が必要です'));
    }
    if (files.some(file => /\.cube$/i.test(file.name))) {
      for (const file of files.filter(entry => /\.cube$/i.test(entry.name))) {
        try {
          const lines = (await readFile(path.join(dir, file.name), 'utf8')).split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
          const size = Number(lines.find(line => line.startsWith('LUT_3D_SIZE '))?.split(/\s+/)[1]);
          const triples = lines.filter(line => /^[+\-\d.]/.test(line));
          if (!Number.isInteger(size) || size < 2 || triples.length !== size ** 3
            || triples.some(line => line.split(/\s+/).length !== 3 || line.split(/\s+/).some(value => !Number.isFinite(Number(value))))) {
            findings.push(issue('error', category, id, dir, 'cube', 'cube の行の形が不正です'));
          }
        } catch (error) { findings.push(issue('error', category, id, dir, 'cube', `cube を読めません: ${error.message}`)); }
      }
    }
    if (meta?.license?.attribution_required && !files.some(file => file.name === 'CREDIT.txt')) {
      findings.push(issue('warning', category, id, dir, 'credit-missing', 'クレジット必須ですが CREDIT.txt がありません'));
    }
    if (meta?.tags?.includes('license:subscription')) {
      findings.push(issue('warning', category, id, dir, 'subscription', 'サブスク素材です。契約が続いているか確認してください'));
    }
  }
  if (project) {
    const known = new Set(rows.map(row => `${row.category}/${row.id}`));
    for (const ref of await readProjectReferences(project)) {
      if (!known.has(`${ref.category}/${ref.id}`)) findings.push(issue('error', ref.category, ref.id, project, 'reference-missing', '参照の台帳にありますが置き場に素材がありません'));
    }
  }
  const affected = new Set(findings.filter(row => row.level === 'error').map(row => `${row.category}/${row.id}`));
  const warned = new Set(findings.filter(row => row.level === 'warning').map(row => `${row.category}/${row.id}`));
  return { ok: rows.filter(row => !affected.has(`${row.category}/${row.id}`) && !warned.has(`${row.category}/${row.id}`)).length,
    warnings: findings.filter(row => row.level === 'warning'), errors: findings.filter(row => row.level === 'error'), findings };
}

export async function projectCredits(project, env = process.env) {
  if (!(await stat(project)).isDirectory()) throw new Error('プロジェクトがフォルダではありません');
  const references = await readProjectReferences(project);
  const candidates = [...references];
  for (const category of ASSET_CATEGORIES) {
    let ids = [];
    try { ids = await readdir(path.join(project, 'assets', category)); } catch { continue; }
    for (const id of ids) candidates.push({ category, id });
  }
  const seenAssets = new Set();
  const seenTexts = new Set();
  const credits = [];
  for (const { category, id } of candidates) {
    const key = `${category}/${id}`;
    if (seenAssets.has(key) || !ASSET_CATEGORIES.includes(category) || !id || /[\\/]/.test(id) || id === '..') continue;
    seenAssets.add(key);
    const roots = [path.join(project, 'assets'), ...resolveAssetLibraryRoots(env).read];
    for (const root of roots) {
      const dir = path.join(root, category, id);
      if (!existsSync(dir)) continue;
      try {
        const actualRoot = await realpath(root), actual = await realpath(dir);
        if (!actual.startsWith(`${actualRoot}${path.sep}`) || !(await lstat(dir)).isDirectory()) continue;
        const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'));
        if (!meta?.license?.attribution_required) break;
        const credit = (await readFile(path.join(dir, 'CREDIT.txt'), 'utf8')).split(/\r?\n/)[0].trim();
        if (credit && !seenTexts.has(credit)) { credits.push(credit); seenTexts.add(credit); }
        break;
      } catch { /* try another library root */ }
    }
  }
  return credits;
}
