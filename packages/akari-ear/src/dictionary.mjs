import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMatcher, locateMatches, normalizeKey } from '../../word-book/src/index.mjs';
import { validateVoiceDictionary } from '../../schemas/bin/validate-voice-dictionary.mjs';

const bundled = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../presets/voice-dictionary/builtin.json');
const cache = new Map();
const queues = new Map();
const pendingHits = new Map();

export function voiceDictionaryPaths({ env = process.env } = {}) {
  const home = env.AKARI_HOME || path.join(env.HOME || env.USERPROFILE || os.homedir(), '.akari');
  const resource = process.resourcesPath && path.join(process.resourcesPath, 'presets/voice-dictionary/builtin.json');
  const memory = path.join(home, 'memory');
  return {
    user: path.join(memory, 'voice-dictionary.json'),
    stats: path.join(memory, 'voice-dictionary.stats.json'),
    history: path.join(memory, 'ear-history.jsonl'),
    builtin: resource && existsSync(resource) ? resource : bundled,
  };
}

function readLayer(file, layer) {
  try {
    const book = JSON.parse(readFileSync(file, 'utf8'));
    const checked = validateVoiceDictionary(book);
    if (!checked.valid) return { layer, path: file, exists: true, error: checked.errors.join('; '), tooNew: checked.tooNew, entries: [] };
    return { layer, path: file, exists: true, entries: book.entries };
  } catch (error) {
    return { layer, path: file, exists: error?.code !== 'ENOENT', error: error?.code === 'ENOENT' ? undefined : '辞書を読めません', entries: [] };
  }
}

function signature(file) {
  try { const stat = statSync(file); return `${stat.mtimeMs}:${stat.size}`; }
  catch { return 'missing'; }
}

export function loadVoiceDictionary({ env = process.env, now = Date.now } = {}) {
  const paths = voiceDictionaryPaths({ env });
  const cacheKey = `${paths.user}|${paths.builtin}`;
  const previous = cache.get(cacheKey);
  const timestamp = now();
  if (previous && timestamp - previous.checkedAt < 1000) return previous.result;
  const signatures = [signature(paths.user), signature(paths.builtin)];
  if (previous && signatures.every((item, index) => item === previous.signatures[index])) {
    previous.checkedAt = timestamp;
    return previous.result;
  }
  const layers = [readLayer(paths.user, 'user'), readLayer(paths.builtin, 'builtin')];
  const owners = new Map(), entries = [], conflicts = [];
  for (const layer of layers) for (const entry of layer.entries) {
    const phrases = entry.kind === 'fix' ? entry.from : entry.trigger;
    const kept = [];
    for (const phrase of phrases) {
      const normalized = normalizeKey(phrase);
      const owner = owners.get(normalized);
      if (owner && owner.entry !== entry) {
        conflicts.push({ key: normalized, winner: owner.id, shadowed: entry.id });
      } else {
        owners.set(normalized, { id: entry.id, entry });
        kept.push(phrase);
      }
    }
    if (kept.length) entries.push({ ...entry, layer: layer.layer, [entry.kind === 'fix' ? 'from' : 'trigger']: kept });
  }
  const result = { entries, layers: layers.map(({ entries: ignored, ...rest }) => rest), conflicts };
  cache.set(cacheKey, { checkedAt: timestamp, signatures, result });
  return result;
}

export function applyVoiceDictionary(text, resolved, { final = false } = {}) {
  const source = String(text ?? '');
  const fixes = (resolved?.entries ?? []).filter(entry => entry.kind === 'fix');
  const matcher = buildMatcher(fixes.map(entry => ({ kind: 'term', surface: entry.to, variants: entry.from, scope: entry.layer })));
  const matches = locateMatches(source, matcher);
  let output = '', cursor = 0;
  const applied = [];
  for (const match of matches) {
    if (match.start < cursor) continue;
    output += source.slice(cursor, match.start);
    const start = output.length;
    output += match.to;
    const entry = fixes[match.priority];
    if (normalizeKey(match.from) !== normalizeKey(match.to)) {
      applied.push({ from: match.from, to: match.to, layer: entry.layer, id: entry.id, range: [start, output.length] });
    }
    cursor = match.end;
  }
  output += source.slice(cursor);
  return { text: output, applied };
}

export function expandSnippet(text, resolved, { target } = {}) {
  if (!['note', 'task', 'partner'].includes(target)) return undefined;
  const normalized = normalizeKey(String(text ?? '').replace(/\p{P}/gu, ''));
  const entry = (resolved?.entries ?? []).find(item => item.kind === 'snippet'
    && (item.scope ?? ['note', 'task', 'partner']).includes(target)
    && item.trigger.some(trigger => normalizeKey(trigger.replace(/\p{P}/gu, '')) === normalized));
  return entry ? { expanded: entry.expand, entryId: entry.id, trigger: text } : undefined;
}

function queued(file, operation) {
  const previous = queues.get(file) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  const settled = current.catch(() => {});
  queues.set(file, settled);
  return current.finally(() => { if (queues.get(file) === settled) queues.delete(file); });
}

async function atomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

async function userBook(file) {
  try {
    const book = JSON.parse(await readFile(file, 'utf8'));
    const checked = validateVoiceDictionary(book);
    return checked.valid ? { ok: true, book } : { ok: false, errors: checked.errors };
  } catch (error) {
    return error.code === 'ENOENT' ? { ok: true, book: { version: 0, entries: [] } } : { ok: false, errors: ['自分の辞書を読めません'] };
  }
}

async function editUser(env, edit) {
  const file = voiceDictionaryPaths({ env }).user;
  return queued(file, async () => {
    const loaded = await userBook(file);
    if (!loaded.ok) return loaded;
    const result = edit(loaded.book);
    if (!result.ok) return result;
    const checked = validateVoiceDictionary(result.book);
    if (!checked.valid) return { ok: false, errors: checked.errors };
    await atomic(file, result.book);
    cache.delete(`${file}|${voiceDictionaryPaths({ env }).builtin}`);
    return { ...result, warnings: checked.warnings };
  });
}

export function addUserEntry(entry, { env = process.env } = {}) {
  return editUser(env, book => {
    const number = Math.max(0, ...book.entries.map(item => Number(/^vd-(\d+)$/u.exec(item.id)?.[1] ?? 0))) + 1;
    const next = { ...entry, id: `vd-${String(number).padStart(4, '0')}`, added_at: entry.added_at ?? new Date().toISOString() };
    return { ok: true, entry: next, book: { ...book, entries: [...book.entries, next] } };
  });
}

export function updateUserEntry(id, patch, { env = process.env } = {}) {
  return editUser(env, book => {
    const index = book.entries.findIndex(entry => entry.id === id);
    if (index < 0) return { ok: false, errors: ['自分の辞書に項目がありません'] };
    const entries = [...book.entries];
    entries[index] = { ...entries[index], ...patch, id };
    return { ok: true, entry: entries[index], book: { ...book, entries } };
  });
}

export function removeUserEntry(id, { env = process.env } = {}) {
  return editUser(env, book => {
    if (!book.entries.some(entry => entry.id === id)) return { ok: false, errors: ['自分の辞書に項目がありません'] };
    return { ok: true, book: { ...book, entries: book.entries.filter(entry => entry.id !== id) } };
  });
}

export function recordApplied(applied, { env = process.env } = {}) {
  const paths = voiceDictionaryPaths({ env });
  let pending = pendingHits.get(paths.user);
  if (!pending) {
    pending = { user: new Map(), builtin: new Map(), paths, timer: undefined };
    pendingHits.set(paths.user, pending);
  }
  for (const item of applied ?? []) {
    const map = item.layer === 'builtin' ? pending.builtin : pending.user;
    map.set(item.id, (map.get(item.id) ?? 0) + 1);
  }
  if (!pending.timer && (pending.user.size || pending.builtin.size)) pending.timer = setTimeout(() => { void flushHits(paths.user).catch(() => {}); }, 1000);
}

async function flushHits(key) {
  const pending = pendingHits.get(key);
  if (!pending) return;
  pendingHits.delete(key);
  if (pending.user.size) await editUser({ AKARI_HOME: path.dirname(path.dirname(pending.paths.user)) }, book => {
    const entries = book.entries.map(entry => ({ ...entry, hits: Math.max(0, (entry.hits ?? 0) + (pending.user.get(entry.id) ?? 0)) }));
    return { ok: true, book: { ...book, entries } };
  });
  if (pending.builtin.size) await queued(pending.paths.stats, async () => {
    let stats = {};
    try { stats = JSON.parse(await readFile(pending.paths.stats, 'utf8')); } catch { /* 初回 */ }
    for (const [id, count] of pending.builtin) stats[id] = Math.max(0, (stats[id] ?? 0) + count);
    await atomic(pending.paths.stats, stats);
  });
}

export function recordReverted(id, { env = process.env } = {}) {
  const paths = voiceDictionaryPaths({ env });
  const pending = pendingHits.get(paths.user);
  if (pending) {
    for (const map of [pending.user, pending.builtin]) if (map.has(id) && map.get(id) > 0) { map.set(id, map.get(id) - 1); return; }
  }
  const entry = loadVoiceDictionary({ env }).entries.find(item => item.id === id);
  if (!entry) return Promise.resolve({ ok: false });
  if (entry.layer === 'user') return editUser(env, book => ({ ok: true, book: { ...book, entries: book.entries.map(item => item.id === id ? { ...item, hits: Math.max(0, (item.hits ?? 0) - 1) } : item) } }));
  return queued(paths.stats, async () => {
    let stats = {};
    try { stats = JSON.parse(await readFile(paths.stats, 'utf8')); } catch { /* 初回 */ }
    stats[id] = Math.max(0, (stats[id] ?? 0) - 1);
    await atomic(paths.stats, stats);
    return { ok: true };
  });
}
