#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const categories = new Set(['film', 'short-drama', 'mv', 'explainer', 'product', 'vlog', 'cm', 'education', 'clip', 'logo']);

async function readOptional(file, fallback = {}) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

function slug(value) {
  return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    || `p-${createHash('sha256').update(String(value)).digest('hex').slice(0, 10)}`;
}

function asArray(value) { return Array.isArray(value) ? value : []; }
function stableById(items) { return items.sort((a, b) => a.id.localeCompare(b.id)); }

async function validateOutput(book, markdown) {
  const modulePath = path.join(repoRoot, 'packages', 'schemas', 'validate-playbook.mjs');
  try {
    await fs.access(modulePath);
    const { validatePlaybook } = await import(pathToFileURL(modulePath).href);
    return validatePlaybook(book, { markdown });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // A skill copied into a project has no monorepo packages directory. Keep its
    // deterministic writer usable there and enforce the core closed-v0 rules.
    const errors = [];
    if (book.version !== 0 || book.kind !== 'akari-playbook' || !book.name || !categories.has(book.category)) errors.push('必須項目または category が不正です');
    if (book.placeholders.some(item => ['own', 'site'].includes(item.sample?.source))) errors.push('own / site の見本は使えません');
    if (book.parts.some(item => ['own', 'site'].includes(item.source))) errors.push('own / site の部品は使えません');
    for (const heading of ['目的とできあがり', '流れ', '設定値', '必要な素材（仮枠）', '使った部品', '要る道具', 'ライセンス', '出どころ']) {
      if (!markdown.includes(`## ${heading}`)) errors.push(`見出しがありません: ${heading}`);
    }
    return { ok: errors.length === 0, errors, warnings: [] };
  }
}

function sourceRole(source, observations) {
  const observation = observations.find(item => item.sourceId === source.id || item.id === source.id || item.path === source.path);
  const role = observation?.role ?? observation?.tags?.role ?? source.role;
  if (role) return String(role);
  if (/\.(mp3|wav|m4a|flac)$/i.test(source.path)) return '音声（要確認）';
  if (/\.(png|jpg|jpeg|webp)$/i.test(source.path)) return '静止画（要確認）';
  return '映像（要確認）';
}

function sourceKind(source, observations) {
  const observation = observations.find(item => item.sourceId === source.id || item.id === source.id || item.path === source.path);
  if (['video', 'image', 'audio'].includes(observation?.kind)) return observation.kind;
  if (/\.(mp3|wav|m4a|flac)$/i.test(source.path)) return 'audio';
  if (/\.(png|jpg|jpeg|webp)$/i.test(source.path)) return 'image';
  return 'video';
}

function durationsBySource(edit) {
  const durations = new Map();
  const fps = edit.output?.fps || 30;
  for (const track of asArray(edit.tracks)) {
    for (const item of asArray(track.items)) {
      const id = item.source?.src;
      if (id) durations.set(id, (durations.get(id) ?? 0) + (item.duration ?? 0) / fps);
    }
  }
  return durations;
}

function collectPlaceholders(edit, analysis, references) {
  const observations = asArray(analysis.sources ?? analysis.assets ?? analysis.observations);
  const durations = durationsBySource(edit);
  const grouped = new Map();
  const usedIds = new Set();
  for (const source of asArray(edit.sources)) {
    const role = sourceRole(source, observations);
    const kind = sourceKind(source, observations);
    const key = `${kind}\0${role}`;
    if (!grouped.has(key)) grouped.set(key, { id: slug(role), role, kind, durationHintSec: 0 });
    const item = grouped.get(key);
    item.durationHintSec += durations.get(source.id) ?? 0;
    const library = /^assets\/([^/]+)\/([^/]+)\//.exec(source.path ?? '');
    const ref = library && asArray(references.references).find(entry => entry.category === library[1] && entry.id === library[2]);
    const observation = observations.find(entry => entry.sourceId === source.id || entry.id === source.id || entry.path === source.path);
    const origin = observation?.source ?? observation?.origin ?? (ref ? 'lab' : 'own');
    if (['own', 'site'].includes(origin)) item.externalSource = true;
    if (!['own', 'site'].includes(origin) && ref && !item.sample) {
      item.sample = { category: ref.category, id: ref.id, source: origin };
    }
  }
  const output = stableById([...grouped.values()].map(item => {
    if (item.externalSource) delete item.sample;
    delete item.externalSource;
    item.durationHintSec = Math.round(item.durationHintSec * 100) / 100;
    let candidate = item.id;
    for (let n = 2; usedIds.has(candidate); n++) candidate = `${item.id}-${n}`;
    item.id = candidate;
    usedIds.add(candidate);
    return item;
  }));
  return output;
}

async function collectParts(project, references, styles) {
  const parts = [];
  for (const ref of asArray(references.references)) {
    if (['own', 'site'].includes(ref.source)) continue;
    if (!ref.category || !ref.id) continue;
    const libraryRoot = process.env.AKARI_LIBRARY_ROOT ?? path.join(process.env.AKARI_HOME ?? path.join(os.homedir(), '.akari'), 'assets');
    const meta = await readOptional(path.join(project, 'assets', ref.category, ref.id, 'meta.json'),
      await readOptional(path.join(libraryRoot, ref.category, ref.id, 'meta.json')));
    if (['own', 'site'].includes(meta.source)) continue;
    const license = ref.license ?? meta.license;
    if (!license) continue;
    parts.push({ kind: 'asset', category: ref.category, id: ref.id,
      source: ref.source ?? meta.source ?? 'lab', license, ...(ref.tier ?? meta.tier ? { tier: ref.tier ?? meta.tier } : {}) });
  }
  for (const entry of asArray(styles.entries)) {
    if (['own', 'site'].includes(entry.source)) continue;
    if (!entry.style_uid) continue;
    const styleRoot = path.join(process.env.AKARI_HOME ?? path.join(os.homedir(), '.akari'), 'styles');
    const meta = await readOptional(path.join(styleRoot, entry.style_uid, 'meta.json'));
    if (['own', 'site'].includes(meta.source)) continue;
    const license = entry.license ?? meta.license;
    if (!license) continue;
    parts.push({ kind: 'style', id: slug(entry.id ?? entry.style_uid), uid: entry.style_uid,
      revision: entry.revision ?? 0, source: entry.source ?? meta.source ?? 'builtin', license });
  }
  return stableById([...new Map(parts.map(item => [`${item.kind}:${item.id}`, item])).values()]);
}

function defaultSteps(decisions) {
  const approved = asArray(decisions.decisions ?? decisions.entries).some(item =>
    ['approved', 'accepted'].includes(item.status ?? item.decision));
  return [
    { id: 'intake', title: '素材を置く', what: '要確認: 素材を置き、analyze-footage で確かめる', skill: 'analyze-footage', checkpoint: false },
    { id: 'script', title: '台本を確定する', what: '要確認: planning/ に台本と構成を書く', skill: 'research-plan', checkpoint: approved },
    { id: 'cut', title: 'カットを整える', what: '要確認: edit.json のカットを整える', skill: 'edit-plan', checkpoint: false },
    { id: 'export', title: '書き出す', what: '要確認: exports/ に書き出す', skill: 'render-cut', checkpoint: false }
  ];
}

function settingsFromEdit(edit) {
  const width = edit.output?.width;
  const height = edit.output?.height;
  const aspect = width && height ? (width < height ? '9:16' : width === height ? '1:1' : '16:9') : '16:9';
  const fps = Number.isInteger(edit.output?.fps) ? edit.output.fps : 30;
  const seconds = asArray(edit.tracks).flatMap(track => asArray(track.items).map(item => ((item.at ?? 0) + (item.duration ?? 0)) / fps));
  const gains = { ...(edit.audio?.role_gains_db ?? {}) };
  for (const track of asArray(edit.tracks)) for (const item of asArray(track.items)) {
    if (item.role && Number.isFinite(item.gain_db) && gains[item.role] === undefined) gains[item.role] = item.gain_db;
  }
  const transition = asArray(edit.tracks).flatMap(track => asArray(track.items))
    .map(item => item.source?.transition_out?.kind ?? item.source?.transition_out?.type).find(Boolean);
  return { aspect, fps, targetDurationSec: Math.ceil(Math.max(0, ...seconds)),
    ...(edit.output?.caption_style_uid ? { captions: { styleUid: edit.output.caption_style_uid,
      ...(edit.output.caption_position ? { position: edit.output.caption_position } : {}) } } : {}),
    transitions: { default: edit.output?.default_transition ?? transition ?? 'cut' },
    ...(Object.keys(gains).length ? { audio: { roles: gains } } : {}) };
}

function table(rows) { return `| ${rows.map(row => row.map(value => String(value ?? '—').replaceAll('|', '\\|')).join(' | ')).join(' |\n| ')} |`; }
function renderMarkdown(book) {
  const steps = book.steps.map((step, index) => `${index + 1}. **${step.title}** — ${step.what}${step.checkpoint ? ' ☑ ここで確認' : ''}`).join('\n');
  const settings = table([['キー', '値', '意味'], ['---', '---', '---'], ...Object.entries(book.settings).map(([key, value]) => [key, JSON.stringify(value), '次のプロジェクトの初期値'])]);
  const placeholders = table([['役割', '種類', '尺の目安', '見本'], ['---', '---', '---', '---'], ...asArray(book.placeholders).map(item => [item.role, item.kind, item.durationHintSec ?? '—', item.sample ? `${item.sample.category}/${item.sample.id}` : 'なし'])]);
  const parts = table([['種類', '名前', '入手先', 'ライセンス'], ['---', '---', '---', '---'], ...asArray(book.parts).map(item => [item.kind, item.id, item.source, item.license])]);
  return `# ${book.name}\n\n${book.category} の作り方。流れと仮枠を再利用できます。\n\n## 目的とできあがり\n\n${book.category}、${book.settings.aspect}、目標 ${book.settings.targetDurationSec} 秒。\n\n## 流れ\n\n${steps}\n\n## 設定値\n\n${settings}\n\n## 必要な素材（仮枠）\n\n${placeholders}\n\n## 使った部品\n\n${parts}\n\n## 要る道具\n\nCLI ${book.requires.cli}。道具: ${book.requires.tools.join('、') || 'なし'}。スキル: ${book.requires.skills.join('、') || 'なし'}。無い道具は別の道具または手作業で補います。\n\n## ライセンス\n\n${book.license}（要確認）。外部由来の素材は見本を付けず仮枠にしました。\n\n## 出どころ\n\n${book.provenance.fromProject} / ${book.provenance.recordedAt} / AKARI ${book.provenance.akariVersion}\n`;
}

async function writeAtomic(file, data) {
  const temp = `${file}.${process.pid}.tmp`;
  try { await fs.writeFile(temp, data, { flag: 'wx' }); await fs.rename(temp, file); }
  finally { await fs.rm(temp, { force: true }); }
}

async function planningEvidence(project) {
  const planning = path.join(project, 'planning');
  const docs = [];
  try {
    for (const file of await fs.readdir(planning)) {
      if (!file.endsWith('.json') || file === 'playbook.json') continue;
      const value = await readOptional(path.join(planning, file));
      docs.push(value);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return docs;
}

export async function recordPlaybook(projectRoot, { name, category, license = 'CC0-1.0', now = new Date() }) {
  if (!name || !categories.has(category)) throw new Error('name と category（定義済み語彙）が必要です');
  const project = path.resolve(projectRoot);
  const edit = await readOptional(path.join(project, 'edit.json'));
  const analysis = await readOptional(path.join(project, 'analysis.json'));
  const references = await readOptional(path.join(project, '.akari', 'asset-references.json'));
  const styles = await readOptional(path.join(project, '.akari', 'style-usage.json'));
  const decisions = await readOptional(path.join(project, 'decisions.json'));
  const prior = await readOptional(path.join(project, 'planning', 'playbook.json'), null);
  const packageJson = await readOptional(path.join(repoRoot, 'packages', 'akari-launcher', 'package.json'));
  const planningDocs = await planningEvidence(project);
  const recordedSteps = planningDocs.flatMap(doc => asArray(doc.steps)).filter(step => step.id && step.title && step.what);
  const steps = recordedSteps.length ? recordedSteps.map(step => ({ id: slug(step.id), title: String(step.title), what: String(step.what),
    ...(step.skill ? { skill: slug(step.skill) } : {}), checkpoint: Boolean(step.checkpoint) })) : defaultSteps(decisions);
  const tools = [...new Set(planningDocs.flatMap(doc => asArray(doc.requires?.tools)).filter(item => typeof item === 'string'))].sort();
  const skills = [...new Set([...steps.map(step => step.skill).filter(Boolean),
    ...planningDocs.flatMap(doc => asArray(doc.requires?.skills)).filter(item => typeof item === 'string')])].sort();
  const book = {
    version: 0, kind: 'akari-playbook', id: prior?.id ?? slug(name), name,
    playbookVersion: (prior?.playbookVersion ?? 0) + 1, depth: 2, category,
    tags: { form: [], length: [], technique: [], tools: [], style: [], industry: [], materials: [], scale: [] },
    requires: { cli: `>=${packageJson.version ?? '0.0.0'}`, tools, skills },
    steps, settings: settingsFromEdit(edit),
    placeholders: collectPlaceholders(edit, analysis, references), parts: await collectParts(project, references, styles),
    license, provenance: { fromProject: path.basename(project), recordedAt: now.toISOString(),
      akariVersion: packageJson.version ?? '0.0.0', recordedBy: 'record-playbook' }
  };
  const markdown = renderMarkdown(book);
  book.tags.tools = tools;
  const validation = await validateOutput(book, markdown);
  if (!validation.ok) throw new Error(`作り方が不正です: ${validation.errors.join('; ')}`);
  const planning = path.join(project, 'planning');
  await fs.mkdir(planning, { recursive: true });
  await writeAtomic(path.join(planning, 'playbook.json'), `${JSON.stringify(book, null, 2)}\n`);
  await writeAtomic(path.join(planning, 'playbook.md'), markdown);
  return book;
}

if (process.argv[1] && await fs.realpath(path.resolve(process.argv[1])).catch(() => '') === await fs.realpath(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const project = args.shift();
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--name', '--category', '--license'].includes(args[index]) || !args[index + 1]) {
      console.error('使い方: record-playbook.mjs <project-root> --name <name> --category <category> [--license <license>]');
      process.exit(2);
    }
    options[args[index].slice(2)] = args[index + 1];
  }
  if (!project) { console.error('プロジェクトの場所が必要です'); process.exit(2); }
  try {
    const result = await recordPlaybook(project, options);
    console.log(`作り方: ${path.join(path.resolve(project), 'planning', 'playbook.md')} / 流れ ${result.steps.length}、仮枠 ${result.placeholders.length}、部品 ${result.parts.length}、要る道具 ${result.requires.tools.length}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
