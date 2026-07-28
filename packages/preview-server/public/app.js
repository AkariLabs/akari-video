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

// Multi-track: top-visible track determination
let mainVideoRuns = [];

// Audio graph
let audioCtx = null;
let bgmNode = null;
let sfxNodes = [];
let narrationNodes = [];

// Waveform
let waveformPeaks = null;
let waveformDuration = 0;

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
    computeMainVideo();
    if (summary?.cuts?.length > 0) {
      video.src = getVideoSource(0);
    }
    setupAudioGraph();
    setupWaveform();
    scheduleTransitions();

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

// Build segments (multi-track aware)
function buildSegments() {
  if (!summary?.cuts) return;
  segments = [];
  const cutEvents = [];
  for (let i = 0; i < summary.cuts.length; i++) {
    const cut = summary.cuts[i];
    const speed = cut.speed || 1;
    const inSec = cut.in || 0;
    const outSec = cut.out || inSec + 1;
    const durationSec = (outSec - inSec) / speed;
    const at = cut.at;
    const track = cut.track ?? 0;
    cutEvents.push({ index: i, inSec, outSec, speed, durationSec, track, at, isGap: false });
  }
  const trackSegments = {};
  for (const c of cutEvents) {
    const t = c.track;
    if (!trackSegments[t]) trackSegments[t] = [];
    trackSegments[t].push(c);
  }
  const effectiveTracks = Object.keys(trackSegments).map(Number).sort((a, b) => a - b);
  const combined = [];
  for (let ti = 0; ti < effectiveTracks.length; ti++) {
    const trackNum = effectiveTracks[ti];
    const trackCuts = trackSegments[trackNum];
    let cursor = 0;
    for (let ci = 0; ci < trackCuts.length; ci++) {
      const c = trackCuts[ci];
      if (c.at !== undefined) cursor = c.at;
      const gap = ci === 0 ? 0 : Math.max(0, cursor - combined.reduce((s, seg) => s + seg.durationSec, 0));
      if (gap > 0) {
        combined.push({ index: -1, inSec: 0, outSec: 0, speed: 1, durationSec: gap, track: trackNum, isGap: true });
      }
      combined.push({ ...c });
      cursor += c.durationSec;
    }
  }
  segments = combined;
  totalDuration = Math.max(...summary.cuts.map((c, i) => {
    const cut = summary.cuts[i];
    return (cut.at ?? calculateDefaultEnd(i));
  }), combined.reduce((s, seg) => s + seg.durationSec, 0));
  seek.max = totalDuration;
  updateTimeLabel();
}

function calculateDefaultEnd(upToIndex) {
  let cursor = 0;
  for (let i = 0; i <= upToIndex && i < summary.cuts.length; i++) {
    const cut = summary.cuts[i];
    const speed = cut.speed || 1;
    const inSec = cut.in || 0;
    const outSec = cut.out || inSec + 1;
    const dur = (outSec - inSec) / speed;
    if (cut.at !== undefined) cursor = cut.at;
    cursor += dur;
  }
  return cursor;
}

// Compute main video runs (highest-priority visible track)
function computeMainVideo() {
  mainVideoRuns = timelineData.clips.map(c => ({
    id: c.id,
    src: c.src,
    startFrame: c.startFrame,
    endFrame: c.endFrame,
    sourceInUs: c.sourceInUs,
    track: c.track ?? 0,
  }));
}

// Audio graph
function setupAudioGraph() {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { return; }

  const audio = summary?.audio;
  if (!audio) return;

  // BGM
  const bgm = audio.bgm;
  if (bgm?.src) {
    const gain = audioCtx.createGain();
    gain.gain.value = dbToGain(bgm.gainDb ?? 0);
    gain.connect(audioCtx.destination);
    bgmNode = gain;
    loadAudioBuffer(bgm.src).then((buf) => {
      if (!buf) return;
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.loop = bgm.loop !== false;
      src.connect(gain);
      bgmNode._source = src;
    });
  }

  // Narration
  if (Array.isArray(audio.narration)) {
    for (const n of audio.narration) {
      if (!n.src) continue;
      const gain = audioCtx.createGain();
      gain.gain.value = dbToGain(n.gainDb ?? 0);
      gain.connect(audioCtx.destination);
      const node = { gain, src: n.src, t: n.t ?? 0, _source: null };
      narrationNodes.push(node);
      loadAudioBuffer(n.src).then((buf) => {
        if (!buf) return;
        node._buffer = buf;
      });
    }
  }

  // SFX
  if (Array.isArray(audio.sfx)) {
    for (const s of audio.sfx) {
      if (!s.src) continue;
      const gain = audioCtx.createGain();
      gain.gain.value = dbToGain(s.gainDb ?? 0);
      gain.connect(audioCtx.destination);
      const node = { gain, src: s.src, t: s.t ?? 0, _source: null };
      sfxNodes.push(node);
      loadAudioBuffer(s.src).then((buf) => {
        if (!buf) return;
        node._buffer = buf;
      });
    }
  }
}

function dbToGain(db) { return Math.pow(10, (db ?? 0) / 20); }

async function loadAudioBuffer(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return audioCtx.decodeAudioData(await res.arrayBuffer());
  } catch { return null; }
}

function syncAudio(t) {
  if (!audioCtx) return;
  // Narration: scheduled playback at specified timestamps
  for (const n of narrationNodes) {
    if (!n._buffer) continue;
    const shouldPlay = t >= n.t && t < n.t + n._buffer.duration;
    const isPlaying = n._source && !n._source._ended;
    if (shouldPlay && !isPlaying) {
      if (n._source) { try { n._source.stop(); } catch {} }
      const src = audioCtx.createBufferSource();
      src.buffer = n._buffer;
      src.connect(n.gain);
      src.start(0, Math.max(0, t - n.t));
      src._ended = false;
      src.onended = () => { src._ended = true; };
      n._source = src;
    }
  }
  // SFX: similar scheduling
  for (const s of sfxNodes) {
    if (!s._buffer) continue;
    const shouldPlay = t >= s.t && t < s.t + s._buffer.duration;
    const isPlaying = s._source && !s._source._ended;
    if (shouldPlay && !isPlaying) {
      if (s._source) { try { s._source.stop(); } catch {} }
      const src = audioCtx.createBufferSource();
      src.buffer = s._buffer;
      src.connect(s.gain);
      src.start(0, Math.max(0, t - s.t));
      src._ended = false;
      src.onended = () => { src._ended = true; };
      s._source = src;
    }
  }
}

// Waveform
async function setupWaveform() {
  waveformCanvas.width = waveformCanvas.clientWidth * devicePixelRatio;
  waveformCanvas.height = waveformCanvas.clientHeight * devicePixelRatio;
  if (timelineData.clips.length === 0 || !audioCtx) return;
  const src = timelineData.clips[0].src;
  try {
    const res = await fetch(src);
    const ab = await res.arrayBuffer();
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
  const w = waveformCanvas.width;
  const h = waveformCanvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!waveformPeaks) return;
  const barW = w / waveformPeaks.length;
  const mid = h / 2;
  ctx.fillStyle = '#888';
  for (let i = 0; i < waveformPeaks.length; i++) {
    const barH = Math.max(1, waveformPeaks[i] * (h - 4));
    ctx.fillRect(i * barW, mid - barH / 2, Math.max(1, barW - 0.5), barH);
  }
  if (ratio > 0) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(ratio * w - 0.5, 0, 1, h);
  }
}

// Transitions
function scheduleTransitions() {
  transitionPlate.style.transition = 'opacity 0.3s';
}

function getVideoTimeForOutput(t) {
  let acc = 0;
  for (const seg of segments) {
    if (seg.isGap) { acc += seg.durationSec; continue; }
    if (t <= acc + seg.durationSec || seg === segments[segments.length - 1]) {
      const local = t - acc;
      return seg.inSec + local * seg.speed;
    }
    acc += seg.durationSec;
  }
  return 0;
}

function seekTo(t) {
  outputTime = Math.max(0, Math.min(t, totalDuration));
  const videoTime = getVideoTimeForOutput(outputTime);
  if (videoTime >= 0) {
    const seg = getActiveSegment(outputTime);
    if (seg && seg.index >= 0) video.src = getVideoSource(seg.index);
    video.currentTime = videoTime;
  }
  seek.value = outputTime;
  updateTimeLabel();
  updateOverlays();
  syncAudio(outputTime);
}

function getActiveSegment(t) {
  let acc = 0;
  for (const seg of segments) {
    if (t <= acc + seg.durationSec || seg === segments[segments.length - 1]) return seg;
    acc += seg.durationSec;
  }
  return null;
}

function play() {
  if (isPlaying || segments.length === 0) return;
  isPlaying = true;
  if (audioCtx?.state === 'suspended') audioCtx.resume();
  if (bgmNode?._source && !bgmNode._source._started) {
    bgmNode._source.start();
    bgmNode._source._started = true;
  }
  syncAudio(outputTime);
  video.play();
  playToggle.innerHTML = pauseIcon;
  playToggle.setAttribute('aria-label', '一時停止');
  playToggle.title = '一時停止';
  requestAnimationFrame(playbackLoop);
}

function pause() {
  if (!isPlaying) return;
  isPlaying = false;
  video.pause();
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
  syncAudio(outputTime);
  requestAnimationFrame(playbackLoop);
}

function updateWaveformPlayhead() {
  if (!waveformPeaks || totalDuration <= 0) return;
  const ratio = outputTime / totalDuration;
  drawWaveform(ratio);
  waveformPlayhead.style.left = `${ratio * 100}%`;
}

function updateTransitions() {
  const cuts = summary?.cuts ?? [];
  if (!cuts.length) return;
  let cursor = 0;
  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    const speed = cut.speed || 1;
    const inSec = cut.in || 0;
    const outSec = cut.out || inSec + 1;
    const dur = (outSec - inSec) / speed;
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
  const fmt = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toFixed(2).padStart(5, '0')}`;
  };
  timeLabel.textContent = `${fmt(outputTime)} / ${fmt(totalDuration)}`;
}

playToggle.addEventListener('click', () => isPlaying ? pause() : play());
frameBack.addEventListener('click', () => { pause(); seekTo(outputTime - 1 / fps); });
frameForward.addEventListener('click', () => { pause(); seekTo(outputTime + 1 / fps); });
skipBack.addEventListener('click', () => { pause(); seekTo(outputTime - 10); });
skipForward.addEventListener('click', () => { pause(); seekTo(outputTime + 10); });

seek.addEventListener('input', () => {
  const was = isPlaying;
  if (was) pause();
  seekTo(Number(seek.value));
  if (was) play();
});

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

// Waveform toggle
let waveformVisible = false;
waveformToggle.addEventListener('click', () => {
  waveformVisible = !waveformVisible;
  waveformRow.hidden = !waveformVisible;
  waveformToggle.setAttribute('aria-pressed', String(waveformVisible));
  if (waveformVisible) setupWaveform();
});

// Zoom
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 8;
function updateZoom() {
  zoomLayer.style.transform = `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`;
  zoomValue.textContent = `${Math.round(zoom * 100)}%`;
  zoomSlider.value = Math.log2(zoom / ZOOM_MIN) / Math.log2(ZOOM_MAX / ZOOM_MIN);
}
zoomToggle.addEventListener('click', () => {
  const open = !zoomPopup.hidden;
  zoomPopup.hidden = open;
  zoomToggle.setAttribute('aria-expanded', String(!open));
});
zoomSlider.addEventListener('input', () => {
  const t = Number(zoomSlider.value);
  zoom = ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, t);
  pan = { x: 0, y: 0 };
  updateZoom();
});
document.querySelectorAll('.zoom-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    zoom = Number(btn.dataset.zoom);
    pan = { x: 0, y: 0 };
    updateZoom();
    zoomPopup.hidden = true;
    zoomToggle.setAttribute('aria-expanded', 'false');
  });
});
wrapper.addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + delta * zoom));
  pan = { x: 0, y: 0 };
  updateZoom();
}, { passive: false });
wrapper.addEventListener('pointerdown', (e) => {
  if (zoom <= 1 || e.target.closest('.icon-button, .zoom-popup, #seek')) return;
  drag = { startX: e.clientX - pan.x, startY: e.clientY - pan.y };
  wrapper.setPointerCapture(e.pointerId);
  wrapper.style.cursor = 'grabbing';
});
wrapper.addEventListener('pointermove', (e) => {
  if (!drag) return;
  pan.x = e.clientX - drag.startX;
  pan.y = e.clientY - drag.startY;
  updateZoom();
});
wrapper.addEventListener('pointerup', () => { drag = null; wrapper.style.cursor = ''; });
fullscreenToggle.addEventListener('click', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
    fullscreenToggle.innerHTML = fullscreenIcon;
    fullscreenToggle.setAttribute('aria-pressed', 'false');
  } else {
    wrapper.requestFullscreen();
    fullscreenToggle.innerHTML = restoreIcon;
    fullscreenToggle.setAttribute('aria-pressed', 'true');
  }
});

// Overlay runtime
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
      if (o.transform) {
        const t = o.transform;
        c.style.transform = `translate(${t.x||0}px,${t.y||0}px) scale(${t.scale||1}) rotate(${t.rotate||0}deg)`;
      }
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

// Enhanced captions
function updateCaption() {
  const caps = summary?.captions;
  if (!Array.isArray(caps) || !caps.length) { captionPlate.textContent = ''; return; }
  const active = caps.find(c => {
    const s = Number(c.start) || 0, d = Number(c.duration) || 0;
    return outputTime >= s && outputTime < s + d;
  });
  if (!active) { captionPlate.textContent = ''; return; }
  const words = active.words ?? [];
  if (words.length > 0) {
    const start = Number(active.start) || 0;
    const localMs = (outputTime - start) * 1000;
    captionPlate.innerHTML = words.map(w => {
      const ws = (w.t ?? 0), wd = (w.d ?? 0.3), we = ws + wd;
      let color = '#fff', shadow = '0 1px 2px #000';
      if (localMs >= we) { color = '#aaa'; shadow = 'none'; }
      else if (localMs >= ws) { color = '#ff0'; shadow = '0 0 8px rgba(255,255,0,0.6)'; }
      return `<span style="color:${color};text-shadow:${shadow};transition:color 0.05s">${esc(w.word || w.w || (typeof w === 'string' ? w : ''))}</span>`;
    }).join(' ');
  } else {
    captionPlate.textContent = active.text || active.caption || '';
  }
}
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// Message
function showMessage(text) {
  if (text) { previewMessage.hidden = false; previewMessageText.textContent = text; }
  else { previewMessage.hidden = true; }
}

// WebSocket live reload
function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}`);
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'reload' || msg.type === 'captions-reload') location.reload();
    } catch {}
  };
  ws.onclose = () => setTimeout(connectWs, 2000);
  ws.onerror = () => ws.close();
}

init();
connectWs();
