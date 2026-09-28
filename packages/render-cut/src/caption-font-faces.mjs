import { accessSync, constants, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLocalLibraryItem, scanLocalLibrary } from '../../asset-resolver/src/library.mjs';

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

export function libraryCaptionFontFaces(env = process.env) {
  const faces = [];
  for (const key of [...scanLocalLibrary(env)].filter(key => key.startsWith('font/')).sort()) {
    const id = key.slice(5);
    const item = readLocalLibraryItem(env, 'font', id);
    const file = item?.mediaFile;
    if (!file || !item?.libraryDir) continue;
    const path = join(item.libraryDir, file);
    try { if (!statSync(path).isFile()) continue; accessSync(path, constants.R_OK); } catch { continue; }
    faces.push({ id, family: item.title.replace(/（.*$/u, '').trim(), file,
      weight: /variable/iu.test(file) ? '100 900' : '400', path, key: `library-${encodeURIComponent(id)}` });
  }
  return faces;
}

export function captionFontFaces(env = process.env, bundledRoot = BUNDLED_FONT_ROOT) {
  const bundled = BUNDLED_CAPTION_FONT_FACES.map(face => ({ ...face, path: join(bundledRoot, face.id, face.file), key: `${face.id}/${face.file}` }));
  const notoSans = bundled.find(face => face.id === 'noto-sans-jp');
  return [
    ...bundled,
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
