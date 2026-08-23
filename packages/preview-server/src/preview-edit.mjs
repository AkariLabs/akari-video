import { readRenderEdit } from '../../render-cut/src/internal-render.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { migrateEditToV2 } = require('../../edit-store/lib/migrate/index.js');

/** renderer と同じ front door で v2 を読み、WebUI が消費する互換ビューへ射影する。 */
export function projectPreviewEdit(source, temporaryDirectory) {
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
