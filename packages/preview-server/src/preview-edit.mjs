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
export function projectPreviewEdit(source, temporaryDirectory, projectRoot = path.resolve(temporaryDirectory, '..', '..'), captions) {
  const edit = readRenderEdit(source, temporaryDirectory, { projectRoot, captions }).edit;
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
  const projectedLayers = (edit.layers ?? []).map(layer => {
    if (layer?.kind !== 'filter' || layer?.filter?.type !== 'lut') return layer;
    const id = layer.filter.id;
    try {
      return { ...layer, filter: { ...layer.filter, cubeText: resolveVideoFxLut(projectRoot, id) } };
    } catch (error) {
      throw new Error(`filter layer LUT ${id} could not be resolved: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  const adjustLutCubeTexts = {};
  const adjustItems = [
    ...(edit.cuts ?? []).map((item, index) => ({ item, id: String(item?.id ?? `cut-${index}`) })),
    ...(edit.layers ?? []).map((item, index) => ({ item, id: String(item?.id ?? `layer-${index}`) })),
  ];
  for (const { item, id } of adjustItems) {
    const ref = item?.adjust?.sections?.lut === false ? null : item?.adjust?.lut?.lut;
    if (typeof ref !== 'string' || ref === '') continue;
    try {
      adjustLutCubeTexts[id] = resolveVideoFxLut(projectRoot, ref);
    } catch {
      indicators.push('LUT');
      console.warn(`[preview] item adjust LUT could not be resolved for ${id}; continuing without that LUT`);
    }
  }
  const hasVideoFx = Boolean(look || Object.keys(sourceVideoFx).length > 0 || hasLayerChroma);

  return {
    ...edit,
    layers: projectedLayers,
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
    ...(Object.keys(adjustLutCubeTexts).length > 0 ? { adjustLutCubeTexts } : {}),
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
      const {
        role: _previewRole,
        part: _previewPart,
        parentId: _previewParentId,
        htmlPath: _previewHtmlPath,
        ...rest
      } = overlay ?? {};
      if (overlay?.role !== 'background') return rest;
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

/**
 * WebUI の legacy 射影で実際に変わった値だけを正本の v2 木へ反映する。
 * baseline は PUT 直前の /api/summary。凍結変換器は差分をフレーム単位へ確定するためだけに使い、
 * その出力で正本全体を置き換えない。
 */
export function applyPreviewProjection(project, source, baseline) {
  const before = migratePreviewCompatibility(baseline);
  const after = migratePreviewCompatibility(source);
  const beforeItems = indexV2Items(before);
  const afterItems = indexV2Items(after);
  const mutableFields = [
    'at', 'duration', 'transform', 'opacity', 'blend', 'crop', 'perspective', 'keyframes',
    'gain_db', 'fade_in', 'fade_out', 'ducking', 'script', 'reading', 'provenance',
  ];
  const mutableSourceFields = [
    'in', 'out', 'vars', 'params', 'framing', 'transition_out', 'freeze', 'fx', 'speed',
    'chroma_key', 'filter',
  ];

  for (const [id, next] of afterItems) {
    const previous = beforeItems.get(id);
    const current = project.edit.find(id);
    if (!previous || !current) continue;
    const patch = {};
    for (const key of mutableFields) {
      if (!sameJson(previous[key], next[key])) patch[key] = next[key] ?? null;
    }
    const sourcePatch = {};
    for (const key of mutableSourceFields) {
      if (!sameJson(previous.source?.[key], next.source?.[key])) sourcePatch[key] = next.source?.[key] ?? null;
    }
    if (Object.keys(sourcePatch).length > 0) patch.source = sourcePatch;
    if (Object.keys(patch).length > 0) project.edit.update(id, patch);
  }

  // 射影上で明示的に消えた既存 item だけを削除する。袋の写し（合成 id）は正本に存在しないので
  // find() が自然に除外し、射影に無い hidden item や袋そのものは一切対象にならない。
  for (const id of beforeItems.keys()) {
    if (!afterItems.has(id) && project.edit.find(id)) project.edit.remove(id);
  }

  const locations = currentLocations(project.edit);
  for (const track of after.tracks ?? []) {
    if (!Array.isArray(track.items) || track.items.length === 0) continue;
    const targetTrack = chooseTargetTrack(track.items, locations, project.edit.tracks, track.lane);
    if (!targetTrack) continue;
    for (const [index, item] of track.items.entries()) {
      let current = project.edit.find(item.id);
      if (!current) {
        if (beforeItems.has(item.id)) continue;
        current = project.edit.insert(targetTrack.id, structuredClone(item), index);
        locations.set(item.id, { track: targetTrack, parent: undefined });
        continue;
      }
      const location = locations.get(item.id);
      if (location?.parent) continue;
      const targetItems = targetTrack.items ?? [];
      const currentIndex = targetItems.findIndex(candidate => candidate.id === item.id);
      if (location?.track.id !== targetTrack.id || currentIndex !== index) {
        project.edit.move(item.id, { track: targetTrack.id, index });
        locations.set(item.id, { track: targetTrack, parent: undefined });
      }
    }
  }
  return { before, after };
}

function indexV2Items(edit) {
  const result = new Map();
  const visit = item => {
    result.set(String(item.id), item);
    for (const child of item.items ?? []) visit(child);
  };
  for (const track of edit.tracks ?? []) for (const item of track.items ?? []) visit(item);
  return result;
}

function currentLocations(edit) {
  const result = new Map();
  edit.walk((item, parent, track) => result.set(item.id, { parent, track }));
  return result;
}

function chooseTargetTrack(items, locations, tracks, lane) {
  const counts = new Map();
  for (const item of items) {
    const track = locations.get(item.id)?.track;
    if (track) counts.set(track.id, (counts.get(track.id) ?? 0) + 1);
  }
  const selected = [...counts].sort((left, right) => right[1] - left[1])[0]?.[0];
  return tracks.find(track => track.id === selected)
    ?? tracks.find(track => track.lane === lane && Array.isArray(track.items));
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
