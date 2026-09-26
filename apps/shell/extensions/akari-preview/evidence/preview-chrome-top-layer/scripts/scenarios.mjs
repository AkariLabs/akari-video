// 手順 0 / 6 の筋書き（検証専用・ラッパー作成）。BEFORE / AFTER 共通の観測。判定は after の後処理で行う。
const VIEW_MEASURE = `(() => {
  const vis = n => !!n && !n.hidden && n.getClientRects().length > 0 && getComputedStyle(n).display !== 'none' && getComputedStyle(n).visibility !== 'hidden' && Number(getComputedStyle(n).opacity) > 0.01;
  const R = b => ({ l: +b.left.toFixed(1), t: +b.top.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) });
  const clipOf = n => {
    let c = { l: 0, t: 0, r: innerWidth, b: innerHeight };
    for (let p = n.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.position === 'fixed') { break; }
      if (s.overflow !== 'visible' || s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.clipPath !== 'none') {
        const b = p.getBoundingClientRect();
        c = { l: Math.max(c.l, b.left), t: Math.max(c.t, b.top), r: Math.min(c.r, b.right), b: Math.min(c.b, b.bottom) };
      }
    }
    return c;
  };
  const one = (name, n) => {
    const b = n.getBoundingClientRect();
    const c = clipOf(n);
    const iw = Math.max(0, Math.min(b.right, c.r) - Math.max(b.left, c.l)), ih = Math.max(0, Math.min(b.bottom, c.b) - Math.max(b.top, c.t));
    const area = Math.max(1e-6, b.width * b.height);
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const top = cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight ? document.elementFromPoint(cx, cy) : null;
    return { name, rect: R(b), visibleFrac: +((iw * ih) / area).toFixed(3), hitSelf: !!top && (top === n || n.contains(top)),
      hitBy: top && !(top === n || n.contains(top)) ? (top.id || top.getAttribute('data-akari-layer-id') || top.className || top.tagName).toString().slice(0, 60) : null,
      z: getComputedStyle(n).zIndex, pos: getComputedStyle(n).position };
  };
  const q = [
    ['layer-box', '#layer-select-box'], ['layer-handle', '#layer-select-box [data-akari-handle], #layer-select-box [data-akari-crop-edge]'],
    ['cut-box', '#cut-select-box'], ['cut-handle', '#cut-select-box [data-akari-handle], #cut-select-box [data-akari-crop-edge]'],
    ['crop-toggle', '#layer-crop-toggle'], ['persp-toggle', '#layer-perspective-toggle'],
    ['caption-box', '#caption-select-box'], ['caption-tools', '.akari-caption-select-tools'],
    ['caption-tool', '.akari-caption-select-tools [data-caption-tool]'],
    ['caption-handle', '.akari-caption-handle'],
    ['ix-frame', '.akari-interaction-selection-frame'], ['ix-handle', '.akari-interaction-handle'],
  ];
  const out = [];
  for (const [name, sel] of q) for (const n of document.querySelectorAll(sel)) if (vis(n)) out.push(one(name + (n.getAttribute('data-akari-handle') || n.getAttribute('data-h') || n.getAttribute('data-caption-tool') || n.getAttribute('data-akari-crop-edge') ? ':' + (n.getAttribute('data-akari-handle') || n.getAttribute('data-h') || n.getAttribute('data-caption-tool') || n.getAttribute('data-akari-crop-edge')) : ''), n));
  const stage = document.getElementById('preview-stage').getBoundingClientRect();
  const guides = [...document.querySelectorAll('.akari-interaction-snap-guide')].filter(vis).map(n => { const s = getComputedStyle(n);
    return { cls: String(n.className), bg: s.backgroundColor, borderLeft: s.borderLeftStyle + ' ' + s.borderLeftColor, borderTop: s.borderTopStyle + ' ' + s.borderTopColor, rect: R(n.getBoundingClientRect()) }; });
  const bodyCls = [...document.body.classList].filter(c => /akari-(media|caption|selection)/.test(c));
  const tools = document.querySelector('.akari-caption-select-tools');
  const toolsStyle = tools ? (() => { const s = getComputedStyle(tools); return { visibility: s.visibility, display: s.display, opacity: s.opacity, bg: s.backgroundColor, rect: R(tools.getBoundingClientRect()) }; })() : null;
  return { viewport: [innerWidth, innerHeight], stage: R(stage), items: out, guides, bodyCls, toolsStyle,
    clipped: out.filter(x => x.visibleFrac < 0.999).map(x => x.name + '=' + x.visibleFrac), covered: out.filter(x => !x.hitSelf).map(x => x.name + '<' + x.hitBy) };
})()`;

const angleOf = expr => `(() => { const n = ${expr}; if (!n) return null; const m = new DOMMatrix(getComputedStyle(n).transform === 'none' ? undefined : getComputedStyle(n).transform); return +(Math.atan2(m.b, m.a) * 180 / Math.PI).toFixed(2); })()`;

export default async function scenarios(api) {
  const { scenario, evaluate, browser, main, sleep, S } = api;
  const V = expr => evaluate(browser, expr, api.view.contextId, api.view.sessionId);
  const measure = () => V(VIEW_MEASURE);
  const hostBar = () => evaluate(main, `(() => {
    const vis = n => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden' && getComputedStyle(n).display !== 'none' && Number(getComputedStyle(n).opacity) > 0.01;
    const R = n => { const b = n.getBoundingClientRect(); return { l: +b.left.toFixed(1), t: +b.top.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
    const out = {};
    for (const k of ['preview-context-bar', 'preview-element-menu', 'preview-context-window', 'preview-element-more']) {
      const n = document.querySelector('[data-akari-ui="' + k + '"]');
      out[k] = n ? { visible: vis(n), busy: n.getAttribute('data-busy'), rect: vis(n) ? R(n) : null } : null;
    }
    return out; })()`);
  const shots = {};
  const shot = async name => { shots[name] = await api.previewShot(name); return shots[name]; };
  const setZoom = async scale => { await V(`(() => { window.postMessage({ type: 'akari-preview-set-zoom', ${scale === 'fit' ? 'fit: true' : 'scale: ' + scale} }, '*'); return true; })()`); await sleep(700); };
  const vmouse = (type, x, y, buttons) => api.mouse(type, api.outer.x + x, api.outer.y + y, [], buttons);
  const box = sel => V(`(() => { const n = document.querySelector(${S(sel)}); if (!n) return null; const b = n.getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: b.right, b: b.bottom }; })()`);
  const plateBox = text => V(`(() => { const p = [...document.querySelectorAll('.caption-row-plate')].find(n => n.getBoundingClientRect().width > 0 && (n.querySelector('.akari-caption__line, .akari-caption__block')?.textContent || '').includes(${S(text)})); if (!p) return null; const n = p.querySelector('.akari-caption__plate') || p; const b = n.getBoundingClientRect(); return { l: b.left, t: b.top, w: b.width, h: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2, r: b.right, b: b.bottom }; })()`);
  const stage = () => box('#preview-layers');
  const selectCaption = async id => {
    await evaluate(main, `(() => { window.dispatchEvent(new CustomEvent('akari.daihon.selectionChanged', { detail: { editUri: ${S(api.editUri)}, captionIds: ${S([id])} } })); return true; })()`);
    await sleep(900);
  };
  const click = async (x, y) => { await api.viewClick(x, y); await sleep(500); };
  const layerBox = id => box(`[data-akari-layer-id=${S(id)}]`);
  /** 押して動かす。途中（mid）で止めて onMid を呼ぶ。 */
  const drag = async (from, to, { steps = 14, midAt = 0.7, hold = 350, onMid } = {}) => {
    await vmouse('mouseMoved', from.x, from.y);
    await sleep(80);
    await vmouse('mousePressed', from.x, from.y);
    await sleep(120);
    let mid = null;
    const midStep = Math.max(1, Math.round(steps * midAt));
    for (let i = 1; i <= steps; i++) {
      const x = from.x + (to.x - from.x) * i / steps, y = from.y + (to.y - from.y) * i / steps;
      await vmouse('mouseMoved', x, y, 1);
      await sleep(35);
      if (i === midStep && onMid) { await sleep(hold); mid = await onMid({ x, y }); }
    }
    await sleep(120);
    await vmouse('mouseReleased', to.x, to.y);
    await sleep(900);
    return mid;
  };
  const midRecord = name => async pointer => ({ pointer, shot: await shot(name), view: await measure(), host: await hostBar() });

  await api.evaluate(main, `(() => { const d = window.theia.container._bindingDictionary; const k = [...d._map.keys()].find(x => typeof x === 'function' && typeof x.prototype?.collapsePanel === 'function' && typeof x.prototype?.revealWidget === 'function'); const shell = window.theia.container.get(k); for (const a of ['left', 'right']) { try { shell.collapsePanel(a); } catch {} } return true; })()`);
  await sleep(1500);
  await api.refreshView();
  const portrait = api.orient === 'portrait';

  // (a) 各素材を出力の枠の端まで動かして、枠・つまみ・道具列・メニューの切れ方（fit）
  await scenario('a-photo-edge', async () => {
    const s = await stage();
    const p = await layerBox('photo-1');
    await click(p.cx, p.cy);
    await drag({ x: p.cx, y: p.cy }, { x: p.cx - (p.l - s.l) - p.w * 0.25, y: p.cy - (p.t - s.t) - p.h * 0.3 });
    return { stage: s, before: p, after: await layerBox('photo-1'), shot: await shot('a-photo-edge-fit'), view: await measure(), host: await hostBar() };
  });
  await scenario('a-shape-edge', async () => {
    const s = await stage();
    const b = await api.itemBox('shape-a');
    await click(b.cx, b.cy);
    await drag({ x: b.cx, y: b.cy }, { x: b.cx + (s.r - (b.left + b.width)) + b.width * 0.3, y: b.cy });
    return { shot: await shot('a-shape-edge-fit'), view: await measure(), host: await hostBar() };
  });
  await scenario('a-placed-text-edge', async () => {
    const s = await stage();
    const b = await plateBox('置いた文字');
    await click(b.cx, b.cy);
    await drag({ x: b.cx, y: b.cy }, { x: b.cx, y: b.cy - (b.t - s.t) - b.h * 0.2 });
    return { shot: await shot('a-placed-text-edge-fit'), view: await measure(), host: await hostBar() };
  });
  await scenario('a-caption-edge', async () => {
    await selectCaption('c-0001');
    return { shot: await shot('a-caption-bottom-fit'), view: await measure(), host: await hostBar() };
  });
  // ズームの比較: fit(=100% プリセットと同じ zoom 1) / 200% / 50%
  for (const [id, kind] of [['photo-1', 'layer'], ['shape-a', 'shape'], ['c-0101', 'caption'], ['c-0001', 'caption']]) {
    for (const z of [2, 0.5]) {
      await scenario(`a-zoom-${id}-${z}`, async () => {
        await setZoom('fit');
        if (kind === 'caption') await selectCaption(id);
        else if (kind === 'layer') { const p = await layerBox(id); await click(Math.max(p.l + 8, 4), Math.max(p.t + 8, 4)); }
        else { const b = await api.itemBox(id); await click(Math.min(b.left + 10, b.cx), b.cy); }
        await setZoom(z);
        const r = { shot: await shot(`a-zoom-${id}-${z * 100}`), view: await measure(), host: await hostBar() };
        await setZoom('fit');
        return r;
      });
    }
  }

  for (const z of [1.3, 1.6]) {
    await scenario(`a-zoom-partial-c-0101-${z}`, async () => {
      await setZoom('fit');
      await selectCaption('c-0101');
      await setZoom(z);
      await sleep(600);
      const r = { shot: await shot(`a-zoom-partial-c-0101-${Math.round(z * 100)}`), view: await measure() };
      await setZoom('fit');
      return r;
    });
  }
  // (b) 上の写真（cover）の下に隠れた字幕 c-0001 を選び、つまみが見える・押せるか
  await scenario('b-hidden-caption', async () => {
    await setZoom('fit');
    await selectCaption('c-0001');
    const m = await measure();
    const before = await api.readEdit();
    const capBefore = JSON.parse(await (await import('node:fs/promises')).readFile(api.captionsPath, 'utf8'));
    const se = await box('.akari-caption-handle[data-h="se"]');
    let dragResult = null;
    if (se) {
      await drag({ x: se.cx, y: se.b - 1.2 }, { x: se.cx + 40, y: se.b + 10.8 });
      const capAfter = JSON.parse(await (await import('node:fs/promises')).readFile(api.captionsPath, 'utf8'));
      const after = await api.readEdit();
      dragResult = { captionScaleBefore: capBefore.captions.find(c => c.id === 'c-0001')?.text_style ?? null,
        captionScaleAfter: capAfter.captions.find(c => c.id === 'c-0001')?.text_style ?? null,
        coverBefore: api.findItem(before, 'cover-1')?.transform, coverAfter: api.findItem(after, 'cover-1')?.transform };
    }
    return { shot: await shot('b-hidden-caption-selected'), view: m, dragResult };
  });

  // (c) 変形の最中のメニュー（ホストのバー・字幕の道具列）
  await scenario('c-placed-text-move', async () => {
    await setZoom('fit');
    const s = await stage();
    await click(s.cx, s.t + s.h * 0.5); // 選択を別の所へ
    await api.key('Escape', 'Escape', 27);
    const b = await plateBox('置いた文字');
    await click(b.cx, b.cy);
    const idle = { view: await measure(), host: await hostBar(), shot: await shot('c-placed-text-idle') };
    const mid = await drag({ x: b.cx, y: b.cy }, { x: b.cx + s.w * 0.12, y: b.cy + s.h * 0.1 }, { onMid: midRecord('c-placed-text-move-mid') });
    return { idle, mid, released: { view: await measure(), host: await hostBar() } };
  });
  await scenario('c-placed-text-scale', async () => {
    const b = await plateBox('置いた文字');
    await click(b.cx, b.cy);
    const se = await box('.caption-row-plate[data-selected] .akari-caption-handle[data-h="se"], #caption-select-box .akari-caption-handle[data-h="se"]');
    if (!se) return { error: 'no se handle' };
    const mid = await drag({ x: se.cx, y: se.b - 1.2 }, { x: se.cx + 50, y: se.b + 18.8 }, { onMid: midRecord('c-placed-text-scale-mid') });
    return { mid, released: { view: await measure(), host: await hostBar() } };
  });
  await scenario('c-placed-text-wrap', async () => {
    const b = await plateBox('置いた文字');
    await click(b.cx, b.cy);
    const e = await box('.caption-row-plate[data-selected] .akari-caption-handle[data-h="e"], #caption-select-box .akari-caption-handle[data-h="e"]');
    if (!e) return { error: 'no e handle' };
    const mid = await drag({ x: e.cx, y: e.cy }, { x: e.cx - 30, y: e.cy }, { onMid: midRecord('c-placed-text-wrap-mid') });
    return { mid, released: { view: await measure(), host: await hostBar() } };
  });
  await scenario('c-photo-move', async () => {
    const p = await layerBox('photo-kf');
    await click(p.cx, p.cy);
    const idle = { view: await measure(), host: await hostBar() };
    const mid = await drag({ x: p.cx, y: p.cy }, { x: p.cx - 40, y: p.cy - 30 }, { onMid: midRecord('c-photo-move-mid') });
    return { idle, mid, released: { view: await measure(), host: await hostBar() } };
  });

  await scenario('c-photo-long-hold', async () => {
    await setZoom('fit');
    const p = await layerBox('photo-kf');
    await click(p.cx, p.cy);
    const onMid = async pointer => {
      const samples = [];
      for (let i = 0; i < 8; i++) { samples.push({ t: i * 400, host: await hostBar() }); await sleep(400); }
      return { pointer, samples, shot: await shot('c-photo-long-hold-mid') };
    };
    const mid = await drag({ x: p.cx, y: p.cy }, { x: p.cx + 30, y: p.cy - 20 }, { onMid, hold: 0 });
    return { mid };
  });
  await scenario('c-caption-long-hold', async () => {
    const b = await plateBox('置いた文字');
    await click(b.cx, b.cy);
    const onMid = async pointer => {
      const samples = [];
      for (let i = 0; i < 8; i++) { samples.push({ t: i * 400, host: await hostBar() }); await sleep(400); }
      return { pointer, samples };
    };
    const mid = await drag({ x: b.cx, y: b.cy }, { x: b.cx + 30, y: b.cy + 20 }, { onMid, hold: 0 });
    return { mid };
  });

  // (d) 写真の角で拡大縮小・回転の途中の枠とポインタのずれ / cut の拡大縮小
  const lag = async (name, id, handle, dx, dy, kind = 'layer') => scenario(name, async () => {
    await setZoom('fit');
    const p = kind === 'cut' ? null : await layerBox(id);
    if (kind === 'cut') { const s = await stage(); await click(s.l + s.w * 0.95, s.t + s.h * (portrait ? 0.68 : 0.08)); }
    else await click(p.l + p.w * 0.3, p.t + p.h * 0.3);
    const boxSel = kind === 'cut' ? '#cut-select-box' : '#layer-select-box';
    const h = await box(`${boxSel} [data-akari-handle="${handle}"]`);
    if (!h) return { error: 'no handle ' + handle, view: await measure() };
    const onMid = async pointer => {
      const samples = [];
      for (const wait of [0, 150, 600]) {
        await sleep(wait);
        const hb = await box(`${boxSel} [data-akari-handle="${handle}"]`);
        const frame = await box(boxSel);
        const media = kind === 'cut' ? null : await layerBox(id);
        samples.push({ wait, handleCenter: hb && { x: +hb.cx.toFixed(1), y: +hb.cy.toFixed(1) },
          pointerToHandlePx: hb ? +Math.hypot(hb.cx - pointer.x, hb.cy - pointer.y).toFixed(1) : null,
          frame: frame && { l: +frame.l.toFixed(1), t: +frame.t.toFixed(1), w: +frame.w.toFixed(1), h: +frame.h.toFixed(1) },
          media: media && { l: +media.l.toFixed(1), t: +media.t.toFixed(1), w: +media.w.toFixed(1), h: +media.h.toFixed(1) },
          frameAngle: await V(angleOf(`document.querySelector(${S(boxSel)})`)),
          mediaAngle: kind === 'cut' ? null : await V(angleOf(`document.querySelector(${S(`[data-akari-layer-id="${id}"]`)})`)) });
      }
      return { pointer, samples, shot: await shot(name + '-mid'), host: await hostBar(), bodyCls: (await measure()).bodyCls };
    };
    const mid = await drag({ x: h.cx, y: h.cy }, { x: h.cx + dx, y: h.cy + dy }, { onMid, midAt: 0.8 });
    return { mid, released: { frame: await box(boxSel), media: kind === 'cut' ? null : await layerBox(id) } };
  });
  await lag('d-photo-scale', 'photo-1', 'se', 70, 45);
  await lag('d-photo-kf-scale', 'photo-kf', 'se', 60, 40);
  await lag('d-photo-rotate', 'photo-kf', 'rotate', 90, -60);
  await lag('d-cut-scale', 'cut-1', 'se', -50, -30, 'cut');

  // (e) 吸着ガイドの色: 図形を中央へ寄せるドラッグの途中
  await scenario('e-guide-color', async () => {
    await setZoom('fit');
    const s = await stage();
    const b = await api.itemBox('shape-a');
    await click(b.cx, b.cy);
    const mid = await drag({ x: b.cx, y: b.cy }, { x: s.cx, y: s.cy }, { steps: 18, midAt: 1, onMid: async p => ({ p, shot: await shot('e-guide-shape'), guides: (await measure()).guides }) });
    const p = await layerBox('photo-kf');
    await click(p.cx, p.cy);
    const mid2 = await drag({ x: p.cx, y: p.cy }, { x: s.cx, y: s.cy }, { steps: 18, midAt: 1, onMid: async q => ({ q, shot: await shot('e-guide-photo'), guides: (await measure()).guides }) });
    return { shape: mid, photo: mid2 };
  });
  // (f2) プレビューの撮影（html.akari-gen-capturing）中は UI 層が消える
  await scenario('f-capture-hides-chrome', async () => {
    await setZoom('fit');
    const p = await layerBox('photo-kf');
    await click(p.cx, p.cy);
    return V(`(() => { const layer = document.getElementById('preview-chrome-layer'); const vis = n => !!n && n.getClientRects().length > 0 && getComputedStyle(n).display !== 'none' && getComputedStyle(n).visibility !== 'hidden';
      const before = { layer: !!layer && vis(layer), box: vis(document.getElementById('layer-select-box')) };
      document.documentElement.classList.add('akari-gen-capturing');
      const during = { layer: !!layer && vis(layer), box: vis(document.getElementById('layer-select-box')), handles: [...document.querySelectorAll('#layer-select-box [data-akari-handle]')].filter(vis).length };
      document.documentElement.classList.remove('akari-gen-capturing');
      return { hasLayer: !!layer, before, during }; })()`);
  });
  // (g) 字幕の編集中のキャレット・選択範囲はプレートの中
  await scenario('g-caption-caret', async () => {
    await setZoom('fit');
    const b = await plateBox('置いた文字');
    await click(b.cx, b.cy);
    const b2 = await plateBox('置いた文字');
    for (const [type, count] of [['mousePressed', 1], ['mouseReleased', 1], ['mousePressed', 2], ['mouseReleased', 2]]) {
      await main.send('Input.dispatchMouseEvent', { type, x: api.outer.x + b2.cx, y: api.outer.y + b2.cy, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: count });
      await sleep(60);
    }
    await sleep(900);
    const state = await V(`(() => { const a = document.activeElement; const sel = getSelection(); const node = sel.anchorNode; const el = node && (node.nodeType === 1 ? node : node.parentElement);
      let caret = null; if (sel.rangeCount) { const r = sel.getRangeAt(0).cloneRange(); r.collapse(true); const rects = r.getClientRects(); const rr = rects[0] || r.getBoundingClientRect(); caret = { x: rr.left, y: rr.top, h: rr.height }; }
      const plate = el && el.closest('.caption-row-plate'); const pb = plate && plate.getBoundingClientRect();
      return { editable: !!a && a.isContentEditable, activeInPlate: !!(a && a.closest && a.closest('.caption-row-plate')), selectionInPlate: !!plate, rangeCount: sel.rangeCount, text: sel.toString(), caret,
        plate: pb && { l: pb.left, t: pb.top, r: pb.right, b: pb.bottom }, chromeOnTop: (() => { const t = caret && document.elementFromPoint(caret.x + 1, caret.y + caret.h / 2); return t ? (t.closest('#preview-chrome-layer') ? 'chrome:' + (t.className || t.id) : 'plate:' + !!t.closest('.caption-row-plate')) : null; })() }; })()`);
    await api.key('ArrowRight', 'ArrowRight', 39);
    const moved = await V(`(() => { const sel = getSelection(); if (!sel.rangeCount) return null; const r = sel.getRangeAt(0).cloneRange(); r.collapse(true); const rr = r.getClientRects()[0] || r.getBoundingClientRect(); return { x: rr.left, y: rr.top, collapsed: sel.isCollapsed }; })()`);
    const shotName = await shot('g-caption-caret');
    await api.key('Escape', 'Escape', 27);
    return { state, afterArrowRight: moved, shot: shotName };
  });
  api.report.shots = shots;
}
