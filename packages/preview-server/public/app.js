// AKARI Video Preview — client (full-featured port)

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

// Audio graph
let audioCtx = null;
let audioSources = [];
let audioNodes = [];

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

    if (timelineData.clips.length > 0) {
      video.src = timelineData.clips[0].src;
    }

    buildSegments();
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

function buildSegments() {
  if (!summary || !summary.cuts) return;
  segments = [];
  let cursor = 0;
  for (let i = 0; i < summary.cuts.length; i++) {
    const cut = summary.cuts[i];
    const speed = cut.speed || 1;
    const inSec = cut.in || 0;
    const outSec = cut.out || inSec + 1;
    const durationSec = (outSec - inSec) / speed;
    const at = cut.at;
    if (at !== undefined) cursor = at;
    const gap = cursor > 0 && segments.length > 0
      ? Math.max(0, cursor - segments.reduce((s, seg) => s + seg.durationSec, 0))
      : 0;
    if (gap > 0) {
      segments.push({ index: -1, inSec: 0, outSec: 0, speed: 1, durationSec: gap, isGap: true });
    }
    segments.push({ index: i, inSec, outSec, speed, durationSec, track: cut.track ?? 0, isGap: false });
    if (at === undefined) cursor += durationSec;
  }
  totalDuration = segments.reduce((sum, s) => sum + s.durationSec, 0);
  seek.max = totalDuration;
  updateTimeLabel();
}

// Audio graph
function setupAudioGraph() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const bgm = summary?.audio?.bgm;
  if (bgm?.src) {
    const gain = audioCtx.createGain();
    gain.gain.value = dbToGain(bgm.gainDb ?? 0);
    audioNodes.push(gain);
    const src = audioCtx.createBufferSource();
    loadAudio(bgm.src).then((buf) => {
      src.buffer = buf;
      src.loop = bgm.loop !== false;
      src.connect(gain);
      gain.connect(audioCtx.destination);
      audioSources.push(src);
    });
  }
}

function dbToGain(db) { return Math.pow(10, (db ?? 0) / 20); }

async function loadAudio(url) {
  const res = await fetch(url);
  const arrayBuffer = await res.arrayBuffer();
  return audioCtx.decodeAudioData(arrayBuffer);
}

// Waveform
async function setupWaveform() {
  waveformCanvas.width = waveformCanvas.clientWidth * devicePixelRatio;
  waveformCanvas.height = waveformCanvas.clientHeight * devicePixelRatio;
  if (timelineData.clips.length === 0) return;
  const src = timelineData.clips[0].src;
  try {
    const res = await fetch(src);
    const arrayBuffer = await res.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    waveformDuration = audioBuffer.duration;
    const channel = audioBuffer.getChannelData(0);
    const peaks = 400;
    const samplesPerPeak = Math.max(1, Math.floor(channel.length / peaks));
    waveformPeaks = [];
    for (let i = 0; i < peaks; i++) {
      const start = i * samplesPerPeak;
      let max = 0;
      for (let j = 0; j < samplesPerPeak && start + j < channel.length; j++) {
        max = Math.max(max, Math.abs(channel[start + j]));
      }
      waveformPeaks.push(max);
    }
    drawWaveform(0);
  } catch {
    waveformPeaks = null;
  }
}

function drawWaveform(playheadRatio) {
  const ctx = waveformCanvas.getContext('2d');
  const w = waveformCanvas.width;
  const h = waveformCanvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!waveformPeaks) return;
  const barW = w / waveformPeaks.length;
  const mid = h / 2;
  ctx.fillStyle = '#888';
  for (let i = 0; i < waveformPeaks.length; i++) {
    const peak = waveformPeaks[i];
    const barH = Math.max(1, peak * (h - 4));
    ctx.fillRect(i * barW, mid - barH / 2, Math.max(1, barW - 0.5), barH);
  }
  if (playheadRatio > 0) {
    const px = playheadRatio * w;
    ctx.fillStyle = '#fff';
    ctx.fillRect(px - 0.5, 0, 1, h);
  }
}

// Transitions
function scheduleTransitions() {
  const cuts = summary?.cuts ?? [];
  let cursor = 0;
  transitionPlate.style.transition = 'opacity 0.3s';
  const check = () => {
    if (!isPlaying) { requestAnimationFrame(check); return; }
    for (let i = 0; i < cuts.length; i++) {
      const cut = cuts[i];
      const speed = cut.speed || 1;
      const inSec = cut.in || 0;
      const outSec = cut.out || inSec + 1;
      const durationSec = (outSec - inSec) / speed;
      const at = cut.at;
      if (at !== undefined) cursor = at;
      const nextStart = cursor + (at === undefined ? durationSec : 0);
      if (cut.transitionOut && outputTime >= nextStart - cut.transitionOut.duration && outputTime < nextStart) {
        const local = outputTime - (nextStart - cut.transitionOut.duration);
        const progress = local / cut.transitionOut.duration;
        const type = cut.transitionOut.type;
        if (type === 'fade-black' || type === 'fade-white') {
          transitionPlate.style.background = type === 'fade-black' ? '#000' : '#fff';
          transitionPlate.style.opacity = String(progress);
          transitionPlate.style.visibility = 'visible';
        }
        requestAnimationFrame(check); return;
      } else if (at === undefined) cursor += durationSec;
    }
    transitionPlate.style.opacity = '0';
    transitionPlate.style.visibility = 'hidden';
    requestAnimationFrame(check);
  };
  check();
}

// Playback
function getVideoTimeForOutput(outTime) {
  let acc = 0;
  for (const seg of segments) {
    if (seg.isGap) {
      if (outTime <= acc + seg.durationSec) return -1;
      acc += seg.durationSec;
      continue;
    }
    if (outTime <= acc + seg.durationSec) {
      const localOut = outTime - acc;
      return seg.inSec + localOut * seg.speed;
    }
    acc += seg.durationSec;
  }
  return segments.length > 0 ? segments[segments.length - 1]?.inSec ?? 0 : 0;
}

function getActiveSegment(outTime) {
  let acc = 0;
  for (const seg of segments) {
    if (outTime <= acc + seg.durationSec || seg === segments[segments.length - 1]) return seg;
    acc += seg.durationSec;
  }
  return null;
}

function seekTo(outTime) {
  outputTime = Math.max(0, Math.min(outTime, totalDuration));
  const videoTime = getVideoTimeForOutput(outputTime);
  const seg = getActiveSegment(outputTime);
  if (videoTime >= 0 && seg && !seg.isGap) {
    video.src = timelineData.clips[seg.index]?.src || video.src;
    video.currentTime = videoTime;
  }
  seek.value = outputTime;
  updateTimeLabel();
  updateOverlays();
}

function play() {
  if (isPlaying || segments.length === 0) return;
  isPlaying = true;
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  for (const src of audioSources) {
    if (!src.started) { src.start(); src.started = true; }
  }
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
  if (outputTime >= totalDuration) {
    outputTime = totalDuration;
    pause();
    return;
  }

  const targetVideoTime = getVideoTimeForOutput(outputTime);
  const seg = getActiveSegment(outputTime);
  if (targetVideoTime >= 0 && seg && !seg.isGap) {
    const currentSrc = timelineData.clips[seg.index]?.src;
    if (currentSrc && video.src !== currentSrc) video.src = currentSrc;
    if (Math.abs(video.currentTime - targetVideoTime) > 0.1) {
      video.currentTime = targetVideoTime;
    }
  }

  seek.value = outputTime;
  updateTimeLabel();
  updateOverlays();
  updateWaveformPlayhead();
  updateCaption();
  requestAnimationFrame(playbackLoop);
}

function updateWaveformPlayhead() {
  if (!waveformPeaks || waveformDuration <= 0) return;
  const ratio = outputTime / totalDuration;
  drawWaveform(ratio);
  waveformPlayhead.style.left = `${ratio * 100}%`;
}

// Transport
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
  const wasPlaying = isPlaying;
  if (wasPlaying) pause();
  seekTo(Number(seek.value));
  if (wasPlaying) play();
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

video.addEventListener('loadedmetadata', () => {
  if (isPlaying) video.play();
});

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

// Zoom via Ctrl+wheel
wrapper.addEventListener('wheel', (e) => {
  if (!e.ctrlKey && !e.metaKey) return;
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.1 : 0.1;
  zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + delta * zoom));
  pan = { x: 0, y: 0 };
  updateZoom();
}, { passive: false });

// Pan
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
wrapper.addEventListener('pointerup', () => {
  drag = null;
  wrapper.style.cursor = '';
});

// Fullscreen
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
  const mountedOverlays = [];
  function unmount() { stage.querySelectorAll('[data-overlay-id]').forEach(el => el.remove()); mountedOverlays.length = 0; }
  function mount(summary) {
    unmount();
    const overlays = summary?.overlays;
    if (!Array.isArray(overlays)) return;
    const fragment = document.createDocumentFragment();
    for (const overlay of overlays) {
      const start = Number(overlay.start) || 0;
      const duration = Number(overlay.duration) || 0;
      const container = document.createElement('div');
      container.dataset.overlayId = String(overlay.id);
      container.dataset.start = String(start);
      container.dataset.duration = String(duration);
      container.style.cssText = 'position:absolute;inset:0;pointer-events:auto;visibility:hidden;';
      if (overlay.transform) {
        const t = overlay.transform;
        container.style.transform = `translate(${t.x || 0}px,${t.y || 0}px) scale(${t.scale || 1}) rotate(${t.rotate || 0}deg)`;
      }
      container.innerHTML = overlay.html || '';
      fragment.appendChild(container);
      mountedOverlays.push({ container, start, duration, visible: false });
    }
    stage.appendChild(fragment);
  }
  function tick(t) {
    for (const overlay of mountedOverlays) {
      const visible = overlay.start <= t && t < overlay.start + overlay.duration;
      if (visible !== overlay.visible) { overlay.container.style.visibility = visible ? 'visible' : 'hidden'; overlay.visible = visible; }
      if (!visible) continue;
      const localMs = Math.max(0, (t - overlay.start) * 1000);
      const animations = overlay.container.getAnimations({ subtree: true });
      for (const a of animations) { a.pause(); a.currentTime = localMs; }
    }
  }
  return { mount, tick, unmount };
}

function updateOverlays() {
  if (window.akari?.runtime) window.akari.runtime.tick(outputTime);
}

// Enhanced captions
let currentCaptionSegments = [];
let captionRAF = null;

function updateCaption() {
  const caps = summary?.captions;
  if (!Array.isArray(caps) || caps.length === 0) return;
  const active = caps.find(c => {
    const start = Number(c.start) || 0;
    const dur = Number(c.duration) || 0;
    return outputTime >= start && outputTime < start + dur;
  });
  if (!active) {
    captionPlate.textContent = '';
    if (captionRAF) { cancelAnimationFrame(captionRAF); captionRAF = null; }
    return;
  }
  const words = active.words ?? [];
  if (words.length > 0 && Array.isArray(words)) {
    const start = Number(active.start) || 0;
    const localMs = (outputTime - start) * 1000;
    captionPlate.innerHTML = words.map((w) => {
      const wStart = (w.t ?? 0);
      const wDur = (w.d ?? 0.3);
      const wEnd = wStart + wDur;
      const isPast = localMs >= wEnd;
      const isActive = localMs >= wStart && localMs < wEnd;
      let color = '#fff';
      let shadow = '0 1px 2px #000';
      if (isPast) { color = '#aaa'; shadow = 'none'; }
      else if (isActive) { color = '#ff0'; shadow = '0 0 8px rgba(255,255,0,0.6)'; }
      return `<span style="color:${color};text-shadow:${shadow};transition:color 0.05s">${escapeHtml(w.t ? (w.word || w.w || '') : (w.word || w.w || w))}</span>`;
    }).join(' ');
  } else {
    captionPlate.textContent = active.text || active.caption || '';
  }
}

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// Message
function showMessage(text) {
  if (text) { previewMessage.hidden = false; previewMessageText.textContent = text; }
  else { previewMessage.hidden = true; }
}

// WebSocket live reload
function connectWs() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}`);
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'reload') location.reload();
    } catch {}
  };
  ws.onclose = () => setTimeout(connectWs, 2000);
  ws.onerror = () => ws.close();
}

// Boot
init();
connectWs();
