// cuts[].fx browser preview: id 参照表 + ディスパッチ機構のブラウザ側ミラー。public/ は単独の
// ブラウザルートとして配信され render-cut の外側にあるため、render-cut/src/fx.mjs を import せず
// 意図的に構造だけをミラーする（型は import { FX_IDS } from render-cut/src/fx.mjs との一致を
// テストで確認する）。
//
// 2026-08-11 撤去: v0 の画面 FX 小語彙 5 種（noise/particles/vignette/flare/color-overlay。
// contract-2026-08-02-preview-parity.md §2.4.5 に旧近似実装の記録が残る）はオーナー裁定により
// 製品面から撤去した。FX_IDS / FX_VISUALS は render-cut 側の FX_IDS / FX_BUILDERS と同じ「器」
// （id 参照表・ディスパッチ）で、現在は登録 0 件。将来 fx が復活したら、この 2 箇所と
// render-cut/src/fx.mjs の FX_BUILDERS へ同じ id で登録する。

// FX_IDS: プレビューが可視化できる id 一覧。render-cut 側の FX_IDS（fx.mjs）と常に一致させる
// （packages/preview-server/test/cut-fx.test.mjs が実測で確認）。
export const FX_IDS = [];

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

// FX_VISUALS: id -> canvas/CSS 描画関数のディスパッチ表。render-cut 側の FX_BUILDERS と対になる
// 器で、2026-08-11 現在 0 件。新しい fx を実装するときは render-cut 側にビルダーを追加するのと
// 同じ id でここへ `(element, item, state) => void` を追加する（element は rebuildVisuals が
// 用意する div、item は normalizeCutFxList の要素、state は current() の戻り値）。
const FX_VISUALS = {};

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
      const element = document.createElement('div');
      element.style.cssText = LAYER_STYLE;
      element.dataset.fxId = item.id;
      element.dataset.fxSourceIndex = String(item.sourceIndex);
      element.dataset.fxStackIndex = String(stackIndex);
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
          headers: { 'content-type': 'application/json', 'x-akari-preview-projection': '1' },
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
      row.append(title, slider, value);
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
      const visual = FX_VISUALS[item.id];
      if (!visual) return; // 2026-08-11 現在 FX_VISUALS は登録 0 件 — 描画するものが無いので何もしない
      visual(element, item, state);
    });
  }

  controls.setAttribute('data-akari-interaction', '1');
  return { update };
}
