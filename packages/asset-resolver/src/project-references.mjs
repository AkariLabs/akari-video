import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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

async function writeProjectReferences(projectDir, references) {
  const target = referencesPath(projectDir);
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const body = `${JSON.stringify({ version: REFERENCES_SCHEMA_VERSION, references: normalizeReferences(references) }, null, 2)}\n`;
  try {
    await writeFile(temp, body, { encoding: 'utf8', flag: 'wx' });
    await rename(temp, target);
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
  const references = await readProjectReferences(projectDir);
  references.push({ id: reference.id, category: reference.category });
  const normalized = normalizeReferences(references);
  await writeProjectReferences(projectDir, normalized);
  return normalized;
}

export async function removeProjectReference(projectDir, reference) {
  assertReference(reference);
  const references = (await readProjectReferences(projectDir)).filter(
    (entry) => entry.id !== reference.id || entry.category !== reference.category,
  );
  await writeProjectReferences(projectDir, references);
  return references;
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
