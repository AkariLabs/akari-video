import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const emptyManifest = () => ({ version: 0, kind: 'akari-project-manifest', nodes: [], edges: [] });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const validNode = value => object(value) && typeof value.id === 'string' && typeof value.kind === 'string';
const validEdge = value => object(value) && typeof value.from === 'string' && typeof value.uses === 'string';

export function normalizeManifest(value) {
  const input = object(value) ? value : {};
  return {
    ...input,
    version: Number.isInteger(input.version) ? input.version : 0,
    kind: typeof input.kind === 'string' ? input.kind : 'akari-project-manifest',
    nodes: Array.isArray(input.nodes) ? input.nodes.filter(validNode).map(node => ({ ...node, rev: Number.isInteger(node.rev) && node.rev >= 0 ? node.rev : 0 })) : [],
    edges: Array.isArray(input.edges) ? input.edges.filter(validEdge) : []
  };
}

export function sortManifest(value) {
  const manifest = normalizeManifest(value);
  manifest.nodes.sort((a, b) => compare(a.kind, b.kind) || compare(a.id, b.id));
  manifest.edges.sort((a, b) => compare(a.from, b.from) || compare(a.uses, b.uses));
  return manifest;
}

export async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
}

export async function readManifest(projectRoot) {
  await resolveWhere(projectRoot, '.akari/manifest.json');
  return normalizeManifest(await readJson(path.join(projectRoot, '.akari', 'manifest.json')));
}

export async function writeJsonAtomic(file, value) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  try { if (await fs.readFile(file, 'utf8') === body) return false; }
  catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, body, { flag: 'wx' });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
  return true;
}

export function manifestPath(projectRoot) { return path.join(projectRoot, '.akari', 'manifest.json'); }
export async function writeManifest(projectRoot, manifest) {
  await resolveWhere(projectRoot, '.akari/manifest.json');
  return writeJsonAtomic(manifestPath(projectRoot), sortManifest(manifest));
}

export async function resolveWhere(projectRoot, where) {
  if (typeof where !== 'string' || !where || path.isAbsolute(where) || /^[A-Za-z]:/.test(where)
      || where.includes('\\') || where.includes('..')) throw new Error('where is outside the project');
  const relative = where.split('#', 1)[0];
  if (!relative || relative.split('/').includes('..')) throw new Error('where is outside the project');
  const root = await fs.realpath(projectRoot);
  const candidate = path.resolve(root, relative);
  const contains = target => target === root || target.startsWith(`${root}${path.sep}`);
  if (!contains(candidate)) throw new Error('where is outside the project');
  let cursor = candidate;
  for (;;) {
    try {
      const real = await fs.realpath(cursor);
      if (!contains(real)) throw new Error('where escapes the project through a symlink');
      break;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      cursor = parent;
    }
  }
  try {
    const actual = await fs.realpath(candidate);
    if (!contains(actual)) throw new Error('where escapes the project through a symlink');
    return { path: actual, exists: true, fragment: where.includes('#') ? where.slice(where.indexOf('#') + 1) : null };
  } catch (error) {
    if (error?.code === 'ENOENT') return { path: candidate, exists: false, fragment: null };
    throw error;
  }
}

export async function sha256(file) {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex');
}
