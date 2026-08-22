import { readFileSync, writeFileSync, statSync, renameSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { CDP, listTargets, evalOn, screenshot as rawScreenshot } from './cdp-lib.mjs';

async function screenshot(cdp, file) {
  try {
    await Promise.race([
      rawScreenshot(cdp, file),
      new Promise((_, rej) => setTimeout(() => rej(new Error('screenshot timeout')), 20000))
    ]);
    console.log('[screenshot]', file);
  } catch (error) {
    console.log('[screenshot-failed]', file, String(error && error.message));
  }
}
import { connectPreview } from './lib.mjs';

const [, , portArg, projectDir, outDir] = process.argv;
const port = Number(portArg);
const EDIT = path.join(projectDir, 'edit.json');
const FRAG = path.join(projectDir, 'overlays', 'title.html');
const log = [];
const record = (step, data) => { log.push({ step, ...data }); console.log(`[${step}]`, JSON.stringify(data)); };

const readEdit = () => JSON.parse(readFileSync(EDIT, 'utf8'));
const itemOf = (id) => {
  for (const t of readEdit().tracks) for (const i of (t.items || [])) if (i.id === id) return i;
  return undefined;
};
const mtime = (p) => { try { return statSync(p).mtimeMs; } catch { return 0; } };
async function waitForFileChange(p, before, label, timeoutMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (mtime(p) !== before) { await sleep(200); return true; }
    await sleep(200);
  }
  record('WARN-no-file-change', { file: p, label });
  return false;
}

// main page target (for screenshots + opening the preview)
const targets = await listTargets(port);
const pageTarget = targets.find(t => t.type === 'page');
const main = new CDP(pageTarget.webSocketDebuggerUrl);
await main.connect();
await main.send('Page.enable');
await main.send('Runtime.enable');
for (let i = 0; i < 60; i++) {
  if (await evalOn(main, `!!(window.theia && window.theia.container)`)) break;
  await sleep(1000);
}
const opened = await evalOn(main, `(() => {
  const bd = window.theia.container._bindingDictionary;
  const keys = [...bd._map.keys()];
  const CmdClass = keys.find(k => typeof k === 'function' && k.prototype
    && typeof k.prototype.executeCommand === 'function' && typeof k.prototype.registerCommand === 'function');
  if (!CmdClass) return { ok: false };
  const registry = window.theia.container.get(CmdClass);
  void registry.executeCommand('akari.preview.ensureVisible', { editUri: ${JSON.stringify('file://' + path.join(process.argv[3], 'edit.json'))} });
  return { ok: true };
})()`);
record('preview-open-command', opened);
await sleep(5000);

const { cdp, contextId } = await connectPreview(port);
const ev = (expr) => evalOn(cdp, expr, contextId);

const domState = `(() => {
  const o = document.querySelector('[data-overlay-id="title-1"]');
  const cs = o ? getComputedStyle(o) : null;
  const l = document.querySelector('[data-akari-layer-id="pip-1"]');
  const b = document.getElementById('write-error-banner');
  return {
    overlay: cs ? { x: cs.getPropertyValue('--x').trim(), y: cs.getPropertyValue('--y').trim(), scale: cs.getPropertyValue('--scale').trim(),
      text: (o.querySelector('.akari-title-text') || {}).textContent } : null,
    layer: l ? { x: l.dataset.akariTransformX, y: l.dataset.akariTransformY, scale: l.dataset.akariTransformScale } : null,
    banner: b ? { hidden: b.hidden, text: document.getElementById('write-error-message').textContent } : null
  };
})()`;

record('dom-initial', await ev(domState));
record('file-initial', { title1: itemOf('title-1').transform, pip1: itemOf('pip-1').transform, fragment: readFileSync(FRAG, 'utf8').trim().slice(0, 120) });
await screenshot(main, path.join(outDir, 'l1-01-opened.png'));

// ---- 1) overlay drag + four-corner resize (overlay-runtime selftest: real PointerEvents) ----
let m0 = mtime(EDIT);
const selftest = await ev(`window.akari.interaction.selftest()`);
record('overlay-selftest', selftest);
await waitForFileChange(EDIT, m0, 'overlay drag/resize');
await sleep(1500);
record('file-after-overlay', { title1: itemOf('title-1').transform });
record('dom-after-overlay', await ev(domState));
await screenshot(main, path.join(outDir, 'l1-02-overlay-moved.png'));

// ---- 2) layer drag ----
// selftest はオーバーレイを選択したまま終わる。以降の window レベルの合成 PointerEvent が
// オーバーレイのドラッグ実装にも同時に入るのを避けるため、Escape で選択を解除する。
await ev(`(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return true; })()`);
await sleep(300);
m0 = mtime(EDIT);
const layerDrag = await ev(`(async () => {
  const el = document.querySelector('[data-akari-layer-id="pip-1"]');
  const common = { bubbles: true, cancelable: true, composed: true, pointerType: 'mouse', isPrimary: true, button: 0, shiftKey: true };
  const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  el.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerId: 91001, buttons: 1, clientX: cx, clientY: cy }));
  window.dispatchEvent(new PointerEvent('pointerup', { ...common, pointerId: 91001, buttons: 0, clientX: cx, clientY: cy }));
  await new Promise(r2 => setTimeout(r2, 250));
  el.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerId: 91002, buttons: 1, clientX: cx, clientY: cy }));
  for (const f of [0.34, 0.67, 1]) {
    window.dispatchEvent(new PointerEvent('pointermove', { ...common, pointerId: 91002, buttons: 1, clientX: cx + 40 * f, clientY: cy + 16 * f }));
    await new Promise(r2 => setTimeout(r2, 40));
  }
  window.dispatchEvent(new PointerEvent('pointerup', { ...common, pointerId: 91002, buttons: 0, clientX: cx + 40, clientY: cy + 16 }));
  return { movedClientPx: { dx: 40, dy: 16 } };
})()`);
record('layer-drag-dispatched', layerDrag);
await waitForFileChange(EDIT, m0, 'layer drag');
await sleep(1200);
record('file-after-layer-drag', { pip1: itemOf('pip-1').transform });

// ---- 3) layer four-corner (SE) resize ----
m0 = mtime(EDIT);
const layerResize = await ev(`(async () => {
  const el = document.querySelector('[data-akari-layer-id="pip-1"]');
  const common = { bubbles: true, cancelable: true, composed: true, pointerType: 'mouse', isPrimary: true, button: 0, shiftKey: true };
  const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  el.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerId: 92001, buttons: 1, clientX: cx, clientY: cy }));
  window.dispatchEvent(new PointerEvent('pointerup', { ...common, pointerId: 92001, buttons: 0, clientX: cx, clientY: cy }));
  await new Promise(r2 => setTimeout(r2, 250));
  const h = document.querySelector('#layer-select-box [data-akari-handle="se"]');
  if (!h) return { ok: false, reason: 'no se handle' };
  const hr = h.getBoundingClientRect(); const hx = hr.left + hr.width / 2, hy = hr.top + hr.height / 2;
  const scaleBefore = el.dataset.akariTransformScale;
  h.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerId: 92002, buttons: 1, clientX: hx, clientY: hy }));
  for (const f of [0.34, 0.67, 1]) {
    window.dispatchEvent(new PointerEvent('pointermove', { ...common, pointerId: 92002, buttons: 1, clientX: hx + 34 * f, clientY: hy + 20 * f }));
    await new Promise(r2 => setTimeout(r2, 40));
  }
  window.dispatchEvent(new PointerEvent('pointerup', { ...common, pointerId: 92002, buttons: 0, clientX: hx + 34, clientY: hy + 20 }));
  await new Promise(r2 => setTimeout(r2, 200));
  return { ok: true, handle: 'se', scaleBefore, scaleAfterDom: el.dataset.akariTransformScale };
})()`);
record('layer-resize-dispatched', layerResize);
await waitForFileChange(EDIT, m0, 'layer resize');
await sleep(1200);
record('file-after-layer-resize', { pip1: itemOf('pip-1').transform });
record('dom-after-layer', await ev(domState));
await screenshot(main, path.join(outDir, 'l1-03-layer-resized.png'));

// ---- 4) fragment text edit by double click ----
const editBeforeText = readFileSync(EDIT, 'utf8');
const fragBefore = readFileSync(FRAG, 'utf8');
let f0 = mtime(FRAG);
const NEW_TEXT = 'ダブルクリックで書き換えたテロップ';
const textEdit = await ev(`(async () => {
  const o = document.querySelector('[data-overlay-id="title-1"]');
  const span = o.querySelector('.akari-title-text');
  const r = span.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  span.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy }));
  await new Promise(res => setTimeout(res, 200));
  const editing = span.getAttribute('contenteditable');
  span.textContent = ${JSON.stringify(NEW_TEXT)};
  span.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
  await new Promise(res => setTimeout(res, 100));
  span.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, composed: true }));
  await new Promise(res => setTimeout(res, 400));
  return { editing, textNow: span.textContent };
})()`);
record('text-edit-dispatched', textEdit);
await waitForFileChange(FRAG, f0, 'fragment text edit');
await sleep(1200);
const fragAfter = readFileSync(FRAG, 'utf8');
const editAfterText = readFileSync(EDIT, 'utf8');
record('file-after-text-edit', {
  fragmentChanged: fragAfter !== fragBefore,
  fragmentContainsNewText: fragAfter.includes(NEW_TEXT),
  fragmentAfter: fragAfter.trim().slice(0, 200),
  editJsonUnchanged: editAfterText === editBeforeText,
  title1Html: itemOf('title-1').source
});
await screenshot(main, path.join(outDir, 'l1-04-text-edited.png'));

// ---- 5) failure surfaces a visible reason ----
renameSync(FRAG, FRAG + '.moved');
await sleep(4000);
// 断片ファイルの消失でプレビューがモデルを読み直し、webview の実行コンテキストが作り直される。
const reconnected = await connectPreview(port);
const ev2 = (expr) => evalOn(reconnected.cdp, expr, reconnected.contextId);
record('reconnected-after-fragment-rename', { ok: true });
const failure = await ev2(`(async () => {
  const o = document.querySelector('[data-overlay-id="title-1"]');
  const span = o.querySelector('.akari-title-text');
  const r = span.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  span.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy }));
  await new Promise(res => setTimeout(res, 200));
  span.textContent = '失敗ケースの文言';
  span.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
  span.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, composed: true }));
  await new Promise(res => setTimeout(res, 2500));
  const b = document.getElementById('write-error-banner');
  const msg = document.getElementById('write-error-message');
  const cs = getComputedStyle(b);
  return { bannerHidden: b.hidden, message: msg.textContent, background: cs.backgroundColor, color: cs.color,
    dismissible: !!document.getElementById('write-error-dismiss') };
})()`);
record('failure-banner', failure);
await screenshot(main, path.join(outDir, 'l1-05-write-error-banner.png'));
const dismissed = await ev2(`(async () => {
  document.getElementById('write-error-dismiss').click();
  await new Promise(r => setTimeout(r, 200));
  return { bannerHidden: document.getElementById('write-error-banner').hidden };
})()`);
record('failure-banner-dismiss', dismissed);
renameSync(FRAG + '.moved', FRAG);

record('final-file-state', { title1: itemOf('title-1').transform, pip1: itemOf('pip-1').transform });
writeFileSync(path.join(outDir, 'l1-log.json'), JSON.stringify(log, null, 2));
cdp.close(); main.close();
console.log('DONE');
