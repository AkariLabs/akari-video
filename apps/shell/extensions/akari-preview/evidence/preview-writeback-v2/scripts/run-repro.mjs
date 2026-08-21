import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectPreview, connectMain, evalOn } from './lib.mjs';
const [, , portArg, projectDir] = process.argv;
const port = Number(portArg);
const EDIT = path.join(projectDir, 'edit.json');
const FRAG = path.join(projectDir, 'overlays', 'title.html');
const record = (s, d) => console.log(`[${s}]`, JSON.stringify(d));
const editText0 = readFileSync(EDIT, 'utf8');
const fragText0 = readFileSync(FRAG, 'utf8');
const main = await connectMain(port);
for (let i = 0; i < 90; i++) { if (await evalOn(main, `!!(window.theia && window.theia.container)`)) break; await sleep(1000); }
await evalOn(main, `(() => {
  const bd = window.theia.container._bindingDictionary; const keys = [...bd._map.keys()];
  const C = keys.find(k => typeof k === 'function' && k.prototype && typeof k.prototype.executeCommand === 'function' && typeof k.prototype.registerCommand === 'function');
  void window.theia.container.get(C).executeCommand('akari.preview.ensureVisible', { editUri: ${JSON.stringify('file://' + path.join(process.argv[3], 'edit.json'))} });
  return true; })()`);
await sleep(6000);
const { cdp, contextId } = await connectPreview(port);
const ev = (e) => evalOn(cdp, e, contextId);
record('dom-initial', await ev(`(() => {
  const o = document.querySelector('[data-overlay-id="title-1"]');
  const cs = o ? getComputedStyle(o) : null;
  const l = document.querySelector('[data-akari-layer-id="pip-1"]');
  return { overlay: cs ? { x: cs.getPropertyValue('--x').trim(), scale: cs.getPropertyValue('--scale').trim() } : null,
    layer: l ? { x: l.dataset.akariTransformX, scale: l.dataset.akariTransformScale } : null,
    hasWriteErrorBanner: !!document.getElementById('write-error-banner') }; })()`));
// 1) drag + resize via overlay-runtime selftest (awaits overlayWrite)
record('overlay-selftest', await ev(`window.akari.interaction.selftest()`));
await sleep(2000);
// 2) layer drag
record('layer-drag', await ev(`(async () => {
  const el = document.querySelector('[data-akari-layer-id="pip-1"]');
  let rejection = null;
  const orig = window.akari.engine.layerWrite;
  window.akari.engine.layerWrite = (id, patch) => orig(id, patch).catch(e => { rejection = e && e.message; throw e; });
  const common = { bubbles: true, cancelable: true, composed: true, pointerType: 'mouse', isPrimary: true, button: 0, shiftKey: true };
  const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await new Promise(res => setTimeout(res, 200));
  el.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerId: 96001, buttons: 1, clientX: cx, clientY: cy }));
  for (const f of [0.5, 1]) { window.dispatchEvent(new PointerEvent('pointermove', { ...common, pointerId: 96001, buttons: 1, clientX: cx + 40 * f, clientY: cy + 16 * f })); await new Promise(res => setTimeout(res, 40)); }
  window.dispatchEvent(new PointerEvent('pointerup', { ...common, pointerId: 96001, buttons: 0, clientX: cx + 40, clientY: cy + 16 }));
  await new Promise(res => setTimeout(res, 4000));
  return { rejection, domXAfter: el.dataset.akariTransformX, domScaleAfter: el.dataset.akariTransformScale };
})()`));
// 3) text edit by double click
record('text-edit', await ev(`(async () => {
  const o = document.querySelector('[data-overlay-id="title-1"]');
  const span = o.querySelector('.akari-title-text');
  const r = span.getBoundingClientRect();
  span.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  await new Promise(res => setTimeout(res, 200));
  const editing = span.getAttribute('contenteditable');
  span.textContent = '旧ビルドで書き換えたテロップ';
  span.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
  span.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, composed: true }));
  await new Promise(res => setTimeout(res, 3000));
  return { editing, textNow: span.textContent };
})()`));
await sleep(1500);
record('files-after', {
  editJsonUnchanged: readFileSync(EDIT, 'utf8') === editText0,
  fragmentUnchanged: readFileSync(FRAG, 'utf8') === fragText0,
  editJsonMtime: statSync(EDIT).mtimeMs
});
record('dom-after', await ev(`(() => {
  const o = document.querySelector('[data-overlay-id="title-1"]');
  const cs = getComputedStyle(o);
  const l = document.querySelector('[data-akari-layer-id="pip-1"]');
  return { overlay: { x: cs.getPropertyValue('--x').trim(), scale: cs.getPropertyValue('--scale').trim(), text: (o.querySelector('.akari-title-text')||{}).textContent },
    layer: { x: l.dataset.akariTransformX, scale: l.dataset.akariTransformScale } }; })()`));
cdp.close(); main.close(); console.log('DONE');
