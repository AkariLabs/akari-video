#!/usr/bin/env node
// caption-group-drag L1 probe (wrapper-authored verification script).
// Same idiom as evidence/hit-region-pointer-events/scripts/run-shell-l1.mjs:
// production-build Electron + raw CDP, no test framework.
// Usage: node run-l1.mjs <cdp-port> <projectRoot> <outDir> <label>
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CDP, evalOn, listTargets, sleep, waitFor } from './cdp-lib.mjs';

const [, , portArg, projectRoot, outDir, label = 'after'] = process.argv;
const port = Number(portArg || 9655);
if (!projectRoot || !outDir) throw new Error('usage: run-l1.mjs <port> <projectRoot> <outDir> [label]');
const editPath = path.join(projectRoot, 'edit.json');
const captionsPath = path.join(projectRoot, 'captions.json');
await mkdir(outDir, { recursive: true });

const VIEW_W = 1600, VIEW_H = 1100;
const results = [];
const record = (step, data = {}) => {
  results.push({ step, ...data });
  console.log(`[${step}]`, JSON.stringify(data).slice(0, 900));
};
const failures = [];
const check = (ok, message, detail = {}) => {
  record(ok ? 'PASS' : 'FAIL', { message, ...detail });
  if (!ok) failures.push({ message, ...detail });
  return ok;
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const readCaptions = async () => JSON.parse(await readFile(captionsPath, 'utf8'));
const readCaptionsText = () => readFile(captionsPath, 'utf8');
const waitCaptionsChange = async before => waitFor('captions.json change', async () => {
  const now = await readCaptionsText();
  return now === before ? null : now;
}, 20000, 200);

// ---------- connect ----------
const targets = await listTargets(port);
const mainTarget = targets.find(t => t.type === 'page' && /localhost/u.test(t.url)) ?? targets.find(t => t.type === 'page');
if (!mainTarget) throw new Error('main page target not found');
const main = new CDP(mainTarget.webSocketDebuggerUrl);
await main.connect();
await main.send('Page.enable'); await main.send('Runtime.enable');
await main.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false });
await main.send('Page.bringToFront');
await waitFor('frontend ready', () => evalOn(main, `document.readyState === 'complete'`));
await evalOn(main, `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`);
await sleep(800);

const commandRegistryExpr = `(() => {
  const bindings=window.theia.container._bindingDictionary;
  const keys=[...bindings._map.keys()];
  return keys.find(k=>typeof k==='function' && typeof k.prototype?.executeCommand==='function' && typeof k.prototype?.registerCommand==='function');
})()`;
const openResult = await evalOn(main, `(async () => {
  const C=${commandRegistryExpr};
  if(!C) return 'no-command-registry';
  return await window.theia.container.get(C).executeCommand('akari.preview.ensureVisible', { editUri: ${JSON.stringify('file://' + editPath)} });
})()`);
record('open-preview', { result: openResult });

const webviewTarget = await waitFor('webview target', async () => {
  const list = await listTargets(port);
  return list.find(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url)) || null;
}, 90000);
const view = new CDP(webviewTarget.webSocketDebuggerUrl);
await view.connect();
const contexts = [];
view.on('Runtime.executionContextCreated', p => contexts.push(p.context));
await view.send('Page.enable'); await view.send('Runtime.enable');
let ctxId;
await waitFor('preview stage in webview', async () => {
  for (const id of [undefined, ...contexts.map(c => c.id)]) {
    try { if (await evalOn(view, `Boolean(document.getElementById('preview-stage'))`, id)) { ctxId = id; return true; } } catch { /* other context */ }
  }
  return false;
}, 120000);
const vEval = expr => evalOn(view, expr, ctxId);
await waitFor('caption model loaded', () => vEval(`Boolean(window.akari && window.akari.computeOutputFrameRect) && Boolean(document.getElementById('caption-plate'))`), 90000);

const shot = async name => {
  const { data } = await main.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(outDir, `${label}-${name}`), Buffer.from(data, 'base64'));
  record('screenshot', { name: `${label}-${name}` });
};

// ---------- shared webview helpers ----------
const GEOMETRY = `(() => {
  const stage = document.getElementById('preview-stage');
  const stageRect = stage.getBoundingClientRect();
  const plate = document.getElementById('caption-plate');
  const lines = [...plate.querySelectorAll('.akari-caption__line')];
  const block = plate.querySelector('.akari-caption__block');
  const elements = block ? [block] : (lines.length ? lines : [plate]);
  const rects = elements.map(e => e.getBoundingClientRect());
  const ink = {
    left: Math.min(...rects.map(r => r.left)),
    right: Math.max(...rects.map(r => r.right)),
    top: Math.min(...rects.map(r => r.top)),
    bottom: Math.max(...rects.map(r => r.bottom))
  };
  const box = document.getElementById('caption-select-box');
  const boxRect = box.getBoundingClientRect();
  const badge = box.querySelector('.akari-caption-group-badge');
  const guideC = document.getElementById('caption-drag-guide-center');
  const guideB = document.getElementById('caption-drag-guide-bottom');
  const highlight = document.getElementById('caption-zone-highlight');
  const hlRect = highlight.getBoundingClientRect();
  const clone = plate.cloneNode(true);
  for (const s of clone.querySelectorAll('style')) s.remove();
  return {
    frame: window.akari.computeOutputFrameRect(),
    stage: { left: stageRect.left, top: stageRect.top, width: stageRect.width, height: stageRect.height },
    ink,
    inkRatio: {
      left: (ink.left - stageRect.left) / stageRect.width,
      right: (ink.right - stageRect.left) / stageRect.width,
      top: (ink.top - stageRect.top) / stageRect.height,
      bottom: (ink.bottom - stageRect.top) / stageRect.height,
      centerX: ((ink.left + ink.right) / 2 - stageRect.left) / stageRect.width
    },
    plateText: clone.textContent.trim(),
    selectBox: {
      active: box.classList.contains('is-active'),
      ratio: {
        left: (boxRect.left - stageRect.left) / stageRect.width,
        top: (boxRect.top - stageRect.top) / stageRect.height,
        width: boxRect.width / stageRect.width,
        height: boxRect.height / stageRect.height
      },
      badgeText: badge ? badge.textContent.trim() : null,
      badgeVisible: badge ? badge.getBoundingClientRect().width > 0 : false
    },
    guides: {
      center: guideC.classList.contains('is-active'),
      bottom: guideB.classList.contains('is-active')
    },
    highlight: {
      active: highlight.classList.contains('is-active'),
      ratio: {
        left: (hlRect.left - stageRect.left) / stageRect.width,
        top: (hlRect.top - stageRect.top) / stageRect.height,
        width: hlRect.width / stageRect.width,
        height: hlRect.height / stageRect.height
      }
    },
    plateTranslate: plate.style.translate || ''
  };
})()`;

// The preview runs on the frame engine (no <video> src), so the transport slider is the
// only seek that is engine-independent (same idiom as evidence/hit-region-pointer-events).
const seekTo = time => `(() => {
  const slider = document.getElementById('seek');
  slider.value = String(${time});
  slider.dispatchEvent(new Event('input', { bubbles: true }));
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(Number(slider.value)))));
})()`;

const seekUntilText = async (time, expected, timeout = 30000) => {
  let last = null;
  try {
    return await waitFor(`caption "${expected}" at t=${time}`, async () => {
      await vEval(seekTo(time));
      last = await vEval(GEOMETRY);
      return last.plateText === expected ? last : null;
    }, timeout, 400);
  } catch (error) {
    record('seek-failed', { time, expected, seen: last?.plateText, geometry: last });
    throw error;
  }
};

const pointer = (type, x, y, onWindow) => `(() => {
  const target = ${onWindow ? 'window' : `document.getElementById('caption-plate')`};
  target.dispatchEvent(new PointerEvent(${JSON.stringify(type)}, {
    bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y},
    button: 0, buttons: ${type === 'pointerup' ? 0 : 1}, pointerId: 1, isPrimary: true
  }));
  return true;
})()`;

// Drag the caption plate so its ink lands at the requested stage ratios.
// targetCenterX / targetBottom / targetTop are stage-relative fractions (any may be null).
const dragCaptionTo = async ({ centerX, bottom, top, steps = 6, captureMid = false }) => {
  const before = await vEval(GEOMETRY);
  const startX = (before.ink.left + before.ink.right) / 2;
  const startY = (before.ink.top + before.ink.bottom) / 2;
  const stage = before.stage;
  let dx = 0, dy = 0;
  if (centerX !== undefined) dx = (stage.left + stage.width * centerX) - (before.ink.left + before.ink.right) / 2;
  if (bottom !== undefined) dy = (stage.top + stage.height * bottom) - before.ink.bottom;
  if (top !== undefined) dy = (stage.top + stage.height * top) - before.ink.top;
  await vEval(pointer('pointerdown', startX, startY, false));
  let mid = null;
  for (let i = 1; i <= steps; i++) {
    const fraction = i / steps;
    await vEval(pointer('pointermove', startX + dx * fraction, startY + dy * fraction, true));
    if (captureMid && i === steps) mid = await vEval(GEOMETRY);
    await sleep(40);
  }
  const beforeText = await readCaptionsText();
  await vEval(pointer('pointerup', startX + dx, startY + dy, true));
  return { before, mid, beforeText, delta: { dx, dy } };
};

const dispatchZoneEvent = (type, zone) => evalOn(main, `(() => {
  window.dispatchEvent(new CustomEvent(${JSON.stringify(type)}, {
    detail: { editUri: ${JSON.stringify('file://' + editPath)}, zone: ${zone === null ? 'null' : JSON.stringify(zone)} }
  }));
  return true;
})()`);

// ---------- phase 0: baseline ----------
await vEval(`(() => { const t=document.getElementById('play-toggle'); const v=document.getElementById('preview-video'); if(v && !v.paused) t?.click(); return true; })()`);
await sleep(1500);
record('transport', await vEval(`(() => { const s=document.getElementById('seek'); return { max: s.max, step: s.step, value: s.value, frameEngine: document.getElementById('preview-stage').dataset.frameEngineActive ?? null }; })()`));
const base1 = await seekUntilText(1.0, '一行の字幕は収まる');
const base2 = await seekUntilText(2.8, '二本目の字幕も同じ位置に出る');
record('baseline', { cue1: base1.inkRatio, cue2: base2.inkRatio, frame: base1.frame, stage: base1.stage });
check(near(base1.inkRatio.bottom, base2.inkRatio.bottom, 0.004),
  'baseline: 2 つの時刻の cue が同じ下端比で描かれる（グループ位置）',
  { cue1Bottom: base1.inkRatio.bottom, cue2Bottom: base2.inkRatio.bottom });
await shot('00-baseline.png');
const baselineText = await readCaptionsText();

// ---------- phase 1: selection look ----------
await vEval(seekTo(1.0));
const beforeSelect = await vEval(GEOMETRY);
const clickX = (beforeSelect.ink.left + beforeSelect.ink.right) / 2;
const clickY = (beforeSelect.ink.top + beforeSelect.ink.bottom) / 2;
await vEval(pointer('pointerdown', clickX, clickY, false));
await vEval(pointer('pointerup', clickX, clickY, true));
await sleep(300);
const selected = await vEval(GEOMETRY);
record('selection', selected.selectBox);
check(selected.selectBox.active, '字幕クリックで #caption-select-box が出る');
check(selected.selectBox.badgeText === '字幕グループ — 動かすと全字幕が動く',
  'バッジ文言が契約どおり', { badgeText: selected.selectBox.badgeText });
check(selected.selectBox.badgeVisible, 'バッジが実寸を持って表示される');
check(near(selected.selectBox.ratio.left, selected.inkRatio.left, 0.01)
  && near(selected.selectBox.ratio.top, selected.inkRatio.top, 0.01)
  && near(selected.selectBox.ratio.width, selected.inkRatio.right - selected.inkRatio.left, 0.01),
  '選択枠がプレート実寸に一致する（1/3 ゾーン枠ではない）',
  { box: selected.selectBox.ratio, ink: selected.inkRatio });
check(!selected.guides.center && !selected.guides.bottom, '非ドラッグ時は吸着ガイドが出ない');
await shot('01-selected.png');

// ---------- phase 2: drag to lower-right (bc + x) ----------
const dragA = await dragCaptionTo({ centerX: 0.70, bottom: 0.80, captureMid: true });
record('dragA-mid', { guides: dragA.mid?.guides, inkRatio: dragA.mid?.inkRatio, translate: dragA.mid?.plateTranslate });
check(dragA.mid?.guides.center === true || dragA.mid?.guides.bottom === true,
  'ドラッグ中に吸着ガイドが表示される', { guides: dragA.mid?.guides });
check(near(dragA.mid?.inkRatio.centerX ?? -1, 0.70, 0.02) && near(dragA.mid?.inkRatio.bottom ?? -1, 0.80, 0.02),
  'ドラッグ中のプレートがポインタへ 1:1 で追従する',
  { midCenterX: dragA.mid?.inkRatio.centerX, midBottom: dragA.mid?.inkRatio.bottom, want: { centerX: 0.70, bottom: 0.80 } });
await waitCaptionsChange(dragA.beforeText).catch(error => record('dragA-write-timeout', { error: error.message }));
await sleep(1200);
const afterA = await readCaptions();
const styleA = afterA.default_text_style ?? {};
record('dragA-written', { default_text_style: styleA });
check(styleA.text_anchor === 'bc', '下段着地 → text_anchor = bc', { anchor: styleA.text_anchor });
check(near(styleA.position?.y ?? -1, 0.80, 0.01), '下段着地 → position.y ≈ プレート下端比 0.80', { y: styleA.position?.y });
check(typeof styleA.position?.x === 'number', '中央スナップ外 → position.x を書く', { x: styleA.position?.x });
check(styleA.zone === undefined, 'position を書いたとき zone は消える', { zone: styleA.zone });
check(afterA.captions.every(cue => cue.text_style === undefined), 'cue 個別 text_style は作られない');
const renderedA = await seekUntilText(1.0, '一行の字幕は収まる');
record('dragA-rendered', renderedA.inkRatio);
check(near(renderedA.inkRatio.bottom, styleA.position?.y ?? -1, 0.01),
  '書き込み値と再読込後の描画下端が一致する', { rendered: renderedA.inkRatio.bottom, written: styleA.position?.y });
check(near(renderedA.inkRatio.left, styleA.position?.x ?? -1, 0.01),
  '書き込み値と再読込後の描画左端が一致する', { rendered: renderedA.inkRatio.left, written: styleA.position?.x });
const renderedA2 = await seekUntilText(2.8, '二本目の字幕も同じ位置に出る');
check(near(renderedA.inkRatio.bottom, renderedA2.inkRatio.bottom, 0.004),
  'ドラッグ後も別時刻の cue が同じ位置に描かれる（グループ一括）',
  { cue1: renderedA.inkRatio.bottom, cue2: renderedA2.inkRatio.bottom });
await shot('02-after-drag-lower-right.png');

// ---------- phase 3: determinism (same landing coordinates → same bytes) ----------
await writeFile(captionsPath, baselineText);
await waitFor('captions reload to baseline', async () => {
  await vEval(seekTo(1.0));
  const geometry = await vEval(GEOMETRY);
  return near(geometry.inkRatio.bottom, base1.inkRatio.bottom, 0.006) ? geometry : null;
}, 20000, 400);
const dragA2 = await dragCaptionTo({ centerX: 0.70, bottom: 0.80 });
await waitCaptionsChange(dragA2.beforeText).catch(error => record('dragA2-write-timeout', { error: error.message }));
await sleep(800);
const afterA2 = await readCaptions();
record('determinism', { first: styleA, second: afterA2.default_text_style });
check(JSON.stringify(afterA2.default_text_style) === JSON.stringify(styleA),
  '決定論: 同じ着地座標 → 同じ書き込み値',
  { first: styleA, second: afterA2.default_text_style });

// ---------- phase 4: snapping (centre + bottom 7%) ----------
const dragS = await dragCaptionTo({ centerX: 0.515, bottom: 0.92, captureMid: true });
record('dragSnap-mid', { guides: dragS.mid?.guides, inkRatio: dragS.mid?.inkRatio });
await waitCaptionsChange(dragS.beforeText).catch(error => record('dragSnap-write-timeout', { error: error.message }));
await sleep(1000);
const afterS = await readCaptions();
const styleS = afterS.default_text_style ?? {};
record('dragSnap-written', { default_text_style: styleS });
check(styleS.position?.x === undefined, '中央 ±0.03 → position.x を書かない（中央吸着）', { x: styleS.position?.x });
check(styleS.position?.y === 0.93, '下段 7% 近傍 → プレート下端 0.93 へ吸着', { y: styleS.position?.y });
check(dragS.mid?.guides.center === true && dragS.mid?.guides.bottom === true,
  '両方の吸着が効いている間ガイドが出る', { guides: dragS.mid?.guides });
const renderedS = await seekUntilText(1.0, '一行の字幕は収まる');
check(near(renderedS.inkRatio.bottom, 0.93, 0.01), '吸着後の描画下端が 0.93', { bottom: renderedS.inkRatio.bottom });
check(near(renderedS.inkRatio.centerX, 0.5, 0.01), '中央吸着後の描画が横中央', { centerX: renderedS.inkRatio.centerX });
await shot('03-after-snap.png');

// ---------- phase 5: drag into the top third (tc) ----------
const dragT = await dragCaptionTo({ centerX: 0.5, top: 0.20 });
await waitCaptionsChange(dragT.beforeText).catch(error => record('dragTop-write-timeout', { error: error.message }));
await sleep(1000);
const afterT = await readCaptions();
const styleT = afterT.default_text_style ?? {};
record('dragTop-written', { default_text_style: styleT });
check(styleT.text_anchor === 'tc', '上 1/3 着地 → text_anchor = tc', { anchor: styleT.text_anchor });
check(near(styleT.position?.y ?? -1, 0.20, 0.01), '上 1/3 着地 → position.y ≈ プレート上端比 0.20', { y: styleT.position?.y });
check(styleT.zone === undefined, 'tc 書き込み時も zone は消える', { zone: styleT.zone });
const renderedT = await seekUntilText(1.0, '一行の字幕は収まる');
check(near(renderedT.inkRatio.top, styleT.position?.y ?? -1, 0.012),
  'tc 書き込み値と再読込後の描画上端が一致する', { rendered: renderedT.inkRatio.top, written: styleT.position?.y });
await shot('04-after-top-drag.png');

// ---------- phase 6: inspector zone hover -> preview highlight ----------
await dispatchZoneEvent('akari.caption.zoneHover', 'top-left');
await sleep(400);
const hoverOn = await vEval(GEOMETRY);
record('zone-hover-on', hoverOn.highlight);
check(hoverOn.highlight.active, 'ゾーン hover でプレビューにハイライトが出る');
check(near(hoverOn.highlight.ratio.left, 0, 0.01) && near(hoverOn.highlight.ratio.top, 0, 0.01)
  && near(hoverOn.highlight.ratio.width, 1 / 3, 0.01) && near(hoverOn.highlight.ratio.height, 1 / 3, 0.01),
  'ハイライトが該当 1/3 領域に一致する', hoverOn.highlight.ratio);
await shot('05-zone-hover.png');
await dispatchZoneEvent('akari.caption.zoneHover', null);
await sleep(400);
const hoverOff = await vEval(GEOMETRY);
check(!hoverOff.highlight.active, 'hover 解除でハイライトが消える');
await shot('06-zone-hover-off.png');

// ---------- phase 6b: real inspector grid (hover + click on the actual cells) ----------
const openInspector = await evalOn(main, `(async () => {
  const C=${commandRegistryExpr};
  if(!C) return 'no-command-registry';
  try { await window.theia.container.get(C).executeCommand('akari.inspector.open'); return 'opened'; }
  catch (error) { return String((error && error.message) || error); }
})()`);
record('inspector-open', { result: openInspector });
// Re-select the caption in the preview so the inspector shows the caption-group seat.
await vEval(seekTo(1.0));
const reselect = await vEval(GEOMETRY);
const reselectX = (reselect.ink.left + reselect.ink.right) / 2;
const reselectY = (reselect.ink.top + reselect.ink.bottom) / 2;
await vEval(pointer('pointerdown', reselectX, reselectY, false));
await vEval(pointer('pointerup', reselectX, reselectY, true));
const readGrid = () => evalOn(main, `(() => {
  const cells = [...document.querySelectorAll('.akari-caption-zone-cell')];
  return {
    count: cells.length,
    zones: cells.map(c => c.dataset.akariCaptionZone),
    saved: cells.filter(c => c.classList.contains('is-saved')).map(c => c.dataset.akariCaptionZone),
    savedBadges: [...document.querySelectorAll('.akari-caption-zone-saved')].map(e => e.textContent)
  };
})()`);
const inspectorProbe = await waitFor('inspector zone grid', async () => {
  const probe = await readGrid();
  return probe.count > 0 ? probe : null;
}, 25000, 500).catch(() => null);
record('inspector-grid', inspectorProbe ?? { count: 0 });
const realGrid = (inspectorProbe?.count ?? 0) === 9;
check(realGrid, '実インスペクターに 3x3 のゾーンセルが 9 個出る', { probe: inspectorProbe });
await shot('06b-inspector-grid.png');

const cellEvent = (zone, type) => evalOn(main, `(() => {
  const cell=[...document.querySelectorAll('.akari-caption-zone-cell')]
    .find(c=>c.dataset.akariCaptionZone===${JSON.stringify(zone)});
  if(!cell) return false;
  ${'${ACTION}'}
  return true;
})()`.replace('${ACTION}', type === 'click'
  ? 'cell.click();'
  : `cell.dispatchEvent(new MouseEvent(${JSON.stringify(type)}, { bubbles: false }));`));

if (realGrid) {
  const hovered = await cellEvent('bottom-left', 'mouseenter');
  await sleep(500);
  const realHoverOn = await vEval(GEOMETRY);
  record('inspector-hover-on', { hovered, highlight: realHoverOn.highlight });
  check(realHoverOn.highlight.active
    && near(realHoverOn.highlight.ratio.left, 0, 0.01)
    && near(realHoverOn.highlight.ratio.top, 2 / 3, 0.01),
    '実セルの mouseenter でプレビューの該当 1/3 がハイライトされる', realHoverOn.highlight.ratio);
  await shot('06c-inspector-hover.png');
  await cellEvent('bottom-left', 'mouseleave');
  await sleep(500);
  const realHoverOff = await vEval(GEOMETRY);
  check(!realHoverOff.highlight.active, '実セルの mouseleave でハイライトが消える');
}

// ---------- phase 7: zone preset click -> zone written, position removed ----------
const beforeZoneText = await readCaptionsText();
if (realGrid) {
  await cellEvent('top-right', 'click');
  record('zonePreset-source', { via: 'inspector-cell-click' });
} else {
  await dispatchZoneEvent('akari.caption.zonePreset', 'top-right');
  record('zonePreset-source', { via: 'synthetic-window-event' });
}
await waitCaptionsChange(beforeZoneText).catch(error => record('zonePreset-write-timeout', { error: error.message }));
await sleep(1200);
const afterZone = await readCaptions();
const styleZ = afterZone.default_text_style ?? {};
record('zonePreset-written', { default_text_style: styleZ });
check(styleZ.zone === 'top-right', 'ゾーンクリックで zone が書かれる', { zone: styleZ.zone });
check(styleZ.position === undefined, 'ゾーンクリックで position が消える', { position: styleZ.position });
check(styleZ.text_anchor === undefined, 'ゾーンクリックで text_anchor が消える', { anchor: styleZ.text_anchor });
const renderedZ = await seekUntilText(1.0, '一行の字幕は収まる');
record('zonePreset-rendered', renderedZ.inkRatio);
check(renderedZ.inkRatio.top < 1 / 3 && renderedZ.inkRatio.right > 0.66,
  'zone=top-right の描画が右上へ移る', renderedZ.inkRatio);
await shot('07-after-zone-preset.png');

if (realGrid) {
  const savedGrid = await waitFor('inspector saved mark', async () => {
    const probe = await readGrid();
    return probe.saved.includes('top-right') ? probe : null;
  }, 20000, 500).catch(() => null);
  record('inspector-saved-mark', savedGrid ?? { saved: [], savedBadges: [] });
  check(!!savedGrid && savedGrid.savedBadges.includes('保存中'),
    '保存済みゾーンのセルに「保存中」マークが出る',
    { saved: savedGrid?.saved, badges: savedGrid?.savedBadges });
  await shot('07b-inspector-saved.png');
}

// ---------- phase 8: extracted line (telop overlay) transform drag regression ----------
const editBefore = await readFile(editPath, 'utf8');
const captionsBeforeOverlay = await readCaptionsText();
const overlayDrag = await evalOn(view, `(async () => {
  const container = document.querySelector('#overlay-stage [data-overlay-id="extracted-line"]')
    || document.querySelector('#overlay-stage [data-overlay-id]');
  if (!container) return { ok: false, reason: 'overlay container not found' };
  const rect = container.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const fire = (type, cx, cy, target) => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 0,
    buttons: type === 'pointerup' ? 0 : 1, pointerId: 3, isPrimary: true
  }));
  fire('pointerdown', x, y, container);
  await new Promise(r => setTimeout(r, 60));
  for (let i = 1; i <= 5; i++) fire('pointermove', x + 24 * i, y - 12 * i, window);
  await new Promise(r => setTimeout(r, 60));
  fire('pointerup', x + 120, y - 60, window);
  return { ok: true, id: container.getAttribute('data-overlay-id'), rect: { left: rect.left, top: rect.top } };
})()`, ctxId);
record('overlay-drag', overlayDrag);
await waitFor('edit.json change', async () => {
  const now = await readFile(editPath, 'utf8');
  return now === editBefore ? null : now;
}, 20000, 200).catch(error => record('overlay-drag-write-timeout', { error: error.message }));
await sleep(800);
const editAfter = JSON.parse(await readFile(editPath, 'utf8'));
const extracted = editAfter.tracks.flatMap(track => track.items).find(item => item.id === 'extracted-line');
record('overlay-transform', { transform: extracted?.transform });
check(!!extracted && (extracted.transform.x !== 0 || extracted.transform.y !== 0),
  '出した行（テロップ overlay）の transform ドラッグが従来どおり効く', { transform: extracted?.transform });
check((await readCaptionsText()) === captionsBeforeOverlay,
  '出した行のドラッグは captions.json を変えない');
await shot('08-after-overlay-drag.png');

// ---------- done ----------
await writeFile(path.join(outDir, `${label}-run-log.json`), `${JSON.stringify({ failures, results }, null, 2)}\n`);
console.log(`\n=== ${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`} ===`);
for (const failure of failures) console.log('  FAIL:', failure.message, JSON.stringify(failure).slice(0, 300));
// Open CDP sockets and the per-call timeout timers keep the event loop alive, so exit
// explicitly instead of leaving the launcher (and its Electron) running forever.
main.close();
view.close();
process.exit(failures.length === 0 ? 0 : 1);
