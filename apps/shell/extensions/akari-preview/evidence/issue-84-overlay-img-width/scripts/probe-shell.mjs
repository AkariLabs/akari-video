#!/usr/bin/env node
// issue #84 shell L1 探針: 出力プレビューの overlay 内 img の論理寸法・位置・効いている CSS 規則・画素を記録する。
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CDP, evalOn, listTargets, sleep, waitFor } from './cdp-lib.mjs';
import { decodePng } from './png-lib.mjs';
import { MEASURE_EXPR, SAMPLE_POINTS } from './measure.mjs';

const [, , portArg, workspaceDir, outDir, label] = process.argv;
const port = Number(portArg || 9487);
const seekTime = Number(process.env.I84_SEEK || 1.0);
const editPath = path.join(workspaceDir, 'project/edit.json');
await mkdir(outDir, { recursive: true });
const VIEW_W = 1600, VIEW_H = 1200;

const targets = await listTargets(port);
const mainTarget = targets.find(t => t.type === 'page' && /localhost/u.test(t.url)) ?? targets.find(t => t.type === 'page');
const main = new CDP(mainTarget.webSocketDebuggerUrl); await main.connect();
await main.send('Page.enable'); await main.send('Runtime.enable');
await main.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false });
await main.send('Page.bringToFront');
await waitFor('frontend ready', () => evalOn(main, `document.readyState === 'complete'`));
await evalOn(main, `(() => { const b=[...document.querySelectorAll('button')].find(e=>e.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`);
await sleep(1000);
const opened = await evalOn(main, `(async () => {
  const keys=[...window.theia.container._bindingDictionary._map.keys()];
  const C=keys.find(k=>typeof k==='function' && typeof k.prototype?.executeCommand==='function' && typeof k.prototype?.registerCommand==='function');
  return await window.theia.container.get(C).executeCommand('akari.preview.ensureVisible', { editUri: ${JSON.stringify('file://' + editPath)} });
})()`);
console.log('[open-preview]', JSON.stringify(opened));

const webviewTarget = await waitFor('webview target', async () => (await listTargets(port)).find(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url)) || null, 90000);
const view = new CDP(webviewTarget.webSocketDebuggerUrl); await view.connect();
const contexts = [];
view.on('Runtime.executionContextCreated', p => contexts.push(p.context));
await view.send('Page.enable'); await view.send('Runtime.enable'); await view.send('DOM.enable'); await view.send('CSS.enable');
let ctxId;
await waitFor('preview stage', async () => {
  for (const id of [undefined, ...contexts.map(c => c.id)]) {
    try { if (await evalOn(view, `Boolean(document.getElementById('preview-stage'))`, id)) { ctxId = id; return true; } } catch {}
  }
  return false;
}, 120000);
const vEval = expr => evalOn(view, expr, ctxId);
await waitFor('img overlay mounted', () => vEval(`Boolean(document.querySelector('#overlay-stage .i84-img') && document.querySelector('#overlay-stage .i84-img').complete)`), 120000);
await vEval(`(() => { const t=document.getElementById('play-toggle'); const v=document.getElementById('preview-video'); if(v && !v.paused) t?.click(); return true; })()`);
await sleep(300);
await vEval(`(() => { const s=document.getElementById('seek'); s.value=${JSON.stringify(String(seekTime))}; s.dispatchEvent(new Event('input',{bubbles:true})); return s.value; })()`);
await sleep(2000);

const measure = await vEval(MEASURE_EXPR);

// img に効いている CSS 規則（max-width / max-height / width を宣言するもの）
await view.send('DOM.getDocument', { depth: -1, pierce: true });
const objRes = await view.send('Runtime.evaluate', { expression: `document.querySelector('#overlay-stage .i84-img')`, contextId: ctxId });
const { nodeId } = await view.send('DOM.requestNode', { objectId: objRes.result.objectId });
const matched = await view.send('CSS.getMatchedStylesForNode', { nodeId });
const sheetMeta = new Map();
view.on('CSS.styleSheetAdded', () => {});
const relevant = [];
for (const m of matched.matchedCSSRules || []) {
  const props = (m.rule.style.cssProperties || []).filter(p => /^(max-width|max-height|width|height|min-width)$/u.test(p.name) && p.value);
  if (!props.length) continue;
  relevant.push({ origin: m.rule.origin, selector: m.rule.selectorList.text, styleSheetId: m.rule.styleSheetId ?? null,
    range: m.rule.style.range ?? null, props: props.map(p => `${p.name}: ${p.value}${p.important ? ' !important' : ''}`) });
}
const inline = (matched.inlineStyle?.cssProperties || []).filter(p => p.value && !p.implicit).map(p => `${p.name}: ${p.value}`);

// スクリーンショット → 論理座標の画素
const iframeRect = await evalOn(main, `(() => { const f=[...document.querySelectorAll('iframe')].find(e=>/webview\\/index\\.html/.test(e.src)); const r=f.getBoundingClientRect(); return {left:r.left, top:r.top}; })()`);
const shot = await main.send('Page.captureScreenshot', { format: 'png' });
const buf = Buffer.from(shot.data, 'base64');
await writeFile(path.join(outDir, `${label}-shell-window.png`), buf);
const png = decodePng(buf);
const st = measure.overlayStage; const sc = measure.scale;
const pixels = Object.fromEntries(Object.entries(SAMPLE_POINTS).map(([k, [x, y]]) => [k, png.pixel(iframeRect.left + st.left + x * sc, iframeRect.top + st.top + y * sc)]));

// 由来シートの特定: _defaultStyles（Theia webview 既定 CSS）か
const sheetOrigin = await vEval(`(() => [...document.styleSheets].map((s, i) => ({ index: i, ownerId: s.ownerNode && s.ownerNode.id || null, ownerTag: s.ownerNode && s.ownerNode.tagName || null, inOverlay: Boolean(s.ownerNode && s.ownerNode.closest && s.ownerNode.closest('[data-overlay-id]')), imgRules: [...s.cssRules].filter(r => r.selectorText && /(^|[\\s,>])img(\\b|$)/.test(r.selectorText)).map(r => r.cssText) })).filter(s => s.imgRules.length))()`);

// Theia 既定シートの現在のセレクタと、overlay の外（シェル UI 側）では既定 CSS が従来どおり効くこと
const defaultSheet = await vEval(`(() => { const el = document.getElementById('_defaultStyles'); if (!el || !el.sheet) return null;
  const sels = [...el.sheet.cssRules].map(r => r.selectorText).filter(Boolean);
  const k = document.createElement('kbd'); k.textContent = 'K'; document.body.appendChild(k);
  const i = document.createElement('img'); document.body.appendChild(i);
  const ks = getComputedStyle(k); const is = getComputedStyle(i);
  const outside = { kbdBorderTop: ks.borderTopWidth + ' ' + ks.borderTopStyle, kbdPaddingLeft: ks.paddingLeft, imgMaxWidth: is.maxWidth, imgMaxHeight: is.maxHeight };
  k.remove(); i.remove();
  return { selectors: sels, outsideOverlay: outside }; })()`);

// v0.1.79 相当の再現: 0.1.80 で足された 1 行（#overlay-stage [data-overlay-id] img の max-* 解除）だけを live CSSOM から外して再計測
let simulated = null;
if (process.env.I84_SIMULATE_079 === '1') {
  const removed = await vEval(`(() => { let n = 0; for (const s of document.styleSheets) { let rules; try { rules = s.cssRules; } catch { continue; } for (let i = rules.length - 1; i >= 0; i--) { if (rules[i].selectorText === '#overlay-stage [data-overlay-id] img') { s.deleteRule(i); n++; } } } return n; })()`);
  await sleep(500);
  const m2 = await vEval(MEASURE_EXPR);
  const shot2 = await main.send('Page.captureScreenshot', { format: 'png' });
  const buf2 = Buffer.from(shot2.data, 'base64');
  await writeFile(path.join(outDir, `${label}-shell-sim079-window.png`), buf2);
  const png2 = decodePng(buf2);
  simulated = { removedRules: removed, measure: m2, pixels: Object.fromEntries(Object.entries(SAMPLE_POINTS).map(([k, [x, y]]) => [k, png2.pixel(iframeRect.left + m2.overlayStage.left + x * m2.scale, iframeRect.top + m2.overlayStage.top + y * m2.scale)])) };
}
const payload = { label, surface: 'shell', seekTime, viewport: [VIEW_W, VIEW_H], measure, imgMatchedRules: relevant, imgInlineStyle: inline, sheetOrigin, defaultSheet, pixels, simulated079: simulated };
await writeFile(path.join(outDir, `${label}-shell.json`), JSON.stringify(payload, null, 2) + '\n');
const brief = m => ({ img: m.img && { logical: m.img.logical, relToFrame: m.img.relToFrame, maxWidth: m.img.computed['max-width'] }, frame: m.frame && m.frame.logical, capImg: m.capImg, capImgMaxWidth: m.capImgMaxWidth, kbd: m.kbd, code: m.code, capRoot: m.capRoot, vwBox: m.vwBox, pxBox: m.pxBox });
console.log(JSON.stringify({ measure: brief(measure), rules: relevant.map(r => r.selector + ' {' + r.props.join('; ') + '}'), defaultSheet, pixels, simulated079: simulated && { removedRules: simulated.removedRules, measure: brief(simulated.measure), pixels: simulated.pixels } }));
main.close(); view.close();
