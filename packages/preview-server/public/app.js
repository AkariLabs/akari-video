// AKARI Video Preview — client (macOS UI port)
// <video> 要素ベース。preview-engine の WebCodecs は使わない（互換性重視）。

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

// --- init ---

async function init() {
  try {
    const [timelineRes, editRes] = await Promise.all([
      fetch('/api/timeline'),
      fetch('/api/raw-edit.json'),
    ]);
    if (!timelineRes.ok) throw new Error(`timeline: HTTP ${timelineRes.status}`);
    timelineData = await timelineRes.json();
    summary = await editRes.json();
    fps = timelineData.fps || 30;

    // video source: first clip's src
    if (timelineData.clips.length > 0) {
      video.src = timelineData.clips[0].src;
    }

    // build segments from cuts
    buildSegments();

    // wire overlay runtime
    window.akari = window.akari || {};
    window.akari.runtime = createOverlayRuntime();

    showMessage(null);
  } catch (e) {
    showMessage(e.message);
  }
}

function buildSegments() {
  if (!summary || !summary.cuts) return;
  segments = summary.cuts.map((cut, i) => {
    const speed = cut.speed || 1;
    const inSec = cut.in || 0;
    const outSec = cut.out || inSec + 1;
    return { index: i, inSec, outSec, speed, durationSec: (outSec - inSec) / speed };
  });
  totalDuration = segments.reduce((sum, s) => sum + s.durationSec, 0);
  seek.max = totalDuration;
  updateTimeLabel();
}

// --- playback ---

function getVideoTimeForOutput(outTime) {
  let acc = 0;
  for (const seg of segments) {
    if (outTime <= acc + seg.durationSec) {
      const localOut = outTime - acc;
      return seg.inSec + localOut * seg.speed;
    }
    acc += seg.durationSec;
  }
  return segments.length > 0 ? segments[segments.length - 1].outSec : 0;
}

function seekTo(outTime) {
  outputTime = Math.max(0, Math.min(outTime, totalDuration));
  const videoTime = getVideoTimeForOutput(outputTime);
  video.currentTime = videoTime;
  seek.value = outputTime;
  updateTimeLabel();
  updateOverlays();
}

function play() {
  if (isPlaying || segments.length === 0) return;
  isPlaying = true;
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

  // sync video to correct position
  const targetVideoTime = getVideoTimeForOutput(outputTime);
  if (Math.abs(video.currentTime - targetVideoTime) > 0.1) {
    video.currentTime = targetVideoTime;
  }

  seek.value = outputTime;
  updateTimeLabel();
  updateOverlays();
  requestAnimationFrame(playbackLoop);
}

// --- transport ---

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

// --- waveform toggle ---

let waveformVisible = false;
waveformToggle.addEventListener('click', () => {
  waveformVisible = !waveformVisible;
  waveformRow.hidden = !waveformVisible;
  waveformToggle.setAttribute('aria-pressed', String(waveformVisible));
});

// --- zoom ---

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

// pan
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

// --- fullscreen ---

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

// --- overlay runtime (macOS 版と同等) ---

function createOverlayRuntime() {
  const mountedOverlays = [];

  function unmount() {
    stage.querySelectorAll('[data-overlay-id]').forEach(el => el.remove());
    mountedOverlays.length = 0;
  }

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
      if (visible !== overlay.visible) {
        overlay.container.style.visibility = visible ? 'visible' : 'hidden';
        overlay.visible = visible;
      }
      if (!visible) continue;
      const localMs = Math.max(0, (t - overlay.start) * 1000);
      const animations = overlay.container.getAnimations({ subtree: true });
      for (const a of animations) { a.pause(); a.currentTime = localMs; }
    }
  }

  return { mount, tick, unmount };
}

function updateOverlays() {
  if (window.akari?.runtime) {
    window.akari.runtime.tick(outputTime);
  }
}

// --- caption plate ---

function updateCaption() {
  if (!summary?.captions || !Array.isArray(summary.captions)) return;
  const cap = summary.captions.find(c => outputTime >= c.start && outputTime < c.start + c.duration);
  captionPlate.textContent = cap?.text || '';
}

// --- message ---

function showMessage(text) {
  if (text) {
    previewMessage.hidden = false;
    previewMessageText.textContent = text;
  } else {
    previewMessage.hidden = true;
  }
}

// --- WebSocket live reload ---

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

// --- boot ---

init();
connectWs();
