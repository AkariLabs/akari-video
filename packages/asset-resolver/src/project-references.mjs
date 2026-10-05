import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import fsPromises, { lstat, realpath, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';

const REFERENCES_FILE = path.join('.akari', 'asset-references.json');

// 参照台帳（.akari/asset-references.json）のスキーマ版数。edit.json の version とは無関係。
const REFERENCES_SCHEMA_VERSION = 0;

function compareReferences(left, right) {
  if (left.category !== right.category) return left.category < right.category ? -1 : 1;
  if (left.id !== right.id) return left.id < right.id ? -1 : 1;
  return 0;
}

function isReference(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.category === 'string'
    && value.category.length > 0;
}

function normalizeReferences(value) {
  const source = Array.isArray(value) ? value : value?.references;
  if (!Array.isArray(source)) return [];
  const unique = new Map();
  for (const entry of source) {
    if (!isReference(entry)) continue;
    const reference = { id: entry.id, category: entry.category };
    unique.set(`${reference.category}\0${reference.id}`, reference);
  }
  return [...unique.values()].sort(compareReferences);
}

function assertReference(reference) {
  if (!isReference(reference)) {
    throw new TypeError('asset reference requires non-empty id and category strings');
  }
}

function referencesPath(projectDir) {
  return path.join(path.resolve(projectDir), REFERENCES_FILE);
}

async function withReferencesLock(projectDir, operation) {
  const lock = `${referencesPath(projectDir)}.lock`;
  await mkdir(path.dirname(lock), { recursive: true });
  const startedAt = Date.now();
  const owner = randomUUID();
  let handle;
  for (;;) {
    try {
      handle = await open(lock, 'wx');
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const info = await stat(lock);
        if (Date.now() - info.mtimeMs > 10_000) {
          await rm(lock, { force: true });
          continue;
        }
      } catch (statError) {
        if (statError?.code !== 'ENOENT') throw statError;
      }
      const remaining = 10_000 - (Date.now() - startedAt);
      if (remaining <= 0) {
        const timeout = new Error(`asset reference lock timed out: ${lock}`);
        timeout.code = 'ETIMEDOUT';
        throw timeout;
      }
      await delay(Math.min(remaining, 25 + Math.floor(Math.random() * 51)));
    }
  }
  let ownerWritten = false;
  try {
    await handle.writeFile(owner);
    ownerWritten = true;
    return await operation();
  } finally {
    try {
      await handle.close();
    } finally {
      // A stale-lock recovery may have replaced our file; never release its new owner.
      const currentOwner = ownerWritten
        ? await readFile(lock, 'utf8').catch(error => {
          if (error?.code === 'ENOENT') return undefined;
          throw error;
        })
        : owner;
      if (currentOwner === owner) await rm(lock, { force: true });
    }
  }
}

function isBlockedFileAccess(error) {
  return ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code);
}

async function renameWithRetry(source, target) {
  for (let retries = 0; ; retries++) {
    try {
      await fsPromises.rename(source, target);
      return;
    } catch (error) {
      if (!isBlockedFileAccess(error) || retries >= 8) throw error;
      await delay(Math.min(20 * 2 ** retries, 400));
    }
  }
}

async function overwriteWithRetry(target, body) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await writeFile(target, body, { encoding: 'utf8' });
      return;
    } catch (error) {
      if (!isBlockedFileAccess(error) || attempt === 9) throw error;
      await delay(100);
    }
  }
}

async function writeProjectReferences(projectDir, references) {
  const target = referencesPath(projectDir);
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const body = `${JSON.stringify({ version: REFERENCES_SCHEMA_VERSION, references: normalizeReferences(references) }, null, 2)}\n`;
  try {
    await writeFile(temp, body, { encoding: 'utf8', flag: 'wx' });
    try {
      await renameWithRetry(temp, target);
    } catch (error) {
      if (!isBlockedFileAccess(error)) throw error;
      // The caller holds the ledger lock, so the fallback keeps read-modify-write serialized.
      await overwriteWithRetry(target, body);
    }
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}

export async function readProjectReferences(projectDir) {
  try {
    const parsed = JSON.parse(await readFile(referencesPath(projectDir), 'utf8'));
    if (parsed?.version !== REFERENCES_SCHEMA_VERSION) return [];
    return normalizeReferences(parsed);
  } catch {
    return [];
  }
}

export async function recordProjectReference(projectDir, reference) {
  assertReference(reference);
  return withReferencesLock(projectDir, async () => {
    const references = await readProjectReferences(projectDir);
    references.push({ id: reference.id, category: reference.category });
    const normalized = normalizeReferences(references);
    await writeProjectReferences(projectDir, normalized);
    return normalized;
  });
}

export async function removeProjectReference(projectDir, reference) {
  assertReference(reference);
  return withReferencesLock(projectDir, async () => {
    const references = (await readProjectReferences(projectDir)).filter(
      (entry) => entry.id !== reference.id || entry.category !== reference.category,
    );
    await writeProjectReferences(projectDir, references);
    return references;
  });
}

function parseDeclaredAssetPath(declaredPath) {
  if (typeof declaredPath !== 'string' || declaredPath.length === 0 || path.isAbsolute(declaredPath)) return null;
  const normalized = declaredPath.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (segments.length < 4
      || segments[0] !== 'assets'
      || segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return null;
  }
  return {
    category: segments[1],
    id: segments[2],
    rest: segments.slice(3),
  };
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveLibraryFallback({ declaredPath, references, akariAssetsDir }) {
  const parsed = parseDeclaredAssetPath(declaredPath);
  if (!parsed || typeof akariAssetsDir !== 'string' || akariAssetsDir.length === 0) return null;
  const normalizedReferences = normalizeReferences(references);
  if (!normalizedReferences.some(
    (entry) => entry.category === parsed.category && entry.id === parsed.id,
  )) return null;

  const lexicalRoot = path.resolve(akariAssetsDir);
  const lexicalTarget = path.resolve(lexicalRoot, parsed.category, parsed.id, ...parsed.rest);
  if (!isWithin(lexicalRoot, lexicalTarget)) return null;

  try {
    const actualRoot = realpathSync(lexicalRoot);
    const actualTarget = realpathSync(lexicalTarget);
    if (!isWithin(actualRoot, actualTarget) || !lstatSync(actualTarget).isFile()) return null;
    return actualTarget;
  } catch {
    return null;
  }
}

export async function resolveLibraryFallbackAsync({ declaredPath, references, akariAssetsDir, rootRealpaths }) {
  const parsed = parseDeclaredAssetPath(declaredPath);
  if (!parsed || typeof akariAssetsDir !== 'string' || akariAssetsDir.length === 0) return null;
  if (!normalizeReferences(references).some(
    entry => entry.category === parsed.category && entry.id === parsed.id,
  )) return null;
  const lexicalRoot = path.resolve(akariAssetsDir);
  const lexicalTarget = path.resolve(lexicalRoot, parsed.category, parsed.id, ...parsed.rest);
  if (!isWithin(lexicalRoot, lexicalTarget)) return null;
  try {
    let actualRoot = rootRealpaths?.get(lexicalRoot);
    if (!actualRoot) {
      actualRoot = realpath(lexicalRoot);
      rootRealpaths?.set(lexicalRoot, actualRoot);
    }
    const [root, target] = await Promise.all([actualRoot, realpath(lexicalTarget)]);
    if (!isWithin(root, target) || !(await lstat(target)).isFile()) return null;
    return target;
  } catch {
    return null;
  }
}
