import { accessSync, constants, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLocalLibraryItem, scanLocalLibrary } from '../../asset-resolver/src/library.mjs';
import { fontCatalog, fontTitle, matchFontCatalog, readFontNames } from '../../asset-resolver/src/font-names.mjs';

const require = createRequire(import.meta.url);
export const BUNDLED_CAPTION_FONT_FACES = require('./caption-font-faces.json');
export function resolveBundledFontRoot(resourcesPath = process.resourcesPath) {
  const packaged = typeof resourcesPath === 'string' ? resolve(resourcesPath, 'assets/font') : null;
  try {
    if (packaged && statSync(join(packaged, 'noto-sans-jp/NotoSansJP-Variable.ttf')).isFile()) return packaged;
  } catch { /* development Electron also has resourcesPath, without bundled assets */ }
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../../assets/font');
}
export const BUNDLED_FONT_ROOT = resolveBundledFontRoot();
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']);
const fontNameCache = new Map();
const catalogCache = new Map();
function cachedFontNames(file, info) {
  const key = `${file}:${info.mtimeMs}:${info.size}`;
  if (!fontNameCache.has(key)) fontNameCache.set(key, readFontNames(file)?.all ?? []);
  return fontNameCache.get(key);
}
function cachedCatalog(catalogRoot) {
  // Catalog entries are stable during normal playback; refresh when the directory changes.
  const parent = resolve(catalogRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../catalog'));
  const root = join(parent, 'font');
  let stamp;
  try { stamp = statSync(root).mtimeMs; } catch { return []; }
  const cached = catalogCache.get(parent);
  if (!cached || cached.stamp !== stamp) catalogCache.set(parent, { stamp, items: fontCatalog(parent) });
  return catalogCache.get(parent).items;
}

export function captionFontFamilies(value) {
  if (typeof value !== 'string') return [];
  const parts = [];
  let token = '', quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const ch = value[index];
    if (ch === '\\' && index + 1 < value.length) { token += value[++index]; continue; }
    if (quote) { if (ch === quote) quote = null; else token += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === ',') { parts.push(token.trim()); token = ''; continue; }
    token += ch;
  }
  parts.push(token.trim());
  return parts.filter(name => name && !GENERIC.has(name.toLowerCase()));
}

export function libraryCaptionFontFaces(env = process.env, options = {}) {
  const faces = [];
  const used = new Set();
  const catalog = cachedCatalog(options.catalogRoot);
  const items = [];
  for (const key of [...scanLocalLibrary(env)].filter(key => key.startsWith('font/')).sort()) {
    const id = key.slice(5);
    const item = readLocalLibraryItem(env, 'font', id);
    const file = item?.mediaFile;
    if (!file || !item?.libraryDir) continue;
    const path = join(item.libraryDir, file);
    let info;
    try { info = statSync(path); if (!info.isFile()) continue; accessSync(path, constants.R_OK); } catch { continue; }
    const names = [fontTitle(item.title), ...(Array.isArray(item.aliases) ? item.aliases : [])];
    if (!Array.isArray(item.aliases)) names.push(...cachedFontNames(path, info));
    const matched = matchFontCatalog(names, catalog);
    const base = { id, file, weight: /variable/iu.test(file) ? '100 900' : '400', path, key: `library-${encodeURIComponent(id)}` };
    items.push({ names, matched, base });
  }
  const explicitOwner = new Map();
  for (const { names, base } of items) {
    if (typeof names[0] === 'string' && !explicitOwner.has(names[0])) explicitOwner.set(names[0], base.id);
  }
  for (const { names, base } of items) for (const name of names) {
    if (typeof name === 'string' && !explicitOwner.has(name)) explicitOwner.set(name, base.id);
  }
  for (const { names, matched, base } of items) {
    if (matched) names.push(...[matched.title, ...matched.aliases]
      .filter(name => !explicitOwner.has(name) || explicitOwner.get(name) === base.id));
    for (const family of names) {
      if (typeof family !== 'string' || !family.trim() || used.has(family)
        || explicitOwner.has(family) && explicitOwner.get(family) !== base.id) continue;
      used.add(family);
      faces.push({ id: base.id, family, file: base.file, weight: base.weight, path: base.path, key: base.key });
    }
  }
  return faces;
}

export function captionFontFaces(env = process.env, bundledRoot = BUNDLED_FONT_ROOT) {
  const bundled = BUNDLED_CAPTION_FONT_FACES.map(face => ({ ...face, path: join(bundledRoot, face.id, face.file), key: `${face.id}/${face.file}` }));
  const notoSans = bundled.find(face => face.id === 'noto-sans-jp');
  const latinNotoSans = bundled.find(face => face.id === 'noto-sans');
  return [
    ...bundled,
    { ...latinNotoSans, family: 'AKARI Noto Sans', key: `noto-sans-alias/${latinNotoSans.file}` },
    // The caption panel persists this product alias; it uses the same variable font.
    { ...notoSans, family: 'AKARI Noto Sans JP', key: `noto-sans-jp-alias/${notoSans.file}` },
    ...libraryCaptionFontFaces(env),
  ];
}

export function captionFontUrl(face) {
  return `/caption-fonts/${face.key}`;
}

export function captionFontFaceCss(face) {
  const extension = face.file?.split('.').at(-1)?.toLowerCase();
  const format = face.variable ? 'truetype-variations'
    : extension === 'otf' ? 'opentype' : extension === 'woff2' ? 'woff2'
      : extension === 'woff' ? 'woff' : 'truetype';
  return `@font-face {\n      font-family: ${JSON.stringify(face.family)};\n      src: url("${captionFontUrl(face)}") format("${format}");\n      font-weight: ${face.weight};\n      font-style: normal;\n    }`;
}
