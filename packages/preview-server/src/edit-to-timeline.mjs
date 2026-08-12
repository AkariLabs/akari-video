// edit.json v0/v1 → TimelineSpec 変換
// preview-engine が消費する TimelineSpec は edit.json のサブセット。

import path from 'node:path';

// docs/contract-2026-08-12-still-image-cut-source-v0.md 裁定1: 判定は拡張子のみ（png/jpe?g/webp/
// bmp/gif、大小無視）。packages/render-cut/src/layers.mjs の IMAGE_LAYER_SOURCE_PATTERN /
// packages/preview-server/public/app.js の IMAGE_LAYER_SRC_PATTERN と同一集合（3面パリティ）。
const STILL_IMAGE_SOURCE_PATTERN = /\.(png|jpe?g|webp|bmp|gif)$/i;
function isStillImageSource(src) {
  return typeof src === 'string' && STILL_IMAGE_SOURCE_PATTERN.test(src);
}

/**
 * edit.json を TimelineSpec に変換する。
 * @param {object} edit - edit.json のパース済みオブジェクト
 * @param {string} projectRoot - プロジェクトルートの絶対パス
 * @returns {object} TimelineSpec
 */
export function editToTimeline(edit, projectRoot) {
  const fps = edit?.output?.fps ?? 30;
  const cuts = edit?.cuts ?? [];

  // v0: source.path が単一ソース、v1: sources[] がある
  const isV1 = Array.isArray(edit?.sources);
  const sourceMap = buildSourceMap(edit, projectRoot);

  const clips = [];
  let cursor = 0;

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    const speed = cut.speed ?? 1;
    const inSec = cut.in ?? 0;
    const outSec = cut.out ?? inSec + 1;
    const durationSec = (outSec - inSec) / speed;
    const durationFrames = Math.round(durationSec * fps);
    const track = cut.track ?? 0;

    let src;
    if (isV1 && cut.src) {
      src = sourceMap[cut.src];
    } else if (!isV1) {
      src = sourceMap['default'];
    }

    if (!src) {
      console.warn(`[edit-to-timeline] cut[${i}]: src "${cut.src}" not found in sources, skipping`);
      continue;
    }

    const sourceInUs = Math.round(inSec * 1_000_000);

    clips.push({
      id: `cut-${i}`,
      src,
      startFrame: cursor,
      endFrame: cursor + durationFrames,
      sourceInUs,
      track,
      mediaType: isStillImageSource(src) ? 'image' : 'video',
    });

    if (cut.at !== undefined) {
      cursor = Math.round(cut.at * fps);
    } else {
      cursor += durationFrames;
    }
  }

  const narration = buildNarrationSpec(edit, projectRoot);
  const bgmDucking = edit?.audio?.bgm?.ducking;

  const timeline = { fps, clips };

  if (narration.length > 0 || bgmDucking) {
    timeline.audio = {};
    if (narration.length > 0) timeline.audio.narration = narration;
    if (bgmDucking !== undefined) timeline.audio.bgm = { ducking: bgmDucking };
  }

  return timeline;
}

function buildSourceMap(edit, projectRoot) {
  const map = {};
  const isV1 = Array.isArray(edit?.sources);

  if (isV1) {
    for (const src of edit.sources) {
      map[src.id] = fileToUrl(src.path, projectRoot);
    }
  } else {
    const srcPath = edit?.source?.path;
    if (srcPath) map['default'] = fileToUrl(srcPath, projectRoot);
  }

  return map;
}

function buildNarrationSpec(edit, projectRoot) {
  const items = edit?.audio?.narration;
  if (!Array.isArray(items)) return [];

  return items
    .filter((n) => n && n.path && typeof n.t === 'number')
    .map((n) => ({
      id: n.id,
      src: fileToUrl(n.path, projectRoot),
      t: n.t,
      gainDb: n.gain_db,
    }));
}

function fileToUrl(filePath, projectRoot) {
  if (filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('blob:')) {
    return filePath;
  }
  const resolved = path.resolve(projectRoot, filePath);
  const relative = path.relative(projectRoot, resolved).split(path.sep).join('/');
  // ルート相対 URL で返す（P2-9: http://localhost:<port> ハードコードだと --host 0.0.0.0 で
  // LAN の別デバイスから動画が読めず、127.0.0.1 アクセスでもクロスオリジン扱いになっていた）
  return `/${relative}`;
}
