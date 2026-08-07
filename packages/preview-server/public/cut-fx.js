// cuts[].fx browser preview. This intentionally mirrors the five-id vocabulary in
// packages/render-cut/src/fx.mjs without importing it: public/ is served as a standalone browser
// root, while render-cut is outside that root. The browser implementation is visual parity for
// authoring, not a pixel-identical port of ffmpeg (see contract-2026-08-02-preview-parity.md §2.4.5).

export const FX_IDS = ['noise', 'particles', 'vignette', 'flare', 'color-overlay'];
export const APPROXIMATE_FX_IDS = ['noise', 'particles', 'flare'];

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export function normalizeCutFxList(fx) {
  if (!Array.isArray(fx)) return [];
  return fx.flatMap((item, sourceIndex) => {
    if (!item || typeof item !== 'object' || !FX_IDS.includes(item.id)) return [];
    return [{
      id: item.id,
      intensity: typeof item.intensity === 'number' && Number.isFinite(item.intensity)
        ? clamp01(item.intensity) : 1,
      params: item.params && typeof item.params === 'object' && !Array.isArray(item.params)
        ? item.params : {},
      sourceIndex,
    }];
  });
}

export function isApproximateFx(id) {
  return APPROXIMATE_FX_IDS.includes(id);
}

export function approximateBadgeLabel(id) {
  return isApproximateFx(id) ? '[FX ≈ 近似]' : '';
}

// All preview implementations use the same linear 0..1 blend contract as render-cut.
export function intensityToOpacity(intensity) {
  return typeof intensity === 'number' && Number.isFinite(intensity) ? clamp01(intensity) : 1;
}

export function normalizePreviewColor(color, fallback = 'black') {
  if (typeof color !== 'string' || color.trim() === '') return fallback;
  const value = color.trim();
  const ffmpegHex = /^0x([0-9a-f]{6}(?:[0-9a-f]{2})?)$/i.exec(value);
  return ffmpegHex ? `#${ffmpegHex[1]}` : value;
}

export function vignetteVisual(intensity, color = 'black') {
  const edge = color === 'white' ? '255,255,255' : '0,0,0';
  return {
    background: `radial-gradient(ellipse at center, rgba(${edge},0) 30%, rgba(${edge},0.18) 58%, rgba(${edge},0.92) 100%)`,
    opacity: intensityToOpacity(intensity),
  };
}

export function flareVisual(outputTime, seed = 0) {
  const phase = seededUnit(hashParts(seed)) * Math.PI * 2;
  const x = 50 + 34 * Math.cos(Math.max(0, outputTime) * 0.38 + phase);
  const y = 50 + 28 * Math.sin(Math.max(0, outputTime) * 0.31 + phase);
  return `radial-gradient(circle at ${x.toFixed(3)}% ${y.toFixed(3)}%, rgba(255,255,255,0.98) 0%, rgba(255,241,196,0.72) 12%, rgba(255,210,130,0.24) 26%, rgba(255,255,255,0) 46%)`;
}

function seededUnit(seed) {
  let value = seed | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 4294967296;
}

function hashParts(...parts) {
  let hash = 0x811c9dc5;
  const value = parts.join(':');
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function canvasSize(output) {
  const width = Math.max(1, Number(output?.width) || 1280);
  const height = Math.max(1, Number(output?.height) || 720);
  const scale = Math.min(1, 360 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function prepareCanvas(canvas, output) {
  const size = canvasSize(output);
  if (canvas.width !== size.width) canvas.width = size.width;
  if (canvas.height !== size.height) canvas.height = size.height;
  return canvas.getContext('2d');
}

function drawNoise(canvas, output, outputTime, seed) {
  const context = prepareCanvas(canvas, output);
  const width = canvas.width;
  const height = canvas.height;
  const image = context.createImageData(width, height);
  const frame = Math.floor(Math.max(0, outputTime) * (Number(output?.fps) || 30));
  let state = hashParts(seed, frame);
  for (let index = 0; index < image.data.length; index += 4) {
    state = Math.imul(state ^ (state >>> 15), 2246822519) >>> 0;
    const value = 64 + (state & 127);
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

function glow(context, x, y, radius, alpha) {
  const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
  gradient.addColorStop(0.22, `rgba(255,245,210,${alpha * 0.8})`);
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function drawParticles(canvas, output, outputTime, seed) {
  const context = prepareCanvas(canvas, output);
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  for (let index = 0; index < 4; index += 1) {
    const phase = seededUnit(hashParts(seed, index)) * Math.PI * 2;
    const x = ((index + 0.5) / 4 * width + outputTime * width * 0.16 * (1 + index * 0.25)) % width;
    const y = height * (0.5 + 0.22 * Math.sin(outputTime * (1.5 - index * 0.14) + phase));
    glow(context, x, y, Math.max(2, Math.min(width, height) * 0.035), 0.95);
  }
}

function visualSignature(cutIndex, list) {
  return `${cutIndex}:${list.map(item => `${item.sourceIndex}:${item.id}`).join('|')}`;
}

const LAYER_STYLE = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';

export function createCutFxController(readState) {
  const host = document.getElementById('cut-fx-layer');
  const controls = document.getElementById('cut-fx-controls');
  if (!host || !controls) return { update() {} };

  let signature = '';
  let visualLayers = [];
  let writeTail = Promise.resolve();
  const writeTimers = new Map();

  function current() {
    const state = readState?.() || {};
    const segment = state.segment;
    const cutIndex = segment && !segment.isGap && segment.index >= 0 ? segment.index : -1;
    const cut = cutIndex >= 0 ? state.summary?.cuts?.[cutIndex] : null;
    const cutTime = cutIndex >= 0
      ? Math.max(0, (Number(state.outputTime) || 0) - (Number(segment.outStart) || 0)) : 0;
    return { ...state, cutIndex, cutTime, cut, list: normalizeCutFxList(cut?.fx) };
  }

  function rebuildVisuals(state) {
    host.replaceChildren();
    visualLayers = state.list.map((item, stackIndex) => {
      const element = document.createElement(['noise', 'particles'].includes(item.id) ? 'canvas' : 'div');
      element.style.cssText = LAYER_STYLE;
      element.dataset.fxId = item.id;
      element.dataset.fxSourceIndex = String(item.sourceIndex);
      element.dataset.fxStackIndex = String(stackIndex);
      if (item.id === 'noise') {
        element.style.imageRendering = 'pixelated';
        element.style.mixBlendMode = 'overlay';
      } else if (item.id === 'particles' || item.id === 'flare') {
        element.style.mixBlendMode = 'screen';
      }
      host.appendChild(element);
      return { item, element };
    });
  }

  function saveIntensity(cutIndex, sourceIndex, id, intensity) {
    const key = `${cutIndex}:${sourceIndex}`;
    clearTimeout(writeTimers.get(key));
    writeTimers.set(key, setTimeout(() => {
      writeTimers.delete(key);
      writeTail = writeTail.then(async () => {
        const response = await fetch('/api/summary');
        if (!response.ok) throw new Error(`edit.json を読めません: HTTP ${response.status}`);
        const edit = await response.json();
        const target = edit?.cuts?.[cutIndex]?.fx?.[sourceIndex];
        if (!target || target.id !== id) throw new Error('保存対象の FX が変更されました');
        target.intensity = intensity;
        const put = await fetch('/api/edit.json', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(edit),
        });
        if (!put.ok) throw new Error(`FX の保存に失敗しました: HTTP ${put.status}`);
        controls.dataset.saveState = 'saved';
      }).catch((error) => {
        controls.dataset.saveState = 'error';
        controls.title = error.message;
        console.warn('[preview] cut FX write failed', error);
      });
    }, 120));
  }

  function rebuildControls(state) {
    controls.replaceChildren();
    controls.hidden = state.list.length === 0;
    if (state.list.length === 0) return;
    const header = document.createElement('div');
    header.className = 'cut-fx-controls-header';
    header.textContent = `Cut ${state.cutIndex + 1} · FX`;
    controls.appendChild(header);
    state.list.forEach((item) => {
      const row = document.createElement('label');
      row.className = 'cut-fx-control';
      row.setAttribute('data-akari-interaction', '1');
      const title = document.createElement('span');
      title.className = 'cut-fx-control-title';
      title.textContent = item.id;
      const badge = document.createElement('span');
      badge.className = 'cut-fx-approx-badge';
      badge.textContent = approximateBadgeLabel(item.id);
      badge.hidden = !isApproximateFx(item.id);
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '1';
      slider.step = '0.01';
      slider.value = String(item.intensity);
      slider.dataset.fxSourceIndex = String(item.sourceIndex);
      slider.setAttribute('data-akari-interaction', '1');
      slider.setAttribute('aria-label', `${item.id} intensity`);
      const value = document.createElement('output');
      value.textContent = item.intensity.toFixed(2);
      slider.addEventListener('input', () => {
        const next = intensityToOpacity(Number(slider.value));
        const live = current();
        const target = live.cut?.fx?.[item.sourceIndex];
        if (!target || target.id !== item.id) return;
        target.intensity = next;
        value.textContent = next.toFixed(2);
        controls.dataset.saveState = 'saving';
        update();
        saveIntensity(live.cutIndex, item.sourceIndex, item.id, next);
      });
      row.append(title, badge, slider, value);
      controls.appendChild(row);
    });
  }

  function syncControls(state) {
    for (const item of state.list) {
      const slider = controls.querySelector(`input[data-fx-source-index="${item.sourceIndex}"]`);
      if (!slider || document.activeElement === slider) continue;
      const value = String(item.intensity);
      if (slider.value !== value) slider.value = value;
      if (slider.nextElementSibling) slider.nextElementSibling.textContent = item.intensity.toFixed(2);
    }
  }

  function update() {
    const state = current();
    const nextSignature = visualSignature(state.cutIndex, state.list);
    if (nextSignature !== signature) {
      signature = nextSignature;
      rebuildVisuals(state);
      rebuildControls(state);
    }
    host.hidden = state.list.length === 0;
    controls.hidden = state.list.length === 0;
    syncControls(state);
    visualLayers.forEach(({ item: original, element }) => {
      const item = state.list.find(candidate => candidate.sourceIndex === original.sourceIndex && candidate.id === original.id);
      const opacity = intensityToOpacity(item?.intensity ?? 0);
      element.hidden = opacity <= 0;
      element.style.opacity = String(opacity);
      if (!item || opacity <= 0) return;
      if (item.id === 'vignette') {
        element.style.background = vignetteVisual(opacity, item.params.color).background;
      } else if (item.id === 'color-overlay') {
        element.style.background = normalizePreviewColor(item.params.color, 'black');
      } else if (item.id === 'noise') {
        drawNoise(element, state.summary?.output, state.cutTime, hashParts(state.cutIndex, item.sourceIndex));
      } else if (item.id === 'particles') {
        drawParticles(element, state.summary?.output, state.cutTime, hashParts(state.cutIndex, item.sourceIndex));
      } else if (item.id === 'flare') {
        element.style.background = flareVisual(state.cutTime, hashParts(state.cutIndex, item.sourceIndex));
      }
    });
  }

  controls.setAttribute('data-akari-interaction', '1');
  return { update };
}
