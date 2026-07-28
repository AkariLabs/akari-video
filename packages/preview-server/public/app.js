// AKARI Video Preview — full-featured client

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
const minimap = document.getElementById('zoom-minimap');
const minimapVideo = document.getElementById('minimap-video');
const minimapViewport = document.getElementById('zoom-minimap-viewport');
const indicatorBtn = document.getElementById('indicator-toggle');
const indicatorPopup = document.getElementById('indicator-popup');

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

let audioCtx = null;
let bgmNode = null;
let sfxNodes = [];
let narrationNodes = [];

let waveformPeaks = null;
let waveformDuration = 0;

// B-roll layer videos
let layerVideos = [];

// Pen annotation
let penPoints = [];
let penActive = false;

async function init() {
  try {
    const [timelineRes, editRes] = await Promise.all([
      fetch('/api/timeline'),
      fetch('/api/summary'),
    ]);
    if (!timelineRes.ok) throw new Error(`timeline: HTTP ${timelineRes.status}`);
    timelineData = await timelineRes.json();
    summary = await editRes.json();
    fps = timelineData.fps || 30;

    buildSegments();
    if (summary?.cuts?.length > 0) video.src = getVideoSource(0);
    setupLayers();
    setupPenCanvas();
    setupAudioGraph();
    setupWaveform();
    scheduleTransitions();
    setupMinimap();

    window.akari = window.akari || {};
    window.akari.runtime = createOverlayRuntime();
    if (window.akari.runtime.mount) window.akari.runtime.mount(summary);

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
    el.style.pointerEvents = 'none';
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
      lv.visible = shouldShow;
    }
    if (shouldShow) {
      const localT = t - (l.t ?? 0);
      if (Math.abs(lv.el.currentTime - localT) > 0.1) lv.el.currentTime = localT;
    }
  }
}

// --- Pen annotation canvas ---
function setupPenCanvas() {
  penCanvas.width = zoomLayer.clientWidth * devicePixelRatio;
  penCanvas.height = zoomLayer.clientHeight * devicePixelRatio;
  penCanvas.style.width = '100%';
  penCanvas.style.height = '100%';
}
function drawPen() {
  const ctx = penCanvas.getContext('2d');
  ctx.clearRect(0, 0, penCanvas.width, penCanvas.height);
  if (!penPoints.length) return;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of penPoints) {
    if (stroke.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(stroke[0].x * devicePixelRatio, stroke[0].y * devicePixelRatio);
    for (let i = 1; i < stroke.length; i++) {
      ctx.lineTo(stroke[i].x * devicePixelRatio, stroke[i].y * devicePixelRatio);
    }
    ctx.strokeStyle = 'rgba(255,200,50,0.85)';
    ctx.lineWidth = 3 * devicePixelRatio;
    ctx.shadowColor = 'rgba(255,200,50,0.5)';
    ctx.shadowBlur = 8 * devicePixelRatio;
    ctx.stroke();
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
  if (audio.bgm?.src) {
    const gain = audioCtx.createGain();
    gain.gain.value = dbToGain(audio.bgm.gainDb ?? 0);
    gain.connect(audioCtx.destination);
    bgmNode = gain;
    loadAudioBuffer(audio.bgm.src).then((buf) => {
      if (!buf) return;
      const src = audioCtx.createBufferSource();
      src.buffer = buf; src.loop = audio.bgm.loop !== false;
      src.connect(gain);
      bgmNode._source = src;
    });
  }
  if (Array.isArray(audio.narration)) {
    for (const n of audio.narration) {
      if (!n.src) continue;
      const gain = audioCtx.createGain();
      gain.gain.value = dbToGain(n.gainDb ?? 0);
      gain.connect(audioCtx.destination);
      const node = { gain, src: n.src, t: n.t ?? 0 };
      narrationNodes.push(node);
      loadAudioBuffer(n.src).then((buf) => { node._buffer = buf; });
    }
  }
  if (Array.isArray(audio.sfx)) {
    for (const s of audio.sfx) {
      if (!s.src) continue;
      const gain = audioCtx.createGain();
      gain.gain.value = dbToGain(s.gainDb ?? 0);
      gain.connect(audioCtx.destination);
      const node = { gain, src: s.src, t: s.t ?? 0 };
      sfxNodes.push(node);
      loadAudioBuffer(s.src).then((buf) => { node._buffer = buf; });
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
}

// --- Waveform ---
async function setupWaveform() {
  waveformCanvas.width = waveformCanvas.clientWidth * devicePixelRatio;
  waveformCanvas.height = waveformCanvas.clientHeight * devicePixelRatio;
  if (!timelineData.clips.length || !audioCtx) return;
  try {
    const r = await fetch(timelineData.clips[0].src);
    const ab = await r.arrayBuffer();
    const buf = await audioCtx.decodeAudioData(ab.slice(0));
    waveformDuration = buf.duration;
    const ch = buf.getChannelData(0);
    const peaks = Math.min(400, ch.length);
    const spp = Math.max(1, Math.floor(ch.length / peaks));
    waveformPeaks = [];
    for (let i = 0; i < peaks; i++) {
      let max = 0;
      for (let j = 0; j < spp && i * spp + j < ch.length; j++) max = Math.max(max, Math.abs(ch[i * spp + j]));
      waveformPeaks.push(max);
    }
    drawWaveform(0);
  } catch { waveformPeaks = null; }
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
  outputTime = Math.max(0, Math.min(t, totalDuration));
  const vt = getVideoTimeForOutput(outputTime);
  if (vt >= 0) {
    const seg = getActiveSegment(outputTime);
    if (seg && seg.index >= 0) video.src = getVideoSource(seg.index);
    video.currentTime = vt;
  }
  seek.value = outputTime;
  updateTimeLabel();
  updateOverlays();
  syncAudio(outputTime);
  syncLayers(outputTime);
}

function play() {
  if (isPlaying || !segments.length) return;
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
  updateOverlays();
  updateWaveformPlayhead();
  updateCaption();
  updateTransitions();
  updateMinimap();
  syncAudio(outputTime);
  syncLayers(outputTime);
  requestAnimationFrame(playbackLoop);
}

function updateWaveformPlayhead() {
  if (!waveformPeaks || totalDuration <= 0) return;
  const r = outputTime / totalDuration;
  drawWaveform(r);
  waveformPlayhead.style.left = `${r * 100}%`;
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

function updateTimeLabel() {
  const fm = (sec) => { const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; };
  timeLabel.textContent = `${fm(outputTime)} / ${fm(totalDuration)}`;
}

playToggle.addEventListener('click', () => isPlaying ? pause() : play());
frameBack.addEventListener('click', () => { pause(); seekTo(outputTime - 1 / fps); });
frameForward.addEventListener('click', () => { pause(); seekTo(outputTime + 1 / fps); });
skipBack.addEventListener('click', () => { pause(); seekTo(outputTime - 10); });
skipForward.addEventListener('click', () => { pause(); seekTo(outputTime + 10); });
seek.addEventListener('input', () => { const w = isPlaying; if (w) pause(); seekTo(Number(seek.value)); if (w) play(); });
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  switch (e.code) {
    case 'Space': e.preventDefault(); isPlaying ? pause() : play(); break;
    case 'ArrowLeft': e.preventDefault(); pause(); seekTo(outputTime - 1 / fps); break;
    case 'ArrowRight': e.preventDefault(); pause(); seekTo(outputTime + 1 / fps); break;
    case 'ArrowUp': e.preventDefault(); pause(); seekTo(outputTime - 10); break;
    case 'ArrowDown': e.preventDefault(); pause(); seekTo(outputTime + 10); break;
    case 'Home': e.preventDefault(); seekTo(0); break;
    case 'End': e.preventDefault(); seekTo(totalDuration); break;
  }
});
video.addEventListener('loadedmetadata', () => { if (isPlaying) video.play(); });

// --- Edit mode ---
let transformDirty = false;
editToggle.addEventListener('click', () => {
  editMode = !editMode;
  editToggle.setAttribute('aria-pressed', String(editMode));
  stage.style.pointerEvents = editMode ? 'auto' : 'none';
  if (!editMode) clearSelection();
});
function clearSelection() {
  selectedId = null; selectedKind = null;
  selectionLabel.textContent = ''; transformPopup.hidden = true;
}
function selectOverlay(id) {
  clearSelection();
  selectedKind = 'overlay'; selectedId = id;
  selectionLabel.textContent = `オーバーレイ ${id}`;
  const overlay = summary?.overlays?.find(o => String(o.id) === String(id));
  if (overlay) showTransform(overlay.transform || {});
}
stage.addEventListener('click', (e) => {
  if (!editMode) return;
  const c = e.target.closest('[data-overlay-id]');
  if (c) { selectOverlay(c.dataset.overlayId); return; }
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
    const res = await fetch('/api/summary');
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
zoomSlider.addEventListener('input', () => { zoom = ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, Number(zoomSlider.value)); pan = { x: 0, y: 0 }; updateZoom(); });
document.querySelectorAll('.zoom-preset').forEach(btn => {
  btn.addEventListener('click', () => { zoom = Number(btn.dataset.zoom); pan = { x: 0, y: 0 }; updateZoom(); zoomPopup.hidden = true; zoomToggle.setAttribute('aria-expanded', 'false'); });
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
      c.style.cssText = 'position:absolute;inset:0;pointer-events:auto;visibility:hidden;';
      if (o.transform) { const t = o.transform; c.style.transform = `translate(${t.x||0}px,${t.y||0}px) scale(${t.scale||1}) rotate(${t.rotate||0}deg)`; }
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

// --- Captions ---
function updateCaption() {
  const caps = summary?.captions;
  if (!Array.isArray(caps) || !caps.length) { captionPlate.textContent = ''; return; }
  const active = caps.find(c => { const s = Number(c.start) || 0, d = Number(c.duration) || 0; return outputTime >= s && outputTime < s + d; });
  if (!active) { captionPlate.textContent = ''; return; }
  const words = active.words ?? [];
  if (words.length > 0) {
    const start = Number(active.start) || 0;
    const ms = (outputTime - start) * 1000;
    captionPlate.innerHTML = words.map(w => {
      const ws = (w.t ?? 0), we = ws + (w.d ?? 0.3);
      let c = '#fff', s = '0 1px 2px #000';
      if (ms >= we) { c = '#aaa'; s = 'none'; }
      else if (ms >= ws) { c = '#ff0'; s = '0 0 8px rgba(255,255,0,0.6)'; }
      return `<span style="color:${c};text-shadow:${s};transition:color 0.05s">${esc(w.word || w.w || '')}</span>`;
    }).join(' ');
  } else {
    captionPlate.textContent = active.text || active.caption || '';
  }
}
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function showMessage(text) { if (text) { previewMessage.hidden = false; previewMessageText.textContent = text; } else { previewMessage.hidden = true; } }

function connectWs() {
  const p = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${p}//${location.host}`);
  ws.onmessage = (e) => { try { const m = JSON.parse(e.data); if (m.type === 'reload' || m.type === 'captions-reload') location.reload(); } catch {} };
  ws.onclose = () => setTimeout(connectWs, 2000);
  ws.onerror = () => ws.close();
}

init();
connectWs();
