#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const categories = new Set(['film', 'short-drama', 'mv', 'explainer', 'product', 'vlog', 'cm', 'education', 'clip', 'logo']);
const execFileAsync = promisify(execFile);

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
    for (const heading of ['目的とできあがり', '流れ', '設定値', '必要な素材（仮枠）', ...(book.beats ? ['内訳'] : []), '使った部品', '要る道具', 'ライセンス', '出どころ']) {
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

function collectBeats(edit, analysis, script, planMarkdown, captions, placeholders) {
  const fps = edit.output?.fps || 30;
  const available = new Set(placeholders.map(item => item.id));
  const visualTracks = asArray(edit.tracks).filter(track => track.lane === 'visual' && track.id !== 'playbook-placeholders-audio');
  const mainTrack = visualTracks.find(track => track.id === 'playbook-placeholders')
    ?? visualTracks.reduce((best, track) => {
      const mediaCount = candidate => asArray(candidate.items).filter(item => item.source?.kind === 'media' && item.source?.src).length;
      return !best || mediaCount(track) > mediaCount(best) ? track : best;
    }, null);
  const visualCuts = asArray(mainTrack?.items).filter(item => Number.isFinite(item.at) && Number.isFinite(item.duration) && item.duration > 0)
    .sort((a, b) => a.at - b.at || String(a.id).localeCompare(String(b.id)));
  const end = Math.max(0, ...visualCuts.map(item => (item.at + item.duration) / fps));
  const plans = asArray(script?.lines).filter(line => line?.kind === 'plan' && Number.isFinite(line.at) && line.at >= 0 && typeof line.text === 'string' && line.text.trim())
    .sort((a, b) => a.at - b.at || String(a.id).localeCompare(String(b.id)));
  const used = new Set();
  const uniqueId = (value) => {
    const base = slug(value);
    let candidate = base;
    for (let n = 2; used.has(candidate); n++) candidate = `${base}-${n}`;
    used.add(candidate);
    return candidate;
  };
  if (plans.length) return plans.map((line, index) => {
    const next = plans[index + 1]?.at ?? end;
    const [titlePart, ...noteParts] = line.text.split(/:\s*/u);
    const title = titlePart.trim() || line.text.trim();
    const note = noteParts.join(': ').trim();
    return { id: uniqueId(line.beat || line.id || title), at: line.at,
      duration: line.duration > 0 ? line.duration : Math.max(0.01, next - line.at || 5),
      title, ...(note ? { note } : {}),
      ...(available.has(line.placeholder) ? { placeholder: line.placeholder } : {}) };
  });

  const headings = [];
  for (const match of String(planMarkdown).matchAll(/^#{2,4}\s+(.+)$/gmu)) {
    const timed = /^(?:(\d+):)?(\d{1,2}):(\d{2})\s*[—–-]?\s*(.+)$/u.exec(match[1].trim());
    const at = timed ? Number(timed[1] ?? 0) * 3600 + Number(timed[2]) * 60 + Number(timed[3]) : undefined;
    headings.push({ at, timed: Boolean(timed), title: (timed ? timed[4] : match[1]).trim() });
  }
  const captionRows = Array.isArray(captions) ? captions : asArray(captions?.captions);
  for (const item of captionRows) {
    const chapterText = /^(?:#{1,4}\s*|第[一二三四五六七八九十0-9]+章\s*)/u.exec(item?.text ?? '');
    if (!['chapter', 'heading'].includes(item?.kind ?? item?.type) && !chapterText) continue;
    const at = item.at ?? item.start;
    const title = (item.title ?? item.text)?.replace(/^(?:#{1,4}\s*)/u, '');
    if (Number.isFinite(at) && typeof title === 'string' && title.trim()) headings.push({ at, timed: true, title: title.trim() });
  }
  for (const [index, heading] of headings.filter(item => !item.timed).entries()) heading.at = visualCuts[index]?.at / fps;
  headings.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
  const sources = new Map(asArray(edit.sources).map(source => [source.id, source]));
  const observations = asArray(analysis.sources ?? analysis.assets ?? analysis.observations);
  const placeholderForCut = cut => {
    const source = sources.get(cut.source?.src);
    const role = source ? sourceRole(source, observations) : cut.source?.canvas?.intent;
    return placeholders.find(item => item.role === role)?.id;
  };
  const timedHeadings = headings.filter(heading => heading.timed);
  if (timedHeadings.length) {
    const chapters = timedHeadings.filter((heading, index) => index === 0 || heading.at !== timedHeadings[index - 1].at);
    return chapters.map((heading, index) => {
      const at = heading.at;
      const until = chapters[index + 1]?.at ?? Math.max(end, at + 5);
      const overlapByRole = new Map();
      for (const cut of visualCuts) {
        const overlap = Math.max(0, Math.min(until, (cut.at + cut.duration) / fps) - Math.max(at, cut.at / fps));
        const placeholder = placeholderForCut(cut);
        if (overlap > 0 && placeholder) overlapByRole.set(placeholder, (overlapByRole.get(placeholder) ?? 0) + overlap);
      }
      const placeholder = [...overlapByRole].sort((a, b) => b[1] - a[1])[0]?.[0];
      return { id: uniqueId(heading.title), at, duration: Math.max(0.01, until - at), title: heading.title,
        ...(placeholder ? { placeholder } : {}) };
    });
  }
  if (!visualCuts.length) return headings.filter(heading => Number.isFinite(heading.at)).map((heading, index, timed) => ({
    id: uniqueId(heading.title), at: heading.at,
    duration: Math.max(0.01, (timed[index + 1]?.at ?? end) - heading.at || 5), title: heading.title }));
  return visualCuts.map((cut, index) => {
    const at = cut.at / fps;
    const heading = headings.find(item => item.at === at);
    const placeholder = placeholderForCut(cut);
    const role = placeholders.find(item => item.id === placeholder)?.role;
    const title = heading?.title || cut.name || role || `カット ${index + 1}`;
    return { id: uniqueId(cut.id || title), at, duration: cut.duration / fps, title,
      ...(placeholder ? { placeholder } : {}) };
  });
}

function table(rows) { return `| ${rows.map(row => row.map(value => String(value ?? '—').replaceAll('|', '\\|')).join(' | ')).join(' |\n| ')} |`; }
function renderMarkdown(book) {
  const steps = book.steps.map((step, index) => `${index + 1}. **${step.title}** — ${step.what}${step.checkpoint ? ' ☑ ここで確認' : ''}`).join('\n');
  const settings = table([['キー', '値', '意味'], ['---', '---', '---'], ...Object.entries(book.settings).map(([key, value]) => [key, JSON.stringify(value), '次のプロジェクトの初期値'])]);
  const placeholders = table([['役割', '種類', '尺の目安', '見本'], ['---', '---', '---', '---'], ...asArray(book.placeholders).map(item => [item.role, item.kind, item.durationHintSec ?? '—', item.sample ? `${item.sample.category}/${item.sample.id}` : 'なし'])]);
  const beats = book.beats?.length
    ? table([['時刻（秒）', '見出し', 'メモ', '仮枠'], ['---', '---', '---', '---'], ...book.beats.map(item => [`${item.at}–${item.at + item.duration}`, item.title, item.note ?? '—', item.placeholder ?? '—'])])
    : 'なし';
  const parts = table([['種類', '名前', '入手先', 'ライセンス'], ['---', '---', '---', '---'], ...asArray(book.parts).map(item => [item.kind, item.id, item.source, item.license])]);
  return `# ${book.name}\n\n${book.category} の作り方。流れと仮枠を再利用できます。\n\n## 目的とできあがり\n\n${book.category}、${book.settings.aspect}、目標 ${book.settings.targetDurationSec} 秒。${book.preview?.frames?.length ? '' : '\n\n見本のコマはまだ（書き出し後に記録し直す）'}\n\n## 流れ\n\n${steps}\n\n## 設定値\n\n${settings}\n\n## 必要な素材（仮枠）\n\n${placeholders}\n\n## 内訳\n\n${beats}\n\n## 使った部品\n\n${parts}\n\n## 要る道具\n\nCLI ${book.requires.cli}。道具: ${book.requires.tools.join('、') || 'なし'}。スキル: ${book.requires.skills.join('、') || 'なし'}。無い道具は別の道具または手作業で補います。\n\n## ライセンス\n\n${book.license}（要確認）。外部由来の素材は見本を付けず仮枠にしました。\n\n## 出どころ\n\n${book.provenance.fromProject} / ${book.provenance.recordedAt} / AKARI ${book.provenance.akariVersion}\n`;
}

async function latestExport(project) {
  const directory = path.join(project, 'exports');
  let files;
  try { files = await fs.readdir(directory); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const videos = await Promise.all(files.filter(file => /\.(mp4|mov|m4v|webm)$/i.test(file)).map(async file => {
    const fullPath = path.join(directory, file);
    const stat = await fs.stat(fullPath);
    return stat.isFile() ? { path: fullPath, modified: stat.mtimeMs } : null;
  }));
  return videos.filter(Boolean).sort((a, b) => b.modified - a.modified)[0]?.path ?? null;
}

function frameTimes(edit, outputDuration) {
  const fps = edit.output?.fps || 30;
  const cuts = asArray(edit.tracks).filter(track => track.lane === 'visual')
    .flatMap(track => asArray(track.items))
    .filter(item => item.source?.kind === 'media' && Number.isFinite(item.at) && Number.isFinite(item.duration) && item.duration > 0);
  const editDuration = Math.max(0, ...cuts.map(item => (item.at + item.duration) / fps));
  const count = Math.min(5, Math.max(3, cuts.length));
  return Array.from({ length: count }, (_, index) => {
    const start = outputDuration * index / count;
    const end = outputDuration * (index + 1) / count;
    const selected = cuts.map(item => ({ duration: item.duration,
      midpoint: (item.at + item.duration / 2) / fps * outputDuration / (editDuration || outputDuration) }))
      .filter(item => item.midpoint >= start && item.midpoint < end)
      .sort((a, b) => b.duration - a.duration)[0];
    return Math.min(outputDuration - 0.05, Math.max(0, selected?.midpoint ?? (start + end) / 2));
  });
}

async function clearPreviewFrames(directory) {
  await fs.mkdir(directory, { recursive: true });
  for (const file of await fs.readdir(directory)) {
    if (file.toLowerCase().endsWith('.png')) await fs.rm(path.join(directory, file));
  }
}

async function createPreview(project, edit) {
  const video = await latestExport(project);
  if (!video) return undefined;
  const ffmpeg = process.env.AKARI_FFMPEG ?? 'ffmpeg';
  const ffprobe = process.env.AKARI_FFPROBE ?? 'ffprobe';
  const directory = path.join(project, 'planning', 'playbook-preview', 'frames');
  await clearPreviewFrames(directory);
  try {
    const { stdout } = await execFileAsync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', video]);
    const duration = Number(stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`書き出しの尺を取得できません: ${video}`);
    const width = edit.output?.width || 1920;
    const height = edit.output?.height || 1080;
    const frameWidth = width >= height ? 640 : Math.max(1, Math.round(640 * width / height));
    const frameHeight = height >= width ? 640 : Math.max(1, Math.round(640 * height / width));
    const frames = [];
    for (const [index, at] of frameTimes(edit, duration).entries()) {
      const filename = `${String(index + 1).padStart(2, '0')}.png`;
      await execFileAsync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(at), '-i', video,
        '-frames:v', '1', '-vf', `scale=${frameWidth}:${frameHeight}:force_original_aspect_ratio=increase,crop=${frameWidth}:${frameHeight}`,
        path.join(directory, filename)]);
      frames.push(`playbook-preview/frames/${filename}`);
    }
    return { frames };
  } catch (error) {
    await clearPreviewFrames(directory);
    throw error;
  }
}

async function installPlaybook(project, book) {
  const destination = path.join(process.env.AKARI_HOME ?? path.join(os.homedir(), '.akari'), 'playbooks', book.id);
  const installed = await readOptional(path.join(destination, 'playbook.json'), null);
  if (installed && installed.playbookVersion >= book.playbookVersion) return false;
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(path.join(project, 'planning', 'playbook.md'), path.join(destination, 'playbook.md'));
  await fs.rm(path.join(destination, 'preview'), { recursive: true, force: true });
  const shelfBook = structuredClone(book);
  if (book.preview?.frames?.length) {
    const frameDirectory = path.join(destination, 'preview', 'frames');
    await fs.mkdir(frameDirectory, { recursive: true });
    shelfBook.preview.frames = [];
    for (const frame of book.preview.frames) {
      const filename = path.basename(frame);
      await fs.cp(path.join(project, 'planning', frame), path.join(frameDirectory, filename));
      shelfBook.preview.frames.push(`preview/frames/${filename}`);
    }
  }
  if (book.preview?.cover) {
    await fs.mkdir(path.join(destination, 'preview'), { recursive: true });
    await fs.cp(path.join(project, 'planning', book.preview.cover), path.join(destination, 'preview', 'cover.png'));
    shelfBook.preview.cover = 'preview/cover.png';
  }
  await writeAtomic(path.join(destination, 'playbook.json'), `${JSON.stringify(shelfBook, null, 2)}\n`);
  return true;
}

export async function installExistingPlaybook(projectRoot) {
  const project = path.resolve(projectRoot);
  const planning = path.join(project, 'planning');
  const book = JSON.parse(await fs.readFile(path.join(planning, 'playbook.json'), 'utf8'));
  const markdown = await fs.readFile(path.join(planning, 'playbook.md'), 'utf8');
  const validation = await validateOutput(book, markdown);
  if (!validation.ok) throw new Error(`作り方が不正です: ${validation.errors.join('; ')}`);
  return installPlaybook(project, book);
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

export async function recordPlaybook(projectRoot, { name, category, license = 'CC0-1.0', now = new Date(), install = false }) {
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
  const script = await readOptional(path.join(project, 'planning', 'script.json'));
  const captions = await readOptional(path.join(project, 'captions.json'));
  const planMarkdown = await fs.readFile(path.join(project, 'planning', 'plan.md'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
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
  const beats = collectBeats(edit, analysis, script, planMarkdown, captions, book.placeholders);
  if (beats.length) book.beats = beats;
  try {
    book.preview = await createPreview(project, edit);
  } catch (error) {
    console.warn(`WARN: 見本のコマを作れませんでした: ${error.message}`);
  }
  if (!book.preview) delete book.preview;
  const markdown = renderMarkdown(book);
  book.tags.tools = tools;
  const validation = await validateOutput(book, markdown);
  if (!validation.ok) throw new Error(`作り方が不正です: ${validation.errors.join('; ')}`);
  const planning = path.join(project, 'planning');
  await fs.mkdir(planning, { recursive: true });
  await writeAtomic(path.join(planning, 'playbook.json'), `${JSON.stringify(book, null, 2)}\n`);
  await writeAtomic(path.join(planning, 'playbook.md'), markdown);
  if (install) await installPlaybook(project, book);
  return book;
}

if (process.argv[1] && await fs.realpath(path.resolve(process.argv[1])).catch(() => '') === await fs.realpath(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const project = args.shift();
  const options = {};
  for (let index = 0; index < args.length;) {
    if (args[index] === '--install') { options.install = true; index += 1; continue; }
    if (!['--name', '--category', '--license'].includes(args[index]) || !args[index + 1]) {
      console.error('使い方: record-playbook.mjs <project-root> --name <name> --category <category> [--license <license>] [--install]');
      process.exit(2);
    }
    options[args[index].slice(2)] = args[index + 1];
    index += 2;
  }
  if (!project) { console.error('プロジェクトの場所が必要です'); process.exit(2); }
  try {
    if (options.install && !options.name && !options.category) {
      const installed = await installExistingPlaybook(project);
      console.log(installed ? '作り方を手元の棚へ写しました' : '手元の棚には同じ版か新しい版があります');
      process.exit(0);
    }
    const result = await recordPlaybook(project, options);
    console.log(`作り方: ${path.join(path.resolve(project), 'planning', 'playbook.md')} / 流れ ${result.steps.length}、仮枠 ${result.placeholders.length}、部品 ${result.parts.length}、要る道具 ${result.requires.tools.length}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
