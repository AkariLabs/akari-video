import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAkariHome } from './env.mjs';
import { ASSET_CATEGORIES, sourceFields } from './library.mjs';
import { assetTier } from './tier.mjs';

export const BUNDLED_CATALOG_ENV = 'AKARI_CATALOG_ROOT';
const MODULE_CATALOG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../catalog');

function isDirectory(location) {
  try { return statSync(location).isDirectory(); } catch { return false; }
}

function containsFile(location) {
  try {
    return readdirSync(location, { withFileTypes: true }).some(item =>
      item.isFile() || (item.isDirectory() && containsFile(path.join(location, item.name))));
  } catch { return false; }
}

export function resolveBundledCatalog(env = process.env) {
  return resolveBundledCatalogFrom(env, MODULE_CATALOG);
}

export function audioSetupDefaults(env = process.env) {
  const { root, origin, candidates } = resolveBundledCatalog(env);
  if (!root) return { root, origin, candidates, candidatesPath: null, catalogDir: null, candidatesHtmlPath: null };
  const home = resolveAkariHome(env);
  return { root, origin, candidates,
    candidatesPath: path.join(root, 'audio', 'candidates.json'),
    catalogDir: existsSync(path.join(root, '..', '.git')) ? path.join(root, 'audio') : path.join(home, 'catalog', 'audio'),
    candidatesHtmlPath: path.join(home, 'audio-candidates', 'candidates.html') };
}

/** The candidate parameter keeps precedence tests independent of the checkout layout. */
export function resolveBundledCatalogFrom(env, bundledCandidate) {
  const override = env[BUNDLED_CATALOG_ENV];
  const candidates = [];
  if (override) {
    const root = path.resolve(override);
    candidates.push(root);
    return { root: isDirectory(root) ? root : null, origin: 'env', candidates };
  }
  const bundled = path.resolve(bundledCandidate);
  candidates.push(bundled);
  if (isDirectory(bundled)) return { root: bundled, origin: 'bundled', candidates };
  const app = path.resolve(resolveAkariHome(env), 'app/catalog');
  candidates.push(app);
  return { root: isDirectory(app) ? app : null, origin: isDirectory(app) ? 'app' : null, candidates };
}

export function readBundledCatalog(root) {
  const entries = [];
  const warnings = [];
  for (const category of ASSET_CATEGORIES) {
    const categoryDir = path.join(root, category);
    if (!isDirectory(categoryDir)) continue;
    for (const id of readdirSync(categoryDir).sort()) {
      const catalogDir = path.join(categoryDir, id);
      if (!isDirectory(catalogDir)) continue;
      const metaPath = path.join(catalogDir, 'meta.json');
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
        if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error('meta.json は object ではありません');
        if (meta.id !== id) throw new Error('id がフォルダ名と一致しません');
        if (meta.category !== category) throw new Error('category がフォルダ名と一致しません');
        const tier = assetTier(meta);
        const fields = sourceFields(meta, false);
        const assetDir = path.resolve(root, '..', 'assets', category, id);
        const bundledAssetDir = isDirectory(assetDir) && containsFile(assetDir) ? assetDir : null;
        entries.push({ ...meta, ...fields, machineTags: [...fields.machineTags, `tier:${tier}`], tier,
          state: 'reference', catalogDir, metaPath, bundledAssetDir });
      } catch (error) { warnings.push(`${category}/${id}: ${error.message}`); }
    }
  }
  return { entries, warnings };
}

export function externalReferences(entries) {
  return entries.filter(entry => entry.sourceKind === 'site');
}

export function mergeBundledReferences(items, references) {
  const seen = new Set(items.map(item => `${item.category}/${item.id}`));
  const result = [...items];
  for (const entry of references) {
    const ref = `${entry.category}/${entry.id}`;
    if (!seen.has(ref)) { result.push(entry); seen.add(ref); }
  }
  return result;
}

export function findBundledEntry(entries, ref) {
  const matches = entries.filter(entry => ref.includes('/')
    ? `${entry.category}/${entry.id}` === ref : entry.id === ref);
  if (matches.length > 1) {
    const error = new Error(`素材 ID が曖昧です: ${ref}（候補: ${matches.map(item => `${item.category}/${item.id}`).join(', ')}）`);
    error.code = 'ambiguous_id';
    error.candidates = matches.map(item => `${item.category}/${item.id}`);
    throw error;
  }
  return matches[0] ?? null;
}
