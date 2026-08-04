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
let drag = null;

let editMode = false;

let audioCtx = null;
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
let captionStylesInjected = false;

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
    const [timelineRes, editRes, captionsRes] = await Promise.all([
      fetch(api.timeline),
      fetch(api.summary),
      fetch(api.captions).catch(() => new Response(null, { status: 404 })),
    ]);
    if (!timelineRes.ok) throw new Error(`timeline: HTTP ${timelineRes.status}`);
    timelineData = await timelineRes.json();
    summary = await editRes.json();
    if (captionsRes.ok) {
      const body = await captionsRes.json();
      captionsData = Array.isArray(body) ? body : (body?.captions ?? []);
    } else {
      captionsData = [];
    }
    fps = timelineData.fps || 30;

    buildSegments();
    if (summary?.cuts?.length > 0) video.src = getVideoSource(0);
    updateStageScale();
    setupLayers();
    setupPenCanvas();
    initPenSprites();
    setupAudioGraph();
    setupWaveform();
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
      setTimeout(setupWaveform, 100);
    }

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
  const os = outputSizePx();
  const rect = computeOutputFrameRect();
  const next = rect.width / os.width;
  frameScale = Number.isFinite(next) && next > 0 ? next : 1;
  for (const el of [stage, layerContainer]) {
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.width = `${os.width}px`;
    el.style.height = `${os.height}px`;
    el.style.transformOrigin = '0 0';
    el.style.transform = `scale(${frameScale})`;
  }
}
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
        durationSec: s.outEnd - s.outStart, outStart: s.outStart, outEnd: s.outEnd, track: s.track ?? 0
      });
  totalDuration = built.totalDuration;
  seek.max = totalDuration;
  updateTimeLabel();
  updateSeekVisual();
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

function setupLayers() {
  const layers = summary?.layers ?? [];
  for (const layer of layers) {
    if (!layer.src) continue;
    const el = document.createElement('video');
    el.preload = 'auto';
    el.muted = true;
    el.playsInline = true;
    // サイドカーが無い案件（--no-preview-proxy で焼いた等）は 404 で error になる。
    // その場合だけ非表示にして知らせる（黒板で映像を覆わないため）
    el.addEventListener('error', () => {
      const lv = layerVideos.find(x => x.el === el);
      if (lv) lv.unplayable = true;
      el.style.display = 'none';
      console.warn('[preview] レイヤーを再生できません（プレビュー用サイドカーを確認）', layer.id, el.src);
    });
    // 一時停止中は syncLayers がシーク時にしか走らない。読み込みがそれより遅いと
    // 「窓の中なのに出ない」まま次の操作まで固まるので、メタデータ到着で貼り直す
    el.addEventListener('loadedmetadata', () => syncLayers(outputTime));
    el.src = resolveMediaUrl(layerPlaybackPath(layer));
    el.dataset.layerId = layer.id;
    el.style.display = 'none';
    el.style.opacity = String(layer.opacity ?? 1);
    if (layer.blend) el.style.mixBlendMode = layer.blend;
    el.dataset.layerX = layer.transform?.x || 0;
    el.dataset.layerY = layer.transform?.y || 0;
    el.dataset.layerScale = layer.transform?.scale || 1;
    el.dataset.layerRotate = layer.transform?.rotate || 0;
    if (layer.transform) {
      const t = layer.transform;
      el.style.transform = `translate(${t.x||0}px, ${t.y||0}px) scale(${t.scale||1}) rotate(${t.rotate||0}deg)`;
    }
    layerContainer.appendChild(el);
    layerVideos.push({ el, layer, visible: false });
  }
}

function syncLayers(t) {
  for (const lv of layerVideos) {
    const l = lv.layer;
    // メタデータ前に出すと最初のフレームが黒板になるので、読めてから出す（shell と同じ規約）
    const shouldShow = !lv.unplayable
      && lv.el.readyState >= HTMLMediaElement.HAVE_METADATA
      && t >= (l.t ?? 0) && t < (l.t ?? 0) + (l.duration ?? 0);
    if (shouldShow !== lv.visible) {
      lv.el.style.display = shouldShow ? 'block' : 'none';
      lv.visible = shouldShow;
      if (!shouldShow && !lv.el.paused) lv.el.pause();
    }
    if (shouldShow) {
      const localT = t - (l.t ?? 0);
      const tolerance = isPlaying ? 0.05 : 0.001;
      if (Math.abs(lv.el.currentTime - localT) > tolerance) lv.el.currentTime = localT;
      if (isPlaying && lv.el.paused) void lv.el.play().catch(() => undefined);
      else if (!isPlaying && !lv.el.paused) lv.el.pause();
    }
  }
}

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
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
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
        if (!buf) return;
        const src = audioCtx.createBufferSource();
        src.buffer = buf; src.loop = audio.bgm.loop !== false;
        src.connect(gain);
        bgmNode._source = src;
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
      const node = { gain, src: sUrl, t: s.t ?? 0 };
      sfxNodes.push(node);
      loadAudioBuffer(sUrl).then((buf) => { node._buffer = buf; });
    }
  }
}
function dbToGain(db) { return Math.pow(10, (db ?? 0) / 20); }
async function loadAudioBuffer(url) {
  try { const r = await fetch(url); return r.ok ? audioCtx.decodeAudioData(await r.arrayBuffer()) : null; } catch { return null; }
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
async function computePeaks(url, numPeaks) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    const buf = await audioCtx.decodeAudioData(ab.slice(0));
    const ch = buf.getChannelData(0);
    const pn = Math.min(numPeaks || 200, ch.length);
    const spp = Math.max(1, Math.floor(ch.length / pn));
    const peaks = [];
    for (let i = 0; i < pn; i++) {
      let max = 0;
      for (let j = 0; j < spp && i * spp + j < ch.length; j++) max = Math.max(max, Math.abs(ch[i * spp + j]));
      peaks.push(max);
    }
    return { peaks, duration: buf.duration };
  } catch { return null; }
}
async function setupWaveform() {
  waveformCanvas.width = waveformCanvas.clientWidth * devicePixelRatio;
  waveformCanvas.height = waveformCanvas.clientHeight * devicePixelRatio;
  if (!timelineData.clips.length || !audioCtx) return;
  const main = await computePeaks(timelineData.clips[0].src, 400);
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

function seekTo(t) {
  cutInfoPopup.hidden = true;
  const prev = outputTime;
  outputTime = Math.max(0, Math.min(t, totalDuration));
  if (Math.abs(outputTime - prev) > 0.05) logReviewEvent('seek', { from: +prev.toFixed(3), to: +outputTime.toFixed(3) });
  const vt = getVideoTimeForOutput(outputTime);
  if (vt >= 0) {
    const seg = getActiveSegment(outputTime);
    // 同じソースへの再代入はロードをやり直してシーク自体を潰すため、変わった時だけ差し替える
    if (seg && seg.index >= 0) setVideoSourceIfChanged(video, getVideoSource(seg.index));
    video.currentTime = vt;
  }
  seek.value = outputTime;
  updateTimeLabel();
  updateStatusBar();
  updateCaption();
  syncCaptionAnimations();
  updateOverlays();
  // 一時停止中のシークでもトランジション帯を反映する（P2-1）
  updateTransitions();
  syncAudio(outputTime);
  syncLayers(outputTime);
}

function play() {
  if (isPlaying || !segments.length) return;
  logReviewEvent('play');
  isPlaying = true;
  lastWallMs = 0;
  if (audioCtx?.state === 'suspended') audioCtx.resume();
  if (bgmNode?._source && !bgmNode._source._started) { bgmNode._source.start(); bgmNode._source._started = true; }
  syncAudio(outputTime);
  video.play();
  for (const lv of layerVideos) if (lv.visible) lv.el.play();
  playToggle.innerHTML = pauseIcon;
  playToggle.setAttribute('aria-label', '一時停止');
  playToggle.title = '一時停止';
  requestAnimationFrame(playbackLoop);
}
function pause() {
  if (!isPlaying) return;
  logReviewEvent('pause');
  isPlaying = false; video.pause();
  for (const n of [...narrationNodes, ...sfxNodes]) {
    if (n._source) { try { n._source.stop(); } catch {} n._source = null; }
  }
  if (audioCtx?.state === 'running') audioCtx.suspend();
  for (const lv of layerVideos) lv.el.pause();
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
  const dt = lastWallMs > 0 ? (now - lastWallMs) / 1000 : 0;
  lastWallMs = now;
  outputTime += dt;
  if (outputTime >= totalDuration) { outputTime = totalDuration; pause(); return; }
  const target = getVideoTimeForOutput(outputTime);
  const seg = getActiveSegment(outputTime);
  if (target >= 0 && seg && seg.index >= 0) {
    setVideoSourceIfChanged(video, getVideoSource(seg.index));
    // ズレ補正は「シーク中でない」かつ「シーク遅延より大きくズレた」ときだけ。
    // 旧実装（閾値 0.1・シーク中も発行）は、1 回のシーク遅延がそのまま次フレームの
    // ズレになって再びしきい値を超えるため補正が自己増殖し、シーク暴走（実測 10 回/秒・
    // readyState 1 のまま・waiting でスピナー点灯・カクつき）を起こしていた。
    if (!video.seeking && Math.abs(video.currentTime - target) > SYNC_DEADBAND_SEC) {
      video.currentTime = target;
    }
  }
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
  if (!cuts.length) { transitionPlate.style.visibility = 'hidden'; return; }
  let cursor = 0;
  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    const speed = cut.speed || 1;
    const dur = ((cut.out ?? cut.in + 1) - (cut.in ?? 0)) / speed;
    if (cut.at !== undefined) cursor = cut.at;
    const nextStart = cursor + (cut.at !== undefined ? 0 : dur);
    if (cut.transitionOut && outputTime >= nextStart - cut.transitionOut.duration && outputTime < nextStart) {
      const p = (outputTime - (nextStart - cut.transitionOut.duration)) / cut.transitionOut.duration;
      transitionPlate.style.background = cut.transitionOut.type === 'fade-white' ? '#fff' : '#000';
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
  summary = await res.json();
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
  summary = await editRes.json();
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

  // 音声グラフを作り直し（旧 context を閉じて鳴っているソースも止める）
  if (audioCtx) { try { audioCtx.close(); } catch { /* already closed */ } }
  audioCtx = null; bgmNode = null; narrationNodes = []; sfxNodes = [];
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
    return;
  }
  cutInfoPopup.hidden = true;
  selectedCutIndex = -1;
}

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
  const tiType = cut.transitionIn?.type || '';
  const tiDur = cut.transitionIn?.duration !== undefined ? cut.transitionIn.duration.toFixed(2) : '';
  const toType = cut.transitionOut?.type || '';
  const toDur = cut.transitionOut?.duration !== undefined ? cut.transitionOut.duration.toFixed(2) : '';
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
      <label style="flex:1;color:#888;font-size:11px">IN トランジション
        <select id="cut-inp-ti-type" style="width:100%;background:#303030;color:#fff;border:1px solid #505050;border-radius:3px;padding:2px 4px;font-size:12px">
          <option value="">なし</option>
          <option value="dissolve"${tiType==='dissolve'?' selected':''}>dissolve</option>
          <option value="fade-black"${tiType==='fade-black'?' selected':''}>fade-black</option>
          <option value="fade-white"${tiType==='fade-white'?' selected':''}>fade-white</option>
        </select>
        <input id="cut-inp-ti-dur" type="number" step="0.01" min="0" value="${tiDur}" placeholder="秒" style="width:100%;background:#303030;color:#fff;border:1px solid #505050;border-radius:3px;padding:2px 4px;font-size:12px;margin-top:2px">
      </label>
      <label style="flex:1;color:#888;font-size:11px">OUT トランジション
        <select id="cut-inp-to-type" style="width:100%;background:#303030;color:#fff;border:1px solid #505050;border-radius:3px;padding:2px 4px;font-size:12px">
          <option value="">なし</option>
          <option value="dissolve"${toType==='dissolve'?' selected':''}>dissolve</option>
          <option value="fade-black"${toType==='fade-black'?' selected':''}>fade-black</option>
          <option value="fade-white"${toType==='fade-white'?' selected':''}>fade-white</option>
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
    const tiType = document.getElementById('cut-inp-ti-type').value;
    const tiDur = Number(document.getElementById('cut-inp-ti-dur').value);
    const toType = document.getElementById('cut-inp-to-type').value;
    const toDur = Number(document.getElementById('cut-inp-to-dur').value);
    if (!Number.isFinite(inVal) || !Number.isFinite(outVal) || !Number.isFinite(speedVal) || speedVal <= 0) return;
    const newCuts = [...(summary?.cuts || [])];
    const cut = newCuts[selectedCutIndex];
    if (!cut) return;
    const old = { in: cut.in, out: cut.out, speed: cut.speed, at: cut.at, transitionIn: cut.transitionIn, transitionOut: cut.transitionOut };
    cut.in = inVal; cut.out = outVal; cut.speed = speedVal;
    cut.at = atVal ? Number(atVal) : undefined;
    cut.transitionIn = tiType ? { type: tiType, duration: Number.isFinite(tiDur) && tiDur > 0 ? tiDur : 0.3 } : undefined;
    cut.transitionOut = toType ? { type: toType, duration: Number.isFinite(toDur) && toDur > 0 ? toDur : 0.3 } : undefined;
    try {
      const res = await fetch('/api/edit.json', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...summary, cuts: newCuts })
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
    body: JSON.stringify({ ...summary, cuts: newCuts })
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
    body: JSON.stringify({ ...summary, cuts: newCuts })
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
    body: JSON.stringify({ ...summary, cuts: newCuts })
  });
  if (res.ok) {
    buildSegments();
    seekTo(outputTime);
  } else {
    showMessage(await editSaveErrorMessage(res));
  }
}

// Wire seek visual click
seekVisual.addEventListener('click', (e) => {
  const rect = seek.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  const t = Math.max(0, Math.min(totalDuration, ratio * totalDuration));
  const w = isPlaying; if (w) pause();
  seekTo(t);
  showCutInfoAt(t);
  if (w) play();
});

playToggle.addEventListener('click', () => isPlaying ? pause() : play());
frameBack.addEventListener('click', () => { pause(); seekTo(outputTime - 1 / fps); });
frameForward.addEventListener('click', () => { pause(); seekTo(outputTime + 1 / fps); });
skipBack.addEventListener('click', () => { pause(); seekTo(outputTime - 10); });
skipForward.addEventListener('click', () => { pause(); seekTo(outputTime + 10); });
seek.addEventListener('input', () => {
  const t = Number(seek.value);
  const w = isPlaying; if (w) pause();
  seekTo(t);
  showCutInfoAt(t);
  if (w) play();
});
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

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
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
    case 'Escape': shortcutHelp.hidden = true; break;
    case 'KeyZ': if (e.ctrlKey || e.metaKey) { e.preventDefault(); } break;
  }
});
video.addEventListener('loadstart', () => { loadingIndicator.style.display = 'block'; });
video.addEventListener('canplay', () => { loadingIndicator.style.display = 'none'; });
video.addEventListener('waiting', () => { loadingIndicator.style.display = 'block'; });
video.addEventListener('playing', () => { loadingIndicator.style.display = 'none'; });
video.addEventListener('error', () => { loadingIndicator.style.display = 'none'; });

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
  if (!editMode) window.akari.interaction?.clearSelection?.();
}
editToggle.addEventListener('click', () => {
  const next = !editMode;
  if (next) { penEnable(false); }
  setEditMode(next);
});
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

// --- Overlay runtime ---
function createOverlayRuntime() {
  const overlays = [];
  function unmount() { stage.querySelectorAll('[data-overlay-id]').forEach(el => el.remove()); overlays.length = 0; }
  function mount(s) {
    unmount();
    if (!Array.isArray(s?.overlays)) return;
    const frag = document.createDocumentFragment();
    for (const o of s.overlays) {
      const c = document.createElement('div');
      c.dataset.overlayId = String(o.id);
      c.dataset.start = String(o.start);
      c.dataset.duration = String(o.duration);
      c.style.cssText = 'position:absolute;inset:0;pointer-events:auto;visibility:hidden;touch-action:none;';
      const t = o.transform || {};
      c.style.setProperty('--x', `${t.x||0}px`);
      c.style.setProperty('--y', `${t.y||0}px`);
      c.style.setProperty('--scale', String(t.scale||1));
      c.style.setProperty('--rotate', `${t.rotate||0}deg`);
      c.style.transform = 'translate(var(--x,0px), var(--y,0px)) scale(var(--scale,1)) rotate(var(--rotate,0deg))';
      if (o.vars && typeof o.vars === 'object') {
        for (const [k, v] of Object.entries(o.vars)) {
          if (k.startsWith('--') && (typeof v === 'string' || typeof v === 'number')) c.style.setProperty(k, String(v));
        }
      }
      // html は「< で始まればインライン、それ以外はファイルパス参照」（shell と同一解釈。lint 契約はパス参照が正）
      const rawHtml = typeof o.html === 'string' ? o.html : '';
      if (rawHtml && !rawHtml.trimStart().startsWith('<')) {
        c.innerHTML = '';
        fetch(resolveMediaUrl(rawHtml))
          .then(r => (r.ok ? r.text() : ''))
          .then(html => { c.innerHTML = html || ''; })
          .catch(() => {});
      } else {
        c.innerHTML = rawHtml;
      }
      frag.appendChild(c);
      overlays.push({ el: c, start: o.start, duration: o.duration, visible: false });
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
        o.visible = v;
      }
      if (!v) continue;
      const ms = Math.max(0, (t - o.start) * 1000);
      for (const a of o.el.getAnimations({ subtree: true })) { a.pause(); a.currentTime = ms; }
      // ㉑ 当たり判定（clip-path）は断片の実寸に合わせる。ただし可視化時に 1 回だけ測ると、
      // その後アニメで拡大した分がはみ出して**見た目まで切り取られる**（実測: pop 断片が
      // 1.13 倍に育った瞬間、円が角丸四角に切れた）。アニメを進めた後に測り直す。
      syncHitRegion(o.el);
    }
  }
  // 断片の顔ぶれ（id / html / 表示窓）が変わっていないときに、位置や見た目だけを
  // 貼り直す。ドラッグ 1 回のたびに 13 枚を作り直すと画面がチラつくため、
  // 再マウントは「構成が変わったとき」だけに絞る。
  function applyProps(s) {
    for (const o of (s?.overlays || [])) {
      const entry = overlays.find(x => x.el.dataset.overlayId === String(o.id));
      if (!entry) continue;
      const t = o.transform || {};
      entry.el.style.setProperty('--x', `${t.x || 0}px`);
      entry.el.style.setProperty('--y', `${t.y || 0}px`);
      entry.el.style.setProperty('--scale', String(t.scale || 1));
      entry.el.style.setProperty('--rotate', `${t.rotate || 0}deg`);
      if (o.vars && typeof o.vars === 'object') {
        for (const [k, v] of Object.entries(o.vars)) {
          if (k.startsWith('--') && (typeof v === 'string' || typeof v === 'number')) {
            entry.el.style.setProperty(k, String(v));
          }
        }
      }
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
async function overlayWriteViaPut(editPath, overlayId, patch) {
  const res = await fetch('/api/summary');
  if (!res.ok) throw new Error(`edit.json を読めません: HTTP ${res.status}`);
  const edit = await res.json();
  const ov = (edit.overlays || []).find(o => String(o.id) === String(overlayId));
  if (!ov) throw new Error(`オーバーレイが見つかりません: ${overlayId}`);
  for (const [key, value] of Object.entries(patch || {})) {
    if (key === 'transform') ov.transform = { ...ov.transform, ...value };
    else if (key === 'vars') ov.vars = { ...ov.vars, ...value };
    else ov[key] = value;
  }
  const put = await fetch('/api/edit.json', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(edit),
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

function applyCaptionStyle(caption) {
  for (const name of CAPTION_STYLE_VARS) captionPlate.style.removeProperty(name);
  let vars = {};
  const ts = caption?.text_style;
  const dts = summary?.default_text_style;
  if (ts?.color) vars['--caption-color'] = ts.color;
  else if (dts?.color) vars['--caption-color'] = dts.color;
  if (ts?.size_px) vars['--caption-font-size'] = ts.size_px + 'px';
  else if (dts?.size_px) vars['--caption-font-size'] = dts.size_px + 'px';
  else vars['--caption-font-size'] = defaultCaptionFontSize() + 'px';
  const zone = ts?.zone || dts?.zone || 'bottom';
  Object.assign(vars, captionZoneVars(zone));
  for (const [k, v] of Object.entries(vars)) captionPlate.style.setProperty(k, v);
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
  const active = findActiveCaption(caps, srcT);
  if (!active) { captionPlate.textContent = ''; _lastCaptionId = null; return; }
  if (active.id === _lastCaptionId) return;
  _lastCaptionId = active.id;
  applyCaptionStyle(active);
  const words = normalizeWords(active.words);
  const emphasisWords = summary?.emphasis_words;
  const hasWords = words.length > 0;
  const hasEmphasis = hasWords && emphasisWords?.length > 0 && words.some(w => findMatchingEmphasis(w, emphasisWords));
  const style = active.style;
  const explicitStyle = (style && ['karaoke', 'pop'].includes(style)) ? style : null;
  // reveal（行単位の順送り表示）: 明示指定に加え、縦長では複数行に折り返す無指定字幕を
  // 自動昇格させる（render-cut generateCaptionOverlays と同じ既定）。
  const displayText = active.display_text || active.text || '';
  const wantsReveal = hasWords && (style === 'reveal'
    || (!style && isPortraitOutput()
      && splitCaptionLines(displayText, captionLineBudget()).length > 1));
  const wordStyle = explicitStyle ?? (hasEmphasis ? 'emphasis' : null);
  injectCaptionStyles();
  if (wantsReveal) {
    const start = Number(active.start) || 0;
    const end = Number(active.end) || (words[words.length - 1]?.end ?? start);
    const lines = groupWordsIntoDisplayLines(words, captionLineBudget());
    captionPlate.innerHTML = `<div class="akari-caption akari-caption--reveal"><div class="akari-caption__plate">${
      renderRevealGroupsMarkup(lines, start, end, line =>
        line.map(w => {
          const ew = findMatchingEmphasis(w, emphasisWords);
          return ew ? renderEmphasisToken(w, start, ew)
            : `<span class="akari-caption__tok">${esc(w.text)}</span>`;
        }).join(''))
    }</div></div>`;
    captionPlate.dataset.captionStart = String(start);
  } else if (wordStyle && hasWords) {
    const start = Number(active.start) || 0;
    const lines = groupWordsIntoLines(words, captionLineBudget());
    captionPlate.innerHTML = `<div class="akari-caption akari-caption--${wordStyle}"><div class="akari-caption__plate">${
      lines.map(line => `<p class="akari-caption__line">${
        line.map(w => {
          const ew = findMatchingEmphasis(w, emphasisWords);
          return ew ? renderEmphasisToken(w, start, ew) : renderStyledToken(w, start, style);
        }).join(' ')
      }</p>`).join('')
    }</div></div>`;
    captionPlate.dataset.captionStart = String(start);
  } else {
    // 無指定字幕は render-cut のプレーン fragment と同じ静的な行分割で描く
    const lines = splitCaptionLines(displayText, captionLineBudget());
    captionPlate.innerHTML = `<div class="akari-caption"><div class="akari-caption__plate">${
      lines.map(line => `<p class="akari-caption__line">${esc(line)}</p>`).join('')
    }</div></div>`;
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
        fetch(api.summary).then(r => r.ok && r.json()).then(d => { if (d) summary = d; }).catch(() => {});
        fetch(api.captions).then(r => r.ok && r.json()).then(d => {
          if (d) { captionsData = Array.isArray(d) ? d : (d?.captions ?? []); _lastCaptionId = null; updateCaption(); }
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
