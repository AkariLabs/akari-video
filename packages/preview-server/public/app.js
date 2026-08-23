// AKARI Video Preview — full-featured client

// タイムライン写像（source↔output）の正本は packages/edit-store/src/timeline-map.ts
// （パリティ契約 §2.1/§2.2。書き込み側 SSOT computeCutTrackSegments と同じ意味論）。
import { buildTimelineMap, outputToSource, findActiveCaption } from '/edit-kernel.bundle.js';
// ペンの視覚正本は packages/pen-visuals（パリティ契約 §2.8）。定数も描画コードも共有する。
import {
  PEN_TUNING,
  createGlowSprite,
  createSparkleSprite,
  createPlatinumGradient,
  drawPenSegment as drawPenSegmentShared,
} from '/pen-visuals.bundle.js';
import { replaceCaptionStyleVariables } from '/caption-style.js';
// cuts[].framing / cuts[].freeze のプレビュー再現（contract-2026-08-02-preview-parity.md §2.4.2/2.4.3）。
import { checkCutFreezeCrossing, computeCutFramingVisual } from '/framing-visual.js';
import { composeCutVisualStyle } from '/cut-transform-visual.js';
// layers[].perspective（corner-pin パース変形）のプレビュー再現（contract-2026-08-02-preview-parity.md §2.4.4）。
import { computeLayerPerspectiveVisual } from '/layer-perspective-visual.js';
// layers[].crop の錨補正（contract-2026-08-02-preview-parity.md §2.4.1・2026-08-06 crop-handle-anchor-fix）。
import { cropAnchorCorrectedTransform } from '/layer-crop-anchor.js';
// layers[].keyframes（transform/crop/perspective のアニメーション。contract-2026-08-09-transform-keyframes-v0.md）。
import { computeLayerKeyframesVisual } from '/layer-keyframes-visual.js';
import { createCutFxController } from '/cut-fx.js';
import { markLayerUnplayable, syncLayerLazyLoad } from '/layer-lazy-load.js';
import { ensureMediaPlaying } from '/media-playback-resume.js';
import { syncMediaCurrentTime } from '/media-time-sync.js';
import {
  createAudioDeClickController,
  transitionApproximationGain,
  waitForMediaSeekCompletion,
} from '/audio-declick.js';
import { editForPut, normalizeLegacyCutTransitions } from '/transition-write-guard.js';

const SETTINGS_KEY = 'akari-preview-settings';
function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; }
}
function saveSettings(partial) {
  const s = loadSettings();
  Object.assign(s, partial);
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}
const savedSettings = loadSettings();

const isOutputMode = new URLSearchParams(location.search).get('mode') === 'output';
const api = {
  timeline: isOutputMode ? '/api/output/timeline' : '/api/timeline',
  summary: isOutputMode ? '/api/output/summary' : '/api/summary',
  edit: '/api/edit.json',
  captions: isOutputMode ? '/api/output/captions.json' : '/api/captions.json',
};

const video = document.getElementById('preview-video');
// cuts[] の静止画ソース区間用（docs/contract-2026-08-12-still-image-cut-source-v0.md）。
// video/img は常に両方 DOM に存在し続ける（video を作り直さない — MediaElementAudioSourceNode は
// 生成元の要素に紐付くため、要素を差し替えると音声グラフが壊れる）。表示は display の出し分けのみ。
const img = document.getElementById('preview-image');
const playToggle = document.getElementById('play-toggle');
const frameBack = document.getElementById('frame-back');
const frameForward = document.getElementById('frame-forward');
const skipBack = document.getElementById('skip-back');
const skipForward = document.getElementById('skip-forward');
const seek = document.getElementById('seek');
const timeLabel = document.getElementById('time-label');
const zoomToggle = document.getElementById('zoom-toggle');
const zoomPopup = document.getElementById('zoom-popup');
const zoomSlider = document.getElementById('zoom-slider');
const zoomValue = document.getElementById('zoom-value');
const fullscreenToggle = document.getElementById('fullscreen-toggle');
const waveformToggle = document.getElementById('waveform-toggle');
const waveformRow = document.querySelector('.transport-waveform');
const waveformCanvas = document.getElementById('waveform-canvas');
const waveformPlayhead = document.querySelector('.transport-waveform-playhead');
const trackCanvases = {
  bgm: document.querySelector('.waveform-track-canvas[data-track="bgm"]'),
  narration: document.querySelector('.waveform-track-canvas[data-track="narration"]'),
  sfx: document.querySelector('.waveform-track-canvas[data-track="sfx"]'),
};
const stage = document.getElementById('overlay-stage');
const cutFxLayer = document.getElementById('cut-fx-layer');
const captionPlate = document.getElementById('caption-plate');
const transitionPlate = document.getElementById('transition-plate');
const wrapper = document.getElementById('preview-wrapper');
const zoomLayer = document.getElementById('zoom-layer');
const previewMessage = document.getElementById('preview-message');
const previewMessageText = document.getElementById('preview-message-text');
const editToggle = document.getElementById('edit-toggle');
const layerContainer = document.getElementById('layer-container');
const penCanvas = document.getElementById('pen-canvas');
const loadingIndicator = document.getElementById('loading-indicator');
const shortcutHelp = document.getElementById('shortcut-help');
const minimap = document.getElementById('zoom-minimap');
const minimapVideo = document.getElementById('minimap-video');
const minimapViewport = document.getElementById('zoom-minimap-viewport');
const indicatorBtn = document.getElementById('indicator-toggle');
const indicatorPopup = document.getElementById('indicator-popup');
const reviewRecordBtn = document.getElementById('review-record-btn');
const reviewTimer = document.getElementById('review-timer');

const TRACK_COLORS = { bgm: '#4da3ff', narration: '#ffd94a', sfx: '#ff798c' };

const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const pauseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zm6 0h4v14h-4z"/></svg>';
const fullscreenIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5v2H6v3zm11-5h5v5h-2V6h-3zm3 11h2v5h-5v-2h3zM9 18v2H4v-5h2v3z"/></svg>';
const restoreIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4V7h3V4zm6 0h2v3h3v2h-5zM4 15h5v5H7v-3H4zm16 0v2h-3v3h-2v-5z"/></svg>';

let summary = null;
let timelineData = null;
let isPlaying = false;
let outputTime = 0;
let fps = 30;
let segments = [];
let totalDuration = 0;
let zoom = 1;
let pan = { x: 0, y: 0 };
// cuts[].freeze の一時停止ホールド（近似実装。尺は伸ばさない — contract-2026-08-02-preview-parity.md §2.4.3）。
let freezeHoldUntilMs = 0;
let freezeHoldConsumedForCutIndex = null;
let drag = null;

let editMode = false;
// 編集ヒント（プレビューを覆わない小さな通知）の状態。setEditMode が module 先頭付近から
// 呼ばれるため、宣言はここに置く（後方で let 宣言すると TDZ で落ちる）。
let editHintTimer = 0;
let lastSelectionShown = null;

let audioCtx = null;
let baseAudioSource = null;
let baseAudioTransitionGain = null;
let baseAudioDeClickGain = null;
let baseAudioDeClick = null;
let bgmNode = null;
let sfxNodes = [];
let narrationNodes = [];

let waveformPeaks = null;
let waveformDuration = 0;
let reviewSession = null;
let reviewRecorder = null;
let reviewStream = null;
let reviewRecStart = 0;
let reviewTimerRAF = 0;
let reviewEvents = [];
let trackWaveforms = { bgm: null, narration: null, sfx: null };
let captionsData = null;
const cutFx = createCutFxController(() => ({ summary, segment: getActiveSegment(outputTime), outputTime }));
let captionsResolvedTimeline = false;
let captionStylesInjected = false;

// All geometry/capture paths await the exact repository-owned variable font.
// The unique family name makes a system-installed Noto unable to satisfy check().
window.__akariCaptionFontReady = (async () => {
  await document.fonts.load('600 82px "AKARI Noto Sans JP"');
  await document.fonts.ready;
  if (!document.fonts.check('600 82px "AKARI Noto Sans JP"')) {
    throw new Error('AKARI caption font did not load');
  }
  return true;
})();

// B-roll layer videos
let layerVideos = [];

// Pen annotation
let penPoints = [];
let penActive = false;

// WebSocket for timeline sync
let ws = null;
let wsTickInterval = null;

async function init() {
  try {
    await window.__akariCaptionFontReady;
    const [timelineRes, editRes, captionsRes] = await Promise.all([
      fetch(api.timeline),
      fetch(api.summary),
      fetch(api.captions).catch(() => new Response(null, { status: 404 })),
    ]);
    if (!timelineRes.ok) throw new Error(`timeline: HTTP ${timelineRes.status}`);
    timelineData = await timelineRes.json();
    summary = normalizeLegacyCutTransitions(await editRes.json());
    if (captionsRes.ok) {
      const body = await captionsRes.json();
      captionsData = Array.isArray(body) ? body : (body?.captions ?? []);
      captionsResolvedTimeline = body?.schema === 'caption-layout/v1';
    } else {
      captionsData = [];
    }
    fps = timelineData.fps || 30;

    buildSegments();
    if (summary?.cuts?.length > 0) {
      // 先頭カットが静止画ソースのときは <img> を初期表示にする（0秒地点で <video> に
      // その src を割り当てても再生できないだけで実害は無いが、表示の出し分けを合わせておく）。
      const seg0 = getActiveSegment(0);
      if (seg0 && isStillImageCutSegment(seg0)) {
        showStillImageForSegment(seg0);
      } else {
        showVideoBase();
        video.src = getVideoSource(0);
      }
    }
    updateStageScale();
    setupLayers();
    setupPenCanvas();
    initPenSprites();
    setupAudioGraph();
    // 波形パネルは既定で hidden。開いた時（下の Restore settings / トグル）に初めて組む。
    // 無条件に組むと、閉じたままのパネルのために全音源をもう 1 周ダウンロードしていた。
    scheduleTransitions();
    setupMinimap();

    window.akari = window.akari || {};
    window.akari.runtime = createOverlayRuntime();
    if (window.akari.runtime.mount) window.akari.runtime.mount(summary);
    // shell と同じ契約: 論理出力 px → 表示 px の倍率（interaction の異常系退避 / selftest 用）
    window.akari.stageScale = () => frameScale;
    const os = summary?.output || {};
    window.akari.outputSize = () => ({ width: os.width || 1280, height: os.height || 720 });
    // overlay-interaction.bundle.js（packages/overlay-runtime 正本）はスクリプト読込時に
    // 自己初期化する。書き込みブリッジ（engine.overlayWrite）と出力サイズ参照
    // （state.summary.output）だけこちらが供給する。editPath はサーバ側 projectRoot 直下
    // 固定のため名目値でよい（PUT /api/edit.json に届く）。
    window.akari.state = { editPath: 'edit.json', summary };
    window.akari.engine = { overlayWrite: overlayWriteViaPut };

    // Restore settings
    if (savedSettings.zoom && savedSettings.zoom >= ZOOM_MIN && savedSettings.zoom <= ZOOM_MAX) {
      zoom = savedSettings.zoom; updateZoom();
    }
    if (savedSettings.waveformVisible) {
      waveformVisible = true; waveformRow.hidden = false;
      waveformToggle.setAttribute('aria-pressed', 'true');
    }
    // 波形はパネルが開いている時だけ組む。init 完走前にトグルされていた場合
    // （データが揃っておらず空振りしている）も、ここで拾い直す。
    if (waveformVisible) setupWaveform();

    // 起動時点で編集モードは OFF。素材の選択・ドラッグを止めた状態から始める
    // （ここで呼ぶのは interaction バンドルの初期化後を保証するため）。
    setEditMode(false);

    showMessage(null);
  } catch (e) {
    showMessage(e.message);
  }
}

// --- P1-2: ステージ座標系をビデオ枠（出力フレーム矩形）に一致させる ---
// 正本は shell の updateStageScale（akari-preview-open-handler.ts）。stage / layer-container を
// 論理サイズ = 出力 px（overlay/layer の px 座標・字幕の px 指定が render-cut と同じ意味になる）
// にし、transform: scale(frameScale) で wrapper 内の出力フレーム矩形へ写像する。
// wrapper は aspect-ratio が max-height で破れてペイン全体に広がることがある（レターボックス）。
let frameScale = 1;
function outputSizePx() {
  const os = summary?.output || {};
  return {
    width: Number(os.width) > 0 ? Number(os.width) : 1280,
    height: Number(os.height) > 0 ? Number(os.height) : 720
  };
}
// wrapper の外枠比率を出力サイズへ追従させる（shell の動的 aspect-ratio とパリティ）。
// output 欠落時は outputSizePx() のフォールバック（1280x720 = 16:9）がそのまま効く。
function applyWrapperAspectRatio() {
  const os = outputSizePx();
  wrapper.style.aspectRatio = `${os.width} / ${os.height}`;
}
// ミニマップ箱の縦横比も出力サイズへ追従させる（shell zoomMinimap と同じ式:
// akari-preview-open-handler.ts の aspectRatio>=1 分岐。基準辺 120px は従来の横長既定
// 120x67.5 を保つ値 — 16:9 では従来どおり 120x67.5 のまま、回帰なし）。
function applyMinimapAspectRatio() {
  const os = outputSizePx();
  const ratio = os.width / os.height;
  const base = 120;
  minimap.style.width = `${ratio >= 1 ? base : base * ratio}px`;
  minimap.style.height = `${ratio >= 1 ? base / ratio : base}px`;
}
function computeOutputFrameRect() {
  const boxW = wrapper.clientWidth;
  const boxH = wrapper.clientHeight;
  const os = outputSizePx();
  if (!(boxW > 0) || !(boxH > 0)) return { x: 0, y: 0, width: boxW, height: boxH };
  const fit = Math.min(boxW / os.width, boxH / os.height);
  const width = os.width * fit;
  const height = os.height * fit;
  return { x: (boxW - width) / 2, y: (boxH - height) / 2, width, height };
}
function updateStageScale() {
  applyWrapperAspectRatio();
  applyMinimapAspectRatio();
  const os = outputSizePx();
  const rect = computeOutputFrameRect();
  const next = rect.width / os.width;
  frameScale = Number.isFinite(next) && next > 0 ? next : 1;
  for (const el of [stage, layerContainer, cutFxLayer]) {
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.width = `${os.width}px`;
    el.style.height = `${os.height}px`;
    el.style.transformOrigin = '0 0';
    el.style.transform = `scale(${frameScale})`;
  }
  // 出力フレームの境界線。ペインが出力比より横長／縦長だと周囲が黒帯になり、断片の背景が
  // 「途中で黒く切れている」ように見える（実機報告 2026-08-07 — 実際はレターボックス）。
  // どこまでが書き出される範囲なのかを常に示す。線は transform で縮むぶんを打ち消しておく。
  stage.style.outline = `${(1 / (frameScale || 1)).toFixed(3)}px solid rgba(255,255,255,0.16)`;
  stage.style.outlineOffset = '0';
}
updateStageScale();
new ResizeObserver(() => { updateStageScale(); setupPenCanvas(); }).observe(wrapper);

// clip.src はルート相対（/assets/foo.mp4）だが video.src は常に絶対 URL を返すため、
// 生の文字列比較では必ず不一致になり毎フレーム再代入 → 動画がロードし直され続ける
// （読み込み中スピナーが出っぱなし・実質再生不能）。解決後の URL で比較する。
function isSameVideoSource(el, src) {
  if (!src) return true;
  try {
    return el.src === new URL(src, document.baseURI).href;
  } catch {
    return el.src === src;
  }
}
function setVideoSourceIfChanged(el, src) {
  if (src && !isSameVideoSource(el, src)) el.src = src;
}

function getVideoSource(cutIndex) {
  const clip = timelineData.clips.find(c => c.id === `cut-${cutIndex}`);
  return clip ? clip.src : (timelineData.clips[0]?.src || '');
}

// docs/contract-2026-08-12-still-image-cut-source-v0.md: cuts[] の静止画ソース区間はメインの
// <video id="preview-video"> ではなく <img id="preview-image"> で表示する（layers[] の静止画判定
// isImageLayerSrc/IMAGE_LAYER_SRC_PATTERN と同じ拡張子集合 -- 定義は下の setupLayers 節にある。
// 関数宣言なので巻き上げにより、このファイル内のどの実行順序からでも呼べる）。
function isStillImageCutSegment(seg) {
  return !!seg && !seg.isGap && seg.index >= 0 && isImageLayerSrc(getVideoSource(seg.index));
}

// 静止画区間へ入る: <video> は止めて隠す（音声グラフ(MediaElementAudioSourceNode)へ古い映像の
// 音が漏れないように、src はそのまま残して pause するだけ -- 要素は作り直さない）。<img> の
// src は画像なので currentTime 相当のシークは不要、一度セットしたら区間内は据え置きでよい。
function showStillImageForSegment(seg) {
  video.pause();
  video.style.display = 'none';
  const src = getVideoSource(seg.index);
  setVideoSourceIfChanged(img, src);
  // '' の代入はインライン宣言を消すだけで、index.html のスタイルシート既定
  // `#preview-image { display: none; }` を打ち消さない（#preview-video 側は CSS に
  // display 指定が無いため '' で戻せる、という非対称に注意）。実機バグ報告
  // preview-server-still-image-never-shown（2026-08-17）の是正。
  img.style.display = 'block';
}
function showVideoBase() {
  img.style.display = 'none';
  video.style.display = '';
}

// --- Segments ---
function buildSegments() {
  if (!summary?.cuts) return;
  // 写像の構築は共有カーネル（timeline-map）に委譲し、ここでは既存 UI が使う
  // 旧フィールド名（index / inSec / outSec / speed / durationSec / isGap）へ写す。
  // outStart / outEnd が正で、トランジション重なり時は隣接 src が出力時間上重なる。
  const built = buildTimelineMap(summary.cuts);
  segments = built.segments.map(s => s.kind === 'gap'
    ? { index: -1, isGap: true, durationSec: s.outEnd - s.outStart, outStart: s.outStart, outEnd: s.outEnd }
    : {
        index: s.cutIndex, isGap: false, inSec: s.in, outSec: s.out, speed: s.speed || 1,
        durationSec: s.outEnd - s.outStart, outStart: s.outStart, outEnd: s.outEnd, track: s.track ?? 0,
        // framing / freeze は再生時の見た目情報で写像には関与しないため、共有カーネルの
        // segment には無い。元 cuts から補う（contract-2026-08-02-preview-parity.md §2.4.2/2.4.3）。
        framing: summary.cuts[s.cutIndex] ? summary.cuts[s.cutIndex].framing : undefined,
        freeze: summary.cuts[s.cutIndex] ? summary.cuts[s.cutIndex].freeze : undefined,
        transform: summary.cuts[s.cutIndex] ? summary.cuts[s.cutIndex].transform : undefined,
        opacity: summary.cuts[s.cutIndex] ? summary.cuts[s.cutIndex].opacity : undefined,
      });
  totalDuration = built.totalDuration;
  seek.max = totalDuration;
  updateTimeLabel();
  updateSeekVisual();
  // 初回描画・編集後の再読み込みのどちらでも framing を反映する（このタイミングは playbackLoop
  // が回っていないことがあるため個別に呼ぶ必要がある）。
  applyCutFramingVisual();
  cutFx.update();
}

// --- B-roll layers ---
// baked レイヤー（bake-layer が焼いた .mov）は ProRes 4444 でブラウザがデコードできない。
// bake-layer は同じ場所へプレビュー用サイドカー（.preview.webm / VP9 + アルファ）を必ず
// 併せて出すので、そちらを再生する。shell の previewProxyUri と同じ命名規約。
function layerPlaybackPath(layer) {
  if (layer.kind !== 'baked') return layer.src;
  return /\.mov$/i.test(layer.src)
    ? layer.src.replace(/\.mov$/i, '.preview.webm')
    : `${layer.src}.preview.webm`;
}

// task 2026-08-10-image-layer-parity 司令塔裁定1: layers[].src の拡張子だけで静止画判定する
// （schema の kind は 'video' のまま不変）。render-cut 側の同じ判定
// （packages/render-cut/src/layers.mjs の isImageLayerSource, plan.mjs の画像判定と同一集合）と
// 対象拡張子を完全に揃える。'baked' はここでは常に false 扱い -- layerPlaybackPath() が baked を
// 元の拡張子に関わらず常に .preview.webm サイドカーへ差し替えるため（上の layerPlaybackPath 参照）、
// 実際に配信されるバイト列は常に動画。'video' kind のみ元ファイルをそのまま配信するので、
// layer.src の拡張子判定がそのまま安全に使える。
const IMAGE_LAYER_SRC_PATTERN = /\.(png|jpe?g|webp|bmp|gif)$/i;
function isImageLayerSrc(src) {
  return typeof src === 'string' && IMAGE_LAYER_SRC_PATTERN.test(src);
}
function isImageLayer(layer) {
  return layer.kind !== 'baked' && isImageLayerSrc(layer.src);
}

// ㉔ layers[].crop（0..1 正規化・ソースフレーム相対・静的。contract-2026-08-02-preview-parity.md）。
// crop 未指定は既定 {x:0,y:0,w:1,h:1} = 全面（従来と完全に見た目が同じになる境界値）。
function cropOf(el) {
  const cw = Number(el.dataset.layerCropW);
  const ch = Number(el.dataset.layerCropH);
  return {
    x: Number(el.dataset.layerCropX) || 0,
    y: Number(el.dataset.layerCropY) || 0,
    w: Number.isFinite(cw) && cw > 0 ? cw : 1,
    h: Number.isFinite(ch) && ch > 0 ? ch : 1,
  };
}

// ㉖ layers[].perspective（0..1 正規化・corner-pin・静的。contract-2026-08-02-preview-parity.md
// §2.4.4）。perspective 未指定 or 不正値は null（既存の見た目を一切変えない = 回帰なし）。
function perspectiveOf(el) {
  const raw = el.dataset.layerPerspectiveCorners;
  if (!raw) return null;
  try {
    const corners = JSON.parse(raw);
    return Array.isArray(corners) && corners.length === 4 ? { corners } : null;
  } catch {
    return null;
  }
}

// レイヤー1件の位置・サイズ・pivot・変形・切り抜きを一括で書く単一の正本（2026-08-06
// web-layer-placement-parity）。shell の updateStageScale レイヤーループと同じ中心基準へ統一
// した: 箱は「クロップ矩形の中心を (outputWidth/2+x, outputHeight/2+y) に置く」
// （left/top = outputSize/2+x,y・width/height = videoWidth/Height×scale）。以前は「要素の
// 自然位置 + translate(x,y) scale(s)」という Web 独自の基準だった（crop 導入前からの既知差分
// として contract §2.4.1 に記載されていたもの。shell/render-cut と数値が一致しない原因だった
// というオーナー実機報告を受けて解消した）。setupLayers の初期描画・loadedmetadata・ドラッグ
// 移動・クロップハンドル・パースパネルの全呼び出し元がこの一本だけを経由する（以前は 2 箇所が
// 個別に `translate() scale() rotate()` を書いており、perspective 追加時にどちらか一方だけ
// 書き換えて drift する危険があった）。crop→scale→perspective→rotate→opacity→overlay の適用順
// （render-cut/src/layers.mjs）どおり、matrix3d は innermost（最右）に追記する。perspective の
// 箱はクロップ矩形の描画済み（scale 込み）px サイズ -- scale はもはや別関数ではなく箱サイズへ
// 焼き込むため、shell と同じ box 単位になった（layer-perspective-visual.js のコメント参照）。
function applyLayerLayout(el, x, y, scale, rotate) {
  const os = outputSizePx();
  el.style.left = `${os.width / 2 + x}px`;
  el.style.top = `${os.height / 2 + y}px`;
  const crop = cropOf(el);
  const pivotXPct = (crop.x + crop.w / 2) * 100;
  const pivotYPct = (crop.y + crop.h / 2) * 100;
  el.style.transformOrigin = `${pivotXPct}% ${pivotYPct}%`;
  el.style.clipPath = (crop.x > 0 || crop.y > 0 || crop.w < 1 || crop.h < 1)
    ? `inset(${crop.y * 100}% ${Math.max(0, (1 - crop.x - crop.w)) * 100}% ${Math.max(0, (1 - crop.y - crop.h)) * 100}% ${crop.x * 100}%)`
    : '';
  let transform = `translate(-${pivotXPct}%, -${pivotYPct}%) rotate(${rotate}deg)`;
  if (el.videoWidth > 0 && el.videoHeight > 0) {
    el.style.width = `${el.videoWidth * scale}px`;
    el.style.height = `${el.videoHeight * scale}px`;
    const boxWidthPx = crop.w * el.videoWidth * scale;
    const boxHeightPx = crop.h * el.videoHeight * scale;
    const visual = computeLayerPerspectiveVisual(perspectiveOf(el), boxWidthPx, boxHeightPx);
    if (visual) transform += ` ${visual.transformFunction}`;
  }
  el.style.transform = transform;
}

function setupLayers() {
  const layers = summary?.layers ?? [];
  for (const layer of layers) {
    if (!layer.src) continue;
    const layerIsImage = isImageLayer(layer);
    const el = document.createElement(layerIsImage ? 'img' : 'video');
    if (layerIsImage) {
      // 画像レイヤー（司令塔裁定3）: <video> 固有の
      // videoWidth/videoHeight/readyState/paused/play/pause/load を <img> インスタンス自身に薄い
      // ファサードとして生やし、以降の配置・crop・アルファ実測・遅延ロード（layer-lazy-load.js）
      // などの既存コード（video 用に書かれたレール）を無改修のまま乗せる。videoWidth/
      // videoHeight/readyState は都度評価する getter にする（ロード完了前後で値が変わる、
      // video の同名プロパティと同じ性質）。
      Object.defineProperty(el, 'videoWidth', { get: () => el.naturalWidth });
      Object.defineProperty(el, 'videoHeight', { get: () => el.naturalHeight });
      Object.defineProperty(el, 'readyState', {
        get: () => (el.complete && el.naturalWidth > 0) ? HTMLMediaElement.HAVE_ENOUGH_DATA : 0,
      });
      // index.html の `#layer-container video { position: absolute; object-fit: contain; }`
      // 相当を img にもインラインで適用する（video は既存 CSS ルールのままで無改修 --
      // index.html はこのタスクの所有ファイルではないため、img 分だけここで直接補う）。
      el.style.position = 'absolute';
      el.style.objectFit = 'contain';
      // 静止画に「再生中」は無い: syncLayers() の play()/pause() 呼び出しを無害な no-op として
      // 吸収する。load() は releaseLayerMedia()（layer-lazy-load.js）が呼ぶため同様に no-op。
      el.paused = true;
      el.play = () => Promise.resolve();
      el.pause = () => {};
      el.load = () => {};
      // video の 'loadedmetadata'（サイズ確定）と 'loadeddata'（updateLayerSelectBox の再試行
      // リスナー）を img の 'load' 1本から合成発火する。
      el.addEventListener('load', () => {
        el.dispatchEvent(new Event('loadedmetadata'));
        el.dispatchEvent(new Event('loadeddata'));
      });
    } else {
      el.preload = 'none';
      el.muted = true;
      el.playsInline = true;
    }
    // サイドカーが無い案件（--no-preview-proxy で焼いた等）は 404 で error になる。
    // その場合だけ非表示にして知らせる（黒板で映像を覆わないため）
    el.addEventListener('error', () => {
      const lv = layerVideos.find(x => x.el === el);
      // src 解放後に遅れて届く中断イベントは 404 扱いしない。実ロード中の失敗だけを
      // 恒久 unplayable にし、その場で解放して以後の先読みでも再試行しない。
      if (!lv?.loaded) return;
      const failedSrc = el.currentSrc || el.src;
      markLayerUnplayable(lv);
      lv.visible = false;
      el.style.display = 'none';
      console.warn('[preview] レイヤーを再生できません（プレビュー用サイドカーを確認）', layer.id, failedSrc);
    });
    // 一時停止中は syncLayers がシーク時にしか走らない。読み込みがそれより遅いと
    // 「窓の中なのに出ない」まま次の操作まで固まるので、メタデータ到着で貼り直す
    el.addEventListener('loadedmetadata', () => syncLayers(outputTime));
    el.dataset.layerId = layer.id;
    el.style.display = 'none';
    el.style.opacity = String(layer.opacity ?? 1);
    if (layer.blend) el.style.mixBlendMode = layer.blend;
    el.dataset.layerX = layer.transform?.x || 0;
    el.dataset.layerY = layer.transform?.y || 0;
    el.dataset.layerScale = layer.transform?.scale || 1;
    el.dataset.layerRotate = layer.transform?.rotate || 0;
    const crop = layer.crop;
    const cropW = crop && Number.isFinite(crop.w) && crop.w > 0 ? crop.w : 1;
    const cropH = crop && Number.isFinite(crop.h) && crop.h > 0 ? crop.h : 1;
    el.dataset.layerCropX = String(crop && Number.isFinite(crop.x) ? crop.x : 0);
    el.dataset.layerCropY = String(crop && Number.isFinite(crop.y) ? crop.y : 0);
    el.dataset.layerCropW = String(cropW);
    el.dataset.layerCropH = String(cropH);
    const perspectiveCorners = layer.perspective && Array.isArray(layer.perspective.corners) ? layer.perspective.corners : null;
    if (perspectiveCorners) el.dataset.layerPerspectiveCorners = JSON.stringify(perspectiveCorners);
    // width/height と perspective の箱サイズは videoWidth/Height を要するため、メタデータ到着
    // （loadedmetadata）のたびに必ず呼び直す -- 初期呼び出しはメタデータ未着で left/top/
    // transform-origin/clip-path だけが決まる（display:none のため見た目に影響しない）。
    const relayout = () => applyLayerLayout(
      el, Number(el.dataset.layerX) || 0, Number(el.dataset.layerY) || 0,
      Number(el.dataset.layerScale) || 1, Number(el.dataset.layerRotate) || 0,
    );
    relayout();
    el.addEventListener('loadedmetadata', relayout);
    // elementsFromPoint のヒット対象にする（実際の当たり判定は wrapper の capture 側）
    el.style.pointerEvents = 'auto';
    el.style.cursor = 'move';
    // 編集適用の再構築（要素作り直し）をまたいで選択を保つ
    if (selectedLayerId !== null && layer.id === selectedLayerId) el.classList.add('layer-selected');
    layerContainer.appendChild(el);
    layerVideos.push({ el, layer, visible: false, loaded: false });
  }
  // 起動時は seekTo/playbackLoop がまだ走っていないため、0 秒付近の先読みをここで始める。
  syncLayers(outputTime);
}

function syncLayers(t) {
  for (const lv of layerVideos) {
    const l = lv.layer;
    syncLayerLazyLoad(lv, t, () => resolveMediaUrl(layerPlaybackPath(l)));
    // メタデータ前に出すと最初のフレームが黒板になるので、読めてから出す（shell と同じ規約）
    const shouldShow = lv.loaded && !lv.unplayable
      && lv.el.readyState >= HTMLMediaElement.HAVE_METADATA
      && t >= (l.t ?? 0) && t < (l.t ?? 0) + (l.duration ?? 0);
    if (shouldShow !== lv.visible) {
      lv.el.style.display = shouldShow ? 'block' : 'none';
      lv.visible = shouldShow;
      if (!shouldShow && !lv.el.paused) lv.el.pause();
      if (selectedLayerId !== null && lv.layer.id === selectedLayerId) {
        if (shouldShow) lv.opaqueBox = undefined; // 表示時点のフレームで測り直す
        updateLayerSelectBox();
      }
    }
    if (shouldShow) {
      const localT = t - (l.t ?? 0);
      // layers[].keyframes（transform/crop/perspective のアニメーション。
      // contract-2026-08-09-transform-keyframes-v0.md）: dataset を書き換えてから
      // applyLayerLayout を呼び直す -- crop pivot / clip-path / matrix3d の描画コードは
      // 既存のものをそのまま再利用する。keyframes の無いレイヤー（大多数）は
      // Array.isArray チェックで弾かれ、コストが増えない。
      if (Array.isArray(l.keyframes) && l.keyframes.length >= 2) {
        const resolved = computeLayerKeyframesVisual(l.keyframes, localT);
        if (resolved) {
          if (resolved.transform) {
            lv.el.dataset.layerX = String(resolved.transform.x);
            lv.el.dataset.layerY = String(resolved.transform.y);
            lv.el.dataset.layerScale = String(resolved.transform.scale);
            lv.el.dataset.layerRotate = String(resolved.transform.rotate);
          }
          if (resolved.crop) {
            lv.el.dataset.layerCropX = String(resolved.crop.x);
            lv.el.dataset.layerCropY = String(resolved.crop.y);
            lv.el.dataset.layerCropW = String(resolved.crop.w);
            lv.el.dataset.layerCropH = String(resolved.crop.h);
          }
          if (resolved.perspective) {
            lv.el.dataset.layerPerspectiveCorners = JSON.stringify(resolved.perspective.corners);
          }
          if (resolved.transform || resolved.crop || resolved.perspective) {
            applyLayerLayout(
              lv.el, Number(lv.el.dataset.layerX) || 0, Number(lv.el.dataset.layerY) || 0,
              Number(lv.el.dataset.layerScale) || 1, Number(lv.el.dataset.layerRotate) || 0,
            );
          }
        }
      }
      // 再生中は下地と同じデッドバンドを使う。複数・高負荷のレイヤーほど小刻みな補正が
      // デコードを圧迫するため、フレーム精度よりシーク完了を優先する。一時停止中は目標が
      // 動かないので従来どおり精密に合わせる。
      const tolerance = isPlaying ? SYNC_DEADBAND_SEC : 0.001;
      if (!lv.el.seeking) syncMediaCurrentTime(lv.el, localT, tolerance);
      if (isPlaying && lv.el.paused) void lv.el.play().catch(() => undefined);
      else if (!isPlaying && !lv.el.paused) lv.el.pause();
    }
  }
}

// --- レイヤー（ベイクテロップ / B-roll）のクリック選択 + ドラッグ移動 ---
// shell の CF-select と同じ書き込み契約: 確定（pointerup）時のみ layers[].transform へ
// merge して PUT（サーバ側 lint ゲート）。ベイクテロップの文字はベイク済み映像のため
// プレビューでは編集できない（ATF を直して再ベイク）— ここで提供するのは移動のみ。
// リサイズ / 回転ハンドルは未実装（shell のみ）。
let selectedLayerId = null;

// 選択枠。ベイクテロップは全面サイズの透明動画なので、要素の箱ではなく
// アルファ実測した不透明領域（コンテンツ）へフィットさせる
const layerSelectBox = document.createElement('div');
layerSelectBox.id = 'layer-select-box';
layerSelectBox.style.cssText = 'position:absolute;pointer-events:none;display:none;z-index:1000;';
const layerSelectRect = document.createElement('div');
layerSelectRect.style.cssText = 'position:absolute;border:2px solid #4da3ff;box-shadow:0 0 0 1px rgba(0,0,0,0.35);border-radius:2px;';
layerSelectBox.appendChild(layerSelectRect);

const layerAlphaCanvas = document.createElement('canvas');
function layerAlphaCtx() {
  return layerAlphaCanvas.getContext('2d', { willReadFrequently: true });
}

// 現フレームの不透明ピクセルのバウンディングボックス（要素ローカル論理 px）。
// 縮小キャンバスで走査するので誤差は数 px。全透明・未ロードは null（= 全体にフォールバック）
function measureLayerOpaqueBox(el) {
  try {
    const vw = el.videoWidth;
    const vh = el.videoHeight;
    if (!(vw > 0 && vh > 0) || el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    const shrink = Math.min(1, 320 / Math.max(vw, vh));
    const w = Math.max(1, Math.round(vw * shrink));
    const h = Math.max(1, Math.round(vh * shrink));
    layerAlphaCanvas.width = w;
    layerAlphaCanvas.height = h;
    const ctx = layerAlphaCtx();
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(el, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 16) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    const sx = el.offsetWidth / w;
    const sy = el.offsetHeight / h;
    const pad = 3;
    return {
      x: minX * sx - pad,
      y: minY * sy - pad,
      w: (maxX - minX + 1) * sx + pad * 2,
      h: (maxY - minY + 1) * sy + pad * 2,
    };
  } catch {
    return null;
  }
}

// クリック地点のアルファ値（0-255）。透明部分のクリックを素通しさせるための当たり判定。
// transform（translate/scale/rotate・origin はクロップ矩形の中心 — crop 無しなら要素中心と一致）
// の逆写像で要素ローカルへ戻す
function layerAlphaAt(el, clientX, clientY) {
  try {
    const vw = el.videoWidth;
    const vh = el.videoHeight;
    if (!(vw > 0 && vh > 0) || el.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return 255;
    const contRect = layerContainer.getBoundingClientRect();
    if (!(contRect.width > 0)) return 255;
    const viewScale = contRect.width / layerContainer.offsetWidth; // frameScale × zoom
    const px = (clientX - contRect.left) / viewScale;
    const py = (clientY - contRect.top) / viewScale;
    const crop = cropOf(el);
    const cx = el.offsetLeft + (crop.x + crop.w / 2) * el.offsetWidth;
    const cy = el.offsetTop + (crop.y + crop.h / 2) * el.offsetHeight;
    const computed = getComputedStyle(el).transform;
    const m = computed && computed !== 'none' ? new DOMMatrix(computed) : new DOMMatrix();
    const p = m.inverse().transformPoint(new DOMPoint(px - cx, py - cy));
    const lx = p.x + cx - el.offsetLeft;
    const ly = p.y + cy - el.offsetTop;
    if (lx < 0 || ly < 0 || lx >= el.offsetWidth || ly >= el.offsetHeight) return 0;
    const vx = Math.min(vw - 1, Math.floor(lx * vw / el.offsetWidth));
    const vy = Math.min(vh - 1, Math.floor(ly * vh / el.offsetHeight));
    layerAlphaCanvas.width = 1;
    layerAlphaCanvas.height = 1;
    const ctx = layerAlphaCtx();
    ctx.clearRect(0, 0, 1, 1);
    ctx.drawImage(el, vx, vy, 1, 1, 0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  } catch {
    return 255; // 計測できない環境では従来どおり要素の箱で当てる
  }
}

function updateLayerSelectBox() {
  if (!layerSelectBox.parentElement) layerContainer.appendChild(layerSelectBox);
  const lv = layerVideos.find(v => selectedLayerId !== null && v.layer.id === selectedLayerId);
  if (!lv || lv.el.style.display === 'none') {
    layerSelectBox.style.display = 'none';
    positionLayerCropToggle(null);
    positionLayerPerspectiveToggle(null);
    return;
  }
  const el = lv.el;
  // undefined = 未計測。フレーム未着ならまだ測れない — 全面フォールバック枠を
  // 一瞬見せず（移動確定後の再構築でチラつく実害）、フレーム到着後に測ってから出す
  if (lv.opaqueBox === undefined) {
    if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      lv.opaqueBox = measureLayerOpaqueBox(el);
    } else {
      layerSelectBox.style.display = 'none';
      el.addEventListener('loadeddata', () => updateLayerSelectBox(), { once: true });
      return;
    }
  }
  layerSelectBox.style.display = 'block';
  layerSelectBox.style.left = `${el.offsetLeft}px`;
  layerSelectBox.style.top = `${el.offsetTop}px`;
  layerSelectBox.style.width = `${el.offsetWidth}px`;
  layerSelectBox.style.height = `${el.offsetHeight}px`;
  layerSelectBox.style.transform = el.style.transform || '';
  // ㉔ pivot はクロップ矩形の中心（crop 無しなら 50%/50% = 従来どおり）— el 自身の
  // transform-origin（applyLayerLayout が設定）をそのまま流用する。
  layerSelectBox.style.transformOrigin = el.style.transformOrigin || '50% 50%';
  const naturalBox = lv.opaqueBox ?? { x: 0, y: 0, w: el.offsetWidth, h: el.offsetHeight };
  // クロップ窓（要素ローカル px = videoWidth/Height×scale。applyLayerLayout が width/height に
  // scale を焼き込むため el.offsetWidth はネイティブ px と一致しない — measureLayerOpaqueBox /
  // layerAlphaAt も el.offsetWidth 相対の比率で換算しており、この関数と単位が揃っているので
  // そのまま交差計算できる）と不透明領域の交差 = 実際に見えている範囲。
  const crop = cropOf(el);
  const cropBoxPx = {
    x: crop.x * el.offsetWidth, y: crop.y * el.offsetHeight,
    w: crop.w * el.offsetWidth, h: crop.h * el.offsetHeight,
  };
  const ix0 = Math.max(naturalBox.x, cropBoxPx.x);
  const iy0 = Math.max(naturalBox.y, cropBoxPx.y);
  const ix1 = Math.min(naturalBox.x + naturalBox.w, cropBoxPx.x + cropBoxPx.w);
  const iy1 = Math.min(naturalBox.y + naturalBox.h, cropBoxPx.y + cropBoxPx.h);
  const r = (ix1 > ix0 && iy1 > iy0) ? { x: ix0, y: iy0, w: ix1 - ix0, h: iy1 - iy0 } : cropBoxPx;
  layerSelectRect.style.left = `${r.x}px`;
  layerSelectRect.style.top = `${r.y}px`;
  layerSelectRect.style.width = `${r.w}px`;
  layerSelectRect.style.height = `${r.h}px`;
  positionLayerCropToggle(el);
  positionLayerPerspectiveToggle(el);
  layerPerspectiveToggle.style.borderColor = layerPerspectiveNow(el) ? '#ffb84d' : '#4da3ff';
}

function setLayerSelected(id) {
  if (cropModeActive) setCropMode(false);
  if (perspectivePanelOpen) setPerspectivePanelOpen(false);
  activePerspectivePreset = null;
  for (const button of layerPerspectivePresetButtons) {
    button.style.background = 'rgba(255,255,255,0.06)';
    button.style.color = '#cfe6ff';
  }
  selectedLayerId = id;
  for (const lv of layerVideos) {
    const on = id !== null && lv.layer.id === id;
    lv.el.classList.toggle('layer-selected', on);
    if (on) lv.opaqueBox = undefined; // 選択時点のフレームで測り直す（updateLayerSelectBox が遅延計測）
  }
  updateLayerSelectBox();
}

// --- ㉔ クロップモード（2026-08-06 オーナー裁定: shell/Web 両面）---
// 移動と操作が衝突しないための排他モード切替。8 方向ハンドルで layers[].crop
// （0..1 正規化・ソースフレーム相対）を編集し、確定（pointerup）時のみ書き戻す。
let cropModeActive = false;
const CROP_MIN = 0.02;
function clampCrop(x, y, w, h) {
  const cw = Math.min(1, Math.max(CROP_MIN, Number.isFinite(w) ? w : 1));
  const ch = Math.min(1, Math.max(CROP_MIN, Number.isFinite(h) ? h : 1));
  const cx = Math.min(1 - cw, Math.max(0, Number.isFinite(x) ? x : 0));
  const cy = Math.min(1 - ch, Math.max(0, Number.isFinite(y) ? y : 0));
  return { x: cx, y: cy, w: cw, h: ch };
}
function layerTransformOf(el) {
  return {
    x: Number(el.dataset.layerX) || 0,
    y: Number(el.dataset.layerY) || 0,
    scale: Number(el.dataset.layerScale) || 1,
    rotate: Number(el.dataset.layerRotate) || 0,
  };
}
// ソース px（ネイティブ px。videoWidth/videoHeight）の矩形を、layerContainer ローカル座標
// （frameScale/zoom 適用前の「出力論理 px」空間 -- video 要素自身と同じ単位。frameScale/zoom は
// 親コンテナの scale() が別途処理する）へ正写像する。shell の layerScreenRectForVideoRect と
// 同型の幾何（画面 px への変換〔frameRect/frameScale 乗算〕だけ、Web はこの空間のまま
// layerContainer の子として置くため省く）。2026-08-06 web-layer-placement-parity: 中心基準統一
// に伴い el.offsetLeft 依存の旧実装を置き換えた -- 旧実装は「el 自身の静的位置に transform.x を
// 加算する」慣習だったが、新基準では transform.x は既に el.style.left（= outputWidth/2+x）へ
// 焼き込まれているため、el.offsetLeft から独立に「ネイティブ px 空間 → transform による配置」を
// 導出する必要がある（shell と同じ formula: P' = outputSize/2 + T + s·R(θ)·(P-pivot)）。
function layerRectForVideoRect(transform, videoRect, pivotPx) {
  const os = outputSizePx();
  const outputW = videoRect.w * transform.scale;
  const outputH = videoRect.h * transform.scale;
  const offX = (videoRect.x + videoRect.w / 2 - pivotPx.x) * transform.scale;
  const offY = (videoRect.y + videoRect.h / 2 - pivotPx.y) * transform.scale;
  const rad = transform.rotate * Math.PI / 180;
  const rotOffX = offX * Math.cos(rad) - offY * Math.sin(rad);
  const rotOffY = offX * Math.sin(rad) + offY * Math.cos(rad);
  const centerX = os.width / 2 + transform.x + rotOffX;
  const centerY = os.height / 2 + transform.y + rotOffY;
  return { left: centerX - outputW / 2, top: centerY - outputH / 2, width: outputW, height: outputH, rotOffX, rotOffY };
}
// 画面クライアント座標 → ソースフレーム正規化座標（0..1）の逆写像。layerRectForVideoRect の逆
// （shell の layerVideoPointForPivot と同型）。pivotFrac はソースフレーム正規化座標（クロップ
// ハンドルは常に全面中心 {0.5,0.5} を使う -- shell と同じ規約。呼び出し元 fullPivot 参照）。
function fractionForClient(el, transform, pivotFrac, clientX, clientY) {
  const contRect = layerContainer.getBoundingClientRect();
  if (!(contRect.width > 0)) return null;
  const viewScale = contRect.width / layerContainer.offsetWidth;
  const px = (clientX - contRect.left) / viewScale;
  const py = (clientY - contRect.top) / viewScale;
  const os = outputSizePx();
  const vw = el.videoWidth, vh = el.videoHeight;
  const pivotPx = { x: pivotFrac.x * vw, y: pivotFrac.y * vh };
  const dx = px - (os.width / 2 + transform.x);
  const dy = py - (os.height / 2 + transform.y);
  const rad = -transform.rotate * Math.PI / 180;
  const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
  const lx = rx / (transform.scale || 1) + pivotPx.x;
  const ly = ry / (transform.scale || 1) + pivotPx.y;
  return { x: lx / vw, y: ly / vh };
}

const layerCropBox = document.createElement('div');
layerCropBox.id = 'layer-crop-box';
layerCropBox.setAttribute('data-akari-interaction', '1');
layerCropBox.style.cssText = 'position:absolute;pointer-events:none;display:none;z-index:1001;overflow:hidden;outline:1px dashed rgba(255,255,255,0.5);';
const layerCropRect = document.createElement('div');
layerCropRect.style.cssText = 'position:absolute;box-sizing:border-box;outline:1.5px solid #4da3ff;box-shadow:0 0 0 2000px rgba(0,0,0,0.45);pointer-events:none;';
layerCropBox.appendChild(layerCropRect);
const CROP_HANDLE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CROP_HANDLE_POS = {
  nw: { top: '0', left: '0', cursor: 'nwse-resize' },
  n: { top: '0', left: '50%', cursor: 'ns-resize' },
  ne: { top: '0', left: '100%', cursor: 'nesw-resize' },
  e: { top: '50%', left: '100%', cursor: 'ew-resize' },
  se: { top: '100%', left: '100%', cursor: 'nwse-resize' },
  s: { top: '100%', left: '50%', cursor: 'ns-resize' },
  sw: { top: '100%', left: '0', cursor: 'nesw-resize' },
  w: { top: '50%', left: '0', cursor: 'ew-resize' },
};
const layerCropHandleElements = CROP_HANDLE_DIRS.map(dir => {
  const h = document.createElement('div');
  const pos = CROP_HANDLE_POS[dir];
  h.dataset.akariCropHandle = dir;
  h.setAttribute('data-akari-interaction', '1');
  h.style.cssText = `position:absolute;width:12px;height:12px;margin:-6px;box-sizing:border-box;border:1.5px solid #4da3ff;border-radius:2px;background:#fff;pointer-events:auto;top:${pos.top};left:${pos.left};cursor:${pos.cursor};`;
  layerCropRect.appendChild(h);
  return h;
});
const layerCropToggle = document.createElement('div');
layerCropToggle.id = 'layer-crop-toggle';
layerCropToggle.title = 'クロップモード切替 (Esc で終了)';
layerCropToggle.textContent = '⛶';
layerCropToggle.setAttribute('data-akari-interaction', '1');
layerCropToggle.style.cssText = 'position:absolute;display:none;width:22px;height:22px;box-sizing:border-box;border-radius:4px;border:1px solid #4da3ff;background:rgba(20,20,20,0.85);color:#cfe6ff;font-size:13px;line-height:20px;text-align:center;cursor:pointer;pointer-events:auto;user-select:none;z-index:1002;';

function positionLayerCropToggle(el) {
  if (!layerCropToggle.parentElement) layerContainer.appendChild(layerCropToggle);
  if (!el) {
    layerCropToggle.style.display = 'none';
    return;
  }
  layerCropToggle.style.display = 'flex';
  layerCropToggle.style.alignItems = 'center';
  layerCropToggle.style.justifyContent = 'center';
  // 箱の上端がキャンバス上端に近いと「箱の外側・上」が画面外へはみ出す。0 未満にはせず、
  // 収まらないときは箱の内側上端へフォールバックする。
  const box = cropModeActive ? layerCropBox : el;
  layerCropToggle.style.left = `${box.offsetLeft + box.offsetWidth + 4}px`;
  layerCropToggle.style.top = `${Math.max(4, box.offsetTop - 26)}px`;
}

function updateLayerCropBox() {
  if (!layerCropBox.parentElement) layerContainer.appendChild(layerCropBox);
  const lv = layerVideos.find(v => selectedLayerId !== null && v.layer.id === selectedLayerId);
  if (!cropModeActive || !lv || lv.el.style.display === 'none' || !(lv.el.videoWidth > 0)) {
    layerCropBox.style.display = 'none';
    return;
  }
  const el = lv.el;
  const transform = layerTransformOf(el);
  const crop = cropOf(el);
  const vw = el.videoWidth, vh = el.videoHeight;
  // pivot は実合成と同じ「現在のクロップ矩形の中心」（applyLayerLayout の transform-origin と
  // 同じ値。ネイティブ px 空間）を使う（2026-08-06 crop-handle-anchor-fix 以前は全面中心固定の
  // 近似だったが、それだと錨補正後の transform.x/y と噛み合わず外枠が編集中にドリフトして見える
  // ため、実際の合成 pivot と統一した — shell の updateLayerCropBox と同型の判断）。
  const cropPivot = { x: (crop.x + crop.w / 2) * vw, y: (crop.y + crop.h / 2) * vh };
  const outer = layerRectForVideoRect(transform, { x: 0, y: 0, w: vw, h: vh }, cropPivot);
  const inner = layerRectForVideoRect(transform, { x: crop.x * vw, y: crop.y * vh, w: crop.w * vw, h: crop.h * vh }, cropPivot);
  layerCropBox.style.display = 'block';
  layerCropBox.style.left = `${outer.left}px`;
  layerCropBox.style.top = `${outer.top}px`;
  layerCropBox.style.width = `${outer.width}px`;
  layerCropBox.style.height = `${outer.height}px`;
  layerCropBox.style.transform = `rotate(${transform.rotate}deg)`;
  layerCropRect.style.left = `${inner.left - outer.left}px`;
  layerCropRect.style.top = `${inner.top - outer.top}px`;
  layerCropRect.style.width = `${inner.width}px`;
  layerCropRect.style.height = `${inner.height}px`;
  positionLayerCropToggle(el);
}

function applyLayerCropDataset(el, crop) {
  el.dataset.layerCropX = String(crop.x);
  el.dataset.layerCropY = String(crop.y);
  el.dataset.layerCropW = String(crop.w);
  el.dataset.layerCropH = String(crop.h);
  const t = layerTransformOf(el);
  applyLayerLayout(el, t.x, t.y, t.scale, t.rotate);
}

// ㉗ クロップハンドル操作の錨補正（2026-08-06 crop-handle-anchor-fix）: crop と transform.x/y を
// 同一フレームで一括更新する。crop 単独 → transform 単独の2段更新だと中間フレームで一瞬だけ
// 錨補正前の crop が画面に出てしまうため、必ずこちらを使う（crop/transform 両方のデータセットを
// 先に確定させてから applyLayerLayout を1回だけ呼ぶ -- applyLayerCropDataset を経由すると
// 古い transform で一度レイアウトしてしまうため、ここでは直接書く）。
function applyLayerCropAndTransformDataset(el, crop, transform) {
  el.dataset.layerCropX = String(crop.x);
  el.dataset.layerCropY = String(crop.y);
  el.dataset.layerCropW = String(crop.w);
  el.dataset.layerCropH = String(crop.h);
  el.dataset.layerX = String(transform.x);
  el.dataset.layerY = String(transform.y);
  el.dataset.layerScale = String(transform.scale);
  el.dataset.layerRotate = String(transform.rotate);
  applyLayerLayout(el, transform.x, transform.y, transform.scale, transform.rotate);
}

function setCropMode(active) {
  cropModeActive = !!(active && selectedLayerId !== null);
  // ㉖ クロップモードとパースパネルは排他（ハンドル/操作の衝突を避ける — shell と同じ設計判断）。
  if (cropModeActive && perspectivePanelOpen) setPerspectivePanelOpen(false);
  layerCropToggle.classList.toggle('is-crop-mode', cropModeActive);
  layerCropToggle.style.background = cropModeActive ? '#4da3ff' : 'rgba(20,20,20,0.85)';
  layerCropToggle.style.color = cropModeActive ? '#0b1a2a' : '#cfe6ff';
  if (cropModeActive) {
    layerSelectBox.style.display = 'none';
    updateLayerCropBox();
  } else {
    layerCropBox.style.display = 'none';
    updateLayerSelectBox();
  }
}
// click ではなく pointerdown+pointerup（setPointerCapture 付き）で拾う — 再生中は毎フレーム
// positionLayerCropToggle が呼ばれてボタンが数 px 動くため、down/up の間にボタンが動くと
// click イベントの合成対象がズレて発火しなくなることがある（実マウス操作で再現・
// 実測確認済み）。ドラッグハンドルと同じ pointer capture 方式にして確実に拾う。
layerCropToggle.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  try { layerCropToggle.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
});
layerCropToggle.addEventListener('pointerup', (e) => {
  e.stopPropagation();
  setCropMode(!cropModeActive);
});
// Escape でのクロップモード終了は、既存のグローバル Escape ハンドラ（setLayerSelected(null) を
// 呼ぶ）が setLayerSelected 内の cropModeActive ガード経由で兼ねる（専用リスナーは不要）。

// ㉗ 錨補正（2026-08-06 crop-handle-anchor-fix）: crop の中心が実際の配置基準点
// （applyLayerLayout の transform-origin）なので、crop 変更だけを書き戻すと基準点自体が
// 動いて絵全体がずれる。cropAnchorCorrectedTransform が「ドラッグした辺以外は画面上不動」に
// なる transform.x/y を返し、crop と同一 patch で書く（ドラッグ中のライブ表示も同じ補正を
// 適用 — 確定時だけだと commit 瞬間にジャンプする）。pointer→ソース座標のマッピング
// （computeNext 内の fractionForClient 呼び出し）はドラッグ開始時点の startTransform を最後まで
// 使い続ける（ライブ補正で変わる layerX/layerY を混ぜない）ため、この錨補正の追加はハンドル
// 自体の追従性に影響しない。
for (const handle of layerCropHandleElements) {
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || selectedLayerId === null || !cropModeActive) return;
    const lv = layerVideos.find(v => v.layer.id === selectedLayerId);
    if (!lv) return;
    const el = lv.el;
    const dir = handle.dataset.akariCropHandle;
    const startTransform = layerTransformOf(el);
    const fullPivot = { x: 0.5, y: 0.5 };
    const original = clampCrop(
      Number(el.dataset.layerCropX), Number(el.dataset.layerCropY),
      Number(el.dataset.layerCropW), Number(el.dataset.layerCropH),
    );
    const anchorRight = original.x + original.w;
    const anchorBottom = original.y + original.h;
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const captureTarget = event.currentTarget;
    let moved = false;
    let cancelled = false;
    try { captureTarget.setPointerCapture(pointerId); } catch { /* not capturable */ }
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKeyDown, true);
      if (captureTarget.hasPointerCapture && captureTarget.hasPointerCapture(pointerId)) {
        captureTarget.releasePointerCapture(pointerId);
      }
    };
    const computeNext = (moveEvent) => {
      const point = fractionForClient(el, startTransform, fullPivot, moveEvent.clientX, moveEvent.clientY);
      if (!point) return original;
      let nextX = original.x, nextY = original.y, nextRight = anchorRight, nextBottom = anchorBottom;
      if (dir.indexOf('w') >= 0) nextX = Math.min(point.x, anchorRight - CROP_MIN);
      if (dir.indexOf('e') >= 0) nextRight = Math.max(point.x, original.x + CROP_MIN);
      if (dir.indexOf('n') >= 0) nextY = Math.min(point.y, anchorBottom - CROP_MIN);
      if (dir.indexOf('s') >= 0) nextBottom = Math.max(point.y, original.y + CROP_MIN);
      return clampCrop(nextX, nextY, nextRight - nextX, nextBottom - nextY);
    };
    // cropAnchorCorrectedTransform は x/y のみを返す（scale/rotate は補正で動かさない）ため、
    // 書き戻し用の完全な transform には startTransform の scale/rotate を必ずマージする（欠けると
    // dataset に "undefined" が書かれ Number(...)||1 の既定値フォールバックでスケール/回転が
    // 消し飛ぶ -- L1 実機テストで実際に踏んだ回帰）。
    const correctedTransformFor = (nextCrop) => ({
      ...startTransform,
      ...cropAnchorCorrectedTransform(original, nextCrop, startTransform, el.videoWidth, el.videoHeight),
    });
    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      moved = true;
      const next = computeNext(moveEvent);
      applyLayerCropAndTransformDataset(el, next, correctedTransformFor(next));
      updateLayerCropBox();
    };
    const finish = async () => {
      cleanup();
      if (cancelled) {
        applyLayerCropAndTransformDataset(el, original, startTransform);
        updateLayerCropBox();
        return;
      }
      if (!moved) return;
      const finalCrop = clampCrop(
        Number(el.dataset.layerCropX), Number(el.dataset.layerCropY),
        Number(el.dataset.layerCropW), Number(el.dataset.layerCropH),
      );
      const finalTransform = layerTransformOf(el);
      try {
        await layerWriteViaPut(selectedLayerId, { crop: finalCrop, transform: finalTransform });
      } catch (err) {
        applyLayerCropAndTransformDataset(el, original, startTransform);
        updateLayerCropBox();
        showMessage(String(err?.message || err));
      }
    };
    const onUp = (upEvent) => {
      if (upEvent.pointerId !== undefined && upEvent.pointerId !== pointerId) return;
      void finish();
    };
    const onKeyDown = (keyEvent) => {
      if (keyEvent.key !== 'Escape') return;
      cancelled = true;
      void finish();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKeyDown, true);
  });
}
new ResizeObserver(() => updateLayerCropBox()).observe(wrapper);

// --- ㉖ layers[].perspective（v0）: プリセット(右奥/左奥/上奥/下奥) + 角度ツマミのみ ---
// 4隅の直接ドラッグハンドルは次段（本タスク対象外）。クロップトグルの下に常駐する。
let perspectivePanelOpen = false;
let activePerspectivePreset = null;
const layerPerspectiveToggle = document.createElement('div');
layerPerspectiveToggle.id = 'layer-perspective-toggle';
layerPerspectiveToggle.title = 'パース変形パネル';
layerPerspectiveToggle.textContent = '◈';
layerPerspectiveToggle.setAttribute('data-akari-interaction', '1');
layerPerspectiveToggle.style.cssText = 'position:absolute;display:none;width:22px;height:22px;box-sizing:border-box;border-radius:4px;border:1px solid #4da3ff;background:rgba(20,20,20,0.85);color:#cfe6ff;font-size:13px;line-height:20px;text-align:center;cursor:pointer;pointer-events:auto;user-select:none;z-index:1002;';

const layerPerspectivePanel = document.createElement('div');
layerPerspectivePanel.id = 'layer-perspective-panel';
layerPerspectivePanel.setAttribute('data-akari-interaction', '1');
layerPerspectivePanel.style.cssText = 'position:absolute;display:none;flex-direction:column;gap:6px;padding:8px;width:168px;box-sizing:border-box;border-radius:6px;border:1px solid #4da3ff;background:rgba(20,20,20,0.92);color:#cfe6ff;font-size:11px;pointer-events:auto;user-select:none;z-index:1003;';
const perspectivePresetsRow = document.createElement('div');
perspectivePresetsRow.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:4px;';
const PERSPECTIVE_PRESETS = [['right', '右奥'], ['left', '左奥'], ['top', '上奥'], ['bottom', '下奥']];
const layerPerspectivePresetButtons = PERSPECTIVE_PRESETS.map(([preset, label]) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.akariPerspectivePreset = preset;
  button.textContent = label;
  button.style.cssText = 'border:1px solid #4da3ff;border-radius:4px;background:rgba(255,255,255,0.06);color:#cfe6ff;font-size:11px;padding:4px 2px;cursor:pointer;';
  perspectivePresetsRow.appendChild(button);
  return button;
});
const perspectiveAngleRow = document.createElement('div');
perspectiveAngleRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
const perspectiveAngleLabel = document.createElement('span');
perspectiveAngleLabel.textContent = '角度';
const layerPerspectiveAngleInput = document.createElement('input');
layerPerspectiveAngleInput.type = 'range';
layerPerspectiveAngleInput.min = '0';
layerPerspectiveAngleInput.max = '75';
layerPerspectiveAngleInput.step = '1';
layerPerspectiveAngleInput.value = '30';
layerPerspectiveAngleInput.style.flex = '1';
const layerPerspectiveAngleValueEl = document.createElement('span');
layerPerspectiveAngleValueEl.textContent = '30°';
perspectiveAngleRow.append(perspectiveAngleLabel, layerPerspectiveAngleInput, layerPerspectiveAngleValueEl);
const layerPerspectiveClearButton = document.createElement('button');
layerPerspectiveClearButton.type = 'button';
layerPerspectiveClearButton.textContent = 'パースを解除';
layerPerspectiveClearButton.style.cssText = 'align-self:flex-end;border:none;background:none;color:#ff8a8a;font-size:11px;cursor:pointer;padding:2px 4px;';
layerPerspectivePanel.append(perspectivePresetsRow, perspectiveAngleRow, layerPerspectiveClearButton);

function positionLayerPerspectiveToggle(el) {
  if (!layerPerspectiveToggle.parentElement) layerContainer.appendChild(layerPerspectiveToggle);
  if (!layerPerspectivePanel.parentElement) layerContainer.appendChild(layerPerspectivePanel);
  if (!el) {
    layerPerspectiveToggle.style.display = 'none';
    if (perspectivePanelOpen) setPerspectivePanelOpen(false);
    return;
  }
  layerPerspectiveToggle.style.display = 'flex';
  layerPerspectiveToggle.style.alignItems = 'center';
  layerPerspectiveToggle.style.justifyContent = 'center';
  const box = cropModeActive ? layerCropBox : el;
  layerPerspectiveToggle.style.left = `${box.offsetLeft + box.offsetWidth + 4}px`;
  layerPerspectiveToggle.style.top = `${Math.max(4, box.offsetTop - 26) + 26 + 4}px`;
  if (perspectivePanelOpen) {
    layerPerspectivePanel.style.left = layerPerspectiveToggle.style.left;
    layerPerspectivePanel.style.top = `${parseFloat(layerPerspectiveToggle.style.top) + 26 + 4}px`;
  }
}

function layerPerspectiveNow(el) {
  const raw = el.dataset.layerPerspectiveCorners;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length === 4 ? parsed : null;
  } catch {
    return null;
  }
}

function applyLayerPerspectiveNow(el, corners) {
  if (corners) el.dataset.layerPerspectiveCorners = JSON.stringify(corners);
  else delete el.dataset.layerPerspectiveCorners;
  layerPerspectiveToggle.style.borderColor = corners ? '#ffb84d' : '#4da3ff';
  const transform = layerTransformOf(el);
  applyLayerLayout(el, transform.x, transform.y, transform.scale, transform.rotate);
}

// プリセット→4隅の展開（v0）。SSOT は保存される4隅のみ — このツマミはオーサリング側の便宜であり、
// schema には「プリセット」「角度」という概念自体は存在しない（shell 側と同一の式・
// contract-2026-08-02-preview-parity.md §2.4.4。意図的なコード重複）。
function perspectivePresetCorners(preset, angleDeg) {
  const compression = Math.max(0, Math.min(0.9, Math.sin((Number(angleDeg) || 0) * Math.PI / 180)));
  const half = compression / 2;
  if (preset === 'right') return [[0, 0], [1, half], [0, 1], [1, 1 - half]];
  if (preset === 'left') return [[0, half], [1, 0], [0, 1 - half], [1, 1]];
  if (preset === 'top') return [[half, 0], [1 - half, 0], [0, 1], [1, 1]];
  if (preset === 'bottom') return [[0, 0], [1, 0], [half, 1], [1 - half, 1]];
  return null;
}

async function commitLayerPerspective(el, corners) {
  const original = layerPerspectiveNow(el);
  applyLayerPerspectiveNow(el, corners);
  try {
    await layerWriteViaPut(el.dataset.layerId, { perspective: corners ? { corners } : null });
  } catch (err) {
    applyLayerPerspectiveNow(el, original);
    showMessage(String(err?.message || err));
  }
}

function setPerspectivePanelOpen(open) {
  perspectivePanelOpen = !!(open && selectedLayerId !== null);
  layerPerspectiveToggle.style.background = perspectivePanelOpen ? '#4da3ff' : 'rgba(20,20,20,0.85)';
  layerPerspectiveToggle.style.color = perspectivePanelOpen ? '#0b1a2a' : '#cfe6ff';
  layerPerspectivePanel.style.display = perspectivePanelOpen ? 'flex' : 'none';
  if (perspectivePanelOpen) {
    if (cropModeActive) setCropMode(false);
    updateLayerSelectBox();
  }
}
layerPerspectiveToggle.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  try { layerPerspectiveToggle.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
});
layerPerspectiveToggle.addEventListener('pointerup', (e) => {
  e.stopPropagation();
  setPerspectivePanelOpen(!perspectivePanelOpen);
});
for (const button of layerPerspectivePresetButtons) {
  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    try { button.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  });
  button.addEventListener('pointerup', (e) => {
    e.stopPropagation();
    if (selectedLayerId === null) return;
    const lv = layerVideos.find(v => v.layer.id === selectedLayerId);
    if (!lv) return;
    const preset = button.dataset.akariPerspectivePreset;
    activePerspectivePreset = preset;
    for (const other of layerPerspectivePresetButtons) {
      other.style.background = other === button ? '#4da3ff' : 'rgba(255,255,255,0.06)';
      other.style.color = other === button ? '#0b1a2a' : '#cfe6ff';
    }
    void commitLayerPerspective(lv.el, perspectivePresetCorners(preset, layerPerspectiveAngleInput.value));
  });
}
layerPerspectiveAngleInput.addEventListener('input', () => {
  layerPerspectiveAngleValueEl.textContent = `${layerPerspectiveAngleInput.value}°`;
  if (!activePerspectivePreset || selectedLayerId === null) return;
  const lv = layerVideos.find(v => v.layer.id === selectedLayerId);
  if (!lv) return;
  // ライブプレビューのみ（書き戻しはしない）— 既存の crop ハンドルと同じ「確定時のみ書き戻す」規律。
  applyLayerPerspectiveNow(lv.el, perspectivePresetCorners(activePerspectivePreset, layerPerspectiveAngleInput.value));
});
layerPerspectiveAngleInput.addEventListener('change', () => {
  if (!activePerspectivePreset || selectedLayerId === null) return;
  const lv = layerVideos.find(v => v.layer.id === selectedLayerId);
  if (!lv) return;
  void commitLayerPerspective(lv.el, perspectivePresetCorners(activePerspectivePreset, layerPerspectiveAngleInput.value));
});
layerPerspectiveClearButton.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  try { layerPerspectiveClearButton.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
});
layerPerspectiveClearButton.addEventListener('pointerup', (e) => {
  e.stopPropagation();
  if (selectedLayerId === null) return;
  const lv = layerVideos.find(v => v.layer.id === selectedLayerId);
  if (!lv) return;
  activePerspectivePreset = null;
  for (const button of layerPerspectivePresetButtons) {
    button.style.background = 'rgba(255,255,255,0.06)';
    button.style.color = '#cfe6ff';
  }
  void commitLayerPerspective(lv.el, null);
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && perspectivePanelOpen) setPerspectivePanelOpen(false);
});

// zoom 込みの実効倍率（表示 px / 論理出力 px）。frameScale 直参照だと zoom>1 でずれる
function layerEffectiveScale() {
  const os = outputSizePx();
  const rect = layerContainer.getBoundingClientRect();
  return rect.width > 0 ? rect.width / os.width : 1;
}

async function layerWriteViaPut(layerId, patch) {
  const res = await fetch('/api/summary');
  if (!res.ok) throw new Error(`edit.json を読めません: HTTP ${res.status}`);
  const edit = normalizeLegacyCutTransitions(await res.json());
  const layer = (edit.layers || []).find(l => String(l.id) === String(layerId));
  if (!layer) throw new Error(`素材が見つかりません: ${layerId}`);
  if (patch.transform) layer.transform = { ...layer.transform, ...patch.transform };
  if (patch.crop) layer.crop = { ...patch.crop };
  if (patch.perspective !== undefined) {
    // null = 明示的な解除（layer.perspective を削除。schema の「未指定=パース無し・
    // バイト等価」既定と揃える）。
    if (patch.perspective === null) delete layer.perspective;
    else layer.perspective = { corners: patch.perspective.corners.map(([x, y]) => [x, y]) };
  }
  const put = await fetch('/api/edit.json', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(editForPut(edit)),
  });
  if (!put.ok) {
    let detail = `HTTP ${put.status}`;
    try {
      const body = await put.json();
      if (body?.findings?.length) detail = body.findings[0].message || detail;
    } catch {}
    throw new Error(`書き戻しに失敗しました: ${detail}`);
  }
}

// 編集モード ON では #overlay-stage（pointer-events:auto・全面）がクリックを受けるため、
// レイヤー実体へのリスナーでは届かない。shell（CF-select）と同じく elementsFromPoint で
// スタックを貫通して当てる。断片・選択枠・字幕プレートが上にあるときはそちらを優先する
function findLayerHit(e) {
  for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
    if (el.hasAttribute && el.hasAttribute('data-akari-interaction')) return null; // 選択枠・ハンドル
    if (el.closest && el.closest('[data-overlay-id]')) return null; // 断片優先
    if (el.closest && el.closest('#caption-plate')) return null;
    if ((el.tagName === 'VIDEO' || el.tagName === 'IMG') && el.dataset && el.dataset.layerId && el.style.display !== 'none') {
      // 全面サイズの透明動画（ベイクテロップ）は箱で当てると画面全部が当たりになる。
      // クリック地点のアルファを実測し、透明部分は下のレイヤーへ素通しする
      if (layerAlphaAt(el, e.clientX, e.clientY) > 16) return el;
      continue;
    }
  }
  return null;
}

wrapper.addEventListener('pointerdown', (e) => {
  // ㉔ クロップモード中は移動と操作が衝突しないよう本編ボディのドラッグ選択/移動を止める
  // （ハンドル/トグルは別要素の専用リスナーが処理する。Esc/トグルクリックで抜けるまで無効）。
  if (penActive || e.button !== 0 || cropModeActive) return;
  // インタラクション UI 自体（選択枠・ハンドル・クロップトグル）へのクリックは、findLayerHit が
  // レイヤー本体ではないため null を返す — それを「背景クリック」と誤認して選択解除しないよう、
  // このキャプチャフェーズの時点で先に弾く（このリスナーは true=capture のため、トグル自身の
  // pointerdown ハンドラより先に実行される）。
  if (e.target && e.target.closest && e.target.closest('[data-akari-interaction]')) return;
  const el = findLayerHit(e);
  if (!el) {
    if (selectedLayerId !== null) setLayerSelected(null);
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  setLayerSelected(el.dataset.layerId);
  const scale = layerEffectiveScale();
  const startX = e.clientX;
  const startY = e.clientY;
  const baseX = Number(el.dataset.layerX) || 0;
  const baseY = Number(el.dataset.layerY) || 0;
  const baseScale = Number(el.dataset.layerScale) || 1;
  const baseRotate = Number(el.dataset.layerRotate) || 0;
  let moved = false;
  const apply = (x, y) => {
    applyLayerLayout(el, x, y, baseScale, baseRotate);
  };
  const detach = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
  };
  const onMove = (ev) => {
    if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) >= 3) moved = true;
    if (moved) {
      apply(baseX + (ev.clientX - startX) / scale, baseY + (ev.clientY - startY) / scale);
      updateLayerSelectBox();
    }
  };
  const onUp = async (ev) => {
    detach();
    if (!moved) return; // 動かしていなければクリック = 選択のみ
    const x = baseX + (ev.clientX - startX) / scale;
    const y = baseY + (ev.clientY - startY) / scale;
    el.dataset.layerX = String(x);
    el.dataset.layerY = String(y);
    try {
      await layerWriteViaPut(el.dataset.layerId, { transform: { x, y } });
    } catch (err) {
      el.dataset.layerX = String(baseX);
      el.dataset.layerY = String(baseY);
      apply(baseX, baseY);
      updateLayerSelectBox();
      showMessage(String(err?.message || err));
    }
  };
  const onCancel = () => {
    detach();
    apply(baseX, baseY);
    updateLayerSelectBox();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}, true);

// --- Pen annotation canvas (upgraded: glow + gradient + sparkle) ---
function setupPenCanvas() {
  // DPR クランプは shell と同じ正本値（PEN_TUNING.maxDevicePixelRatio）に従う。
  // 裏バッファは表示 px（出力フレーム矩形）基準 — CSS サイズは論理ステージの 100% で、
  // stage の scale(frameScale) を経て正味 dpr 密度になる（P1-2）。
  const dpr = Math.min(devicePixelRatio || 1, PEN_TUNING.maxDevicePixelRatio);
  const rect = computeOutputFrameRect();
  penCanvas.width = Math.max(1, Math.round(rect.width * dpr));
  penCanvas.height = Math.max(1, Math.round(rect.height * dpr));
  penCanvas.style.width = '100%';
  penCanvas.style.height = '100%';
  rebuildPlatinumGradient();
}
let penCtx = penCanvas.getContext('2d');
let platinumGradient = null;
let penCurrentStroke = null;
let penFadingStrokes = [];
let penSparkles = [];
let penGlowSprite = null;
let penSparkleSprite = null;
let penAnimHandle = 0;

// PEN_TUNING / スプライト生成は pen-visuals.bundle.js（単一正本）から import する。

function rebuildPlatinumGradient() {
  const w = penCanvas.width, h = penCanvas.height;
  platinumGradient = (w > 0 && h > 0) ? createPlatinumGradient(penCtx, w, h) : null;
}

function drawPenSegment(ctx, from, to) {
  drawPenSegmentShared(
    ctx, penGlowSprite, platinumGradient,
    [from.x, from.y], [to.x, to.y],
    penCanvas.width, penCanvas.height
  );
}

function spawnPenSparkles(point) {
  const w = penCanvas.width, h = penCanvas.height;
  for (let i = 0; i < PEN_TUNING.sparklesPerSegment; i++) {
    if (penSparkles.length >= PEN_TUNING.sparkleMaxPoolSize) penSparkles.shift();
    const angle = Math.random() * Math.PI * 2;
    const jitter = Math.random() * PEN_TUNING.sparkleJitterPx;
    penSparkles.push({
      x: point.x * w + Math.cos(angle) * jitter,
      y: point.y * h + Math.sin(angle) * jitter,
      bornAt: performance.now(),
      lifetimeMs: PEN_TUNING.sparkleLifetimeMs * (0.6 + Math.random() * 0.8),
      size: PEN_TUNING.sparkleMinSizePx + Math.random() * (PEN_TUNING.sparkleMaxSizePx - PEN_TUNING.sparkleMinSizePx),
      phase: Math.random() * Math.PI * 2
    });
  }
}

function drawPenSparkles(ctx, timestamp) {
  if (!penSparkles.length) return;
  const alive = [];
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const s of penSparkles) {
    const age = timestamp - s.bornAt;
    if (age >= s.lifetimeMs) continue;
    const fade = 1 - age / s.lifetimeMs;
    const twinkle = 0.6 + 0.4 * Math.sin((timestamp / 1000) * PEN_TUNING.sparkleTwinkleHz * Math.PI * 2 + s.phase);
    ctx.globalAlpha = Math.max(0, Math.min(1, fade * twinkle));
    const size = s.size * (0.7 + 0.3 * fade);
    ctx.drawImage(penSparkleSprite, s.x - size / 2, s.y - size / 2, size, size);
    alive.push(s);
  }
  ctx.restore();
  penSparkles = alive;
}

function penFadeAlpha(fading, timestamp) {
  const now = timestamp || performance.now();
  return Math.max(0, Math.min(1, 1 - (now - fading.fadeStartedAt) / PEN_TUNING.fadeDurationMs));
}

function penRecomposite(timestamp) {
  const w = penCanvas.width, h = penCanvas.height;
  if (!(w > 0) || !(h > 0)) return;
  penCtx.clearRect(0, 0, w, h);
  for (const fading of penFadingStrokes) {
    penCtx.globalAlpha = penFadeAlpha(fading, timestamp);
    drawPenStrokePoints(fading);
  }
  penCtx.globalAlpha = 1;
  if (penCurrentStroke) drawPenStrokePoints(penCurrentStroke);
  drawPenSparkles(penCtx, timestamp || performance.now());
}

function drawPenStrokePoints(stroke) {
  const pts = stroke.points;
  if (pts.length < 2) return;
  let i = stroke.drawnIndex || 0;
  while (i < pts.length - 1) {
    drawPenSegment(penCtx, pts[i], pts[i + 1]);
    spawnPenSparkles(pts[i + 1]);
    i++;
  }
  stroke.drawnIndex = i;
}

function penTick(timestamp) {
  if (penCurrentStroke) drawPenStrokePoints(penCurrentStroke);
  penFadingStrokes = penFadingStrokes.filter(f => penFadeAlpha(f, timestamp) > 0);
  penRecomposite(timestamp);
  const stillActive = penCurrentStroke !== null || penFadingStrokes.length > 0 || penSparkles.length > 0;
  penAnimHandle = stillActive ? requestAnimationFrame(penTick) : 0;
}

function ensurePenLoop() {
  if (!penAnimHandle) penAnimHandle = requestAnimationFrame(penTick);
}

function initPenSprites() {
  if (!penGlowSprite) penGlowSprite = createGlowSprite(Math.max(64, PEN_TUNING.glowSizePx * 3));
  if (!penSparkleSprite) penSparkleSprite = createSparkleSprite(Math.max(48, PEN_TUNING.sparkleSpritePx * 3));
}

// Pointer event handling for pen drawing
function getPenPoint(e) {
  // ビデオ枠（= 論理ステージの表示矩形）基準で正規化する。ペイン全体（zoomLayer）基準だと
  // レターボックス時に描画位置がずれる（P1-2）。getBoundingClientRect はズーム変換も織り込む
  const rect = stage.getBoundingClientRect();
  return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
}
function onPenPointerDown(e) {
  if (!penActive) return;
  penCurrentStroke = { points: [getPenPoint(e)], drawnIndex: 0 };
  e.preventDefault();
}
function onPenPointerMove(e) {
  if (!penActive || !penCurrentStroke) return;
  penCurrentStroke.points.push(getPenPoint(e));
  ensurePenLoop();
  e.preventDefault();
}
function onPenPointerUp(e) {
  if (!penCurrentStroke) return;
  penCurrentStroke.fadeStartedAt = performance.now();
  penFadingStrokes.push(penCurrentStroke);
  penCurrentStroke = null;
  ensurePenLoop();
  e.preventDefault();
}

function penEnable(enabled) {
  penActive = enabled;
  penCanvas.style.pointerEvents = enabled ? 'auto' : 'none';
  document.body.style.cursor = enabled ? 'crosshair' : '';
  if (!enabled && !penCurrentStroke) return;
  if (!enabled && penCurrentStroke) {
    penCurrentStroke.fadeStartedAt = performance.now();
    penFadingStrokes.push(penCurrentStroke);
    penCurrentStroke = null;
    ensurePenLoop();
  }
}

// --- Minimap ---
function setupMinimap() {
  if (!summary?.cuts?.length) return;
  minimapVideo.src = video.src;
}
function updateMinimap() {
  if (zoom <= 1) { minimap.hidden = true; return; }
  minimap.hidden = false;
  const vw = minimap.clientWidth;
  const vh = minimap.clientHeight;
  const vpW = vw / zoom;
  const vpH = vh / zoom;
  const cx = vw / 2 + pan.x / (zoomLayer.clientWidth / vw);
  const cy = vh / 2 + pan.y / (zoomLayer.clientHeight / vh);
  minimapViewport.style.width = `${vpW}px`;
  minimapViewport.style.height = `${vpH}px`;
  minimapViewport.style.left = `${cx - vpW / 2}px`;
  minimapViewport.style.top = `${cy - vpH / 2}px`;
}

// --- Audio graph ---
function setupAudioGraph() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  }

  // MediaElementSource は同じ <video> に 1 回だけ生成できる。soft reload でも AudioContext と
  // この経路は閉じずに保持し、タイムライン依存の BGM / narration / SFX だけを組み直す。
  if (!baseAudioSource) {
    try {
      baseAudioSource = audioCtx.createMediaElementSource(video);
      baseAudioTransitionGain = audioCtx.createGain();
      baseAudioDeClickGain = audioCtx.createGain();
      baseAudioSource.connect(baseAudioTransitionGain);
      baseAudioTransitionGain.connect(baseAudioDeClickGain);
      baseAudioDeClickGain.connect(audioCtx.destination);
      baseAudioDeClick = createAudioDeClickController({ audioContext: audioCtx, gainNode: baseAudioDeClickGain });

      // video.volume / video.muted は MediaElementAudioSourceNode の入力へ反映されるため、
      // 音量 UI が media element を操作する従来の契約は二重ゲインにせず、そのまま維持する。
      window.akari = window.akari || {};
      window.akari.baseAudioDebug = {
        context: audioCtx,
        mediaSource: baseAudioSource,
        outputNode: baseAudioDeClickGain,
      };
    } catch (error) {
      console.warn('[preview] base audio graph setup failed', error);
    }
  }

  const audio = summary?.audio;
  if (!audio) return;
  if (audio.bgm) {
    const bgmUrl = audio.bgm.src || resolveMediaUrl(audio.bgm.path);
    if (bgmUrl) {
      const gain = audioCtx.createGain();
      gain.gain.value = dbToGain(audio.bgm.gainDb ?? audio.bgm.gain_db ?? 0);
      gain.connect(audioCtx.destination);
      bgmNode = gain;
      loadAudioBuffer(bgmUrl).then((buf) => {
        if (!buf || bgmNode !== gain) return;
        // ソースはここでは作らない。BufferSource は start 後に位置を動かせないので、
        // 「今の outputTime に対応する位置」で毎回作り直す（restartBgm）。
        bgmNode._buffer = buf;
        if (isPlaying) restartBgm(outputTime);
      });
    }
  }
  if (Array.isArray(audio.narration)) {
    for (const n of audio.narration) {
      const nUrl = n.src || resolveMediaUrl(n.path);
      if (!nUrl) continue;
      const gain = audioCtx.createGain();
      gain.gain.value = dbToGain(n.gainDb ?? 0);
      gain.connect(audioCtx.destination);
      const node = { gain, src: nUrl, t: n.t ?? 0 };
      narrationNodes.push(node);
      loadAudioBuffer(nUrl).then((buf) => { node._buffer = buf; });
    }
  }
  if (Array.isArray(audio.sfx)) {
    for (const s of audio.sfx) {
      const sUrl = s.src || resolveMediaUrl(s.path);
      if (!sUrl) continue;
      const gain = audioCtx.createGain();
      gain.gain.value = dbToGain(s.gainDb ?? 0);
      gain.connect(audioCtx.destination);
      // fade_in/fade_out (audio-clip-fades, 2026-08-18): edit.json spells these snake_case
      // (distinct from audio.bgm.fadeIn/fadeOut's camelCase) -- see docs/contract-2026-07-25-r6-
      // audio-tracks-and-trim.md §2 addendum. Read straight off the raw `s` item, matching how
      // this function reads every other raw sfx field.
      const node = { gain, src: sUrl, t: s.t ?? 0, gainDb: s.gainDb, fadeIn: s.fade_in, fadeOut: s.fade_out };
      sfxNodes.push(node);
      loadAudioBuffer(sUrl).then((buf) => { node._buffer = buf; });
    }
  }
}
function dbToGain(db) { return Math.pow(10, (db ?? 0) / 20); }

function teardownTimelineAudioGraph() {
  if (bgmNode?._source) {
    try { bgmNode._source.stop(); } catch { /* already stopped */ }
  }
  if (bgmNode) try { bgmNode.disconnect(); } catch { /* already detached */ }
  for (const node of [...narrationNodes, ...sfxNodes]) {
    if (node._source) try { node._source.stop(); } catch { /* already stopped */ }
    try { node.gain.disconnect(); } catch { /* already detached */ }
  }
  bgmNode = null;
  narrationNodes = [];
  sfxNodes = [];
}

function transitionAudioBoundaries() {
  const cuts = summary?.cuts ?? [];
  return segments.flatMap((segment) => {
    if (segment.isGap || segment.index < 0) return [];
    const transition = cuts[segment.index]?.transition_out;
    return transition ? [{ at: segment.outEnd, duration: transition.duration }] : [];
  });
}

function updateBaseAudioTransition(t) {
  if (!audioCtx || !baseAudioTransitionGain) return;
  const target = transitionApproximationGain(t, transitionAudioBoundaries());
  const param = baseAudioTransitionGain.gain;
  const now = audioCtx.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  // rAF の段階変化自体が新しいクリックにならないよう、短い補間で目標へ追従する。
  param.linearRampToValueAtTime(target, now + 0.004);
}

function requestBaseVideoSeek(src, target) {
  const apply = () => {
    const sourceChanged = !isSameVideoSource(video, src);
    let expectedSource = src;
    try { expectedSource = new URL(src, document.baseURI).href; } catch { /* use src as-is */ }
    // Listeners must exist before src/currentTime is assigned: local files can
    // complete quickly enough for loadeddata/seeked to race subsequent setup.
    const ready = waitForMediaSeekCompletion({
      mediaElement: video,
      sourceChanged,
      target,
      expectedSource,
    });
    setVideoSourceIfChanged(video, src);
    video.currentTime = target;
    if (isPlaying) ensureMediaPlaying(video, true);
    else finishPausingPlayback();
    return ready;
  };
  if (!baseAudioDeClick) { apply(); return true; }
  return baseAudioDeClick.request(apply);
}

function syncBaseVideoTime(src, target, tolerance) {
  const sourceChanged = !isSameVideoSource(video, src);
  if (!sourceChanged && (video.seeking || Math.abs(video.currentTime - target) <= tolerance)) return false;
  return requestBaseVideoSeek(src, target);
}

// 効果音は「同じファイルを何十回も差し込む」使い方が普通で、差し込み 1 件ごとに
// fetch + decode すると回数ぶんの重複ロードになる（実測 fieldtest/2026-08-03-akari-video-beat-pv:
// 差し込み 159 件 / ユニーク 37 本 = 68.5MB のところ 17.1MB で足りる）。この重複が
// <video> のレンジ要求とコネクションを食い合い、読み込み中スピナーが点きっぱなしになる。
// URL 単位で 1 回に畳む。AudioBuffer は複数の BufferSource から同時に使ってよい（仕様）ので
// 差し込みごとに別バッファを持つ必要はなく、デコード済み PCM のメモリも 1/4 以下になる。
// キーに sampleRate を混ぜる: 通常の soft reload は MediaElementSource を守るため AudioContext を
// 保持するが、将来 context の作り直し経路が加わっても、decodeAudioData が context のレートへ
// リサンプルするという条件をキャッシュキーから失わないようにする。
const audioBufferCache = new Map(); // `${sampleRate}|${url}` -> Promise<AudioBuffer | null>
// 同時 fetch の上限。HTTP/1.1 の同一オリジン 6 本を音声で埋めると <video> の
// バッファリングが待たされて waiting → スピナーになるため、必ず空きを残す。
const AUDIO_FETCH_CONCURRENCY = 3;
let audioFetchActive = 0;
const audioFetchQueue = [];
function withAudioFetchSlot(task) {
  return new Promise((resolve) => {
    const run = async () => {
      audioFetchActive++;
      let out = null;
      try { out = await task(); } catch { out = null; }
      audioFetchActive--;
      const next = audioFetchQueue.shift();
      if (next) next();
      resolve(out);
    };
    if (audioFetchActive < AUDIO_FETCH_CONCURRENCY) run();
    else audioFetchQueue.push(run);
  });
}
async function decodeAudioFrom(url, expectedSampleRate = null) {
  const r = await fetch(url);
  if (!r.ok) return null;
  const bytes = await r.arrayBuffer();
  // 順番待ちの間にホットリロードで context が差し替わっていることがある。閉じた context の
  // decodeAudioData は InvalidStateError で落ちるので、実行時点で生きているものを使う。
  const ctx = audioCtx;
  if (!ctx || ctx.state === 'closed') return null;
  if (expectedSampleRate !== null && ctx.sampleRate !== expectedSampleRate) return null;
  return await ctx.decodeAudioData(bytes);
}
// 再生に使うバッファ（BGM / ナレーション / 効果音）。保持して使い回す。
function loadAudioBuffer(url) {
  if (!audioCtx || !url) return Promise.resolve(null);
  const rate = audioCtx.sampleRate;
  const key = `${rate}|${url}`;
  let p = audioBufferCache.get(key);
  if (!p) {
    p = withAudioFetchSlot(() => decodeAudioFrom(url, rate)).then((buf) => {
      // 失敗をキャッシュすると以後ずっと無音のままになる。取り直せるよう捨てる
      if (!buf) audioBufferCache.delete(key);
      return buf;
    });
    audioBufferCache.set(key, p);
  }
  return p;
}
// BGM を「今の出力時刻に対応する位置」で鳴らし直す。
// AudioBufferSourceNode は start 後に再生位置を動かせないため、シークのたびに作り直すしかない。
// 旧実装は play() で一度だけ offset 無しの start() を撃ち、以後シークしても何もしなかったので、
// 0:00 から通しで再生した時だけ偶然合っていて、ジャンプすると必ずズレていた（実機報告 2026-08-07）。
function restartBgm(t) {
  if (!audioCtx || !bgmNode) return;
  if (bgmNode._source) {
    try { bgmNode._source.stop(); } catch { /* 未 start / 既 stop */ }
    try { bgmNode._source.disconnect(); } catch { /* already detached */ }
    bgmNode._source = null;
  }
  const buf = bgmNode._buffer;
  if (!buf || !isPlaying) return;
  const bgm = summary?.audio?.bgm || {};
  // t: タイムライン上の開始秒 / in: 素材内の開始オフセット（波形側と同じ読み方）
  const startAt = Number.isFinite(Number(bgm.t)) && Number(bgm.t) > 0 ? Number(bgm.t) : 0;
  const sourceIn = Number.isFinite(Number(bgm.in)) && Number(bgm.in) > 0 ? Number(bgm.in) : 0;
  if (t < startAt) return;
  const loop = bgm.loop !== false;
  const dur = buf.duration;
  if (!(dur > 0)) return;
  let offset = sourceIn + (t - startAt);
  if (loop) offset %= dur;
  else if (offset >= dur) return;
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.loop = loop;
  src.connect(bgmNode);
  src.start(0, Math.max(0, offset));
  bgmNode._source = src;
}

// シーク先の音に組み替える。ナレーション / 効果音は syncAudio が
// 「鳴っていないなら t に応じた offset で鳴らす」ので、鳴りっぱなしのソースを畳んで再武装させる。
function resyncAudioAfterSeek(t) {
  if (!audioCtx) return;
  for (const n of [...narrationNodes, ...sfxNodes]) {
    if (n._source) { try { n._source.stop(); } catch { /* noop */ } n._source = null; }
  }
  restartBgm(t);
}

function syncAudio(t) {
  if (!audioCtx) return;
  if (isPlaying) for (const n of narrationNodes) {
    if (!n._buffer) continue;
    const should = t >= n.t && t < n.t + n._buffer.duration;
    if (should && (!n._source || n._source._ended)) {
      if (n._source) try { n._source.stop(); } catch {}
      const src = audioCtx.createBufferSource();
      src.buffer = n._buffer; src.connect(n.gain);
      src.start(0, Math.max(0, t - n.t));
      src._ended = false; src.onended = () => { src._ended = true; };
      n._source = src;
    }
  }
  if (isPlaying) for (const s of sfxNodes) {
    if (!s._buffer) continue;
    const should = t >= s.t && t < s.t + s._buffer.duration;
    if (should && (!s._source || s._source._ended)) {
      if (s._source) try { s._source.stop(); } catch {}
      const src = audioCtx.createBufferSource();
      src.buffer = s._buffer; src.connect(s.gain);
      src.start(0, Math.max(0, t - s.t));
      src._ended = false; src.onended = () => { src._ended = true; };
      s._source = src;
    }
    if (should) {
      // sfx fade_in/fade_out (audio-clip-fades, 2026-08-18): same per-tick multiplier shape as
      // BGM's fadeIn/fadeOut below, computed against this clip's own [t, t+clipDuration) window.
      // clipDuration is the full decoded buffer -- this preview engine doesn't apply audio.sfx[].
      // in/out trim yet (a pre-existing gap, not this task's scope), so it matches what's actually
      // played here rather than a possibly-untrimmed edit.json in/out window.
      const clipDuration = s._buffer.duration;
      const sfxFadeIn = Number.isFinite(s.fadeIn) && s.fadeIn > 0 ? Math.min(s.fadeIn, clipDuration / 2) : 0;
      const sfxFadeOut = Number.isFinite(s.fadeOut) && s.fadeOut > 0 ? Math.min(s.fadeOut, clipDuration / 2) : 0;
      const localT = t - s.t;
      let sfxFadeMul = 1;
      if (sfxFadeIn > 0 && localT < sfxFadeIn) sfxFadeMul = Math.min(sfxFadeMul, localT / sfxFadeIn);
      if (sfxFadeOut > 0 && localT > clipDuration - sfxFadeOut) sfxFadeMul = Math.min(sfxFadeMul, (clipDuration - localT) / sfxFadeOut);
      s.gain.gain.value = dbToGain(s.gainDb ?? 0) * sfxFadeMul;
    }
  }
  // BGM ducking + fade in/out
  if (bgmNode) {
    const audio = summary?.audio;
    const ducking = audio?.bgm?.ducking === true;
    const hasNarration = narrationNodes.some(n => n._buffer && t >= n.t && t < n.t + n._buffer.duration);
    const duckDb = ducking && hasNarration ? -12 : 0;
    const fadeIn = Number.isFinite(audio?.bgm?.fadeIn) && audio.bgm.fadeIn > 0 ? Math.min(audio.bgm.fadeIn, totalDuration / 2) : 0;
    const fadeOut = Number.isFinite(audio?.bgm?.fadeOut) && audio.bgm.fadeOut > 0 ? Math.min(audio.bgm.fadeOut, totalDuration / 2) : 0;
    let fadeMul = 1;
    if (fadeIn > 0 && t < fadeIn) fadeMul = Math.min(fadeMul, t / fadeIn);
    if (fadeOut > 0 && t > totalDuration - fadeOut) fadeMul = Math.min(fadeMul, (totalDuration - t) / fadeOut);
    const baseGain = dbToGain(audio?.bgm?.gainDb ?? 0);
    const targetGain = baseGain * Math.pow(10, duckDb / 20) * fadeMul;
    bgmNode.gain.value = targetGain;
  }
}

// --- Waveform ---
// 波形は「同じ URL・同じ本数」なら結果が変わらない。パネルを開き直すたびに
// 全効果音を落とし直していた（実測 159 リクエスト/回）ので、ピークを URL 単位で覚える。
const peaksCache = new Map(); // `${url}|${numPeaks}` -> { peaks, duration }
// retain: 再生にも使う音（BGM / ナレーション / 効果音）は audioBufferCache と同じ
// デコード済みバッファを共有する。false のときは波形専用（本編動画）なので、
// 巨大な PCM を抱え続けないようピーク算出後に捨てる。
async function computePeaks(url, numPeaks, { retain = true } = {}) {
  if (!url || !audioCtx) return null;
  const key = `${url}|${numPeaks || 200}`;
  const hit = peaksCache.get(key);
  // 呼び出し側は戻り値に t / color を書き込むため、キャッシュ実体は渡さず毎回包み直す
  if (hit) return { peaks: hit.peaks, duration: hit.duration };
  try {
    const buf = retain
      ? await loadAudioBuffer(url)
      : await withAudioFetchSlot(() => decodeAudioFrom(url));
    if (!buf) return null;
    const ch = buf.getChannelData(0);
    const pn = Math.min(numPeaks || 200, ch.length);
    const spp = Math.max(1, Math.floor(ch.length / pn));
    const peaks = [];
    for (let i = 0; i < pn; i++) {
      let max = 0;
      for (let j = 0; j < spp && i * spp + j < ch.length; j++) max = Math.max(max, Math.abs(ch[i * spp + j]));
      peaks.push(max);
    }
    peaksCache.set(key, { peaks, duration: buf.duration });
    return { peaks, duration: buf.duration };
  } catch { return null; }
}
// パネルを素早く開閉すると多重に走って同じ URL を並行で取りに行くため、実行中は 1 本に畳む
let waveformSetupInFlight = null;
function setupWaveform() {
  if (waveformSetupInFlight) return waveformSetupInFlight;
  waveformSetupInFlight = buildWaveform()
    .catch((e) => { console.warn('[preview] waveform build failed', e); })
    .finally(() => { waveformSetupInFlight = null; });
  return waveformSetupInFlight;
}
async function buildWaveform() {
  // init 完走前にパネルを開かれると timelineData がまだ null。ここで空振りしても、
  // init の末尾が「開いていれば組み直す」ので取りこぼさない。
  if (!timelineData?.clips?.length || !audioCtx) return;
  waveformCanvas.width = waveformCanvas.clientWidth * devicePixelRatio;
  waveformCanvas.height = waveformCanvas.clientHeight * devicePixelRatio;
  const main = await computePeaks(timelineData.clips[0].src, 400, { retain: false });
  if (main) { waveformPeaks = main.peaks; waveformDuration = main.duration; }
  trackWaveforms = { bgm: null, narration: null, sfx: null };
  const audio = summary?.audio;
  const bgmUrl = audio?.bgm?.src || resolveMediaUrl(audio?.bgm?.path);
  if (bgmUrl) {
    const t = await computePeaks(bgmUrl, 200);
    if (t) { t.color = TRACK_COLORS.bgm; t.t = audio.bgm.t ?? 0; trackWaveforms.bgm = t; }
  }
  if (Array.isArray(audio?.narration)) {
    const all = [];
    for (const n of audio.narration) {
      const nUrl = n.src || resolveMediaUrl(n.path);
      if (!nUrl) continue;
      const t = await computePeaks(nUrl, 80);
      if (t) { t.t = n.t ?? 0; all.push(t); }
    }
    if (all.length) trackWaveforms.narration = { segments: all, color: TRACK_COLORS.narration };
  }
  if (Array.isArray(audio?.sfx)) {
    const all = [];
    for (const s of audio.sfx) {
      const sUrl = s.src || resolveMediaUrl(s.path);
      if (!sUrl) continue;
      const t = await computePeaks(sUrl, 60);
      if (t) { t.t = s.t ?? 0; all.push(t); }
    }
    if (all.length) trackWaveforms.sfx = { segments: all, color: TRACK_COLORS.sfx };
  }
  for (const [name, canvas] of Object.entries(trackCanvases)) {
    if (!canvas) continue;
    const track = trackWaveforms[name];
    const tr = canvas.closest('.waveform-track');
    if (track) {
      canvas.width = canvas.clientWidth * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;
      if (tr) tr.hidden = false;
    } else {
      if (tr) tr.hidden = true;
    }
  }
  drawWaveform(0);
  drawTrackWaveforms(0);
}
function drawTrackWaveforms(ratio) {
  for (const [name, canvas] of Object.entries(trackCanvases)) {
    if (!canvas || !canvas.width) continue;
    const track = trackWaveforms[name];
    if (!track) continue;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (track.segments) {
      for (const seg of track.segments) {
        if (!seg.peaks) continue;
        const sx = ((seg.t ?? 0) / totalDuration) * w;
        const sw = (seg.duration / totalDuration) * w;
        ctx.fillStyle = track.color;
        for (let i = 0; i < seg.peaks.length; i++) {
          const bH = Math.max(1, seg.peaks[i] * (h - 4));
          ctx.fillRect(sx + (i / seg.peaks.length) * sw, (h - bH) / 2, Math.max(1, sw / seg.peaks.length - 0.5), bH);
        }
      }
    } else if (track.peaks) {
      const sx = ((track.t ?? 0) / totalDuration) * w;
      const sw = (track.duration / totalDuration) * w;
      const barW = sw / track.peaks.length;
      ctx.fillStyle = track.color;
      for (let i = 0; i < track.peaks.length; i++) {
        const bH = Math.max(1, track.peaks[i] * (h - 4));
        ctx.fillRect(sx + i * barW, (h - bH) / 2, Math.max(1, barW - 0.5), bH);
      }
    }
    if (ratio > 0) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(ratio * w - 0.5, 0, 1, h); }
  }
}
function drawWaveform(ratio) {
  const ctx = waveformCanvas.getContext('2d');
  const w = waveformCanvas.width, h = waveformCanvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!waveformPeaks) return;
  const barW = w / waveformPeaks.length, mid = h / 2;
  ctx.fillStyle = '#888';
  for (let i = 0; i < waveformPeaks.length; i++) {
    const bH = Math.max(1, waveformPeaks[i] * (h - 4));
    ctx.fillRect(i * barW, mid - bH / 2, Math.max(1, barW - 0.5), bH);
  }
  if (ratio > 0) { ctx.fillStyle = '#fff'; ctx.fillRect(ratio * w - 0.5, 0, 1, h); }
}

// Waveform click-to-seek
waveformCanvas.addEventListener('pointerdown', (e) => {
  if (!waveformPeaks || totalDuration <= 0) return;
  const rect = waveformCanvas.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const w = isPlaying; if (w) pause();
  seekTo(ratio * totalDuration);
});

function scheduleTransitions() { transitionPlate.style.transition = 'opacity 0.3s'; }

function getVideoTimeForOutput(t) {
  // gap 上は -1（呼び出し側の vt >= 0 ガードで video シークを抑止）。
  const mapped = outputToSource(sharedSegmentsView(), t);
  return mapped.sourceT === null ? -1 : mapped.sourceT;
}
function getActiveSegment(t) {
  const mapped = outputToSource(sharedSegmentsView(), t);
  if (!mapped.segment) return null;
  return segments[sharedSegmentsView().indexOf(mapped.segment)] ?? null;
}
// outputToSource（共有カーネル）が期待する形へ、旧フィールドの segments から復元する。
let _sharedView = { source: null, view: [] };
function sharedSegmentsView() {
  if (_sharedView.source === segments) return _sharedView.view;
  _sharedView = {
    source: segments,
    view: segments.map(seg => seg.isGap
      ? { kind: 'gap', outStart: seg.outStart, outEnd: seg.outEnd, cutIndex: null }
      : {
          kind: 'src', outStart: seg.outStart, outEnd: seg.outEnd, cutIndex: seg.index,
          in: seg.inSec, out: seg.outSec, speed: seg.speed
        })
  };
  return _sharedView.view;
}

// cuts[].transform/opacity は render-cut が既に適用しており、プレビューにも必要。framing は
// 左上基準、transform の scale/rotate は中央基準なので cut-transform-visual.js で合成する。
function playedCutLocalSeconds(seg) {
  if (!seg || seg.isGap) return 0;
  // 静止画区間は video.currentTime を進めない（画像はシークしないため）ので、代わりに
  // マスタークロック outputTime からカット内経過秒を直接出す。
  if (isStillImageCutSegment(seg)) return outputTime - seg.outStart;
  const speed = seg.speed > 0 ? seg.speed : 1;
  return ((video.currentTime || 0) - seg.inSec) / speed;
}
function applyCutFramingVisual() {
  const seg = getActiveSegment(outputTime);
  const cut = seg && !seg.isGap ? seg : null;
  const framingVisual = computeCutFramingVisual(cut ? cut.framing : null, playedCutLocalSeconds(seg));
  const os = outputSizePx();
  const composed = composeCutVisualStyle({
    framingVisual,
    transform: cut ? cut.transform : null,
    opacity: cut ? cut.opacity : null,
    outputWidth: os.width,
    outputHeight: os.height,
  });
  // 現在表示中のほう（video/img）にだけ適用しても見た目は変わらないが、切替の瞬間に古いスタイルが
  // 一瞬見えることがないよう両方へ同じ値を書く（隠れている側のスタイルは無害）。
  for (const el of [video, img]) {
    el.style.transformOrigin = composed.transformOrigin;
    el.style.transform = composed.transform;
    el.style.opacity = composed.opacity;
  }
}

// cuts[].freeze の一時停止ホールド（近似実装。尺は伸ばさない -- contract-2026-08-02-preview-parity.md
// §2.4.3）。pause()/play() の既存一時停止・再開ロジックを直接呼ばず、isPlaying/playToggle UI や
// logReviewEvent には触れない小さなサブセットとして独立させている（フリーズはユーザー操作ではない）。
function pauseAllPlaybackForFreeze() {
  video.pause();
  for (const n of [...narrationNodes, ...sfxNodes]) {
    if (n._source) { try { n._source.stop(); } catch {} n._source = null; }
  }
  if (audioCtx?.state === 'running') audioCtx.suspend();
  for (const lv of layerVideos) lv.el.pause();
}
function resumeAllPlaybackForFreeze() {
  // 静止画区間では <video> を再生してはいけない（隠れているだけで、再生すると古いカットの
  // 音声が MediaElementAudioSourceNode 経由で漏れる）。
  if (video.paused && !isStillImageCutSegment(getActiveSegment(outputTime))) video.play();
  if (audioCtx?.state === 'suspended') audioCtx.resume();
  for (const lv of layerVideos) if (lv.visible) lv.el.play();
}

function seekTo(t) {
  cutInfoPopup.hidden = true;
  // フリーズホールドはシーク（=カットが変わりうる操作）で必ず打ち切る（contract-2026-08-02-preview-
  // parity.md §2.4.3）。古い holdSeconds タイマーが新しい位置の再生を誤って一時停止させるのを防ぐ。
  freezeHoldUntilMs = 0;
  freezeHoldConsumedForCutIndex = null;
  const prev = outputTime;
  outputTime = Math.max(0, Math.min(t, totalDuration));
  if (Math.abs(outputTime - prev) > 0.05) logReviewEvent('seek', { from: +prev.toFixed(3), to: +outputTime.toFixed(3) });
  const vt = getVideoTimeForOutput(outputTime);
  if (vt >= 0) {
    const seg = getActiveSegment(outputTime);
    if (seg && seg.index >= 0) {
      if (isStillImageCutSegment(seg)) {
        // 静止画には currentTime シークの概念が無い。src を合わせて表示を切り替えるだけでよい。
        showStillImageForSegment(seg);
      } else {
        // 音量をゼロへランプしてから source/currentTime を変え、切替後に戻す。ユーザー操作の
        // シークもカット境界と同じ経路を通すことで、不連続なサンプルを直接 destination へ出さない。
        showVideoBase();
        requestBaseVideoSeek(getVideoSource(seg.index), vt);
      }
    }
  }
  seek.value = outputTime;
  updateTimeLabel();
  updateStatusBar();
  updateCaption();
  syncCaptionAnimations();
  updateOverlays();
  // 一時停止中のシークでもトランジション帯を反映する（P2-1）
  updateTransitions();
  // 音はシーク先へ組み替える（BGM は作り直し、ナレーション / 効果音は再武装）。
  // これを挟まないと、鳴っている音が古い位置のまま流れ続けてズレる
  resyncAudioAfterSeek(outputTime);
  syncAudio(outputTime);
  syncLayers(outputTime);
  applyCutFramingVisual();
  cutFx.update();
}

function play() {
  if (isPlaying || !segments.length) return;
  logReviewEvent('play');
  isPlaying = true;
  lastWallMs = 0;
  if (audioCtx?.state === 'suspended') audioCtx.resume();
  // 静止画区間の開始位置から再生を始めるときは <video> を動かさない（隠れたまま古い映像の
  // 音声が漏れるのを防ぐ -- resumeAllPlaybackForFreeze と同じ理由）。
  const onStillImage = isStillImageCutSegment(getActiveSegment(outputTime));
  if (!onStillImage && baseAudioDeClick?.pending) {
    baseAudioDeClick.request(() => ensureMediaPlaying(video, isPlaying));
  }
  // 再生開始位置の BGM を組む（一時停止からの再開も含め、必ず今の outputTime に合わせる）
  restartBgm(outputTime);
  syncAudio(outputTime);
  if (!onStillImage) video.play();
  for (const lv of layerVideos) if (lv.visible) lv.el.play();
  playToggle.innerHTML = pauseIcon;
  playToggle.setAttribute('aria-label', '一時停止');
  playToggle.title = '一時停止';
  requestAnimationFrame(playbackLoop);
}

function finishPausingPlayback() {
  video.pause();
  for (const n of [...narrationNodes, ...sfxNodes]) {
    if (n._source) { try { n._source.stop(); } catch {} n._source = null; }
  }
  if (audioCtx?.state === 'running') audioCtx.suspend();
  for (const lv of layerVideos) lv.el.pause();
}

function pause() {
  if (!isPlaying) return;
  logReviewEvent('pause');
  // 手動一時停止はフリーズホールドを打ち切る（保留中タイマーを引きずったまま次の再開で
  // 誤って再一時停止しない -- contract-2026-08-02-preview-parity.md §2.4.3）。
  freezeHoldUntilMs = 0;
  isPlaying = false;
  // 再生中のシーク操作は pause() → seekTo() の順で来る。ここでも同じ 12ms ランプを
  // 予約し、直後の seekTo が pending action を「シークしてから停止」へ更新できるようにする。
  if (baseAudioDeClick && audioCtx?.state === 'running' && !video.paused) {
    baseAudioDeClick.request(finishPausingPlayback);
  } else {
    finishPausingPlayback();
  }
  playToggle.innerHTML = playIcon;
  playToggle.setAttribute('aria-label', '再生');
  playToggle.title = '再生';
}

let lastWallMs = 0;
// 壁時計で進める出力時刻と <video> の再生位置の許容ズレ。シーク 1 回の遅延より
// 広く取らないと補正が自己増殖する（下の playbackLoop の注記参照）。
const SYNC_DEADBAND_SEC = 0.35;
function playbackLoop() {
  if (!isPlaying) return;
  const now = performance.now();
  // cuts[].freeze の一時停止ホールド中（近似実装。尺は伸ばさない -- contract-2026-08-02-preview-
  // parity.md §2.4.3）: outputTime を進めず video/audio を実時間で止めたまま rAF だけ生かす。
  // lastWallMs を毎フレーム更新しておくことで、ホールドが明けた直後の dt がホールド全体の
  // 長さを含んでしまう（=明けた瞬間に outputTime が一気に進む）のを防ぐ。
  if (freezeHoldUntilMs > 0) {
    if (now < freezeHoldUntilMs) {
      lastWallMs = now;
      requestAnimationFrame(playbackLoop);
      return;
    }
    freezeHoldUntilMs = 0;
    resumeAllPlaybackForFreeze();
  }
  const dt = lastWallMs > 0 ? (now - lastWallMs) / 1000 : 0;
  lastWallMs = now;
  outputTime += dt;
  if (outputTime >= totalDuration) { outputTime = totalDuration; pause(); return; }
  const target = getVideoTimeForOutput(outputTime);
  const seg = getActiveSegment(outputTime);
  if (target >= 0 && seg && seg.index >= 0) {
    if (isStillImageCutSegment(seg)) {
      // 静止画には currentTime シークも play() 復帰も無い。表示の出し分けだけでよい。
      showStillImageForSegment(seg);
    } else {
      showVideoBase();
      // ズレ補正は「シーク中でない」かつ「シーク遅延より大きくズレた」ときだけ。
      // 旧実装（閾値 0.1・シーク中も発行）は、1 回のシーク遅延がそのまま次フレームの
      // ズレになって再びしきい値を超えるため補正が自己増殖し、シーク暴走（実測 10 回/秒・
      // readyState 1 のまま・waiting でスピナー点灯・カクつき）を起こしていた。
      // 補正が必要な場合は 12ms で下地音声をゼロへ落としてから source/currentTime を切り替える。
      syncBaseVideoTime(getVideoSource(seg.index), target, SYNC_DEADBAND_SEC);
      // src の差し替えで paused に戻った場合も、時刻を合わせてから再生を復帰する。
      // 読み込み直後の play() が失敗しても、再生中だけ次フレームで再試行される。
      ensureMediaPlaying(video, isPlaying);
    }
    if (seg.index !== freezeHoldConsumedForCutIndex) {
      const freezeCheck = checkCutFreezeCrossing(seg.freeze, playedCutLocalSeconds(seg));
      if (freezeCheck.shouldHold) {
        freezeHoldConsumedForCutIndex = seg.index;
        freezeHoldUntilMs = performance.now() + freezeCheck.holdSeconds * 1000;
        pauseAllPlaybackForFreeze();
      }
    }
  }
  applyCutFramingVisual();
  cutFx.update();
  seek.value = outputTime;
  updateTimeLabel();
  updateStatusBar();
  updateOverlays();
  updateWaveformPlayhead();
  updateCaption();
  syncCaptionAnimations();
  updateTransitions();
  updateMinimap();
  syncAudio(outputTime);
  syncLayers(outputTime);
  const tickNow = performance.now();
  if (tickNow - wsTickLast > 200) { sendWsTick(); wsTickLast = tickNow; }
  requestAnimationFrame(playbackLoop);
}

function updateWaveformPlayhead() {
  if (!waveformPeaks || totalDuration <= 0) return;
  const r = outputTime / totalDuration;
  drawWaveform(r);
  drawTrackWaveforms(r);
  waveformPlayhead.style.left = `${r * 100}%`;
  for (const canvas of Object.values(trackCanvases)) {
    if (!canvas) continue;
    const ph = canvas.parentElement?.querySelector('.transport-waveform-playhead');
    if (ph) ph.style.left = `${r * 100}%`;
  }
}

function updateTransitions() {
  const cuts = summary?.cuts ?? [];
  updateBaseAudioTransition(outputTime);
  if (!cuts.length) { transitionPlate.style.visibility = 'hidden'; return; }
  let cursor = 0;
  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    const speed = cut.speed || 1;
    const dur = ((cut.out ?? cut.in + 1) - (cut.in ?? 0)) / speed;
    if (cut.at !== undefined) cursor = cut.at;
    const nextStart = cursor + (cut.at !== undefined ? 0 : dur);
    if (cut.transition_out && outputTime >= nextStart - cut.transition_out.duration && outputTime < nextStart) {
      const p = (outputTime - (nextStart - cut.transition_out.duration)) / cut.transition_out.duration;
      transitionPlate.style.background = cut.transition_out.type === 'fade-white' ? '#fff' : '#000';
      transitionPlate.style.opacity = String(p);
      transitionPlate.style.visibility = 'visible';
      return;
    }
    if (cut.at === undefined) cursor += dur;
  }
  transitionPlate.style.opacity = '0';
  transitionPlate.style.visibility = 'hidden';
}

const fm = (sec) => { const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; };
function updateTimeLabel() {
  timeLabel.textContent = `${fm(outputTime)} / ${fm(totalDuration)}`;
}
function updateStatusBar() {
  const el = document.getElementById('status-info');
  if (!el) return;
  const seg = getActiveSegment(outputTime);
  const parts = [fm(outputTime)];
  if (seg && !seg.isGap && seg.index >= 0) parts.push(`カット #${seg.index + 1}`);
  if (zoom !== 1) parts.push(`${Math.round(zoom * 100)}%`);
  el.textContent = parts.join(' · ');
  const bar = el.parentElement;
  if (!bar._shown) { bar._shown = true; bar.style.opacity = '1'; setTimeout(() => { bar.style.opacity = '0'; bar._shown = false; }, 3000); }
}

// --- Cut segment visual on seek bar ---
const seekVisual = document.getElementById('seek-visual');
const cutInfoPopup = document.getElementById('cut-info-popup');
const cutInfoContent = document.getElementById('cut-info-content');
const CUT_COLORS = ['#4da3ff', '#ff6b6b', '#51cf66', '#ffd43b', '#cc5de8', '#20c997', '#ff922b', '#748ffc'];
function updateSeekVisual() {
  if (!segments.length || totalDuration <= 0) { seekVisual.style.display = 'none'; return; }
  seekVisual.style.display = 'flex';
  let html = '';
  let prevEnd = 0;
  for (const seg of segments) {
    // トランジション重なり分は先行カットの帯に含める（帯の合計幅を 100% に保つ）。
    const width = Math.max(0, seg.outEnd - Math.max(seg.outStart, prevEnd));
    prevEnd = Math.max(prevEnd, seg.outEnd);
    const pct = (width / totalDuration * 100);
    if (seg.isGap) {
      html += `<div style="width:${pct}%;background:#333"></div>`;
    } else {
      const color = CUT_COLORS[seg.index % CUT_COLORS.length];
      html += `<div style="width:${pct}%;background:${color};flex-shrink:0" data-cut-index="${seg.index}"></div>`;
    }
  }
  seekVisual.innerHTML = html;
}

let selectedCutIndex = -1;
let selectedCutAcc = 0;

async function editSaveErrorMessage(res) {
  try {
    const body = await res.json();
    if (Array.isArray(body.findings) && body.findings.length) {
      // warning が先頭に混ざると真因が埋もれる — error のみ表示（P2-5）。
      // error が無い異常応答では従来どおり全 findings にフォールバック
      const errors = body.findings.filter((f) => f.severity === 'error');
      const shown = errors.length ? errors : body.findings;
      return shown.map((f) => f.message || f.check).filter(Boolean).join(' / ');
    }
    return body.error || `保存に失敗しました (HTTP ${res.status})`;
  } catch {
    return `保存に失敗しました (HTTP ${res.status})`;
  }
}

function resolveMediaUrl(pathOrSrc) {
  if (!pathOrSrc) return null;
  if (/^(https?:|blob:)/.test(pathOrSrc)) return pathOrSrc;
  return `/${String(pathOrSrc).replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')}`;
}

async function reloadSummary() {
  const res = await fetch(api.summary);
  if (!res.ok) throw new Error(`summary: HTTP ${res.status}`);
  summary = normalizeLegacyCutTransitions(await res.json());
  updateStageScale();
  return summary;
}

// --- P2-7: 編集適用の差分化 ---
// 編集適用（PUT / file watch → WS reload）のたびに location.reload すると再生位置・
// 再生状態・ズーム・編集モードが毎回失われる。ページは再読込せず、変わり得るデータ
// （timeline / summary / captions）だけ再取得して組み直す。オーバーレイ選択だけは
// DOM が入れ替わるため解除する。失敗時は従来どおり全リロードへフォールバック
let softReloadTail = Promise.resolve();
function requestSoftReload() {
  softReloadTail = softReloadTail.then(applySoftReload).catch((err) => {
    console.warn('[preview] soft reload failed; falling back to full reload', err);
    location.reload();
  });
}

// 断片の「顔ぶれ」— これが変わらない限り DOM は作り直さない（位置や見た目の変更は貼り直しで足りる）
function overlaySignature(s) {
  return JSON.stringify((s?.overlays || []).map(o => [String(o.id), o.html, o.start, o.duration]));
}

async function applySoftReload() {
  const keep = { t: outputTime, playing: isPlaying };
  const signatureBefore = overlaySignature(summary);
  if (isPlaying) pause();

  const [timelineRes, editRes, captionsRes] = await Promise.all([
    fetch(api.timeline),
    fetch(api.summary),
    fetch(api.captions).catch(() => new Response(null, { status: 404 })),
  ]);
  if (!timelineRes.ok || !editRes.ok) {
    throw new Error(`reload fetch failed (timeline=${timelineRes.status}, summary=${editRes.status})`);
  }
  timelineData = await timelineRes.json();
  summary = normalizeLegacyCutTransitions(await editRes.json());
  if (captionsRes.ok) {
    const body = await captionsRes.json();
    captionsData = Array.isArray(body) ? body : (body?.captions ?? []);
  } else {
    captionsData = [];
  }
  fps = timelineData.fps || 30;

  buildSegments();
  updateStageScale();

  // B-roll レイヤーを組み直し
  for (const lv of layerVideos) lv.el.remove();
  layerVideos = [];
  setupLayers();

  // MediaElementSource は 1 要素 1 回のため AudioContext / 下地経路は保持し、編集内容に
  // 依存する BGM・ナレーション・効果音のノードだけを組み直す。
  teardownTimelineAudioGraph();
  setupAudioGraph();

  // オーバーレイ: 顔ぶれが同じなら作り直さず位置と見た目だけ貼り直す
  // （ドラッグのたびに全部作り直すと画面がチラつき、選択も毎回外れる）
  if (overlaySignature(summary) === signatureBefore) {
    window.akari.runtime?.applyProps?.(summary);
  } else {
    window.akari.interaction?.clearSelection?.();
    if (window.akari.runtime?.mount) window.akari.runtime.mount(summary);
  }
  window.akari.state = { editPath: 'edit.json', summary };

  cutInfoPopup.hidden = true;
  _lastCaptionId = null;

  // 再生位置と状態を復元（新しい総尺にクランプ）
  seekTo(Math.min(keep.t, totalDuration));
  if (keep.playing) play();
}

function showCutInfoAt(t) {
  const seg = getActiveSegment(t);
  if (seg) {
    selectedCutIndex = seg.isGap ? -1 : seg.index;
    selectedCutAcc = seg.outStart;
    renderCutInfoContent(seg);
    cutInfoPopup.hidden = false;
    // 素材の選択フレームは document.body 直下の position:fixed / z-index 最大で、
    // ハンドルだけ pointer-events:auto。ポップアップ（z-index 20）に重なるとクリックを
    // 全部そちらが取ってしまい、ボタンが押せなくなる（実機報告 2026-08-07）。
    // カットを編集している間は素材の選択を解いて、重なり自体を無くす。
    window.akari?.interaction?.clearSelection?.();
    return;
  }
  cutInfoPopup.hidden = true;
  selectedCutIndex = -1;
}

// ポップアップから抜ける道を用意する（Escape / 外側クリック）。
// ✕ は「カットを削除」であって閉じるボタンではないため、閉じ方が「閉じる」ボタン 1 つしか
// 無く、そこが押せない状況に陥ると詰んでいた。
function closeCutInfo() {
  cutInfoPopup.hidden = true;
  selectedCutIndex = -1;
}
document.addEventListener('pointerdown', (e) => {
  if (cutInfoPopup.hidden) return;
  if (cutInfoPopup.contains(e.target) || e.target === seek) return;
  closeCutInfo();
}, true);

function renderCutInfoContent(seg) {
  if (seg.isGap) {
    cutInfoContent.innerHTML = '<div style="margin-bottom:8px"><b>ギャップ</b><br><span style="color:#888">' + seg.durationSec.toFixed(2) + 's</span></div>';
    return;
  }
  const cut = summary?.cuts?.[seg.index];
  if (!cut) { cutInfoContent.innerHTML = '<div>不明なカット</div>'; return; }
  const srcName = cut.src ? cut.src.split('/').pop() : 'メイン';
  const inVal = seg.inSec.toFixed(2);
  const outVal = seg.outSec.toFixed(2);
  const speedVal = seg.speed.toFixed(2);
  const toType = cut.transition_out?.type || '';
  const toDur = cut.transition_out?.duration !== undefined ? cut.transition_out.duration.toFixed(2) : '';
  const atVal = cut.at !== undefined ? String(cut.at) : '';
  cutInfoContent.innerHTML = `
    <div style="margin-bottom:6px"><b>カット #${seg.index + 1}</b> <span style="color:#888">${esc(srcName)}</span></div>
    <div style="display:flex;gap:8px;margin-bottom:6px">
      <label style="flex:1;color:#888;font-size:11px">IN <input id="cut-inp-in" type="number" step="0.01" value="${inVal}" style="width:100%;background:#303030;color:#fff;border:1px solid #505050;border-radius:3px;padding:2px 4px;font-size:12px"></label>
      <label style="flex:1;color:#888;font-size:11px">OUT <input id="cut-inp-out" type="number" step="0.01" value="${outVal}" style="width:100%;background:#303030;color:#fff;border:1px solid #505050;border-radius:3px;padding:2px 4px;font-size:12px"></label>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:4px">
      <label style="flex:1;color:#888;font-size:11px">速度 <input id="cut-inp-speed" type="number" step="0.01" min="0.01" value="${speedVal}" style="width:100%;background:#303030;color:#fff;border:1px solid #505050;border-radius:3px;padding:2px 4px;font-size:12px"></label>
      <label style="flex:0;color:#888;font-size:11px">絶対位置 <input id="cut-inp-at" type="number" step="0.01" value="${atVal}" placeholder="" style="width:80px;background:#303030;color:#fff;border:1px solid #505050;border-radius:3px;padding:2px 4px;font-size:12px"></label>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:6px">
      <label style="flex:1;color:#888;font-size:11px">OUT トランジション
        <select id="cut-inp-to-type" style="width:100%;background:#303030;color:#fff;border:1px solid #505050;border-radius:3px;padding:2px 4px;font-size:12px">
          <option value="">なし</option>
          <option value="dissolve"${toType==='dissolve'?' selected':''}>dissolve</option>
          <option value="fade-black"${toType==='fade-black'?' selected':''}>fade-black</option>
          <option value="fade-white"${toType==='fade-white'?' selected':''}>fade-white</option>
          <option value="reveal-down"${toType==='reveal-down'?' selected':''}>reveal-down</option>
          <option value="reveal-up"${toType==='reveal-up'?' selected':''}>reveal-up</option>
     </select>
        <input id="cut-inp-to-dur" type="number" step="0.01" min="0" value="${toDur}" placeholder="秒" style="width:100%;background:#303030;color:#fff;border:1px solid #505050;border-radius:3px;padding:2px 4px;font-size:12px;margin-top:2px">
      </label>
    </div>
    <div style="display:flex;gap:6px">
      <button id="cut-apply-btn" style="flex:1;background:#4da3ff;color:#fff;border:none;border-radius:3px;padding:4px 8px;cursor:pointer;font-size:12px">適用</button>
      <button id="cut-close-btn" style="flex:0;background:#505050;color:#fff;border:none;border-radius:3px;padding:4px 8px;cursor:pointer;font-size:12px">閉じる</button>
    </div>
    <div style="display:flex;gap:6px;margin-top:6px;border-top:1px solid #505050;padding-top:6px">
      <button id="cut-add-before-btn" style="flex:1;background:#303030;color:#aaa;border:1px solid #505050;border-radius:3px;padding:3px 6px;cursor:pointer;font-size:11px">＋前に追加</button>
      <button id="cut-add-after-btn" style="flex:1;background:#303030;color:#aaa;border:1px solid #505050;border-radius:3px;padding:3px 6px;cursor:pointer;font-size:11px">＋後に追加</button>
      <button id="cut-move-up-btn" style="flex:0;background:#303030;color:#aaa;border:1px solid #505050;border-radius:3px;padding:3px 6px;cursor:pointer;font-size:11px">▲</button>
      <button id="cut-move-down-btn" style="flex:0;background:#303030;color:#aaa;border:1px solid #505050;border-radius:3px;padding:3px 6px;cursor:pointer;font-size:11px">▼</button>
      <button id="cut-delete-btn" style="flex:0;background:#6b2020;color:#fff;border:1px solid #8b3030;border-radius:3px;padding:3px 6px;cursor:pointer;font-size:11px">✕</button>
    </div>`;
  document.getElementById('cut-close-btn').addEventListener('click', () => { cutInfoPopup.hidden = true; });
  document.getElementById('cut-add-before-btn').addEventListener('click', () => addCutAt(selectedCutIndex, 'before'));
  document.getElementById('cut-add-after-btn').addEventListener('click', () => addCutAt(selectedCutIndex, 'after'));
  document.getElementById('cut-move-up-btn').addEventListener('click', () => moveCut(selectedCutIndex, -1));
  document.getElementById('cut-move-down-btn').addEventListener('click', () => moveCut(selectedCutIndex, 1));
  document.getElementById('cut-delete-btn').addEventListener('click', () => deleteCut(selectedCutIndex));
  document.getElementById('cut-apply-btn').addEventListener('click', async () => {
    if (selectedCutIndex < 0) return;
    const inVal = Number(document.getElementById('cut-inp-in').value);
    const outVal = Number(document.getElementById('cut-inp-out').value);
    const speedVal = Number(document.getElementById('cut-inp-speed').value);
    const atVal = document.getElementById('cut-inp-at').value;
    const toType = document.getElementById('cut-inp-to-type').value;
    const toDur = Number(document.getElementById('cut-inp-to-dur').value);
    if (!Number.isFinite(inVal) || !Number.isFinite(outVal) || !Number.isFinite(speedVal) || speedVal <= 0) return;
    const newCuts = [...(summary?.cuts || [])];
    const cut = newCuts[selectedCutIndex];
    if (!cut) return;
    const old = { in: cut.in, out: cut.out, speed: cut.speed, at: cut.at, transition_out: cut.transition_out };
    cut.in = inVal; cut.out = outVal; cut.speed = speedVal;
    cut.at = atVal ? Number(atVal) : undefined;
    cut.transition_out = toType ? { type: toType, duration: Number.isFinite(toDur) && toDur > 0 ? toDur : 0.3 } : undefined;
    try {
      const res = await fetch('/api/edit.json', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(editForPut({ ...summary, cuts: newCuts }))
      });
      if (res.ok) {
        buildSegments();
        seekTo(outputTime);
      } else {
        Object.assign(cut, old);
        showMessage(await editSaveErrorMessage(res));
      }
    } catch (e) { Object.assign(cut, old); showMessage(e?.message || String(e)); }
  });
}

// lint 契約（cuts.overlap / 最小尺 0.15s / 実尺内）を満たす空き source 区間を探す（P2-6:
// 旧実装は隣接カットと source 範囲が重なる {in: ref.out, out: ref.out+1} を作り 422 になっていた）
function findFreeSourceRange(cuts, fromSec, direction) {
  const MIN = 0.15;
  const want = 1;
  const materialEnd = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : Infinity;
  const used = cuts.map(c => [Number(c.in) || 0, Number(c.out) || 0]).sort((a, b) => a[0] - b[0]);
  if (direction > 0) {
    let start = Math.max(0, fromSec);
    for (let guard = 0; guard <= used.length; guard++) {
      const hit = used.find(([a, b]) => a < start + MIN && b > start);
      if (!hit) break;
      start = hit[1];
    }
    const end = Math.min(start + want, materialEnd, ...used.filter(([a]) => a >= start + MIN).map(([a]) => a));
    return end - start >= MIN ? { in: start, out: end } : null;
  }
  let end = fromSec;
  for (let guard = 0; guard <= used.length; guard++) {
    const hit = used.find(([a, b]) => a < end && b > end - MIN);
    if (!hit) break;
    end = hit[0];
  }
  const start = Math.max(0, end - want, ...used.filter(([, b]) => b <= end - MIN).map(([, b]) => b));
  return end - start >= MIN && end <= materialEnd ? { in: start, out: end } : null;
}

async function addCutAt(index, where) {
  const cuts = summary?.cuts;
  if (!Array.isArray(cuts) || index < 0) return;
  const ref = cuts[index];
  if (!ref) return;
  const newCut = where === 'before'
    ? findFreeSourceRange(cuts, ref.in, -1)
    : findFreeSourceRange(cuts, ref.out, 1);
  if (!newCut) {
    showMessage('追加できる空き区間が素材内にありません。');
    return;
  }
  const idx = where === 'before' ? index : index + 1;
  const newCuts = [...cuts.slice(0, idx), newCut, ...cuts.slice(idx)];
  const res = await fetch('/api/edit.json', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(editForPut({ ...summary, cuts: newCuts }))
  });
  if (res.ok) {
    buildSegments();
    seekTo(outputTime);
  } else {
    showMessage(await editSaveErrorMessage(res));
  }
}

async function moveCut(index, dir) {
  const cuts = summary?.cuts;
  if (!Array.isArray(cuts) || index < 0) return;
  const target = index + dir;
  if (target < 0 || target >= cuts.length) return;
  const newCuts = [...cuts];
  [newCuts[index], newCuts[target]] = [newCuts[target], newCuts[index]];
  const res = await fetch('/api/edit.json', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(editForPut({ ...summary, cuts: newCuts }))
  });
  if (res.ok) {
    buildSegments();
    seekTo(outputTime);
  } else {
    showMessage(await editSaveErrorMessage(res));
  }
}

async function deleteCut(index) {
  const cuts = summary?.cuts;
  if (!Array.isArray(cuts) || index < 0 || cuts.length <= 1) return;
  const newCuts = [...cuts.slice(0, index), ...cuts.slice(index + 1)];
  const res = await fetch('/api/edit.json', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(editForPut({ ...summary, cuts: newCuts }))
  });
  if (res.ok) {
    buildSegments();
    seekTo(outputTime);
  } else {
    showMessage(await editSaveErrorMessage(res));
  }
}

playToggle.addEventListener('click', () => isPlaying ? pause() : play());
frameBack.addEventListener('click', () => { pause(); seekTo(outputTime - 1 / fps); });
frameForward.addEventListener('click', () => { pause(); seekTo(outputTime + 1 / fps); });
skipBack.addEventListener('click', () => { pause(); seekTo(outputTime - 10); });
skipForward.addEventListener('click', () => { pause(); seekTo(outputTime + 10); });
seek.addEventListener('input', () => {
  const t = Number(seek.value);
  const w = isPlaying; if (w) pause();
  seekTo(t);
  if (w) play();
});
// カット情報はダブルクリックでだけ開く。
// 旧実装は「ドラッグを伴わないクリック」で開いていたが、シークバーをクリックして位置を
// 飛ばすのは最も普通の操作なので、位置を変えるたびに毎回開いてしまっていた（実機報告 2026-08-07）。
// 単クリック = 移動だけ / ダブルクリック = そのカットの情報、と分ける。
// （seek-visual は pointer-events:none でクリックを受けられないため range 側で受ける）
seek.title = 'ドラッグ / クリックで移動・ダブルクリックでカット情報';
seek.addEventListener('dblclick', () => { showCutInfoAt(Number(seek.value)); });
// カット境界へジャンプ（P2-2: 旧実装は区間内の t をそのまま返す恒等関数だった）
function snapToCut(t, dir) {
  if (!segments.length) return t;
  const EPS = 0.001;
  const bounds = [...new Set(segments.flatMap(seg => [seg.outStart, seg.outEnd]))]
    .sort((left, right) => left - right);
  if (dir > 0) {
    const next = bounds.find(b => b > t + EPS);
    return next !== undefined ? next : t;
  }
  const prev = bounds.filter(b => b < t - EPS).pop();
  return prev !== undefined ? prev : 0;
}

// 文字入力を受ける input 型だけ素通しする（シェルの isEditable と同じ判定）。
// INPUT を無差別に除外すると、シークバー（type=range）をクリックした後フォーカスが
// そこに残り、Space の再生トグルが飲まれる（実機報告: 効かない時がある）
const NON_TEXT_INPUT_TYPES = ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image'];
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (e.target.tagName === 'INPUT' && !NON_TEXT_INPUT_TYPES.includes(e.target.type)) return;
  // 断片のダブルクリック編集中（contenteditable）は文字入力とカーソル操作が優先。
  // ここを抜けないと ← → が「1 コマ戻す/送る」に取られてキャレットが動かず、
  // Space も再生トグルになって空白が打てない
  if (e.target.isContentEditable || (e.target.closest && e.target.closest('[contenteditable="true"]'))) return;
  switch (e.code) {
    case 'Space': e.preventDefault(); isPlaying ? pause() : play(); break;
    case 'ArrowLeft': e.preventDefault(); pause(); seekTo(outputTime - 1 / fps); break;
    case 'ArrowRight': e.preventDefault(); pause(); seekTo(outputTime + 1 / fps); break;
    case 'ArrowUp': e.preventDefault(); pause(); seekTo(outputTime - 10); break;
    case 'ArrowDown': e.preventDefault(); pause(); seekTo(outputTime + 10); break;
    case 'Home': e.preventDefault(); seekTo(0); break;
    case 'End': e.preventDefault(); seekTo(totalDuration); break;
    case 'Comma': e.preventDefault(); pause(); seekTo(snapToCut(outputTime, -1)); break;
    case 'Period': e.preventDefault(); pause(); seekTo(snapToCut(outputTime, 1)); break;
    case 'Slash': if (!e.shiftKey) { e.preventDefault(); shortcutHelp.hidden = !shortcutHelp.hidden; } break;
    case 'Escape': shortcutHelp.hidden = true; setLayerSelected(null); closeCutInfo(); break;
    case 'Digit0': e.preventDefault(); resetSelectedOverlayTransform(); break;
    case 'Delete':
    case 'Backspace': e.preventDefault(); deleteSelectedOverlay(); break;
    case 'KeyZ': if (e.ctrlKey || e.metaKey) { e.preventDefault(); } break;
  }
});
// スピナーは「本当に待たされている時」だけ出す。waiting はカット跨ぎやシークで日常的に
// 一瞬立つため、素直に反映すると点滅が読み込み中の体感を実際より重くする
// （実測 beat-pv: 13 回の点灯のうち 12 回が 400ms 未満）。立ち上がりだけ遅らせ、消すのは即座に。
const LOADING_SPINNER_DELAY_MS = 400;
let loadingSpinnerTimer = 0;
function showLoading() {
  if (loadingSpinnerTimer || loadingIndicator.style.display === 'block') return;
  loadingSpinnerTimer = setTimeout(() => {
    loadingSpinnerTimer = 0;
    loadingIndicator.style.display = 'block';
  }, LOADING_SPINNER_DELAY_MS);
}
function hideLoading() {
  if (loadingSpinnerTimer) { clearTimeout(loadingSpinnerTimer); loadingSpinnerTimer = 0; }
  loadingIndicator.style.display = 'none';
}
video.addEventListener('loadstart', showLoading);
video.addEventListener('canplay', hideLoading);
video.addEventListener('waiting', showLoading);
video.addEventListener('playing', hideLoading);
// シーク完了で待ちは解消している。seeked を拾わないと、一時停止中のシークでは
// playing が来ないためスピナーが出たまま残る
video.addEventListener('seeked', hideLoading);
video.addEventListener('error', hideLoading);

// --- Pen mode ---
const penToggle = document.getElementById('pen-toggle');
penToggle.addEventListener('click', () => {
  const next = !penActive;
  if (next) { setEditMode(false); }
  penToggle.setAttribute('aria-pressed', String(next));
  penEnable(next);
  if (next) zoomLayer.style.cursor = 'crosshair';
});
// Pointer events for pen drawing on zoomLayer
zoomLayer.addEventListener('pointerdown', onPenPointerDown);
zoomLayer.addEventListener('pointermove', onPenPointerMove);
zoomLayer.addEventListener('pointerup', onPenPointerUp);
zoomLayer.addEventListener('pointerleave', onPenPointerUp);

// --- Edit mode（オーバーレイのドラッグ編集のみ。レイヤー/字幕スタイルの編集は shell 側の担当） ---
function setEditMode(next) {
  editMode = next;
  window.akari = window.akari || {};
  window.akari.editMode = editMode;
  editToggle.setAttribute('aria-pressed', String(editMode));
  stage.style.pointerEvents = editMode ? 'auto' : 'none';
  // 素材の選択・ドラッグは編集モードでだけ生かす。
  // interaction のリスナは document の捕捉フェーズに付いていて、当たり判定も断片の
  // 実測境界（ステージのクリップ外へはみ出す）で決まる。つまり pointer-events:none だけでは
  // 止まらず、プレビュー枠の外を押しただけで背景断片を掴めてしまい、
  //   (a) 選択枠の追従 rAF が回り続けて毎フレーム強制レイアウトが走る
  //   (b) body 直下・z-index 最大の枠がトランスポートのクリックを奪う（✕ が押せない件）
  //   (c) 気づかないうちにドラッグされて edit.json に書き込まれる
  // が起きていた（実機 2026-08-07。誤ドラッグ 4 件が混入）。入口ごと閉じる。
  window.akari?.interaction?.setEnabled?.(editMode);
  lastSelectionShown = null;
  updateSelectionHint();
  // 当たり判定は編集中だけ毎フレーム測る（tick 参照）。ON にした瞬間は、今見えている
  // 断片ぶんをここで 1 回そろえておく
  if (editMode) {
    for (const el of stage.querySelectorAll('[data-overlay-id][data-akari-active]')) {
      window.akari.interaction?.applyOverlayHitPolicy?.(el);
      window.akari.interaction?.syncOverlayHitRegion?.(el);
    }
  }
  if (!editMode) window.akari.interaction?.clearSelection?.();
}
editToggle.addEventListener('click', () => {
  const next = !editMode;
  if (next) { penEnable(false); }
  setEditMode(next);
});
// 選択は interaction 側で変わるので、ポインタ操作のたびに見に行く（差分があるときだけ描く）
for (const type of ['pointerup', 'click']) {
  document.addEventListener(type, () => { updateSelectionHint(); });
}
// --- Indicator popup ---
indicatorBtn.addEventListener('click', () => {
  const h = indicatorPopup.hidden;
  indicatorPopup.hidden = !h;
  indicatorBtn.setAttribute('aria-pressed', String(!h));
  // h = 「閉じていた」= これから開く時に描画する（P2-8: 判定が反転していて開くと空白だった）
  if (h) renderIndicators();
});
function renderIndicators() {
  const ind = summary?.indicators;
  if (!Array.isArray(ind) || !ind.length) {
    indicatorPopup.innerHTML = '<div class="indicator-item"><span class="val">指標なし</span></div>';
    return;
  }
  indicatorPopup.innerHTML = ind.map(i => `<div class="indicator-item"><span class="key">${esc(i)}</span></div>`).join('');
}

// --- Waveform toggle ---
let waveformVisible = false;
waveformToggle.addEventListener('click', () => {
  waveformVisible = !waveformVisible;
  waveformRow.hidden = !waveformVisible;
  waveformToggle.setAttribute('aria-pressed', String(waveformVisible));
  saveSettings({ waveformVisible });
  if (waveformVisible) setupWaveform();
});

// --- Zoom ---
const ZOOM_MIN = 0.25, ZOOM_MAX = 8;
function updateZoom() {
  zoomLayer.style.transform = `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`;
  zoomValue.textContent = `${Math.round(zoom * 100)}%`;
  zoomSlider.value = Math.log2(zoom / ZOOM_MIN) / Math.log2(ZOOM_MAX / ZOOM_MIN);
  updateMinimap();
}
zoomToggle.addEventListener('click', () => { const o = !zoomPopup.hidden; zoomPopup.hidden = o; zoomToggle.setAttribute('aria-expanded', String(!o)); });
zoomSlider.addEventListener('input', () => { zoom = ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, Number(zoomSlider.value)); pan = { x: 0, y: 0 }; updateZoom(); saveSettings({ zoom }); });
document.querySelectorAll('.zoom-preset').forEach(btn => {
  btn.addEventListener('click', () => { zoom = Number(btn.dataset.zoom); pan = { x: 0, y: 0 }; updateZoom(); zoomPopup.hidden = true; zoomToggle.setAttribute('aria-expanded', 'false'); saveSettings({ zoom }); });
});
wrapper.addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + (e.deltaY > 0 ? -0.1 : 0.1) * zoom));
  pan = { x: 0, y: 0 }; updateZoom();
}, { passive: false });
wrapper.addEventListener('pointerdown', (e) => {
  // ペン使用中はパンでポインタを奪わない（P2-3: ズーム中に注釈が描けなかった）
  if (zoom <= 1 || penActive || e.target.closest('.icon-button, .popup, #seek')) return;
  drag = { startX: e.clientX - pan.x, startY: e.clientY - pan.y };
  wrapper.setPointerCapture(e.pointerId);
  wrapper.style.cursor = 'grabbing';
});
wrapper.addEventListener('pointermove', (e) => { if (!drag) return; pan.x = e.clientX - drag.startX; pan.y = e.clientY - drag.startY; updateZoom(); });
wrapper.addEventListener('pointerup', () => { drag = null; wrapper.style.cursor = ''; });
fullscreenToggle.addEventListener('click', () => {
  if (document.fullscreenElement) { document.exitFullscreen(); fullscreenToggle.innerHTML = fullscreenIcon; fullscreenToggle.setAttribute('aria-pressed', 'false'); }
  else { wrapper.requestFullscreen(); fullscreenToggle.innerHTML = restoreIcon; fullscreenToggle.setAttribute('aria-pressed', 'true'); }
});

// --- 3D オーバーレイ（three.js） ---
// Web UI にはこれまで 3D ランタイムが一切無く、断片の `[data-akari-3d-fallback]`
// （「3D を読み込み中」）が永久に出たままだった（実機報告 2026-08-07。three.js の取得要求は
// ゼロ = 遅いのではなく未実装）。shell と同じ packages/overlay-runtime のランタイムを使う。
//
// vendor は 776KB あるので、断片が実際に 3D を宣言していた時だけ読む。
// 宣言の無いプロジェクトのダウンロード量は 1 バイトも増えない。
let threeRuntimeReady = null;
function ensureThreeRuntime() {
  if (threeRuntimeReady) return threeRuntimeReady;
  const loadScript = (src) => new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = false; // vendor → runtime の順序を守る
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`${src} を読み込めませんでした`));
    document.head.appendChild(el);
  });
  threeRuntimeReady = (async () => {
    await loadScript('/three-bundle.js');
    await loadScript('/three-runtime.js');
    return Boolean(window.akari?.threeRuntime);
  })().catch((e) => {
    console.warn('[preview] 3D ランタイムを読み込めませんでした', e);
    return false;
  });
  return threeRuntimeReady;
}
// プレビューの描画バッファ上限（長辺 px）。書き出しには渡さないので最終品質は不変。
// プレビューは「位置と動きを掴む」用途なので等倍で描く必要がない。
const PREVIEW_3D_MAX_RENDER_SIZE = 720;

// --- Overlay runtime ---
function createOverlayRuntime() {
  const overlays = [];
  function unmount() {
    for (const o of overlays) {
      if (o.is3d) window.akari?.threeRuntime?.dispose(o.el);
    }
    stage.querySelectorAll('[data-overlay-id]').forEach(el => el.remove());
    overlays.length = 0;
  }
  // 断片の HTML が入った後に判定する（html はファイル参照で非同期に届くため）
  function markThreeOverlay(rec) {
    rec.is3d = Boolean(rec.el.querySelector('script[type="application/json"][data-akari-3d-scene]'));
    if (rec.is3d) ensureThreeRuntime();
  }
  function mount(s) {
    unmount();
    if (!Array.isArray(s?.overlays)) return;
    const frag = document.createDocumentFragment();
    for (const o of s.overlays) {
      const c = document.createElement('div');
      c.dataset.overlayId = String(o.id);
      c.dataset.start = String(o.start);
      c.dataset.duration = String(o.duration);
      if (o.role !== undefined && o.role !== null) c.dataset.role = String(o.role);
      c.style.cssText = 'position:absolute;inset:0;pointer-events:none;visibility:hidden;touch-action:none;';
      // 2026-08-07 オーナー裁定: role==="background" は
      // ずらせない・必ずフレームを埋める種別。--x/--y/--scale/--rotate を無条件で恒等値へ
      // ロックする（transform も vars 経由の抜け道も無視する。overlay-runtime.js の mount・
      // render-cut の rasterize.mjs の renderOverlayNode と同じロック）。
      const isBackground = o.role === 'background';
      const t = o.transform || {};
      c.style.setProperty('--x', isBackground ? '0px' : `${t.x||0}px`);
      c.style.setProperty('--y', isBackground ? '0px' : `${t.y||0}px`);
      c.style.setProperty('--scale', isBackground ? '1' : String(t.scale||1));
      c.style.setProperty('--rotate', isBackground ? '0deg' : `${t.rotate||0}deg`);
      c.style.transform = 'translate(var(--x,0px), var(--y,0px)) scale(var(--scale,1)) rotate(var(--rotate,0deg))';
      if (o.vars && typeof o.vars === 'object') {
        for (const [k, v] of Object.entries(o.vars)) {
          if (k.startsWith('--') && (typeof v === 'string' || typeof v === 'number')) c.style.setProperty(k, String(v));
        }
      }
      if (isBackground) {
        c.style.setProperty('--x', '0px');
        c.style.setProperty('--y', '0px');
        c.style.setProperty('--scale', '1');
        c.style.setProperty('--rotate', '0deg');
      }
      // html は「< で始まればインライン、それ以外はファイルパス参照」（shell と同一解釈。lint 契約はパス参照が正）
      const rawHtml = typeof o.html === 'string' ? o.html : '';
      const rec = { el: c, start: o.start, duration: o.duration, visible: false, is3d: false, hitPolicyPending: false };
      if (rawHtml && !rawHtml.trimStart().startsWith('<')) {
        c.innerHTML = '';
        fetch(resolveMediaUrl(rawHtml))
          .then(r => (r.ok ? r.text() : ''))
          .then(html => {
            c.innerHTML = html || '';
            markThreeOverlay(rec);
            window.akari.interaction?.invalidateOverlayHitPolicy?.(c);
            rec.hitPolicyPending = rec.visible;
          })
          .catch(() => {});
      } else {
        c.innerHTML = rawHtml;
        markThreeOverlay(rec);
      }
      frag.appendChild(c);
      overlays.push(rec);
    }
    stage.appendChild(frag);
  }
  // 断片の実寸はアニメで毎フレーム変わりうる。外枠のサイズは固定なのでキャッシュ判定が
  // できず、可視中の断片は毎回測り直す（同時に見えている断片は通常 1〜3 枚）。
  function syncHitRegion(el) {
    window.akari.interaction?.syncOverlayHitRegion?.(el);
  }

  function tick(t) {
    for (const o of overlays) {
      const v = o.start <= t && t < o.start + o.duration;
      if (v !== o.visible) {
        o.el.style.visibility = v ? 'visible' : 'hidden';
        // 断片の出入りアニメは `[data-akari-active] .foo { animation: ... }` で宣言する規約
        // （overlay-authoring/telop.md）。shell の overlay-runtime は必ずこの属性を立てる。
        // Web UI は visibility しか切り替えておらず、規約どおりに書かれた断片は
        // base opacity:0 のまま一切アニメせず「何も出ない」状態になっていた。
        o.el.toggleAttribute('data-akari-active', v);
        o.hitPolicyPending = v;
        // ゲート属性の付け外しでアニメの顔ぶれが変わるのでキャッシュを捨てる
        o._anims = null;
        // 見えなくなったら GPU リソースを返す（shell の overlay-runtime と同じ）
        if (!v && o.is3d) window.akari?.threeRuntime?.dispose(o.el);
        o.visible = v;
      }
      if (!v) continue;
      const ms = Math.max(0, (t - o.start) * 1000);
      if (o.is3d) {
        // 3D 断片は three 側が時刻を持つ（mixer.setTime）。shell と同じく
        // getAnimations ループは回さない — ここで continue する
        window.akari?.threeRuntime?.render(o.el, ms / 1000, {
          syncVideos: true,
          maxRenderSize: PREVIEW_3D_MAX_RENDER_SIZE,
        });
        if (o.hitPolicyPending) {
          window.akari.interaction?.applyOverlayHitPolicy?.(o.el);
          o.hitPolicyPending = false;
        }
        continue;
      }
      // getAnimations({subtree:true}) のコストは「ドキュメント全体に現存する CSS animation の
      // 総数」にほぼ比例する（overlay-runtime.js の注記。実測の地雷）。断片のアニメは
      // `[data-akari-active]` ゲートで宣言する規約なので、可視の間は顔ぶれが変わらない。
      // 毎フレーム引き直さず、可視化時と 250ms ごとだけ引き直す（遅れて生えるものも拾える）。
      const nowMs = performance.now();
      if (!o._anims || nowMs - o._animsAt > 250) {
        o._anims = o.el.getAnimations({ subtree: true });
        o._animsAt = nowMs;
      }
      for (const a of o._anims) { a.pause(); a.currentTime = ms; }
      if (o.hitPolicyPending) {
        window.akari.interaction?.applyOverlayHitPolicy?.(o.el);
        o.hitPolicyPending = false;
      }
      // ㉑ 当たり判定（clip-path）は断片の実寸に合わせる。ただし可視化時に 1 回だけ測ると、
      // その後アニメで拡大した分がはみ出して**見た目まで切り取られる**（実測: pop 断片が
      // 1.13 倍に育った瞬間、円が角丸四角に切れた）。アニメを進めた後に測り直す。
      // ただし編集モードが OFF のときはステージ自体が pointer-events:none で当たり判定を
      // 一切使わない。毎フレーム getBoundingClientRect を撃つ（＝強制レイアウト）のは
      // 純粋な無駄なので、編集中だけに絞る。
      if (editMode) syncHitRegion(o.el);
    }
  }
  // 断片の顔ぶれ（id / html / 表示窓）が変わっていないときに、位置や見た目だけを
  // 貼り直す。ドラッグ 1 回のたびに 13 枚を作り直すと画面がチラつくため、
  // 再マウントは「構成が変わったとき」だけに絞る。
  function applyProps(s) {
    for (const o of (s?.overlays || [])) {
      const entry = overlays.find(x => x.el.dataset.overlayId === String(o.id));
      if (!entry) continue;
      // mount() と同じロック（transform 無視 + vars 経由の
      // --x/--y/--scale/--rotate 上書きを許さない）。applyProps は再マウント無しで既存要素の
      // 見た目だけを貼り直す経路なので、ここで抜けると別クライアントの書き込みや summary
      // 再取得で背景がずれ得る。
      const isBackground = o.role === 'background';
      const t = o.transform || {};
      entry.el.style.setProperty('--x', isBackground ? '0px' : `${t.x || 0}px`);
      entry.el.style.setProperty('--y', isBackground ? '0px' : `${t.y || 0}px`);
      entry.el.style.setProperty('--scale', isBackground ? '1' : String(t.scale || 1));
      entry.el.style.setProperty('--rotate', isBackground ? '0deg' : `${t.rotate || 0}deg`);
      if (o.vars && typeof o.vars === 'object') {
        for (const [k, v] of Object.entries(o.vars)) {
          if (k.startsWith('--') && (typeof v === 'string' || typeof v === 'number')) {
            entry.el.style.setProperty(k, String(v));
          }
        }
      }
      if (isBackground) {
        entry.el.style.setProperty('--x', '0px');
        entry.el.style.setProperty('--y', '0px');
        entry.el.style.setProperty('--scale', '1');
        entry.el.style.setProperty('--rotate', '0deg');
      }
      window.akari.interaction?.invalidateOverlayHitPolicy?.(entry.el);
      if (entry.visible) window.akari.interaction?.applyOverlayHitPolicy?.(entry.el);
      if (o.role !== undefined && o.role !== null) entry.el.dataset.role = String(o.role);
      else delete entry.el.dataset.role;
      entry.start = o.start;
      entry.duration = o.duration;
      entry.el.dataset.start = String(o.start);
      entry.el.dataset.duration = String(o.duration);
    }
  }

  return { mount, tick, unmount, applyProps };
}
function updateOverlays() { window.akari?.runtime?.tick(outputTime); }

// interaction（overlay-runtime 正本）の書き込みブリッジ。shell では engine.overlayWrite が
// RPC（lint ゲート付き）に相当し、Web UI では PUT /api/edit.json（サーバ側で同じ lint ゲート）に
// 落ちる。patch は { transform } / { html } /（将来 { vars }）— 旧フォークの applyPatch と同じ
// 「最新 summary を取得 → 対象 overlay へマージ → 全文 PUT」方式。
// プレビューを潰さない通知。showMessage は .message-card = プレビュー全面を覆う板なので、
// 一過性の結果表示に使うと画面が消えたように見える（実機報告 2026-08-07「0 を押したらバグった」）。
// 要素は都度引く（呼ばれるのは選択が変わったときだけなので安い）。
function showHint(text, holdMs = 2600) {
  const editHint = document.getElementById('edit-hint');
  if (!editHint) return;
  if (editHintTimer) { clearTimeout(editHintTimer); editHintTimer = 0; }
  if (!text) { editHint.hidden = true; editHint.style.opacity = '0'; return; }
  editHint.hidden = false;
  editHint.textContent = text;
  editHint.style.opacity = '1';
  if (holdMs > 0) {
    editHintTimer = setTimeout(() => { editHintTimer = 0; editHint.style.opacity = '0'; }, holdMs);
  }
}
function fmtRange(sec) {
  const m = Math.floor(sec / 60), s2 = (sec % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s2}`;
}
// 何を掴んでいるかを常に出す。断片は画面いっぱいに広がるものが多く、いま見ている場面の
// 部品を掴んだつもりで「動画全体に敷いてある背景」を掴んでいることがある
// （bg-live は 0〜123.6 秒 = 全編。実機報告 2026-08-07「次の背景も同じ量だけ動く」の正体）。
// 選択は可視である限り持ち越されるので、スクラブしても掴んだままになる点も見えるようにする。
function updateSelectionHint() {
  if (!editMode) { if (lastSelectionShown !== null) { lastSelectionShown = null; showHint(null); } return; }
  const el = document.querySelector('[data-akari-interaction-selected]');
  const id = el?.dataset?.overlayId ?? null;
  if (id === lastSelectionShown) return;
  lastSelectionShown = id;
  if (!id) { showHint('編集モード: 素材をクリックで選択', 0); return; }
  const ov = (summary?.overlays || []).find(o => String(o.id) === String(id));
  const range = ov ? `${fmtRange(ov.start)}〜${fmtRange(ov.start + ov.duration)}` : '範囲不明';
  const whole = ov && ov.duration >= totalDuration * 0.9 ? '（動画ほぼ全編に敷かれています）' : '';
  // 背景（role==="background"）は動かせないので「0 キーで位置を戻す」は意味を持たない。
  // 代わりに「動かせない」ことと Delete での差し替え動線を伝える。
  const trailer = ov?.role === 'background'
    ? '（背景・移動不可）・ Delete キーで削除'
    : '・ 0 キーで位置を戻す ・ Delete キーで削除';
  showHint(`選択中: ${id} ・ ${range}${whole}${trailer}`, 0);
}

// 選択中の素材を「作者が書いた位置」へ厳密に戻す。
// 作者の位置 = transform を持たない状態なので、目分量で合わせ直す必要はなくキーを消すだけ。
// 動いている断片は目視で元位置を復元できない、という実機の詰みへの答え（2026-08-07）。
async function resetSelectedOverlayTransform() {
  const el = document.querySelector('[data-akari-interaction-selected]');
  const id = el?.dataset?.overlayId;
  if (!id) { showHint('位置を戻す素材が選択されていません（編集モードで選んでください）'); return; }
  try {
    await overlayWriteViaPut('edit.json', id, { transform: null });
    showHint(`${id} の位置を作者の位置へ戻しました`);
  } catch (e) {
    showHint(`位置を戻せませんでした: ${e.message}`, 6000);
  }
}

// 選択中の素材を Delete キーで削除する。
// 背景に限らず overlays[] 全般に対する汎用機能 — 背景は「選択はできるが動かせない」種別で、
// 差し替え（別の背景へ切り替える）の唯一の手段が「今の背景を消す」なので必須。
// 消した後は下にあるものがそのまま見える（beat-pv ならベース動画）。lint 警告も出さない
// （2026-08-07 オーナー裁定「消したら黒でよい」）。
async function deleteSelectedOverlay() {
  const el = document.querySelector('[data-akari-interaction-selected]');
  const id = el?.dataset?.overlayId;
  if (!id) { showHint('削除する素材が選択されていません（編集モードで選んでください）'); return; }
  try {
    await deleteOverlayViaPut(id);
    showHint(`${id} を削除しました`);
  } catch (e) {
    showHint(`削除できませんでした: ${e.message}`, 6000);
  }
}

async function deleteOverlayViaPut(overlayId) {
  const res = await fetch('/api/summary');
  if (!res.ok) throw new Error(`edit.json を読めません: HTTP ${res.status}`);
  const edit = normalizeLegacyCutTransitions(await res.json());
  const before = (edit.overlays || []).length;
  edit.overlays = (edit.overlays || []).filter(o => String(o.id) !== String(overlayId));
  if (edit.overlays.length === before) throw new Error(`オーバーレイが見つかりません: ${overlayId}`);
  const put = await fetch('/api/edit.json', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(editForPut(edit)),
  });
  if (!put.ok) {
    let detail = `HTTP ${put.status}`;
    try {
      const body = await put.json();
      if (body?.findings?.length) detail = body.findings[0].message || detail;
    } catch {}
    throw new Error(`削除の書き戻しに失敗しました: ${detail}`);
  }
}

async function overlayWriteViaPut(editPath, overlayId, patch) {
  // html は edit.json ではなく overlays[].html が指す断片ファイルへ書く（契約上ファイル参照。
  // edit.json へマージすると lint「html does not resolve to a regular file」で 422 になる）
  const { html, ...rest } = patch || {};
  if (typeof html === 'string') {
    const put = await fetch('/api/overlay-html', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: String(overlayId), html }),
    });
    if (!put.ok) {
      let detail = `HTTP ${put.status}`;
      try {
        const body = await put.json();
        if (body?.error) detail = body.error;
      } catch {}
      throw new Error(`断片の書き戻しに失敗しました: ${detail}`);
    }
  }
  if (Object.keys(rest).length === 0) return;
  const res = await fetch('/api/summary');
  if (!res.ok) throw new Error(`edit.json を読めません: HTTP ${res.status}`);
  const edit = normalizeLegacyCutTransitions(await res.json());
  const ov = (edit.overlays || []).find(o => String(o.id) === String(overlayId));
  if (!ov) throw new Error(`オーバーレイが見つかりません: ${overlayId}`);
  for (const [key, value] of Object.entries(rest)) {
    // null は「そのキーごと消す」。作者が書いた位置は「transform が無い状態」なので、
    // 消すことが目分量ではない厳密な復元になる（「位置を戻す」の土台）
    if (value === null) { delete ov[key]; continue; }
    if (key === 'transform') ov.transform = { ...ov.transform, ...value };
    else if (key === 'vars') ov.vars = { ...ov.vars, ...value };
    else ov[key] = value;
  }
  const put = await fetch('/api/edit.json', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(editForPut(edit)),
  });
  if (!put.ok) {
    let detail = `HTTP ${put.status}`;
    try {
      const body = await put.json();
      if (body?.findings?.length) detail = body.findings[0].message || detail;
    } catch {}
    throw new Error(`書き戻しに失敗しました: ${detail}`);
  }
}

function captionZoneParts(zone) {
  if (!zone || zone === 'bottom') return { row: 'bottom', col: 'center' };
  if (zone === 'center') return { row: 'middle', col: 'center' };
  if (zone === 'top') return { row: 'top', col: 'center' };
  if (zone === 'left' || zone === 'right') return { row: 'middle', col: zone };
  const [row, col] = zone.split('-');
  return { row, col };
}
function captionZoneVars(zone) {
  if (!zone || zone === 'bottom') return {};
  const parts = captionZoneParts(zone);
  const v = parts.row === 'top' ? '7%' : parts.row === 'middle' ? '0' : 'auto';
  const b = parts.row === 'bottom' ? '7%' : parts.row === 'middle' ? '0' : 'auto';
  const align = parts.col === 'left' ? 'flex-start' : parts.col === 'right' ? 'flex-end' : 'center';
  return {
    '--caption-top': v,
    '--caption-bottom': b,
    '--caption-left': '4%',
    '--caption-right': '4%',
    '--caption-justify-content': parts.row === 'middle' ? 'center' : 'flex-start',
    '--caption-align-items': align,
    // 行は既定で margin:0 auto（中央寄せ）なので、これを外さないと align-items が効かず
    // top-right などの水平成分が無視されて上中央に出る。shell の zoneVars と同じ指定。
    '--caption-line-margin': '0',
    '--caption-line-max-width': '100%',
    // text-align に flex-* を渡すと無効値。CSS の水平キーワードへ落とす
    '--caption-text-align': parts.col
  };
}

// 字幕ごとに設定しうる CSS 変数。前の字幕の指定が残ると次の字幕に持ち越されるため
// （実害: top-right の直後に出る既定 bottom の字幕が上段に出ていた）、毎回消してから積む。
const CAPTION_STYLE_VARS = [
  '--caption-color', '--caption-font-size', '--caption-text-shadow',
  '--plate-bg', '--plate-radius', '--plate-block-bg', '--plate-block-radius',
  '--caption-top', '--caption-bottom', '--caption-left', '--caption-right',
  '--caption-justify-content', '--caption-align-items',
  '--caption-line-margin', '--caption-line-max-width', '--caption-text-align'
];

// shell captionTextStyleVars の colorWithOpacity / strokeShadow と同じ変換（パリティ層）
function captionColorWithOpacity(color, explicitOpacity) {
  if (typeof color !== 'string' || !color.startsWith('#')) {
    return explicitOpacity === undefined ? String(color) : String(color);
  }
  const expanded = color.slice(1).length === 3
    ? color.slice(1).split('').map(ch => ch + ch).join('')
    : color.slice(1);
  const rgb = expanded.slice(0, 6).padEnd(6, '0');
  const alphaFromColor = expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1;
  const alpha = explicitOpacity ?? alphaFromColor;
  return `rgba(${parseInt(rgb.slice(0, 2), 16)},${parseInt(rgb.slice(2, 4), 16)},`
    + `${parseInt(rgb.slice(4, 6), 16)},${Number(alpha.toFixed(4))})`;
}
function captionStrokeShadow(color, width) {
  const negative = width === 0 ? '0' : `-${width}px`;
  const positive = width === 0 ? '0' : `${width}px`;
  return `${negative} ${negative} 0 ${color}, ${positive} ${negative} 0 ${color}, `
    + `${negative} ${positive} 0 ${color}, ${positive} ${positive} 0 ${color}, `
    + '0 0 8px rgba(0,0,0,.6)';
}

function applyCaptionStyle(caption) {
  for (const name of CAPTION_STYLE_VARS) captionPlate.style.removeProperty(name);
  let vars = {};
  if (captionsResolvedTimeline) {
    vars = caption?.style_vars && typeof caption.style_vars === 'object' ? { ...caption.style_vars } : {};
    replaceCaptionStyleVariables(captionPlate.style, vars);
    captionPlate.classList.add('akari-caption-resolved', 'akari-caption-styled');
    return;
  }
  const ts = caption?.text_style;
  const dts = summary?.default_text_style;
  if (ts?.color) vars['--caption-color'] = ts.color;
  else if (dts?.color) vars['--caption-color'] = dts.color;
  if (ts?.size_px) vars['--caption-font-size'] = ts.size_px + 'px';
  else if (dts?.size_px) vars['--caption-font-size'] = dts.size_px + 'px';
  else vars['--caption-font-size'] = defaultCaptionFontSize() + 'px';
  // 座布団（background）: block は 1 枚板の --plate-block-*、per-line/無指定は行ごとの --plate-*
  // （shell captionTextStyleVars と同じ振り分け。ここが無く座布団が一切描かれていなかった）
  const bg = ts?.background ?? dts?.background;
  if (bg && (bg.color !== undefined || bg.opacity !== undefined)) {
    const bgVar = bg.mode === 'block' ? '--plate-block-bg' : '--plate-bg';
    vars[bgVar] = captionColorWithOpacity(bg.color ?? '#000000', bg.opacity);
  }
  if (bg?.radius_px !== undefined) {
    const radiusVar = bg.mode === 'block' ? '--plate-block-radius' : '--plate-radius';
    vars[radiusVar] = bg.radius_px + 'px';
  }
  const stroke = ts?.stroke ?? dts?.stroke;
  if (stroke && (stroke.color !== undefined || stroke.width_px !== undefined)) {
    vars['--caption-text-shadow'] = captionStrokeShadow(stroke.color ?? 'rgba(0,0,0,.85)', stroke.width_px ?? 1.5);
  }
  const zone = ts?.zone || dts?.zone || 'bottom';
  Object.assign(vars, captionZoneVars(zone));
  replaceCaptionStyleVariables(captionPlate.style, vars);
  captionPlate.classList.toggle('akari-caption-resolved', captionsResolvedTimeline);
  captionPlate.classList.toggle('akari-caption-styled', captionsResolvedTimeline || !!ts || !!dts);
}

function getActiveCaptions() {
  // captions.json が正本（shell と同一）。edit.json 埋め込みはフォールバックのみ
  if (Array.isArray(captionsData) && captionsData.length > 0) return captionsData;
  const fromEdit = summary?.captions;
  return Array.isArray(fromEdit) ? fromEdit : [];
}
function normalizeWords(words) {
  if (!Array.isArray(words) || !words.length) return [];
  return words.map(w => ({
    start: w.start ?? w.t ?? 0,
    end: w.end ?? (w.t ?? 0) + (w.d ?? 0.3),
    text: w.text ?? w.word ?? w.w ?? '',
  }));
}
const EMPHASIS_STYLE_MAP = { pain: 'one-char-bang', surprise: 'one-char-bang', anger: 'one-char-bang', joy: 'size-pulse', emphasis: 'size-pulse' };
function findMatchingEmphasis(word, list) {
  return list?.find(e =>
    e.t_end > word.start && e.t_start < word.end &&
    (word.text === e.word || e.word.includes(word.text))
  ) || null;
}
function resolveEmphasisStyle(emphasis) {
  return emphasis.style_hint || EMPHASIS_STYLE_MAP[emphasis.emotion] || 'color-accent';
}
function groupWordsIntoLines(words, maxLen = 13) {
  const lines = [];
  let cur = [], len = 0;
  for (const w of words) {
    const wlen = Array.from(w.text).length;
    if (len + wlen > maxLen && cur.length > 0) { lines.push(cur); cur = []; len = 0; }
    cur.push(w); len += wlen;
  }
  if (cur.length > 0) lines.push(cur);
  return lines;
}
// --- render-cut とのパリティ層（正本: packages/render-cut/src/captions.mjs）---
// 縦長出力では「行を短く（10 字）・文字を大きく（幅 6%）・複数行字幕は行単位の順送り（reveal）」
// が焼き込み側の既定。プレビューも同じ既定で描く。ロジックは意図的な文字列/コード重複
// （render-cut は CLI パッケージで相互 import しない方針）。
function isPortraitOutput() {
  const os = summary?.output || {};
  return Number(os.height) > Number(os.width);
}
function captionLineBudget() { return isPortraitOutput() ? 10 : 20; }
function defaultCaptionFontSize() {
  const os = summary?.output || {};
  return isPortraitOutput() ? Math.round(Number(os.width) * 0.06) : 38;
}
const CAPTION_BOUNDARIES = ['から', 'まで', 'ので', 'のに', 'けど', 'て', 'で', 'は', 'が', 'を', 'に', 'へ', 'と', 'も', 'の'];
function splitCaptionLines(text, maximum) {
  const limit = Number.isFinite(maximum) && maximum > 0 ? Math.floor(maximum) : 20;
  const lines = [];
  for (const value of String(text).split(/\r?\n/u)) {
    if (value.length === 0) { lines.push(''); continue; }
    for (const segment of splitAfterPunctuation(value)) {
      lines.push(...splitAtNaturalBoundaries(segment, limit));
    }
  }
  return lines;
}
function splitAfterPunctuation(value) {
  const characters = Array.from(value);
  const segments = [];
  let start = 0;
  for (let index = 0; index < characters.length; index += 1) {
    if ((characters[index] === '、' || characters[index] === '。') && index + 1 < characters.length) {
      segments.push(characters.slice(start, index + 1).join(''));
      start = index + 1;
    }
  }
  segments.push(characters.slice(start).join(''));
  return segments;
}
function splitAtNaturalBoundaries(value, maximum) {
  const lines = [];
  let remaining = Array.from(value);
  while (remaining.length > maximum) {
    const spaceBoundary = findLastSpaceBoundary(remaining, maximum);
    const phraseBoundary = spaceBoundary ?? findLastPhraseBoundary(remaining, maximum);
    const boundary = phraseBoundary ?? maximum;
    lines.push(remaining.slice(0, boundary).join(''));
    remaining = remaining.slice(boundary);
  }
  if (remaining.length > 0) lines.push(remaining.join(''));
  return lines;
}
function findLastSpaceBoundary(characters, maximum) {
  for (let index = maximum - 1; index > 0; index -= 1) {
    if (characters[index] === ' ' || characters[index] === '　') return index + 1;
  }
  return null;
}
function findLastPhraseBoundary(characters, maximum) {
  const prefix = characters.slice(0, maximum).join('');
  let best = null;
  for (const boundary of CAPTION_BOUNDARIES) {
    const index = prefix.lastIndexOf(boundary);
    if (index >= 0) {
      const candidate = Array.from(prefix.slice(0, index + boundary.length)).length;
      if (candidate > 0 && (best === null || candidate > best)) best = candidate;
    }
  }
  return best;
}
// splitCaptionLines の分割点を word 境界へスナップして words を行へ配る
// （captions.mjs groupDisplayTokensIntoLines の words 専用ポート）。
function groupWordsIntoDisplayLines(words, maximum) {
  if (words.length === 0) return [];
  const text = words.map(w => w.text).join('');
  const desiredBoundaries = [];
  let desiredOffset = 0;
  for (const line of splitCaptionLines(text, maximum).slice(0, -1)) {
    desiredOffset += Array.from(line).length;
    desiredBoundaries.push(desiredOffset);
  }
  const ranges = [];
  let offset = 0;
  for (const word of words) {
    const start = offset;
    offset += Array.from(word.text).length;
    ranges.push({ word, start, end: offset });
  }
  const boundaries = [];
  let previous = 0;
  for (const desired of desiredBoundaries) {
    const containing = ranges.find(({ start, end }) => start < desired && desired < end);
    let snapped = desired;
    if (containing) {
      const candidates = [containing.start, containing.end]
        .filter(candidate => candidate > previous && candidate < offset);
      const withinTolerance = candidates.filter(candidate => candidate - previous <= maximum + 2);
      const eligible = withinTolerance.length > 0 ? withinTolerance : candidates;
      if (eligible.length === 0) continue;
      snapped = eligible.reduce((best, candidate) =>
        Math.abs(candidate - desired) < Math.abs(best - desired) ? candidate : best);
    }
    if (snapped > previous && snapped < offset) { boundaries.push(snapped); previous = snapped; }
  }
  const lines = [];
  let start = 0;
  for (const end of [...boundaries, offset]) {
    const line = ranges.filter(r => r.end > start && r.start < end).map(r => r.word);
    if (line.length > 0) lines.push(line);
    start = end;
  }
  return lines;
}
// 行グループを開始時刻ごとに束ねて順送り表示の markup を作る
// （captions.mjs renderRevealGroups のポート。preview は速度リマップ無しの source 秒）。
function renderRevealGroupsMarkup(lines, rangeStart, rangeEnd, renderLine) {
  const groups = [];
  for (const line of lines) {
    const start = line[0]?.start ?? rangeStart;
    const previous = groups[groups.length - 1];
    if (previous && previous.start === start) previous.lines.push(line);
    else groups.push({ start, lines: [line] });
  }
  return groups.map((group, index) => {
    const nextStart = groups[index + 1]?.start ?? rangeEnd;
    const delay = Math.max(0, group.start - rangeStart);
    const duration = Math.max(0.01, nextStart - group.start);
    const lineMarkup = group.lines
      .map(line => `<p class="akari-caption__line">${renderLine(line)}</p>`)
      .join('');
    return `<div class="akari-caption__reveal-group" style="--akari-reveal-delay:${delay.toFixed(3)}s;--akari-reveal-dur:${duration.toFixed(3)}s">${lineMarkup}</div>`;
  }).join('');
}
function injectCaptionStyles() {
  if (captionStylesInjected) return;
  captionStylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
@keyframes akari-caption-karaoke-lit {
  from { color: var(--caption-color, #fff); }
  to   { color: var(--caption-highlight-color, #ffd94a); }
}
@keyframes akari-caption-pop {
  0%   { transform: translateY(0) scale(1); }
  50%  { transform: translateY(-0.08em) scale(1.12); }
  100% { transform: translateY(0) scale(1); }
}
@keyframes akari-caption-reveal-word {
  0% { opacity:0; }
  100% { opacity:1; }
}
@keyframes akari-emphasis-one-char-bang {
  from { opacity: 0; transform: scale(1.6); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes akari-emphasis-size-pulse {
  0%   { transform: scale(1); }
  50%  { transform: scale(1.25); }
  100% { transform: scale(1); }
}
.akari-caption { position:absolute; inset:0; pointer-events:none; color:var(--caption-color,#fff); -webkit-text-stroke:var(--caption-stroke,0.14em rgba(0,0,0,.9)); paint-order:stroke fill; text-shadow:var(--caption-text-shadow,0 2px 8px rgba(0,0,0,.35)); font-family:"Noto Sans JP",sans-serif; font-size:var(--caption-font-size,38px); font-weight:700; line-height:1.42; text-align:center; }
.akari-caption__plate { position:absolute; top:var(--caption-top,auto); left:var(--caption-left,0); right:var(--caption-right,0); bottom:var(--caption-bottom,7%); display:flex; flex-direction:column; justify-content:var(--caption-justify-content,flex-start); align-items:var(--caption-align-items,stretch); gap:4px; }
.akari-caption__line { width:max-content; max-width:var(--caption-line-max-width,92%); margin:var(--caption-line-margin,0 auto); padding:0.08em 0.42em; border-radius:10px; background:var(--plate-bg,transparent); text-align:var(--caption-text-align,center); white-space:pre; }
.akari-caption__block { display:flex; flex-direction:column; width:max-content; max-width:var(--caption-line-max-width,92%); margin:var(--caption-line-margin,0 auto); gap:var(--plate-gap,4px); padding:var(--plate-pad-y,0.08em) var(--plate-pad-x,0.42em); border-radius:var(--plate-block-radius,10px); background:var(--plate-block-bg,transparent); }
.akari-caption__block .akari-caption__line { width:auto; max-width:none; margin:0; padding:0; border-radius:0; background:transparent; }
.akari-caption--reveal .akari-caption__plate { display:grid; }
.akari-caption__reveal-group { grid-area:1 / 1; display:flex; flex-direction:column; gap:4px; opacity:0; animation:akari-caption-reveal var(--akari-reveal-dur,0.2s) var(--akari-reveal-delay,0s) linear both paused; }
@keyframes akari-caption-reveal {
  0% { opacity:0; transform:translateY(0.18em); }
  12% { opacity:1; transform:translateY(0); }
  99.99% { opacity:1; transform:translateY(0); }
  100% { opacity:0; transform:translateY(0); }
}
.akari-caption__tok { display:inline-block; will-change:transform,color; }
.akari-caption__tok--karaoke { animation:akari-caption-karaoke-lit var(--akari-tok-dur,0.2s) var(--akari-tok-delay,0s) linear both paused; }
.akari-caption__tok--pop { animation:akari-caption-pop 0.2s var(--akari-tok-delay,0s) ease-out both paused; }
.akari-caption__tok--reveal-word { animation:akari-caption-reveal-word 0.01s var(--akari-tok-delay,0s) linear both paused; }
.akari-caption__tok--emphasis { }
.akari-caption__tok--one-char-bang { color:var(--akari-emphasis-color,var(--caption-color,#fff)); }
.akari-caption__tok--size-pulse { animation:akari-emphasis-size-pulse var(--akari-emphasis-dur,0.2s) var(--akari-emphasis-delay,0s) ease-in-out both paused; color:var(--akari-emphasis-color,var(--caption-color,#fff)); }
.akari-caption__tok--color-accent { color:var(--akari-emphasis-color,var(--caption-color,#fff)); }
.akari-caption__emphasis-char { display:inline-block; opacity:0; animation:akari-emphasis-one-char-bang var(--akari-emphasis-dur,0.1s) var(--akari-emphasis-delay,0s) ease-out both paused; }
`;
  document.head.appendChild(style);
}
function renderStyledToken(word, captionStart, style) {
  const delay = word.start - captionStart;
  const dur = Math.max(0.01, word.end - word.start);
  if (style === 'reveal-word') {
    return `<span class="akari-caption__tok akari-caption__tok--reveal-word" style="--akari-tok-delay:${delay}s">${esc(word.text)}</span>`;
  }
  const cls = style === 'pop' ? 'akari-caption__tok--pop' : 'akari-caption__tok--karaoke';
  const vars = style === 'pop'
    ? `--akari-tok-delay:${delay}s`
    : `--akari-tok-delay:${delay}s;--akari-tok-dur:${dur}s`;
  return `<span class="akari-caption__tok ${cls}" style="${vars}">${esc(word.text)}</span>`;
}
function renderEmphasisToken(word, captionStart, emphasis) {
  const estyle = resolveEmphasisStyle(emphasis);
  const overlapStart = Math.max(word.start, emphasis.t_start);
  const overlapEnd = Math.min(word.end, emphasis.t_end);
  const delay = Math.max(0, overlapStart - captionStart);
  const dur = Math.max(0.01, overlapEnd - overlapStart);
  const emotion = ['joy', 'pain', 'surprise', 'anger', 'sadness', 'emphasis'].includes(emphasis.emotion) ? emphasis.emotion : 'emphasis';
  const colorVar = `--akari-emphasis-color:var(--akari-emphasis-${emotion},var(--caption-color,#fff))`;
  if (estyle === 'one-char-bang') {
    const chars = Array.from(word.text);
    const charDur = dur / chars.length;
    const charHtml = chars.map((ch, i) =>
      `<span class="akari-caption__emphasis-char" style="${colorVar};--akari-emphasis-delay:${(delay + charDur * i).toFixed(3)}s;--akari-emphasis-dur:${charDur.toFixed(3)}s">${esc(ch)}</span>`
    ).join('');
    return `<span class="akari-caption__tok akari-caption__tok--emphasis akari-caption__tok--one-char-bang" data-emphasis-id="${esc(emphasis.id)}">${charHtml}</span>`;
  }
  if (estyle === 'size-pulse') {
    return `<span class="akari-caption__tok akari-caption__tok--emphasis akari-caption__tok--size-pulse" data-emphasis-id="${esc(emphasis.id)}" style="${colorVar};--akari-emphasis-delay:${delay}s;--akari-emphasis-dur:${dur}s">${esc(word.text)}</span>`;
  }
  return `<span class="akari-caption__tok akari-caption__tok--emphasis akari-caption__tok--color-accent" data-emphasis-id="${esc(emphasis.id)}" style="${colorVar}">${esc(word.text)}</span>`;
}
let _lastCaptionId = null;
// 字幕ウィンドウ判定（start/end はソース秒・duration は end 不在時のみ）は
// 共有カーネル findActiveCaption（edit-kernel.bundle.js — packages/edit-store/src/caption-window.ts）
function updateCaption() {
  const caps = getActiveCaptions();
  if (!caps.length) { captionPlate.textContent = ''; _lastCaptionId = null; return; }
  const srcT = getVideoTimeForOutput(outputTime);
  const active = findActiveCaption(caps, captionsResolvedTimeline ? outputTime : srcT);
  if (!active) { captionPlate.textContent = ''; _lastCaptionId = null; return; }
  if (active.id === _lastCaptionId) return;
  _lastCaptionId = active.id;
  applyCaptionStyle(active);
  const words = normalizeWords(active.words);
  const emphasisWords = summary?.emphasis_words;
  const hasWords = words.length > 0;
  const hasEmphasis = hasWords && emphasisWords?.length > 0 && words.some(w => findMatchingEmphasis(w, emphasisWords));
  const style = active.style;
  const explicitStyle = (style && ['karaoke', 'pop', 'reveal-word'].includes(style)) ? style : null;
  // reveal（行単位の順送り表示）: 明示指定に加え、縦長では複数行に折り返す無指定字幕を
  // 自動昇格させる（render-cut generateCaptionOverlays と同じ既定）。
  const displayText = active.display_text || active.text || '';
  const wantsReveal = hasWords && (style === 'reveal'
    || (!style && isPortraitOutput()
      && splitCaptionLines(displayText, captionLineBudget()).length > 1));
  const wordStyle = explicitStyle ?? (hasEmphasis ? 'emphasis' : null);
  // 座布団 block モード: 行群を 1 枚板ラッパーで包む（shell / render-cut と同じ構造）
  const blockMode = (active.text_style?.background?.mode
    ?? summary?.default_text_style?.background?.mode) === 'block';
  const wrapPlate = inner => blockMode ? `<div class="akari-caption__block">${inner}</div>` : inner;
  injectCaptionStyles();
  if (wantsReveal) {
    const start = Number(active.start) || 0;
    const end = Number(active.end) || (words[words.length - 1]?.end ?? start);
    const lines = groupWordsIntoDisplayLines(words, captionLineBudget());
    captionPlate.innerHTML = `<div class="akari-caption akari-caption--reveal"><div class="akari-caption__plate">${
      wrapPlate(renderRevealGroupsMarkup(lines, start, end, line =>
        line.map(w => {
          const ew = findMatchingEmphasis(w, emphasisWords);
          return ew ? renderEmphasisToken(w, start, ew)
            : `<span class="akari-caption__tok">${esc(w.text)}</span>`;
        }).join('')))
    }</div></div>`;
    captionPlate.dataset.captionStart = String(start);
  } else if (wordStyle && hasWords) {
    const start = Number(active.start) || 0;
    const lines = groupWordsIntoLines(words, captionLineBudget());
    captionPlate.innerHTML = `<div class="akari-caption akari-caption--${wordStyle}"><div class="akari-caption__plate">${
      wrapPlate(lines.map(line => `<p class="akari-caption__line">${
        line.map(w => {
          const ew = findMatchingEmphasis(w, emphasisWords);
          if (style === 'reveal-word') return renderStyledToken(w, start, style);
          return ew ? renderEmphasisToken(w, start, ew) : renderStyledToken(w, start, style);
        }).join(' ')
      }</p>`).join(''))
    }</div></div>`;
    captionPlate.dataset.captionStart = String(start);
  } else {
    if (captionsResolvedTimeline) {
      captionPlate.innerHTML = `<span class="akari-caption__resolved-line">${esc(active.text || '')}</span>`;
    } else {
      // 無指定字幕は render-cut のプレーン fragment と同じ静的な行分割で描く
      const lines = splitCaptionLines(displayText, captionLineBudget());
      captionPlate.innerHTML = `<div class="akari-caption"><div class="akari-caption__plate">${
        wrapPlate(lines.map(line => `<p class="akari-caption__line">${esc(line)}</p>`).join(''))
      }</div></div>`;
    }
    delete captionPlate.dataset.captionStart;
  }
}
function syncCaptionAnimations() {
  const start = Number(captionPlate.dataset.captionStart);
  if (!Number.isFinite(start)) return;
  const localMs = Math.max(0, (getVideoTimeForOutput(outputTime) - start) * 1000);
  for (const a of captionPlate.getAnimations({ subtree: true })) {
    a.pause();
    a.currentTime = localMs;
  }
}
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// メッセージカードはクリックか Escape で閉じられる（P2-4: 以前は次の正常保存かリロードまで居座った）
function showMessage(text) {
  if (text) {
    previewMessage.hidden = false;
    previewMessageText.textContent = text;
    previewMessage.title = 'クリックで閉じる';
    previewMessage.style.cursor = 'pointer';
  } else {
    previewMessage.hidden = true;
  }
}
previewMessage.addEventListener('click', () => showMessage(null));
document.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && !previewMessage.hidden) showMessage(null);
});

let wsTickLast = 0;
function connectWs() {
  const p = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${p}//${location.host}`);
  ws.onmessage = (e) => {
    try {
      const m = JSON.parse(e.data);
      if (m.type === 'reload') { requestSoftReload(); return; }
      if (m.type === 'captions-reload') {
        Promise.all([fetch(api.summary), fetch(api.captions)]).then(async ([summaryResponse, captionsResponse]) => {
          if (summaryResponse.ok) summary = normalizeLegacyCutTransitions(await summaryResponse.json());
          if (captionsResponse.ok) {
            const body = await captionsResponse.json();
            captionsData = Array.isArray(body) ? body : (body?.captions ?? []);
            captionsResolvedTimeline = body?.schema === 'caption-layout/v1';
            _lastCaptionId = null;
            updateCaption();
          }
        }).catch(() => {});
        return;
      }
      if (m.type === 'seek') { pause(); seekTo(m.time); }
      if (m.type === 'tick') {
        if (m.playing && !isPlaying) { outputTime = m.time; seekTo(m.time); play(); }
        else if (!m.playing && isPlaying) { pause(); }
        else if (Math.abs(outputTime - m.time) > 0.3) { seekTo(m.time); }
      }
    } catch {}
  };
  ws.onclose = () => { ws = null; setTimeout(connectWs, 2000); };
  ws.onerror = () => { if (ws) ws.close(); };
}

function sendWsTick() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'tick', time: outputTime, playing: isPlaying }));
}

// --- Review recording ---
reviewRecordBtn.addEventListener('click', async () => {
  if (reviewSession) { await stopReviewRecording(); return; }
  try {
    reviewStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    reviewRecorder = new MediaRecorder(reviewStream, { mimeType: 'audio/webm;codecs=opus' });
  } catch {
    reviewStream = null; reviewRecorder = null;
    showMessage('マイクへのアクセスを許可してください');
    return;
  }
  showMessage('レビュー録音中…');
  const startedAt = new Date().toISOString();
  try {
    const r = await fetch('/api/review/start', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startedAt }),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    reviewSession = data.id;
  } catch (e) {
    reviewStream.getTracks().forEach(t => t.stop());
    reviewStream = null; reviewRecorder = null;
    showMessage('セッション開始に失敗: ' + e.message);
    return;
  }
  reviewRecStart = performance.now();
  reviewRecordBtn.classList.add('is-recording');
  reviewRecordBtn.setAttribute('aria-pressed', 'true');
  reviewTimer.classList.add('is-active');
  reviewTimer.textContent = '0:00';
  reviewTimerRAF = requestAnimationFrame(updateReviewTimer);
  // Snapshot edit.json at start
  fetch('/api/review/' + reviewSession + '/snapshot', { method: 'POST' }).catch(() => {});
  // Start MediaRecorder
  const audioChunks = [];
  reviewRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
  reviewRecorder.onstop = async () => {
    cancelAnimationFrame(reviewTimerRAF);
    reviewTimer.classList.remove('is-active');
    reviewRecordBtn.classList.remove('is-recording');
    reviewRecordBtn.setAttribute('aria-pressed', 'false');
    try {
      await sendReviewAudio(audioChunks);
      await sendReviewEvents();
      await sendReviewEnd();
    } catch (e) {
      showMessage('録音の保存に失敗: ' + e.message);
    }
    reviewStream.getTracks().forEach(t => t.stop());
    reviewStream = null; reviewRecorder = null;
    reviewSession = null;
    reviewEvents = [];
    showMessage(null);
  };
  reviewRecorder.start();
});
reviewRecordBtn.addEventListener('dblclick', async () => {
  if (!reviewSession) return;
  await stopReviewRecording();
});
async function stopReviewRecording() {
  if (reviewRecorder && reviewRecorder.state === 'recording') reviewRecorder.stop();
}
async function sendReviewAudio(chunks) {
  if (!chunks.length) return;
  const blob = new Blob(chunks, { type: 'audio/webm' });
  // Convert to WAV-ish blob or just send raw
  await fetch('/api/review/' + reviewSession + '/audio', {
    method: 'POST',
    body: blob,
  });
}
async function sendReviewEvents() {
  if (!reviewEvents.length) return;
  await fetch('/api/review/' + reviewSession + '/events', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(reviewEvents),
  });
}
async function sendReviewEnd() {
  const editRes = await fetch('/api/review/' + reviewSession + '/snapshot', { method: 'POST' });
  const { editHash } = editRes.ok ? await editRes.json() : {};
  await fetch('/api/review/' + reviewSession + '/end', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endedAt: new Date().toISOString(), editHash }),
  });
}
function updateReviewTimer() {
  const elapsed = (performance.now() - reviewRecStart) / 1000;
  const m = Math.floor(elapsed / 60);
  const s = Math.floor(elapsed % 60);
  reviewTimer.textContent = m + ':' + String(s).padStart(2, '0');
  reviewTimerRAF = requestAnimationFrame(updateReviewTimer);
}
function logReviewEvent(type, extra) {
  if (!reviewSession) return;
  const recT = (performance.now() - reviewRecStart) / 1000;
  reviewEvents.push({ recT: +recT.toFixed(3), type, timelineT: +outputTime.toFixed(3), playing: isPlaying, ...extra });
}

// --- Output preview ---
const outputBtn = document.getElementById('output-preview-btn');
if (isOutputMode) {
  document.title = 'AKARI Video Preview (出力)';
  outputBtn.hidden = true;
  reviewRecordBtn.hidden = true;
} else {
  outputBtn.hidden = false;
  outputBtn.addEventListener('click', () => {
    window.open('/?mode=output', 'akari-output-preview', 'width=960,height=600');
  });
}

init();
connectWs();
