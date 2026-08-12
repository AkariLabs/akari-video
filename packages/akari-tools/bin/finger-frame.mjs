#!/usr/bin/env node
// hand_pose トラック（analysis.json の tracks.hand_pose）-> 「指で作ったフレームの中だけ映像が
// 切り替わる」演出の layers[] エントリへの決定論変換器。
//
//   akari internal vision-finger-frame <project> \
//     ((--media <path> [--kind video|baked] | --layer-id <id>) | \
//       --kind filter --filter invert|lut:<id>|saturation:<value>) \
//     [--analysis <path>] [--edit <path>] \
//     [--open-threshold <0..1>] [--close-threshold <0..1>] [--min-open-duration <sec>] \
//     [--max-points-per-sec <n>] [--opacity <0..1>] [--id-prefix <str>] \
//     [--chroma-key-color <color>] [--chroma-key-similarity <0..1>] [--chroma-key-blend <0..1>] \
//     [--apply] [--out <path>]
//
// 契約: docs/contract-2026-08-11-analysis-vision-tracks-v0.md §4（finger-frame = hand_pose の
// 消費者第 2 号）。幾何・発動検出・時間写像の詳細な設計判断は
// packages/akari-tools/bin/finger-frame/ 配下の各モジュール（コメント + 単体テスト）を参照。
//
// 出力: 1 行 JSON を stdout へ（{ ok, layers, gesture_intervals_source, warnings, ... }）。
// --apply で edit.layers へ additive に書き込む（既存 layers・その他フィールドは一切変更しない）。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

import { extractHandSamples } from './finger-frame/hand-metrics.mjs';
import {
  detectOpenIntervals,
  DEFAULT_OPEN_THRESHOLD,
  DEFAULT_CLOSE_THRESHOLD,
  DEFAULT_MIN_OPEN_DURATION,
} from './finger-frame/gesture.mjs';
import { buildCornerKeyframes, DEFAULT_MAX_POINTS_PER_SEC } from './finger-frame/keyframes.mjs';
import {
  resolveCutStartEnds,
  mapSourceTimeToTimeline,
  cutHasDefaultFraming,
  letterboxContainTransform,
  coverFitLayer,
} from './finger-frame/timeline-map.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const hasFlag = (name) => args.includes(`--${name}`);
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

const USAGE = 'usage: finger-frame.mjs <project> ((--media <path> [--kind video|baked] | --layer-id <id>) '
  + '| --kind filter --filter invert|lut:<id>|saturation:<value>) '
  + '[--analysis <path>] [--edit <path>] [--open-threshold <0..1>] [--close-threshold <0..1>] '
  + '[--min-open-duration <sec>] [--max-points-per-sec <n>] [--opacity <0..1>] [--id-prefix <str>] '
  + '[--chroma-key-color <color>] [--apply] [--out <path>]';

const [projectArg] = positional;
if (!projectArg) {
  console.error(USAGE);
  process.exit(1);
}
const projectRoot = resolve(projectArg);

const editPath = resolve(flag('edit') ?? join(projectRoot, 'edit.json'));
if (!existsSync(editPath)) {
  console.error(`edit.json が見つかりません: ${editPath}`);
  process.exit(1);
}
const edit = JSON.parse(readFileSync(editPath, 'utf8'));

const analysisCandidate = flag('analysis') ?? [
  join(projectRoot, 'analysis.json'),
  join(projectRoot, '.akari', 'sidecars', 'analysis.json'),
].find(existsSync);
if (!analysisCandidate || !existsSync(analysisCandidate)) {
  console.error('analysis.json が見つかりません。--analysis で指定するか、vision-tracks.mjs --kinds hand で hand_pose トラックを先に生成してください。');
  process.exit(1);
}
const analysisPath = resolve(analysisCandidate);
const analysis = JSON.parse(readFileSync(analysisPath, 'utf8'));
const handPosePointer = analysis?.tracks?.hand_pose;
if (!handPosePointer?.path) {
  console.error(`analysis.json に tracks.hand_pose がありません（${analysisPath}）。vision-tracks.mjs --kinds hand で生成してください。`);
  process.exit(1);
}
const analysisDir = dirname(analysisPath);
const trackPath = resolve(analysisDir, handPosePointer.path);
if (!existsSync(trackPath)) {
  console.error(`hand_pose トラックファイルが見つかりません: ${trackPath}`);
  process.exit(1);
}
const track = JSON.parse(readFileSync(trackPath, 'utf8'));
if (track.kind !== 'hand-pose') {
  console.error(`トラックの kind が hand-pose ではありません（${track.kind}）: ${trackPath}`);
  process.exit(1);
}

const mediaArg = flag('media');
const layerIdArg = flag('layer-id');
const requestedKind = flag('kind', 'video');
const filterArg = flag('filter');

function parseFilterSpec(value) {
  if (value === 'invert') return { type: 'invert' };
  if (value?.startsWith('lut:')) {
    const id = value.slice('lut:'.length);
    if (id.trim() !== '') return { type: 'lut', id };
  }
  if (value?.startsWith('saturation:')) {
    const raw = value.slice('saturation:'.length);
    const saturation = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(saturation) && saturation >= 0 && saturation <= 3) {
      return { type: 'saturation', value: saturation };
    }
  }
  console.error('--filter は invert / lut:<id> / saturation:<0..3> のいずれかで指定してください。');
  process.exit(1);
}

if (requestedKind === 'filter' && (mediaArg || layerIdArg)) {
  console.error('--kind filter では --media と --layer-id を指定できません。');
  process.exit(1);
}
if (requestedKind === 'filter' && !filterArg) {
  console.error('--kind filter では --filter invert|lut:<id>|saturation:<value> が必須です。');
  process.exit(1);
}
if (requestedKind !== 'filter' && filterArg) {
  console.error('--filter は --kind filter のときのみ指定できます。');
  process.exit(1);
}
if (requestedKind !== 'filter' && !mediaArg && !layerIdArg) {
  console.error('--media <path> または --layer-id <id> のいずれかが必要です（貼る対象の指定）。');
  process.exit(1);
}
const layerFilter = requestedKind === 'filter' ? parseFilterSpec(filterArg) : null;
let pastedSrc;
let pastedKind;
if (requestedKind === 'filter') {
  pastedKind = 'filter';
} else if (layerIdArg) {
  const existingLayer = (edit.layers ?? []).find((l) => l.id === layerIdArg);
  if (!existingLayer) {
    console.error(`--layer-id ${layerIdArg} は edit.layers に見つかりません。`);
    process.exit(1);
  }
  pastedSrc = existingLayer.src;
  pastedKind = existingLayer.kind;
} else {
  pastedSrc = mediaArg;
  pastedKind = requestedKind;
}
if (!['video', 'baked', 'filter'].includes(pastedKind)) {
  console.error(`--kind は video / baked / filter のみ対応します（受け取り: ${pastedKind}）。`);
  process.exit(1);
}
const pastedAbsPath = pastedKind === 'filter' ? null : resolve(projectRoot, pastedSrc);
if (pastedAbsPath && !existsSync(pastedAbsPath)) {
  console.error(`貼る対象の素材が見つかりません: ${pastedAbsPath}`);
  process.exit(1);
}

const openThreshold = Number(flag('open-threshold', DEFAULT_OPEN_THRESHOLD));
const closeThreshold = Number(flag('close-threshold', DEFAULT_CLOSE_THRESHOLD));
const minOpenDuration = Number(flag('min-open-duration', DEFAULT_MIN_OPEN_DURATION));
const maxPointsPerSec = Number(flag('max-points-per-sec', DEFAULT_MAX_POINTS_PER_SEC));
const opacity = Number(flag('opacity', 1));
const idPrefix = flag('id-prefix', 'finger-frame');
const chromaKeyColor = flag('chroma-key-color');
const chromaKeySimilarity = flag('chroma-key-similarity');
const chromaKeyBlend = flag('chroma-key-blend');

function ffprobeDimensions(path) {
  const stdout = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
    '-of', 'json', path,
  ], { encoding: 'utf8' });
  const stream = JSON.parse(stdout).streams?.[0];
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  if (!(width > 0) || !(height > 0)) {
    throw new Error(`ffprobe が寸法を返しませんでした: ${path}`);
  }
  return { width, height };
}

const trackSourcePath = resolve(dirname(trackPath), track.source?.path ?? '');
if (!existsSync(trackSourcePath)) {
  console.error(`hand_pose トラックの元動画が見つかりません: ${trackSourcePath}`);
  process.exit(1);
}
const sourceDims = ffprobeDimensions(trackSourcePath);
const canvasWidth = Number(edit.output?.width);
const canvasHeight = Number(edit.output?.height);
if (!(canvasWidth > 0) || !(canvasHeight > 0)) {
  console.error(`edit.json の output.width/height が不正です（${editPath}）。`);
  process.exit(1);
}
const pastedDims = pastedKind === 'video' ? ffprobeDimensions(pastedAbsPath) : null;

// v0（単一 source）/ v1（sources[] + cuts[].src が source id を指す）の両対応。
function resolveCutSourcePath(cut) {
  if (Array.isArray(edit.sources)) {
    const source = edit.sources.find((s) => s.id === cut.src);
    return source ? resolve(projectRoot, source.path) : null;
  }
  return edit.source?.path ? resolve(projectRoot, edit.source.path) : null;
}

const cuts = Array.isArray(edit.cuts) ? edit.cuts : [];
const startEnds = resolveCutStartEnds(cuts);
const warnings = [];
const matchingCuts = [];
cuts.forEach((cut, index) => {
  const cutSourcePath = resolveCutSourcePath(cut);
  if (!cutSourcePath || cutSourcePath !== trackSourcePath) return;
  if (!cutHasDefaultFraming(cut)) {
    warnings.push(`cuts[${index}] は framing/transform を宣言しているため座標写像の前提（既定 letterbox 合わせ）が崩れます。このカットはスキップしました（v0 の既知の境界 — docs/contract-2026-08-11-analysis-vision-tracks-v0.md §4 参照）。`);
    return;
  }
  matchingCuts.push({ cut, index, start: startEnds[index].start, end: startEnds[index].end });
});
if (matchingCuts.length === 0) {
  console.error(`edit.cuts の中に hand_pose の元動画（${trackSourcePath}）を参照し、かつ既定 framing のカットが見つかりません。`);
  process.exit(1);
}

const handSamples = extractHandSamples(track.samples, {
  sourceWidth: sourceDims.width,
  sourceHeight: sourceDims.height,
});
const sourceIntervals = detectOpenIntervals(handSamples, { openThreshold, closeThreshold, minOpenDuration });

const letterboxTransform = letterboxContainTransform(sourceDims.width, sourceDims.height, canvasWidth, canvasHeight);
const cover = pastedKind === 'video' && pastedDims
  ? coverFitLayer(pastedDims.width, pastedDims.height, canvasWidth, canvasHeight)
  : { crop: null, scale: 1 };

const existingIds = new Set((edit.layers ?? []).map((l) => l.id));
function nextId() {
  let n = 0;
  let id = `${idPrefix}-${n}`;
  while (existingIds.has(id)) {
    n += 1;
    id = `${idPrefix}-${n}`;
  }
  existingIds.add(id);
  return id;
}

function round6(value) {
  return Number(Number(value).toFixed(6));
}
function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}
function roundCorners(corners) {
  return corners.map(([x, y]) => [round6(clamp01(x)), round6(clamp01(y))]);
}

const newLayers = [];
for (const { cut, index, start: cutStart } of matchingCuts) {
  const cutIn = Number(cut.in);
  const cutOut = Number(cut.out);
  for (const interval of sourceIntervals) {
    const clippedStart = Math.max(interval.startT, cutIn);
    const clippedEnd = Math.min(interval.endT, cutOut);
    if (clippedEnd - clippedStart <= 0) continue;

    const mapTimelineTime = (sourceT) => mapSourceTimeToTimeline(cut, cutStart, sourceT);
    const points = buildCornerKeyframes(handSamples, { startT: clippedStart, endT: clippedEnd }, {
      letterboxTransform,
      mapTimelineTime,
      maxPointsPerSec,
    });
    if (points.length < 2) {
      warnings.push(`cuts[${index}] のジェスチャ区間 [${clippedStart.toFixed(3)}s, ${clippedEnd.toFixed(3)}s]（元動画秒）は有効な四角形を作れず（両手検出不足・退化四角形）スキップしました。`);
      continue;
    }
    const layerT = points[0].t;
    const layerDuration = points[points.length - 1].t - layerT;
    if (!(layerDuration > 0)) continue;

    const id = nextId();
    const sharedLayer = {
      id,
      t: round6(layerT),
      duration: round6(layerDuration),
      kind: pastedKind,
      perspective: { corners: roundCorners(points[0].corners) },
      opacity,
      keyframes: points.map((p) => ({
        t: round6(p.t - layerT),
        perspective: { corners: roundCorners(p.corners) },
      })),
    };
    const layer = pastedKind === 'filter'
      ? { ...sharedLayer, filter: layerFilter }
      : {
          ...sharedLayer,
          src: pastedSrc,
          transform: { x: 0, y: 0, scale: round6(cover.scale), rotate: 0 },
          ...(cover.crop ? { crop: { x: round6(cover.crop.x), y: round6(cover.crop.y), w: round6(cover.crop.w), h: round6(cover.crop.h) } } : {}),
        };
    if (pastedKind !== 'filter' && chromaKeyColor) {
      layer.chroma_key = {
        color: chromaKeyColor,
        ...(chromaKeySimilarity !== null ? { similarity: Number(chromaKeySimilarity) } : {}),
        ...(chromaKeyBlend !== null ? { blend: Number(chromaKeyBlend) } : {}),
      };
    }
    newLayers.push(layer);
  }
}

const applied = hasFlag('apply');
if (applied) {
  if (newLayers.length === 0) {
    warnings.push('layers が 0 件のため edit.json への書き込みはスキップしました。');
  } else {
    edit.layers = [...(edit.layers ?? []), ...newLayers];
    writeFileSync(editPath, `${JSON.stringify(edit, null, 2)}\n`);
  }
}

const result = {
  ok: true,
  hand_pose_track: trackPath,
  hand_pose_source: trackSourcePath,
  cuts_matched: matchingCuts.map((m) => m.index),
  gesture_intervals_source: sourceIntervals,
  layers: newLayers,
  applied,
  edit_path: applied && newLayers.length > 0 ? editPath : null,
  warnings,
};
console.log(JSON.stringify(result));
const outArg = flag('out');
if (outArg) {
  writeFileSync(resolve(outArg), `${JSON.stringify(result, null, 2)}\n`);
}
