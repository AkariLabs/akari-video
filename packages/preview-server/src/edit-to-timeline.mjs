// renderer 互換ビューを TimelineSpec へ変換する。raw v2 が直接来る output
// 経路だけは edit-store の正本射影で同じ互換形へ揃える。

import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readInternalEdit, projectLegacyEdit } = require('../../edit-store/lib/index.js');

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
  // renderer 互換ビューは raw v2 を spread して tracks と cuts を併せ持つため、tracks や version
  // だけでは判定しない。cuts が無い raw v2 だけを edit-store の正本射影へ通す。
  if (!Array.isArray(edit?.cuts) && Array.isArray(edit?.tracks)) {
    let legacy;
    try {
      legacy = projectLegacyEdit(readInternalEdit(edit));
    } catch {
      // output preview は raw v2 に overlays 等の互換フィールドを付けた中間文書も読む。
      // v2 として厳密に読めない場合は、着手前の v0/v1 変換へ fail-soft に戻す。
    }
    if (legacy) {
      return editToTimeline({
        version: 1,
        output: { ...edit.output, fps: legacy.fps },
        sources: legacy.sources,
        cuts: legacy.cuts,
        audio: {
          ...(legacy.audioBgm ? { bgm: legacy.audioBgm } : {}),
          narration: legacy.audioNarration,
        },
        ...(edit.videoFx ? { videoFx: edit.videoFx } : {}),
      }, projectRoot);
    }
  }

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
    const startSec = cut.at ?? cursor;
    const startFrame = Math.round(startSec * fps);

    let source;
    if (isV1 && cut.src) {
      source = sourceMap[cut.src];
    } else if (!isV1) {
      source = sourceMap['default'];
    }

    if (!source) {
      console.warn(`[edit-to-timeline] cut[${i}]: src "${cut.src}" not found in sources, skipping`);
      continue;
    }

    const sourceInUs = Math.round(inSec * 1_000_000);

    clips.push({
      id: `cut-${i}`,
      src: source.src,
      startFrame,
      endFrame: startFrame + durationFrames,
      sourceInUs,
      track,
      mediaType: source.mediaType,
    });

    cursor = startSec + durationSec;
  }

  const narration = buildNarrationSpec(edit, projectRoot);
  const bgmDucking = edit?.audio?.bgm?.ducking;

  const timeline = { fps, clips };

  if (edit?.videoFx) timeline.videoFx = edit.videoFx;

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
      const playbackPath = typeof src.proxy === 'string' && src.proxy.trim().length > 0
        ? src.proxy
        : src.path;
      map[src.id] = {
        src: fileToUrl(playbackPath, projectRoot),
        // proxy のコンテナ形式ではなく、宣言 source.path の拡張子が素材種別の正本。
        mediaType: isStillImageSource(src.path) ? 'image' : 'video',
      };
    }
  } else {
    const srcPath = edit?.source?.path;
    if (srcPath) {
      map['default'] = {
        src: fileToUrl(srcPath, projectRoot),
        mediaType: isStillImageSource(srcPath) ? 'image' : 'video',
      };
    }
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
