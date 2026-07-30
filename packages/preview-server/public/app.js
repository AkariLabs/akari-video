// AKARI Video Preview — full-featured client

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
const selectionLabel = document.getElementById('selection-label');
const transformPopup = document.getElementById('transform-popup');
const txInput = document.getElementById('tx');
const tyInput = document.getElementById('ty');
const tsInput = document.getElementById('ts');
const trInput = document.getElementById('tr');
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

const ZONE_ROW_RANGES = { top: [0, 1 / 3], middle: [1 / 3, 2 / 3], bottom: [2 / 3, 1] };
const ZONE_COL_RANGES = { left: [0, 1 / 3], center: [1 / 3, 2 / 3], right: [2 / 3, 1] };
const CAPTION_ZONE_LIST = ['bottom', 'bottom-left', 'bottom-right', 'center', 'left', 'right', 'top', 'top-left', 'top-right'];
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
let selectedId = null;
let selectedKind = null;
let captionEditMode = false;
let selectedCaptionId = null;
let selectedCaptionZone = 'bottom';

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
    window.akari.stageScale = () => zoomLayer.clientWidth / wrapper.clientWidth;
    const os = summary?.output || {};
    window.akari.outputSize = () => ({ width: os.width || 1280, height: os.height || 720 });
    if (window.akari.interaction) window.akari.interaction.init();

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

function getVideoSource(cutIndex) {
  const clip = timelineData.clips.find(c => c.id === `cut-${cutIndex}`);
  return clip ? clip.src : (timelineData.clips[0]?.src || '');
}

// --- Segments ---
function buildSegments() {
  if (!summary?.cuts) return;
  segments = [];
  const cutEvents = [];
  for (let i = 0; i < summary.cuts.length; i++) {
    const cut = summary.cuts[i];
    const speed = cut.speed || 1;
    const inSec = cut.in || 0;
    const outSec = cut.out || inSec + 1;
    const dur = (outSec - inSec) / speed;
    cutEvents.push({ index: i, inSec, outSec, speed, durationSec: dur, track: cut.track ?? 0, at: cut.at });
  }
  const trackMap = {};
  for (const c of cutEvents) {
    if (!trackMap[c.track]) trackMap[c.track] = [];
    trackMap[c.track].push(c);
  }
  const tracks = Object.keys(trackMap).map(Number).sort((a, b) => a - b);
  for (const tn of tracks) {
    const tc = trackMap[tn];
    let cursor = 0;
    for (let ci = 0; ci < tc.length; ci++) {
      const c = tc[ci];
      if (c.at !== undefined) cursor = c.at;
      const gap = ci === 0 ? 0 : Math.max(0, cursor - segments.reduce((s, seg) => s + seg.durationSec, 0));
      if (gap > 0) segments.push({ index: -1, durationSec: gap, isGap: true });
      segments.push(c);
      cursor += c.durationSec;
    }
  }
  totalDuration = segments.reduce((s, seg) => s + seg.durationSec, 0);
  seek.max = totalDuration;
  updateTimeLabel();
  updateSeekVisual();
}

// --- B-roll layers ---
function setupLayers() {
  const layers = summary?.layers ?? [];
  for (const layer of layers) {
    if (layer.kind === 'baked' || !layer.src) continue;
    const el = document.createElement('video');
    el.preload = 'auto';
    el.src = layer.src;
    el.dataset.layerId = layer.id;
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
    const shouldShow = t >= (l.t ?? 0) && t < (l.t ?? 0) + (l.duration ?? 0);
    if (shouldShow !== lv.visible) {
      lv.el.style.display = shouldShow ? 'block' : 'none';
      lv.el.style.pointerEvents = shouldShow && editMode ? 'auto' : 'none';
      lv.visible = shouldShow;
    }
    if (shouldShow) {
      const localT = t - (l.t ?? 0);
      if (Math.abs(lv.el.currentTime - localT) > 0.1) lv.el.currentTime = localT;
    }
  }
}

// --- Pen annotation canvas (upgraded: glow + gradient + sparkle) ---
function setupPenCanvas() {
  penCanvas.width = zoomLayer.clientWidth * devicePixelRatio;
  penCanvas.height = zoomLayer.clientHeight * devicePixelRatio;
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

const PEN_TUNING = {
  coreWidthPx: 3.2, coreAlpha: 0.88, glowSizePx: 28, glowAlpha: 0.35,
  sparkleSpritePx: 48, sparkleLifetimeMs: 540, sparkleTwinkleHz: 4.2,
  sparklesPerSegment: 2, sparkleMaxPoolSize: 120, sparkleJitterPx: 14,
  sparkleMinSizePx: 7, sparkleMaxSizePx: 18, fadeDurationMs: 600,
  drawnIndex: 0
};

function createGlowSprite(size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const cx = c.getContext('2d');
  const g = cx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.4, 'rgba(226,234,255,0.55)');
  g.addColorStop(1, 'rgba(226,234,255,0)');
  cx.fillStyle = g; cx.fillRect(0, 0, size, size);
  return c;
}
function createSparkleSprite(size) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const cx = c.getContext('2d');
  const h = size / 2;
  const g = cx.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  cx.fillStyle = g; cx.fillRect(0, 0, size, size);
  cx.strokeStyle = 'rgba(255,255,255,0.9)';
  cx.lineWidth = Math.max(1, size * 0.06);
  cx.lineCap = 'round';
  cx.beginPath();
  cx.moveTo(h, h - size * 0.42);
  cx.lineTo(h, h + size * 0.42);
  cx.moveTo(h - size * 0.42, h);
  cx.lineTo(h + size * 0.42, h);
  cx.stroke();
  return c;
}

function rebuildPlatinumGradient() {
  const w = penCanvas.width, h = penCanvas.height;
  if (!(w > 0) || !(h > 0)) { platinumGradient = null; return; }
  const g = penCtx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.48, '#d9deea');
  g.addColorStop(0.72, '#ffffff');
  g.addColorStop(1, '#c8cfdd');
  platinumGradient = g;
}

function drawPenSegment(ctx, from, to) {
  const w = penCanvas.width, h = penCanvas.height;
  const fpx = [from.x * w, from.y * h];
  const tpx = [to.x * w, to.y * h];
  const gs = PEN_TUNING.glowSizePx;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = PEN_TUNING.glowAlpha;
  const dpr = devicePixelRatio;
  ctx.drawImage(penGlowSprite, tpx[0] - gs / 2, tpx[1] - gs / 2, gs, gs);
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = PEN_TUNING.coreAlpha;
  ctx.strokeStyle = platinumGradient || '#eef2fb';
  ctx.lineWidth = PEN_TUNING.coreWidthPx;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(fpx[0], fpx[1]);
  ctx.lineTo(tpx[0], tpx[1]);
  ctx.stroke();
  ctx.restore();
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
  const rect = zoomLayer.getBoundingClientRect();
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
  for (const n of narrationNodes) {
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
  for (const s of sfxNodes) {
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
  let acc = 0;
  for (const seg of segments) {
    if (seg.isGap) { acc += seg.durationSec; continue; }
    if (t <= acc + seg.durationSec || seg === segments[segments.length - 1]) return seg.inSec + (t - acc) * seg.speed;
    acc += seg.durationSec;
  }
  return 0;
}
function getActiveSegment(t) {
  let acc = 0;
  for (const seg of segments) {
    if (t <= acc + seg.durationSec || seg === segments[segments.length - 1]) return seg;
    acc += seg.durationSec;
  }
  return null;
}

function seekTo(t) {
  cutInfoPopup.hidden = true;
  const prev = outputTime;
  outputTime = Math.max(0, Math.min(t, totalDuration));
  if (Math.abs(outputTime - prev) > 0.05) logReviewEvent('seek', { from: +prev.toFixed(3), to: +outputTime.toFixed(3) });
  const vt = getVideoTimeForOutput(outputTime);
  if (vt >= 0) {
    const seg = getActiveSegment(outputTime);
    if (seg && seg.index >= 0) video.src = getVideoSource(seg.index);
    video.currentTime = vt;
  }
  seek.value = outputTime;
  updateTimeLabel();
  updateStatusBar();
  updateCaption();
  syncCaptionAnimations();
  updateOverlays();
  syncAudio(outputTime);
  syncLayers(outputTime);
}

function play() {
  if (isPlaying || !segments.length) return;
  logReviewEvent('play');
  isPlaying = true;
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
  for (const lv of layerVideos) lv.el.pause();
  playToggle.innerHTML = playIcon;
  playToggle.setAttribute('aria-label', '再生');
  playToggle.title = '再生';
}

let lastWallMs = 0;
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
    const src = getVideoSource(seg.index);
    if (src && video.src !== src) video.src = src;
    if (Math.abs(video.currentTime - target) > 0.1) video.currentTime = target;
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
  for (const seg of segments) {
    const pct = (seg.durationSec / totalDuration * 100);
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
      return body.findings.map((f) => f.message || f.check).filter(Boolean).join(' / ');
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
  return summary;
}

function showCutInfoAt(t) {
  let acc = 0;
  for (const seg of segments) {
    if (t <= acc + seg.durationSec || seg === segments[segments.length - 1]) {
      selectedCutIndex = seg.isGap ? -1 : seg.index;
      selectedCutAcc = acc;
      renderCutInfoContent(seg);
      cutInfoPopup.hidden = false;
      return;
    }
    acc += seg.durationSec;
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

async function addCutAt(index, where) {
  const cuts = summary?.cuts;
  if (!Array.isArray(cuts) || index < 0) return;
  const ref = cuts[index];
  if (!ref) return;
  const inSec = where === 'before' ? ref.in : ref.out;
  const outSec = Math.min(inSec + 1, (cuts[cuts.length - 1]?.out ?? inSec + 5));
  const newCut = { in: inSec, out: outSec };
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
// Snap to nearest cut boundary
function snapToCut(t, dir) {
  if (!segments.length) return t;
  let acc = 0;
  for (const seg of segments) {
    const segEnd = acc + seg.durationSec;
    if (dir > 0 && t >= acc && t < segEnd) return Math.min(t, segEnd - 0.001);
    if (dir < 0 && t > acc && t <= segEnd) return Math.max(t, acc);
    acc = segEnd;
  }
  return t;
}

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  switch (e.code) {
    case 'Space': e.preventDefault(); isPlaying ? pause() : play(); break;
    case 'ArrowLeft': e.preventDefault(); pause(); seekTo(outputTime - 1 / fps); break;
    case 'ArrowRight': e.preventDefault(); pause(); seekTo(outputTime + 1 / fps); break;
    case 'ArrowUp': e.preventDefault(); pause(); seekTo(outputTime - 10); break;
    case 'ArrowDown': e.preventDefault(); pause(); seekTo(outputTime + 10); break;
    case 'Home': e.preventDefault(); seekTo(0); break;
    case 'End': e.preventDefault(); seekTo(totalDuration); break;
    case 'KeyS': e.preventDefault(); pause(); tlSplitCut(outputTime); break;
    case 'Delete':
    case 'Backspace': e.preventDefault(); pause(); tlDeleteCut(outputTime); break;
    case 'Comma': e.preventDefault(); pause(); seekTo(snapToCut(outputTime - 0.1, -1)); break;
    case 'Period': e.preventDefault(); pause(); seekTo(snapToCut(outputTime + 0.1, 1)); break;
    case 'Slash': if (!e.shiftKey) { e.preventDefault(); shortcutHelp.hidden = !shortcutHelp.hidden; } break;
    case 'Escape': shortcutHelp.hidden = true; if (editMode) { clearSelection(); } break;
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
  if (next) { editMode = false; editToggle.setAttribute('aria-pressed', 'false'); stage.style.pointerEvents = 'none'; clearSelection(); captionEnable(false); }
  penToggle.setAttribute('aria-pressed', String(next));
  penEnable(next);
  if (next) zoomLayer.style.cursor = 'crosshair';
});
// Pointer events for pen drawing on zoomLayer
zoomLayer.addEventListener('pointerdown', onPenPointerDown);
zoomLayer.addEventListener('pointermove', onPenPointerMove);
zoomLayer.addEventListener('pointerup', onPenPointerUp);
zoomLayer.addEventListener('pointerleave', onPenPointerUp);

// --- Caption edit mode ---
const captionToggle = document.getElementById('caption-toggle');
const captionEditPopup = document.getElementById('caption-edit-popup');
const captionIdLabel = document.getElementById('caption-id-label');
const captionZoneSelect = document.getElementById('caption-zone-select');
const captionColorInput = document.getElementById('caption-color-input');
const captionSizeInput = document.getElementById('caption-size-input');
const captionSelectBox = document.getElementById('caption-select-box');
captionZoneSelect.innerHTML = CAPTION_ZONE_LIST.map(z => `<option value="${z}">${z}</option>`).join('');

function captionEnable(enabled) {
  captionEditMode = enabled;
  captionToggle.setAttribute('aria-pressed', String(enabled));
  captionPlate.style.cursor = enabled ? 'pointer' : 'move';
  if (!enabled) { deselectCaption(); }
}
function selectCaption(id) {
  if (id === selectedCaptionId) return;
  selectedCaptionId = id;
  const cap = summary?.captions?.find(c => c.id === id);
  if (!cap) { deselectCaption(); return; }
  const ts = cap.text_style || {};
  captionIdLabel.textContent = id;
  captionZoneSelect.value = ts.zone || 'bottom';
  captionColorInput.value = ts.color || '#ffffff';
  captionSizeInput.value = ts.size_px || 38;
  captionEditPopup.hidden = false;
  updateCaptionSelectBox();
}
function deselectCaption() {
  selectedCaptionId = null;
  captionEditPopup.hidden = true;
  captionSelectBox.classList.remove('is-active');
}

function updateCaptionSelectBox() {
  if (!selectedCaptionId) { captionSelectBox.classList.remove('is-active'); return; }
  const cap = summary?.captions?.find(c => c.id === selectedCaptionId);
  if (!cap) { deselectCaption(); return; }
  selectedCaptionZone = cap.text_style?.zone || 'bottom';
  const parts = captionZoneParts(selectedCaptionZone);
  const wr = wrapper.getBoundingClientRect();
  const zl = zoomLayer.getBoundingClientRect();
  const scaleX = zl.width / wr.width;
  const scaleY = zl.height / wr.height;
  const rowR = ZONE_ROW_RANGES[parts.row] || ZONE_ROW_RANGES.bottom;
  const colR = ZONE_COL_RANGES[parts.col] || ZONE_COL_RANGES.center;
  captionSelectBox.style.left = ((zl.left - wr.left) + wr.width * colR[0] * scaleX) + 'px';
  captionSelectBox.style.top = ((zl.top - wr.top) + wr.height * rowR[0] * scaleY) + 'px';
  captionSelectBox.style.width = (wr.width * (colR[1] - colR[0]) * scaleX) + 'px';
  captionSelectBox.style.height = (wr.height * (rowR[1] - rowR[0]) * scaleY) + 'px';
  captionSelectBox.classList.add('is-active');
}

captionToggle.addEventListener('click', () => {
  const next = !captionEditMode;
  if (next) { editMode = false; editToggle.setAttribute('aria-pressed', 'false'); stage.style.pointerEvents = 'none'; clearSelection(); penEnable(false); }
  captionEnable(next);
});
captionPlate.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !captionEditMode) return;
  const cap = summary?.captions?.find(c => {
    const s = Number(c.start) || 0, d = Number(c.end) || Number(c.duration) || 0;
    return outputTime >= s && outputTime < s + d;
  });
  if (!cap || !cap.id) return;
  e.preventDefault(); e.stopPropagation();
  selectCaption(cap.id);
  const ptrId = e.pointerId;
  const startX = e.clientX, startY = e.clientY;
  const origZone = selectedCaptionZone;
  let candidateZone = origZone, moved = false;
  try { captionPlate.setPointerCapture(ptrId); } catch {}
  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
  };
  const onMove = (ev) => {
    if (ev.pointerId !== ptrId) return;
    const dx = ev.clientX - startX, dy = ev.clientY - startY;
    if (!moved && Math.hypot(dx, dy) > 4) moved = true;
    if (!moved) return;
    const wr = wrapper.getBoundingClientRect();
    const fx = (ev.clientX - wr.left) / wr.width;
    const fy = (ev.clientY - wr.top) / wr.height;
    candidateZone = captionZoneFromFraction(fx, fy);
    const parts = captionZoneParts(candidateZone);
    const zl = zoomLayer.getBoundingClientRect();
    const scaleX = zl.width / wr.width;
    const scaleY = zl.height / wr.height;
    const rowR = ZONE_ROW_RANGES[parts.row] || ZONE_ROW_RANGES.bottom;
    const colR = ZONE_COL_RANGES[parts.col] || ZONE_COL_RANGES.center;
    captionSelectBox.style.left = ((zl.left - wr.left) + wr.width * colR[0] * scaleX) + 'px';
    captionSelectBox.style.top = ((zl.top - wr.top) + wr.height * rowR[0] * scaleY) + 'px';
    captionSelectBox.style.width = (wr.width * (colR[1] - colR[0]) * scaleX) + 'px';
    captionSelectBox.style.height = (wr.height * (rowR[1] - rowR[0]) * scaleY) + 'px';
  };
  const onUp = () => {
    cleanup();
    if (!moved || candidateZone === origZone) { updateCaptionSelectBox(); return; }
    (async () => {
      const cap = summary?.captions?.find(c => c.id === selectedCaptionId);
      if (!cap) return;
      const ts = { ...(cap.text_style || {}), zone: candidateZone };
      const captions = summary.captions.map(c => c.id === selectedCaptionId ? { ...c, text_style: ts } : c);
      try {
        const res = await fetch('/api/edit.json?captions', {
          method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ captions })
        });
        if (res.ok) { await reloadSummary(); selectedCaptionZone = candidateZone; }
      } catch (err) { console.warn('caption zone write failed', err); }
      updateCaptionSelectBox();
    })();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
});
// Caption style editing via popup
captionZoneSelect.addEventListener('change', async () => {
  if (!selectedCaptionId) return;
  const zone = captionZoneSelect.value;
  const cap = summary?.captions?.find(c => c.id === selectedCaptionId);
  if (!cap) return;
  const ts = { ...(cap.text_style || {}), zone };
  const captions = summary.captions.map(c => c.id === selectedCaptionId ? { ...c, text_style: ts } : c);
  try {
    const res = await fetch('/api/edit.json?captions', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ captions })
    });
    if (res.ok) { await reloadSummary(); }
  } catch (err) { console.warn('caption zone write failed', err); }
});
captionColorInput.addEventListener('change', async () => {
  if (!selectedCaptionId) return;
  const color = captionColorInput.value;
  const cap = summary?.captions?.find(c => c.id === selectedCaptionId);
  if (!cap) return;
  const ts = { ...(cap.text_style || {}), color };
  const captions = summary.captions.map(c => c.id === selectedCaptionId ? { ...c, text_style: ts } : c);
  try {
    const res = await fetch('/api/edit.json?captions', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ captions })
    });
    if (res.ok) await reloadSummary();
  } catch (err) { console.warn('caption color write failed', err); }
});
captionSizeInput.addEventListener('change', async () => {
  if (!selectedCaptionId) return;
  const size_px = Number(captionSizeInput.value);
  const cap = summary?.captions?.find(c => c.id === selectedCaptionId);
  if (!cap) return;
  const ts = { ...(cap.text_style || {}), size_px };
  const captions = summary.captions.map(c => c.id === selectedCaptionId ? { ...c, text_style: ts } : c);
  try {
    const res = await fetch('/api/edit.json?captions', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ captions })
    });
    if (res.ok) await reloadSummary();
  } catch (err) { console.warn('caption size write failed', err); }
});

// --- Layer (B-roll) editing ---
let selectedLayerId = null;
const layerSelectBox = document.getElementById('layer-select-box');

function updateLayerSelectBox() {
  if (!selectedLayerId) { layerSelectBox.classList.remove('is-active'); return; }
  const lv = layerVideos.find(v => v.layer.id === selectedLayerId);
  if (!lv || !lv.visible || !lv.el.offsetParent) { layerSelectBox.classList.remove('is-active'); return; }
  const wr = wrapper.getBoundingClientRect();
  const zl = zoomLayer.getBoundingClientRect();
  const scaleX = zl.width / wr.width;
  const scaleY = zl.height / wr.height;
  const t = lv.layer.transform || {};
  const x = t.x || 0, y = t.y || 0;
  const w = lv.el.videoWidth || 640, h = lv.el.videoHeight || 360;
  const s = t.scale || 1;
  const cx = wr.width / 2 * scaleX + x * scaleX;
  const cy = wr.height / 2 * scaleY + y * scaleY;
  const bw = w * s * scaleX;
  const bh = h * s * scaleY;
  layerSelectBox.style.left = (cx - bw / 2) + 'px';
  layerSelectBox.style.top = (cy - bh / 2) + 'px';
  layerSelectBox.style.width = bw + 'px';
  layerSelectBox.style.height = bh + 'px';
  layerSelectBox.style.transform = `rotate(${t.rotate || 0}deg)`;
  layerSelectBox.classList.add('is-active');
}

function selectLayer(id) {
  if (id === selectedLayerId && id) { updateLayerSelectBox(); return; }
  selectedLayerId = id;
  if (id) { clearSelection(); }
  updateLayerSelectBox();
}

function clearLayerSelection() {
  selectedLayerId = null;
  layerSelectBox.classList.remove('is-active');
}

// Layer drag-to-move + resize
function getLayerTransform(lv) {
  const t = lv.layer.transform || {};
  return { x: t.x || 0, y: t.y || 0, scale: t.scale || 1, rotate: t.rotate || 0 };
}
function applyLayerTransform(lv, tr) {
  const el = lv.el;
  el.dataset.layerX = tr.x; el.dataset.layerY = tr.y;
  el.dataset.layerScale = tr.scale; el.dataset.layerRotate = tr.rotate;
  el.style.transform = `translate(${tr.x}px, ${tr.y}px) scale(${tr.scale}) rotate(${tr.rotate}deg)`;
}

function beginLayerDrag(lv, startEvent, computeTransform) {
  startEvent.preventDefault();
  startEvent.stopPropagation();
  const ptrId = startEvent.pointerId;
  const orig = getLayerTransform(lv);
  let moved = false, cancelled = false;
  try { startEvent.target.setPointerCapture(ptrId); } catch {}
  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey);
  };
  const onMove = (ev) => {
    if (ev.pointerId !== ptrId) return;
    const next = computeTransform(ev, orig);
    if (!moved && (Math.abs(next.x - orig.x) > 2 || Math.abs(next.y - orig.y) > 2 || Math.abs(next.scale - orig.scale) > 0.02)) moved = true;
    applyLayerTransform(lv, next);
  };
  const onUp = () => {
    cleanup();
    if (cancelled || !moved) { applyLayerTransform(lv, orig); updateLayerSelectBox(); return; }
    const final = getLayerTransform(lv);
    (async () => {
      const layers = (summary?.layers || []).map(l => l.id === lv.layer.id ? { ...l, transform: final } : l);
      try {
        const res = await fetch('/api/edit.json', {
          method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...summary, layers })
        });
        if (res.ok) { await reloadSummary(); }
        else { applyLayerTransform(lv, orig); }
      } catch { applyLayerTransform(lv, orig); }
      updateLayerSelectBox();
    })();
  };
  const onCancel = () => { cancelled = true; cleanup(); applyLayerTransform(lv, orig); updateLayerSelectBox(); };
  const onKey = (e) => { if (e.code === 'Escape') { cancelled = true; cleanup(); applyLayerTransform(lv, orig); updateLayerSelectBox(); }};
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey);
}

// Layer timing popup (double-click on selected layer)
const layerInfoPopup = document.getElementById('layer-info-popup');
if (!layerInfoPopup) {
  const div = document.createElement('div');
  div.id = 'layer-info-popup';
  div.className = 'popup';
  div.style.cssText = 'left:0;right:auto;width:260px';
  div.hidden = true;
  div.innerHTML = '<div class="popup-header"><span>レイヤー</span><span id="layer-id-label"></span></div><div id="layer-info-content" style="font-size:12px;color:#ccc;line-height:1.6"></div>';
  document.querySelector('.transport-seek').appendChild(div);
}
stage.addEventListener('dblclick', (e) => {
  if (!editMode || !selectedLayerId) return;
  const lv = layerVideos.find(v => v.layer.id === selectedLayerId);
  if (!lv) return;
  const layer = lv.layer;
  const popup = document.getElementById('layer-info-popup');
  const content = document.getElementById('layer-info-content');
  document.getElementById('layer-id-label').textContent = layer.id;
  const tVal = (layer.t ?? 0).toFixed(2);
  const durVal = (layer.duration ?? 0).toFixed(2);
  content.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:6px">
      <label style="flex:1;color:#888;font-size:11px">開始 <input id="ly-t" type="number" step="0.01" value="${tVal}" style="width:100%;background:#303030;color:#fff;border:1px solid #505050;border-radius:3px;padding:2px 4px;font-size:12px"></label>
      <label style="flex:1;color:#888;font-size:11px">長さ <input id="ly-dur" type="number" step="0.01" min="0" value="${durVal}" style="width:100%;background:#303030;color:#fff;border:1px solid #505050;border-radius:3px;padding:2px 4px;font-size:12px"></label>
    </div>
    <div style="display:flex;gap:6px;margin-bottom:4px">
      <label style="flex:1;color:#888;font-size:11px">不透明度 <input id="ly-opacity" type="number" step="0.05" min="0" max="1" value="${layer.opacity ?? 1}" style="width:100%;background:#303030;color:#fff;border:1px solid #505050;border-radius:3px;padding:2px 4px;font-size:12px"></label>
      <label style="flex:1;color:#888;font-size:11px">blend
        <select id="ly-blend" style="width:100%;background:#303030;color:#fff;border:1px solid #505050;border-radius:3px;padding:2px 4px;font-size:12px">
          <option value="">通常</option>
          ${['multiply','screen','overlay','darken','lighten','color-dodge','color-burn','hard-light','soft-light','difference','exclusion'].map(b => `<option value="${b}"${layer.blend===b?' selected':''}>${b}</option>`).join('')}
        </select>
      </label>
    </div>
    <button id="ly-apply-btn" style="width:100%;background:#4da3ff;color:#fff;border:none;border-radius:3px;padding:4px 8px;cursor:pointer;font-size:12px">適用</button>`;
  content.querySelector('#ly-apply-btn').addEventListener('click', async () => {
    const newT = Number(document.getElementById('ly-t').value);
    const newDur = Number(document.getElementById('ly-dur').value);
    const newOp = Number(document.getElementById('ly-opacity').value);
    const newBlend = document.getElementById('ly-blend').value;
    if (!Number.isFinite(newT) || !Number.isFinite(newDur) || newDur <= 0) return;
    const layers = (summary?.layers || []).map(l => l.id === layer.id ? { ...l, t: newT, duration: newDur, opacity: newOp, blend: newBlend || undefined } : l);
    try {
      const res = await fetch('/api/edit.json', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...summary, layers })
      });
      if (res.ok) { await reloadSummary(); popup.hidden = true; }
    } catch {}
  });
  popup.hidden = false;
});

// Wire pointer events for layers
stage.addEventListener('pointerdown', (e) => {
  if (!editMode || e.button !== 0) return;
  const hit = document.elementsFromPoint(e.clientX, e.clientY)
    .find(c => c.tagName === 'VIDEO' && c.dataset && c.dataset.layerId && c.style.display !== 'none');
  if (!hit) return;
  const lv = layerVideos.find(v => v.el === hit);
  if (!lv) return;
  e.preventDefault(); e.stopPropagation();
  selectLayer(lv.layer.id);
  const wr = wrapper.getBoundingClientRect();
  const startFX = (e.clientX - wr.left) / wr.width;
  const startFY = (e.clientY - wr.top) / wr.height;
  beginLayerDrag(lv, e, (ev, orig) => {
    const fx = (ev.clientX - wr.left) / wr.width;
    const fy = (ev.clientY - wr.top) / wr.height;
    const dx = (fx - startFX) * wr.width;
    const dy = (fy - startFY) * wr.height;
    return { ...orig, x: orig.x + dx, y: orig.y + dy };
  });
});

// Layer handle resize/rotate
document.querySelectorAll('.akari-layer-handle').forEach(h => {
  h.addEventListener('pointerdown', (e) => {
    if (!editMode || !selectedLayerId || e.button !== 0) return;
    const lv = layerVideos.find(v => v.layer.id === selectedLayerId);
    if (!lv || !lv.visible) return;
    e.preventDefault(); e.stopPropagation();
    const wr = wrapper.getBoundingClientRect();
    const handle = h.dataset.handle;
    const zl = zoomLayer.getBoundingClientRect();
    const scaleX = zl.width / wr.width;
    const startFX = (e.clientX - wr.left) / wr.width;
    const startFY = (e.clientY - wr.top) / wr.height;
    if (handle === 'rotate') {
      const tr = getLayerTransform(lv);
      const centerX = wr.width / 2 + tr.x;
      const centerY = wr.height / 2 + tr.y;
      const startAngle = Math.atan2(startFY * wr.height - centerY, startFX * wr.width - centerX) * 180 / Math.PI;
      beginLayerDrag(lv, e, (ev, orig) => {
        const fx = (ev.clientX - wr.left) / wr.width;
        const fy = (ev.clientY - wr.top) / wr.height;
        const angle = Math.atan2(fy * wr.height - centerY, fx * wr.width - centerX) * 180 / Math.PI;
        return { ...orig, rotate: orig.rotate + (angle - startAngle) };
      });
    } else {
      const tr = getLayerTransform(lv);
      const origCx = wr.width / 2 + tr.x;
      const origCy = wr.height / 2 + tr.y;
      const startDist = Math.hypot((startFX * wr.width - origCx) / scaleX, (startFY * wr.height - origCy) / scaleY);
      const w = lv.el.videoWidth || 640, h = lv.el.videoHeight || 360;
      const baseSize = Math.sqrt(w * w + h * h) / 2;
      beginLayerDrag(lv, e, (ev, orig) => {
        const fx = (ev.clientX - wr.left) / wr.width;
        const fy = (ev.clientY - wr.top) / wr.height;
        const dist = Math.hypot((fx * wr.width - origCx) / scaleX, (fy * wr.height - origCy) / scaleY);
        return { ...orig, scale: Math.max(0.05, orig.scale * (dist / startDist)) };
      });
    }
  });
});

function updateLayerPointerEvents() {
  for (const lv of layerVideos) {
    lv.el.style.pointerEvents = lv.visible && editMode ? 'auto' : 'none';
  }
}

// --- Edit mode ---
let transformDirty = false;
editToggle.addEventListener('click', () => {
  editMode = !editMode;
  if (editMode) { penEnable(false); captionEnable(false); }
  editToggle.setAttribute('aria-pressed', String(editMode));
  stage.style.pointerEvents = editMode ? 'auto' : 'none';
  updateLayerPointerEvents();
  if (!editMode) { clearSelection(); clearLayerSelection(); }
  if (editMode && selectedLayerId) updateLayerSelectBox();
});
function clearSelection() {
  selectedId = null; selectedKind = null;
  selectionLabel.textContent = ''; transformPopup.hidden = true;
  clearLayerSelection();
}
function selectOverlay(id) {
  clearSelection();
  clearLayerSelection();
  selectedKind = 'overlay'; selectedId = id;
  selectionLabel.textContent = `オーバーレイ ${id}`;
  const overlay = summary?.overlays?.find(o => String(o.id) === String(id));
  if (overlay) showTransform(overlay.transform || {});
}
stage.addEventListener('click', (e) => {
  if (!editMode) return;
  const c = e.target.closest('[data-overlay-id]');
  if (c) { selectOverlay(c.dataset.overlayId); return; }
  if (e.target.tagName === 'VIDEO' && e.target.dataset?.layerId) return;
  clearSelection();
});
function showTransform(t) {
  txInput.value = t.x ?? 0; tyInput.value = t.y ?? 0;
  tsInput.value = t.scale ?? 1; trInput.value = t.rotate ?? 0;
  transformPopup.hidden = false; transformDirty = false;
}
[txInput, tyInput, tsInput, trInput].forEach(inp => {
  inp.addEventListener('input', () => { transformDirty = true; });
  inp.addEventListener('change', async () => {
    if (!transformDirty || !selectedId) return;
    const patch = { transform: { x: Number(txInput.value), y: Number(tyInput.value), scale: Number(tsInput.value), rotate: Number(trInput.value) } };
    await writeEditJson(selectedKind, selectedId, patch);
    transformDirty = false;
  });
});
async function writeEditJson(kind, id, patch) {
  try {
    const res = await fetch(api.summary);
    const edit = await res.json();
    if (kind === 'overlay') {
      const ov = edit.overlays?.find(o => String(o.id) === String(id));
      if (ov) Object.assign(ov, patch.transform ? { transform: { ...ov.transform, ...patch.transform } } : patch);
    } else if (kind === 'layer') {
      const ly = edit.layers?.find(l => String(l.id) === String(id));
      if (ly) Object.assign(ly, patch.transform ? { transform: { ...ly.transform, ...patch.transform } } : patch);
    }
    const saveRes = await fetch('/api/edit.json', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(edit) });
    if (saveRes.ok) { summary = edit; window.akari?.runtime?.mount(summary); }
  } catch (e) { console.error('write failed', e); }
}

// --- Indicator popup ---
indicatorBtn.addEventListener('click', () => {
  const h = indicatorPopup.hidden;
  indicatorPopup.hidden = !h;
  indicatorBtn.setAttribute('aria-pressed', String(!h));
  if (!h) renderIndicators();
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
  if (zoom <= 1 || e.target.closest('.icon-button, .popup, #seek')) return;
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
      c.innerHTML = o.html || '';
      frag.appendChild(c);
      overlays.push({ el: c, start: o.start, duration: o.duration, visible: false });
    }
    stage.appendChild(frag);
  }
  function tick(t) {
    for (const o of overlays) {
      const v = o.start <= t && t < o.start + o.duration;
      if (v !== o.visible) { o.el.style.visibility = v ? 'visible' : 'hidden'; o.visible = v; }
      if (!v) continue;
      const ms = Math.max(0, (t - o.start) * 1000);
      for (const a of o.el.getAnimations({ subtree: true })) { a.pause(); a.currentTime = ms; }
    }
  }
  return { mount, tick, unmount };
}
function updateOverlays() { window.akari?.runtime?.tick(outputTime); }

function captionZoneParts(zone) {
  if (!zone || zone === 'bottom') return { row: 'bottom', col: 'center' };
  if (zone === 'center') return { row: 'middle', col: 'center' };
  if (zone === 'top') return { row: 'top', col: 'center' };
  if (zone === 'left' || zone === 'right') return { row: 'middle', col: zone };
  const [row, col] = zone.split('-');
  return { row, col };
}
function captionZoneFromFraction(fx, fy) {
  const col = fx < 1 / 3 ? 'left' : fx < 2 / 3 ? 'center' : 'right';
  const row = fy < 1 / 3 ? 'top' : fy < 2 / 3 ? 'middle' : 'bottom';
  if (row === 'middle' && col === 'center') return 'center';
  if (row === 'middle') return col;
  if (col === 'center') return row;
  return row + '-' + col;
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
    '--caption-text-align': align
  };
}

function applyCaptionStyle(caption) {
  let vars = {};
  const ts = caption?.text_style;
  const dts = summary?.default_text_style;
  if (ts?.color) vars['--caption-color'] = ts.color;
  else if (dts?.color) vars['--caption-color'] = dts.color;
  if (ts?.size_px) vars['--caption-font-size'] = ts.size_px + 'px';
  else if (dts?.size_px) vars['--caption-font-size'] = dts.size_px + 'px';
  else vars['--caption-font-size'] = '38px';
  const zone = ts?.zone || dts?.zone || 'bottom';
  Object.assign(vars, captionZoneVars(zone));
  for (const [k, v] of Object.entries(vars)) captionPlate.style.setProperty(k, v);
  captionPlate.classList.toggle('akari-caption-styled', !!ts || !!dts);
}

function getActiveCaptions() {
  const fromEdit = summary?.captions;
  if (Array.isArray(fromEdit) && fromEdit.length > 0) return fromEdit;
  return captionsData || [];
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
.akari-caption { position:absolute; inset:0; pointer-events:none; color:var(--caption-color,#fff); text-shadow:var(--caption-text-shadow,-1.5px -1.5px 0 rgba(0,0,0,.85),1.5px -1.5px 0 rgba(0,0,0,.85),-1.5px 1.5px 0 rgba(0,0,0,.85),1.5px 1.5px 0 rgba(0,0,0,.85),0 0 8px rgba(0,0,0,.6)); font-family:"Noto Sans JP",sans-serif; font-size:var(--caption-font-size,38px); font-weight:700; line-height:1.42; text-align:center; }
.akari-caption__plate { position:absolute; top:var(--caption-top,auto); left:var(--caption-left,0); right:var(--caption-right,0); bottom:var(--caption-bottom,7%); display:flex; flex-direction:column; justify-content:var(--caption-justify-content,flex-start); align-items:var(--caption-align-items,stretch); gap:4px; }
.akari-caption__line { width:max-content; max-width:92%; margin:0 auto; padding:0.08em 0.42em; border-radius:10px; background:rgba(8,12,22,0.74); text-align:center; white-space:pre; }
.akari-caption__tok { display:inline-block; will-change:transform,color; }
.akari-caption__tok--karaoke { animation:akari-caption-karaoke-lit var(--akari-tok-dur,0.2s) var(--akari-tok-delay,0s) linear both paused; }
.akari-caption__tok--pop { animation:akari-caption-pop 0.2s var(--akari-tok-delay,0s) ease-out both paused; }
.akari-caption__tok--emphasis { }
.akari-caption__tok--one-char-bang { color:var(--akari-emphasis-color,var(--caption-color,#fff)); }
.akari-caption__tok--size-pulse { animation:akari-emphasis-size-pulse var(--akari-emphasis-dur,0.2s) var(--akari-emphasis-delay,0s) ease-in-out both paused; color:var(--akari-emphasis-color,var(--caption-color,#fff)); }
.akari-caption__tok--color-accent { color:var(--akari-emphasis-color,var(--caption-color,#fff)); }
.akari-caption__emphasis-char { display:inline-block; opacity:0; animation:akari-emphasis-one-char-bang var(--akari-emphasis-dur,0.1s) var(--akari-emphasis-delay,0s) ease-out both paused; }
.akari-caption--pop .akari-caption__line { background:rgba(8,12,22,0.74); }
.akari-caption--emphasis .akari-caption__line { background:rgba(8,12,22,0.74); }
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
function updateCaption() {
  const caps = getActiveCaptions();
  if (!caps.length) { captionPlate.textContent = ''; _lastCaptionId = null; return; }
  const active = caps.find(c => { const s = Number(c.start) || 0, d = Number(c.end) || Number(c.duration) || 0; return outputTime >= s && outputTime < s + d; });
  if (!active) { captionPlate.textContent = ''; _lastCaptionId = null; return; }
  if (active.id === _lastCaptionId) return;
  _lastCaptionId = active.id;
  applyCaptionStyle(active);
  const words = normalizeWords(active.words);
  const emphasisWords = summary?.emphasis_words;
  const hasWords = words.length > 0;
  const hasEmphasis = hasWords && emphasisWords?.length > 0 && words.some(w => findMatchingEmphasis(w, emphasisWords));
  const style = active.style;
  const wordStyle = (style && ['karaoke', 'pop', 'reveal'].includes(style)) ? style : (hasEmphasis ? 'emphasis' : null);
  if (wordStyle && hasWords) {
    injectCaptionStyles();
    const start = Number(active.start) || 0;
    const lines = groupWordsIntoLines(words);
    captionPlate.innerHTML = `<div class="akari-caption akari-caption--${wordStyle}"><div class="akari-caption__plate">${
      lines.map(line => `<p class="akari-caption__line">${
        line.map(w => {
          const ew = findMatchingEmphasis(w, emphasisWords);
          return ew ? renderEmphasisToken(w, start, ew) : renderStyledToken(w, start, style);
        }).join(' ')
      }</p>`).join('')
    }</div></div>`;
    captionPlate.dataset.captionStart = String(start);
  } else if (hasWords) {
    const start = Number(active.start) || 0;
    const ms = (outputTime - start) * 1000;
    captionPlate.innerHTML = words.map(w => {
      const ws = w.start, we = w.end;
      let c = '#fff', s = '0 1px 2px #000';
      if (ms >= we) { c = '#aaa'; s = 'none'; }
      else if (ms >= ws) { c = '#ff0'; s = '0 0 8px rgba(255,255,255,0.4)'; }
      return `<span style="color:${c};text-shadow:${s};transition:color 0.05s">${esc(w.text)}</span>`;
    }).join(' ');
  } else {
    captionPlate.innerHTML = esc(active.text || active.display_text || '');
  }
}
function syncCaptionAnimations() {
  const start = Number(captionPlate.dataset.captionStart);
  if (!Number.isFinite(start)) return;
  const localMs = Math.max(0, (outputTime - start) * 1000);
  for (const a of captionPlate.getAnimations({ subtree: true })) {
    a.pause();
    a.currentTime = localMs;
  }
}
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function showMessage(text) { if (text) { previewMessage.hidden = false; previewMessageText.textContent = text; } else { previewMessage.hidden = true; } }

let wsTickLast = 0;
function connectWs() {
  const p = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${p}//${location.host}`);
  ws.onmessage = (e) => {
    try {
      const m = JSON.parse(e.data);
      if (m.type === 'reload') return location.reload();
      if (m.type === 'captions-reload') {
        fetch(api.summary).then(r => r.ok && r.json()).then(d => { if (d) summary = d; }).catch(() => {});
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

// --- Asset Browser ---
const assetList = document.getElementById('asset-list');
const assetSearch = document.getElementById('asset-search');
const assetTabs = document.querySelectorAll('.asset-tab');
const ASSET_ICONS = { video: '🎬', audio: '🎵', image: '🖼️' };

let allAssets = [];
let assetFilterCat = 'all';
let assetFilterText = '';

function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}

function renderAssets() {
  const filtered = allAssets.filter(a => {
    if (assetFilterCat !== 'all' && a.category !== assetFilterCat) return false;
    if (assetFilterText && !a.name.toLowerCase().includes(assetFilterText)) return false;
    return true;
  });
  if (!filtered.length) {
    assetList.innerHTML = '<div class="asset-empty">素材がありません<br>ファイルをドロップして追加</div>';
    return;
  }
  assetList.innerHTML = filtered.map(a => `
    <div class="asset-item" draggable="true" data-path="${a.path}" data-category="${a.category}">
      <div class="asset-icon ${a.category}">${ASSET_ICONS[a.category] || '📄'}</div>
      <div class="asset-info">
        <div class="asset-name">${esc(a.name)}</div>
        <div class="asset-meta">${a.category} · ${formatSize(a.size)}</div>
      </div>
    </div>
  `).join('');
  // Drag start — store asset path for timeline drop
  assetList.querySelectorAll('.asset-item').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', el.dataset.path);
      e.dataTransfer.effectAllowed = 'copy';
      el.classList.add('is-active');
    });
    el.addEventListener('dragend', () => el.classList.remove('is-active'));
  });
}

function setupAssetBrowser() {
  // Tabs
  for (const tab of assetTabs) {
    tab.addEventListener('click', () => {
      assetTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      assetFilterCat = tab.dataset.cat;
      renderAssets();
    });
  }
  // Search
  assetSearch.addEventListener('input', () => {
    assetFilterText = assetSearch.value.toLowerCase();
    renderAssets();
  });
  // Click to show in editor (add to sources or navigate)
  assetList.addEventListener('click', (e) => {
    const item = e.target.closest('.asset-item');
    if (!item) return;
    showMessage(null);
  });
  // Drag-and-drop upload
  const assetPane = document.getElementById('asset-pane');
  let dropOverlay = null;
  function showDropOverlay(show) {
    if (show) {
      if (!dropOverlay) {
        dropOverlay = document.createElement('div');
        dropOverlay.style.cssText = 'position:absolute;inset:0;z-index:100;background:rgba(77,163,255,0.12);border:2px dashed #4da3ff;display:grid;place-items:center;font-size:14px;color:#4da3ff;font-weight:600;pointer-events:none;border-radius:4px;';
        dropOverlay.textContent = 'ドロップして素材を追加';
        assetPane.style.position = 'relative';
      }
      assetPane.appendChild(dropOverlay);
    } else {
      if (dropOverlay && dropOverlay.parentNode) dropOverlay.remove();
    }
  }
  assetPane.addEventListener('dragenter', (e) => { e.preventDefault(); showDropOverlay(true); });
  assetPane.addEventListener('dragover', (e) => { e.preventDefault(); });
  assetPane.addEventListener('dragleave', (e) => {
    if (!assetPane.contains(e.relatedTarget)) showDropOverlay(false);
  });
  assetPane.addEventListener('drop', async (e) => {
    e.preventDefault();
    showDropOverlay(false);
    const files = Array.from(e.dataTransfer.files).filter(f => {
      const ext = '.' + f.name.split('.').pop().toLowerCase();
      return /\.(mp4|webm|mov|avi|mkv|m4v|mp3|wav|ogg|aac|flac|m4a|png|jpg|jpeg|gif|webp)$/i.test(ext);
    });
    if (!files.length) { showMessage('対応形式: mp4/webm/mov/avi/mkv/mp3/wav/ogg/png/jpg など'); return; }
    showMessage(`${files.length}個のファイルをアップロード中...`);
    let ok = 0, err = 0;
    for (const file of files) {
      try {
        const res = await fetch('/api/assets/upload', {
          method: 'POST',
          headers: { 'X-File-Name': encodeURIComponent(file.name) },
          body: file,
        });
        if (res.ok) ok++; else err++;
      } catch { err++; }
    }
    if (err === 0) showMessage(`${ok}個のファイルを追加しました`);
    else showMessage(`${ok}個追加、${err}個失敗`);
    await loadAssets();
  });
}

async function loadAssets() {
  try {
    const res = await fetch('/api/project-files');
    if (!res.ok) return;
    allAssets = await res.json();
    renderAssets();
  } catch {}
}

// --- Timeline Editor ---
const tlCanvas = document.getElementById('timeline-canvas');
const tlRulerCanvas = document.getElementById('tl-ruler-canvas');
const tlPlayhead = document.getElementById('tl-playhead');
const tlCanvasWrap = document.getElementById('tl-canvas-wrap');
const tlZoomIn = document.getElementById('tl-zoom-in');
const tlZoomOut = document.getElementById('tl-zoom-out');
const tlZoomLabel = document.getElementById('tl-zoom-label');
const tlFitBtn = document.getElementById('tl-fit-btn');

let tlZoom = 1;
let tlScrollLeft = 0;
let tlDrag = null;
const TL_TRACK_HEIGHT = 28;
const TL_MIN_ZOOM = 5;
const TL_MAX_ZOOM = 500;
const TL_HANDLE_PX = 8;
const TL_CUT_COLORS = ['#4da3ff', '#ff6b6b', '#51cf66', '#ffd43b', '#cc5de8', '#20c997', '#ff922b', '#748ffc'];

function computeNaturalZoom() {
  if (totalDuration <= 0) return 100;
  const w = tlCanvasWrap.clientWidth - 16;
  return Math.max(TL_MIN_ZOOM, Math.min(TL_MAX_ZOOM, w / totalDuration));
}

function tlTimelineX(e) {
  const rect = tlCanvas.getBoundingClientRect();
  return e.clientX - rect.left + tlCanvasWrap.scrollLeft;
}

function tlTimeFromX(px) {
  return Math.max(0, Math.min(totalDuration, px / tlZoom));
}

function tlHitTest(px, py) {
  if (py < 0 || py > TL_TRACK_HEIGHT * 2) return null;
  const track = py < TL_TRACK_HEIGHT ? 0 : 1;
  let cursor = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.isGap) { cursor += seg.durationSec; continue; }
    if (seg.track !== track) { cursor += seg.durationSec; continue; }
    const sx = cursor * tlZoom;
    const sw = seg.durationSec * tlZoom;
    if (px >= sx && px < sx + sw) {
      const distL = px - sx;
      const distR = (sx + sw) - px;
      let mode;
      if (distL < TL_HANDLE_PX && sw > TL_HANDLE_PX * 2) mode = 'trim-in';
      else if (distR < TL_HANDLE_PX && sw > TL_HANDLE_PX * 2) mode = 'trim-out';
      else mode = 'move';
      return { segIndex: i, cutIndex: seg.index, mode, cursor };
    }
    cursor += seg.durationSec;
  }
  return null;
}

const TL_SNAP_PX = 6;

function tlSnapTime(t, excludeIndex) {
  let bestSnap = null;
  let bestDist = TL_SNAP_PX / tlZoom;
  let cursor = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.isGap) { cursor += seg.durationSec; continue; }
    if (seg.index === excludeIndex) { cursor += seg.durationSec; continue; }
    [cursor, cursor + seg.durationSec].forEach(b => {
      const d = Math.abs(t - b);
      if (d < bestDist) { bestDist = d; bestSnap = b; }
    });
    cursor += seg.durationSec;
  }
  return bestSnap;
}

async function tlSplitCut(t) {
  const seg = getActiveSegment(t);
  if (!seg || seg.isGap || !summary?.cuts?.[seg.index]) return;
  let cursor = 0;
  for (const s of segments) {
    if (s === seg) break;
    cursor += s.durationSec;
  }
  const srcSplit = seg.inSec + (t - cursor) * seg.speed;
  if (srcSplit <= seg.inSec || srcSplit >= seg.outSec) return;
  const newEdit = JSON.parse(JSON.stringify(summary));
  const orig = newEdit.cuts[seg.index];
  const cutA = { ...orig, out: +srcSplit.toFixed(3) };
  const cutB = { ...orig, in: +srcSplit.toFixed(3), at: +t.toFixed(3) };
  newEdit.cuts.splice(seg.index, 1, cutA, cutB);
  try {
    const res = await fetch('/api/edit.json', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(newEdit)
    });
    if (res.ok) { await reloadSummary(); buildSegments(); seekTo(t); showMessage('カットを分割しました (S)'); }
    else showMessage(await editSaveErrorMessage(res));
  } catch (err) { showMessage(err?.message || String(err)); }
}

async function tlDeleteCut(t) {
  const seg = getActiveSegment(t);
  if (!seg || seg.isGap || !summary?.cuts?.[seg.index]) return;
  const newEdit = JSON.parse(JSON.stringify(summary));
  newEdit.cuts.splice(seg.index, 1);
  try {
    const res = await fetch('/api/edit.json', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(newEdit)
    });
    if (res.ok) { await reloadSummary(); buildSegments(); seekTo(t); showMessage('カットを削除しました (Del)'); }
    else showMessage(await editSaveErrorMessage(res));
  } catch (err) { showMessage(err?.message || String(err)); }
}

function setupTimeline() {
  tlZoomIn.addEventListener('click', () => { tlZoom = Math.min(TL_MAX_ZOOM, tlZoom * 1.5); renderTimeline(); });
  tlZoomOut.addEventListener('click', () => { tlZoom = Math.max(TL_MIN_ZOOM, tlZoom / 1.5); renderTimeline(); });
  tlFitBtn.addEventListener('click', () => { tlZoom = computeNaturalZoom(); renderTimeline(); });
  tlCanvasWrap.addEventListener('scroll', () => { tlScrollLeft = tlCanvasWrap.scrollLeft; updateTimelinePlayhead(); });

  // Pointer interaction: trim / move / seek
  tlCanvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const px = tlTimelineX(e);
    const py = e.clientY - tlCanvas.getBoundingClientRect().top;
    const hit = tlHitTest(px, py);
    if (!hit || hit.mode === 'move' && hit.segIndex < 0) {
      // seek
      const t = tlTimeFromX(px);
      const w = isPlaying; if (w) pause();
      seekTo(t);
      return;
    }
    const seg = segments[hit.segIndex];
    const cut = summary?.cuts?.[hit.cutIndex];
    if (!cut) return;
    tlDrag = {
      mode: hit.mode, segIndex: hit.segIndex, cutIndex: hit.cutIndex,
      startPx: px,
      startIn: cut.in, startOut: cut.out,
      startSegIn: seg.inSec, startSegOut: seg.outSec,
      startAt: cut.at !== undefined ? cut.at : null,
      saved: false, moved: false,
      cursorStart: hit.cursor,
    };
    tlCanvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  tlCanvas.addEventListener('pointermove', (e) => {
    if (!tlDrag) {
      // Cursor change on hover
      const px = tlTimelineX(e);
      const py = e.offsetY || (e.clientY - tlCanvas.getBoundingClientRect().top);
      const hit = tlHitTest(px, py);
      tlCanvas.style.cursor = hit ? (hit.mode === 'trim-in' || hit.mode === 'trim-out' ? 'ew-resize' : 'grab') : 'default';
      // Cut info popup on hover
      const infoPopup = document.getElementById('cut-info-popup');
      const infoContent = document.getElementById('cut-info-content');
      if (hit && summary?.cuts?.[hit.cutIndex]) {
        const c = summary.cuts[hit.cutIndex];
        const src = summary.sources?.find(s => s.id === c.src)?.path || c.src || '(no source)';
        const srcName = src.split('/').pop();
        const dur = (((c.out || 0) - (c.in || 0)) / (c.speed || 1)).toFixed(2);
        const fmt = (sec) => { const m = Math.floor(sec / 60); return `${m}:${String(Math.floor(sec % 60)).padStart(2, '0')}.${String(Math.floor((sec % 1) * 100)).padStart(2, '0')}`; };
        infoContent.innerHTML = `<div><b>#${hit.cutIndex + 1}</b> ${srcName}</div><div>in: ${fmt(c.in || 0)}  out: ${fmt(c.out || 0)}  dur: ${dur}s</div>${c.at !== undefined ? `<div>at: ${fmt(c.at)}</div>` : ''}`;
        const wrapRect = tlCanvasWrap.getBoundingClientRect();
        infoPopup.style.position = 'fixed';
        infoPopup.style.left = Math.min(e.clientX + 12, window.innerWidth - 292) + 'px';
        infoPopup.style.top = Math.max(8, e.clientY - infoPopup.offsetHeight - 8) + 'px';
        infoPopup.hidden = false;
      } else if (infoPopup) {
        infoPopup.hidden = true;
      }
      return;
    }
    const px = tlTimelineX(e);
    const deltaSec = (px - tlDrag.startPx) / tlZoom;
    const deltaFrames = Math.round(deltaSec * fps) / fps;
    const newEdit = JSON.parse(JSON.stringify(summary));
    const cut = newEdit.cuts[tlDrag.cutIndex];
    if (!cut) return;
    if (Math.abs(px - tlDrag.startPx) > 3) tlDrag.moved = true;
    if (tlDrag.mode === 'trim-in') {
      const newIn = Math.max(0, +(tlDrag.startIn + deltaFrames).toFixed(2));
      if (newIn < cut.out - (1 / fps)) cut.in = newIn;
    } else if (tlDrag.mode === 'trim-out') {
      const newOut = Math.max(cut.in + (1 / fps), +(tlDrag.startOut + deltaFrames).toFixed(2));
      cut.out = newOut;
    } else if (tlDrag.mode === 'move') {
      const newAt = Math.max(0, +(tlDrag.startAt + deltaFrames).toFixed(2));
      const snap = tlSnapTime(newAt, tlDrag.cutIndex);
      cut.at = snap !== null ? snap : newAt;
    }
    // Snap right edge for trim
    if (tlDrag.mode === 'trim-out' || tlDrag.mode === 'trim-in') {
      const atPos = tlDrag.startAt !== null ? tlDrag.startAt : tlDrag.cursorStart;
      const speed = cut.speed || 1;
      const rightEdge = atPos + ((cut.out || 0) - (cut.in || 0)) / speed;
      const snap = tlSnapTime(rightEdge, tlDrag.cutIndex);
      if (snap !== null) {
        const newDur = snap - atPos;
        if (tlDrag.mode === 'trim-out') {
          cut.out = Math.max(cut.in + 1 / fps, +(cut.in + newDur * speed).toFixed(3));
        } else {
          cut.in = Math.max(0, Math.min(cut.out - 1 / fps, +(cut.out - newDur * speed).toFixed(3)));
        }
      }
    }
    // Re-render timeline with new cuts
    const oldCuts = summary.cuts;
    summary.cuts = newEdit.cuts;
    buildSegments();
    summary.cuts = oldCuts;
    tlDrag.saved = false;
    e.preventDefault();
  });

  tlCanvas.addEventListener('pointerleave', () => {
    const p = document.getElementById('cut-info-popup');
    if (p) p.hidden = true;
  });

  tlCanvas.addEventListener('pointerup', async (e) => {
    if (!tlDrag) return;
    tlCanvas.releasePointerCapture(e.pointerId);
    if (tlDrag.saved) { tlDrag = null; return; }
    if (!tlDrag.moved) {
      // No drag — just seek
      const t = tlTimeFromX(tlTimelineX(e));
      const w = isPlaying; if (w) pause();
      seekTo(t);
      tlDrag = null;
      return;
    }
    // Save to server
    const newEdit = JSON.parse(JSON.stringify(summary));
    const cut = newEdit.cuts[tlDrag.cutIndex];
    if (!cut) { tlDrag = null; return; }
    if (tlDrag.mode === 'trim-in') {
      const deltaSec = (tlTimelineX(e) - tlDrag.startPx) / tlZoom;
      cut.in = Math.max(0, +(tlDrag.startIn + deltaSec).toFixed(2));
    } else if (tlDrag.mode === 'trim-out') {
      const deltaSec = (tlTimelineX(e) - tlDrag.startPx) / tlZoom;
      cut.out = Math.max(cut.in + (1 / fps), +(tlDrag.startOut + deltaSec).toFixed(2));
    } else if (tlDrag.mode === 'move') {
      const deltaSec = (tlTimelineX(e) - tlDrag.startPx) / tlZoom;
      cut.at = Math.max(0, +(tlDrag.startAt + deltaSec).toFixed(2));
    }
    try {
      const res = await fetch('/api/edit.json', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(newEdit)
      });
      if (res.ok) {
        await reloadSummary();
        buildSegments();
        seekTo(outputTime);
        tlDrag.saved = true;
      } else {
        showMessage(await editSaveErrorMessage(res));
        buildSegments();
        renderTimeline();
      }
    } catch (err) { showMessage(err?.message || String(err)); buildSegments(); renderTimeline(); }
    tlDrag = null;
  });

  tlCanvas.addEventListener('pointercancel', () => {
    if (tlDrag) { tlDrag = null; buildSegments(); renderTimeline(); }
  });

  // Mouse wheel to zoom
  tlCanvasWrap.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const rect = tlCanvasWrap.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const tUnder = (mx + tlCanvasWrap.scrollLeft) / tlZoom;
    const factor = e.deltaY > 0 ? 1 / 1.15 : 1.15;
    tlZoom = Math.max(TL_MIN_ZOOM, Math.min(TL_MAX_ZOOM, tlZoom * factor));
    renderTimeline();
    tlCanvasWrap.scrollLeft = tUnder * tlZoom - mx;
  }, { passive: false });

  // Drop asset on timeline
  let dropIndicator = null;
  tlCanvas.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dropIndicator) {
      dropIndicator = document.createElement('div');
      dropIndicator.style.cssText = 'position:absolute;top:0;bottom:0;width:2px;background:#4da3ff;z-index:6;pointer-events:none;';
      (tlCanvasWrap.querySelector('div') || tlCanvasWrap).appendChild(dropIndicator);
    }
    dropIndicator.style.left = (tlTimelineX(e) - tlCanvasWrap.scrollLeft) + 'px';
  });
  tlCanvasWrap.addEventListener('dragleave', (e) => {
    if (!tlCanvasWrap.contains(e.relatedTarget)) { dropIndicator?.remove(); dropIndicator = null; }
  });
  tlCanvas.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropIndicator?.remove(); dropIndicator = null;
    const assetPath = e.dataTransfer.getData('text/plain');
    if (!assetPath || !summary?.cuts) return;
    const t = tlTimeFromX(tlTimelineX(e));
    const newEdit = JSON.parse(JSON.stringify(summary));
    if (!Array.isArray(newEdit.sources)) newEdit.sources = [];
    const srcId = 'src-' + Date.now();
    newEdit.sources.push({ id: srcId, path: assetPath });
    newEdit.cuts = [...newEdit.cuts, { in: 0, out: 2, src: srcId, at: +t.toFixed(2) }];
    try {
      const res = await fetch('/api/edit.json', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(newEdit)
      });
      if (res.ok) { await reloadSummary(); buildSegments(); seekTo(outputTime); }
      else showMessage(await editSaveErrorMessage(res));
    } catch (err) { showMessage(err?.message || String(err)); }
  });
}

function renderTimeline() {
  const wrapW = tlCanvasWrap.clientWidth;
  const totalPx = Math.max(wrapW, totalDuration * tlZoom);
  const h = TL_TRACK_HEIGHT * 2;
  tlCanvas.width = Math.ceil(totalPx) * devicePixelRatio;
  tlCanvas.height = h * devicePixelRatio;
  tlCanvas.style.width = Math.ceil(totalPx) + 'px';
  tlCanvas.style.height = h + 'px';
  const ctx = tlCanvas.getContext('2d');
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.fillStyle = '#161616';
  ctx.fillRect(0, 0, totalPx, h);
  // Grid
  ctx.strokeStyle = '#222';
  ctx.lineWidth = 1;
  const step = tlZoom >= 100 ? 1 : tlZoom >= 40 ? 5 : tlZoom >= 15 ? 10 : 30;
  for (let t = step; t <= totalDuration; t += step) {
    const x = t * tlZoom;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  // Draw cuts with handles
  let cursor = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.isGap) { cursor += seg.durationSec; continue; }
    const sx = cursor * tlZoom;
    const sw = seg.durationSec * tlZoom;
    const color = TL_CUT_COLORS[seg.index % TL_CUT_COLORS.length];
    const y = seg.track === 0 ? 0 : TL_TRACK_HEIGHT;
    const segH = TL_TRACK_HEIGHT - 4;
    // Main body
    const grad = ctx.createLinearGradient(sx, y, sx, y + TL_TRACK_HEIGHT);
    grad.addColorStop(0, color);
    grad.addColorStop(0.5, color);
    grad.addColorStop(1, '#000');
    ctx.fillStyle = grad;
    ctx.beginPath();
    const r = 3;
    const rx = sx, ry = y + 2, rw = Math.max(2, sw), rh = segH;
    ctx.moveTo(rx + r, ry); ctx.lineTo(rx + rw - r, ry); ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + r);
    ctx.lineTo(rx + rw, ry + rh - r); ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - r, ry + rh);
    ctx.lineTo(rx + r, ry + rh); ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - r);
    ctx.lineTo(rx, ry + r); ctx.quadraticCurveTo(rx, ry, rx + r, ry);
    ctx.fill();
    // Handle zones
    if (sw > TL_HANDLE_PX * 3) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(sx, y + 2, TL_HANDLE_PX, segH);
      ctx.fillRect(sx + sw - TL_HANDLE_PX, y + 2, TL_HANDLE_PX, segH);
      // Handle grips
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      for (let g = 0; g < 3; g++) {
        const gh = y + 2 + 5 + g * 6;
        ctx.fillRect(sx + 2, gh, 4, 2);
        ctx.fillRect(sx + sw - 6, gh, 4, 2);
      }
    }
    // Label
    if (sw > 30) {
      ctx.fillStyle = '#fff';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`#${seg.index + 1}`, sx + sw / 2, y + TL_TRACK_HEIGHT / 2);
    }
    // Source time label (in/out)
    if (sw > 80) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '8px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const fmt = (sec) => { const m = Math.floor(sec / 60); return `${m}:${String(Math.floor(sec % 60)).padStart(2, '0')}.${String(Math.floor((sec % 1) * 100)).padStart(2, '0')}`; };
      ctx.fillText(`${fmt(seg.inSec)} → ${fmt(seg.outSec)}`, sx + sw / 2, y + 1);
    }
    cursor += seg.durationSec;
  }
  // Track separator
  ctx.strokeStyle = '#303030';
  ctx.beginPath(); ctx.moveTo(0, TL_TRACK_HEIGHT); ctx.lineTo(totalPx, TL_TRACK_HEIGHT); ctx.stroke();
  // Ruler
  tlRulerCanvas.width = Math.ceil(totalPx) * devicePixelRatio;
  tlRulerCanvas.height = 22 * devicePixelRatio;
  tlRulerCanvas.style.width = Math.ceil(totalPx) + 'px';
  const rctx = tlRulerCanvas.getContext('2d');
  rctx.scale(devicePixelRatio, devicePixelRatio);
  rctx.fillStyle = '#141414';
  rctx.fillRect(0, 0, totalPx, 22);
  rctx.strokeStyle = '#333';
  rctx.lineWidth = 1;
  rctx.fillStyle = '#666';
  rctx.font = '9px system-ui, sans-serif';
  rctx.textAlign = 'center';
  rctx.textBaseline = 'bottom';
  for (let t = 0; t <= totalDuration; t += step) {
    const x = t * tlZoom;
    const rh = t % (step * 5) === 0 ? 14 : 8;
    rctx.beginPath(); rctx.moveTo(x, 22); rctx.lineTo(x, 22 - rh); rctx.stroke();
    if (t % (step * 5) === 0 || step <= 1) {
      const m = Math.floor(t / 60);
      const s = Math.floor(t % 60);
      rctx.fillText(`${m}:${String(s).padStart(2, '0')}`, x, 20);
    }
  }
  tlZoomLabel.textContent = Math.round(tlZoom) + 'px/s';
  // drag preview overlay
  if (tlDrag) {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    const seg = segments[tlDrag.segIndex];
    if (seg && !seg.isGap) {
      let dc = 0;
      for (let j = 0; j < tlDrag.segIndex; j++) { if (!segments[j].isGap) dc += segments[j].durationSec; }
      const dx = (tlDrag.cursorStart + (segments[tlDrag.segIndex]?.durationSec || 0) / 2) * tlZoom - 20;
      ctx.fillRect(dx, 0, 40, h);
    }
  }
  updateTimelinePlayhead();
}

function updateTimelinePlayhead() {
  if (totalDuration <= 0) { tlPlayhead.style.display = 'none'; return; }
  tlPlayhead.style.display = 'block';
  const x = outputTime * tlZoom - tlCanvasWrap.scrollLeft;
  tlPlayhead.style.left = Math.max(0, x) + 'px';
  tlPlayhead.style.height = (TL_TRACK_HEIGHT * 2) + 'px';
}

// Extend existing functions
const origSeekTo = seekTo;
seekTo = function(t) {
  origSeekTo(t);
  updateTimelinePlayhead();
};

const origBuildSegments = buildSegments;
buildSegments = function() {
  origBuildSegments();
  if (totalDuration > 0) {
    tlZoom = computeNaturalZoom();
    renderTimeline();
  }
};

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
setupAssetBrowser();
setupTimeline();
loadAssets();
