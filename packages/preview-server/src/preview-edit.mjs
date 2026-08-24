import { readRenderEdit } from '../../render-cut/src/internal-render.mjs';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { migrateEditToV2 } = require('../../edit-store/lib/migrate/index.js');
const PRESET_LUT_DIRECTORY = fileURLToPath(new URL('../../../presets/luts/', import.meta.url));
const LUT_PRESET_ID = /^[A-Za-z0-9_-]+$/;
const CSS_COLOR_KEYWORDS = new Set([
  'black', 'white', 'red', 'green', 'blue', 'yellow', 'cyan', 'magenta',
  'gray', 'grey', 'orange', 'purple', 'pink', 'brown',
]);

function containsPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function resolveVideoFxLut(projectRoot, lutRef) {
  let candidate;
  if (!lutRef.includes('/') && !lutRef.includes('\\')) {
    if (!LUT_PRESET_ID.test(lutRef)) throw new Error('Invalid LUT preset id');
    candidate = path.resolve(PRESET_LUT_DIRECTORY, lutRef, `${lutRef}.cube`);
  } else {
    const realProjectRoot = fs.realpathSync(projectRoot);
    candidate = fs.realpathSync(path.resolve(realProjectRoot, lutRef));
    if (!containsPath(realProjectRoot, candidate)) throw new Error('LUT path escapes the project root');
  }
  const actual = fs.realpathSync(candidate);
  const stat = fs.statSync(actual);
  if (!stat.isFile() || path.extname(actual).toLowerCase() !== '.cube') {
    throw new Error('LUT is not a .cube file');
  }
  return fs.readFileSync(actual, 'utf8');
}

function isColorLike(value) {
  return typeof value === 'string'
    && (value.startsWith('#') || /^0x/iu.test(value) || CSS_COLOR_KEYWORDS.has(value.toLowerCase()));
}

function projectRelativeUrl(projectRoot, declaredPath) {
  if (typeof declaredPath !== 'string' || !declaredPath) throw new Error('Invalid chroma background path');
  const realProjectRoot = fs.realpathSync(projectRoot);
  const actual = fs.realpathSync(path.resolve(realProjectRoot, declaredPath));
  if (!containsPath(realProjectRoot, actual) || !fs.statSync(actual).isFile()) {
    throw new Error('Chroma background escapes the project root or is not a file');
  }
  const relative = path.relative(realProjectRoot, actual).split(path.sep).map(encodeURIComponent).join('/');
  return `/${relative}`;
}

function projectSourceChromaKey(raw, projectRoot) {
  const declaredBackground = raw.background ?? '0x000000';
  const background = isColorLike(declaredBackground)
    ? { type: 'color', color: declaredBackground }
    : { type: 'image', url: projectRelativeUrl(projectRoot, declaredBackground) };
  return {
    color: raw.color,
    similarity: raw.similarity,
    blend: raw.blend,
    mode: 'source',
    background,
  };
}

/** renderer と同じ front door で v2 を読み、WebUI が消費する互換ビューへ射影する。 */
export function projectPreviewEdit(source, temporaryDirectory, projectRoot = path.resolve(temporaryDirectory, '..', '..')) {
  const edit = readRenderEdit(source, temporaryDirectory).edit;
  const withoutDisplayGain = value => {
    if (!value || typeof value !== 'object') return value;
    const { gainDb: _displayOnly, ...rest } = value;
    return rest;
  };
  const narration = (edit.audio?.narration ?? []).map(value => {
    const { track: _displayOnlyTrack, ...rest } = withoutDisplayGain(value);
    return rest;
  });
  const bgm = edit.audio?.bgm
    ? (() => {
        const { track: _displayOnlyTrack, ...rest } = withoutDisplayGain(edit.audio.bgm);
        return rest;
      })()
    : undefined;
  const indicators = [];
  if (edit.audio?.master) indicators.push('音声マスター処理');

  let look;
  const rawLook = edit.output?.look;
  if (rawLook && typeof rawLook === 'object' && typeof rawLook.lut === 'string') {
    try {
      look = {
        cubeText: resolveVideoFxLut(projectRoot, rawLook.lut),
        intensity: Number.isFinite(rawLook.intensity)
          ? Math.min(1, Math.max(0, rawLook.intensity)) : 1,
      };
    } catch {
      indicators.push('LUT');
      console.warn('[preview] LUT could not be resolved; continuing without the video FX rail');
    }
  }

  const sourceVideoFx = {};
  for (const declared of edit.sources ?? []) {
    if (!declared?.id || !declared.chroma_key) continue;
    try {
      sourceVideoFx[declared.id] = projectSourceChromaKey(declared.chroma_key, projectRoot);
    } catch {
      indicators.push('クロマキー');
      console.warn('[preview] chroma background could not be resolved; continuing without the video FX rail');
    }
  }
  const hasLayerChroma = (edit.layers ?? []).some(layer => layer?.chroma_key);
  const hasVideoFx = Boolean(look || Object.keys(sourceVideoFx).length > 0 || hasLayerChroma);

  return {
    ...edit,
    overlays: (edit.overlays ?? []).map(overlay => ({
      ...overlay,
      ...(overlay.vars?.role === 'background' ? { role: 'background' } : {}),
    })),
    audio: {
      ...edit.audio,
      sfx: (edit.audio?.sfx ?? []).map(withoutDisplayGain),
      narration,
      ...(bgm !== undefined ? { bgm } : {}),
    },
    indicators: [...new Set(indicators)],
    ...(hasVideoFx ? {
      videoFx: {
        ...(look ? { look } : {}),
        sources: sourceVideoFx,
      },
    } : {}),
  };
}

/** /api/summary・/api/timeline 共通の fail-loud 応答。 */
export function previewReadError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const status = error && typeof error === 'object' && error.code === 'ENOENT' ? 404 : 422;
  return { status, body: { error: message } };
}

// summary は renderer 互換の v1 shape なので、そこから発生した WebUI の編集だけは凍結変換器で
// v2 に戻す。任意の legacy PUT は受けず、サーバ側は専用ヘッダがある要求にだけこの経路を開く。
export function migratePreviewCompatibility(source) {
  const parsed = typeof source === 'string' ? JSON.parse(source) : source;
  const audio = parsed?.audio && typeof parsed.audio === 'object'
    ? {
        ...parsed.audio,
        sfx: (parsed.audio.sfx ?? []).map(value => {
          const { duration: _displayOnlyDuration, ...rest } = value;
          return rest;
        }),
      }
    : parsed?.audio;
  const compatible = {
    version: 1,
    output: parsed?.output,
    sources: parsed?.sources,
    cuts: parsed?.cuts,
    overlays: (parsed?.overlays ?? []).map(overlay => {
      if (overlay?.role !== 'background') return overlay;
      const { role: _previewRole, ...rest } = overlay;
      return { ...rest, vars: { ...(rest.vars ?? {}), role: 'background' } };
    }),
    layers: parsed?.layers,
    audio,
    ...(parsed?.captions !== undefined ? { captions: parsed.captions } : {}),
    ...(parsed?.thumbnail !== undefined ? { thumbnail: parsed.thumbnail } : {}),
  };
  const result = migrateEditToV2(compatible, { hasCaptions: Array.isArray(compatible.captions) });
  if (!result.ok) {
    throw new Error(`WebUI の編集を v2 へ反映できません: ${result.blockers.join(' / ')}`);
  }
  return result.doc;
}
