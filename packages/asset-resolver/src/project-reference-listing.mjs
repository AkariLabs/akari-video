import { readFile } from 'node:fs/promises';
import { listProjectReferenceAssets } from './shell-reference.mjs';
import { sourceFields } from './library.mjs';
import { readCatalogCache } from './catalog.mjs';
import { resolveCatalogSource } from './env.mjs';

export async function listProjectAssetReferences(project, env = process.env) {
  let catalog = await readCatalogCache(env);
  const source = resolveCatalogSource(env);
  if (source.kind === 'file') { try { catalog = JSON.parse(await readFile(source.value, 'utf8')); } catch {} }
  const entries = await listProjectReferenceAssets(project, env);
  for (const entry of entries) {
    let meta;
    try { meta = JSON.parse(await readFile(entry.files.find(file => file.name === 'meta.json').path, 'utf8')); } catch {}
    entry.tags = Array.isArray(meta?.tags) ? meta.tags.filter(tag => typeof tag === 'string') : [];
    const known = catalog?.items?.find(item => item.id === entry.id && item.category === entry.category);
    entry.title = typeof meta?.title === 'string' ? meta.title : typeof known?.title === 'string' ? known.title : entry.id;
    if (!meta && known) entry.tags = Array.isArray(known.tags) ? known.tags.filter(tag => typeof tag === 'string') : [];
    if (meta || known) entry.sourceKind = sourceFields(meta ?? known, !!known).sourceKind;
  }
  return entries;
}
