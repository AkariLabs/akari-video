import { readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectPreview, connectMain, evalOn } from './lib.mjs';
const [, , portArg, projectDir, label] = process.argv;
const port = Number(portArg);
const EDIT = path.join(projectDir, 'edit.json');
const FRAG = path.join(projectDir, 'overlays', 'title.html');
const record = (s, d) => console.log(`[${label}:${s}]`, JSON.stringify(d));
const edit0 = readFileSync(EDIT, 'utf8');
const frag0 = readFileSync(FRAG, 'utf8');
const main = await connectMain(port);
for (let i = 0; i < 90; i++) { if (await evalOn(main, `!!(window.theia && window.theia.container)`)) break; await sleep(1000); }
await evalOn(main, `(() => {
  const bd = window.theia.container._bindingDictionary; const keys = [...bd._map.keys()];
  const C = keys.find(k => typeof k === 'function' && k.prototype && typeof k.prototype.executeCommand === 'function' && typeof k.prototype.registerCommand === 'function');
  void window.theia.container.get(C).executeCommand('akari.preview.ensureVisible', { editUri: ${JSON.stringify('file://' + path.join(process.argv[3], 'edit.json'))} });
  return true; })()`);
await sleep(7000);
const notice = await evalOn(main, `(() => {
  const texts = Array.from(document.querySelectorAll('.theia-notification-message, .theia-notification-list-item, .theia-notification-message span'))
    .map(el => (el.textContent || '').trim()).filter(Boolean);
  return { readOnlyNotice: texts.filter(t => t.includes('読み取り専用')).slice(0, 2), count: texts.length }; })()`);
record('read-only-notice', notice);
const { cdp, contextId } = await connectPreview(port);
const ev = (e) => evalOn(cdp, e, contextId);
record('dom-initial', await ev(`(() => {
  const o = document.querySelector('[data-overlay-id="title-1"]');
  const cs = o ? getComputedStyle(o) : null;
  return { overlayPresent: !!o, x: cs && cs.getPropertyValue('--x').trim(), scale: cs && cs.getPropertyValue('--scale').trim(),
    hasWriteErrorBanner: !!document.getElementById('write-error-banner') }; })()`));
record('overlay-selftest', await ev(`window.akari.interaction.selftest()`));
await sleep(2500);
record('text-edit', await ev(`(async () => {
  const o = document.querySelector('[data-overlay-id="title-1"]');
  const span = o.querySelector('.akari-title-text');
  const r = span.getBoundingClientRect();
  span.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  await new Promise(res => setTimeout(res, 200));
  span.textContent = 'legacy テキスト編集';
  span.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
  span.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, composed: true }));
  await new Promise(res => setTimeout(res, 3000));
  return { textNow: span.textContent };
})()`));
await sleep(1500);
record('files-after', { editJsonUnchanged: readFileSync(EDIT, 'utf8') === edit0, fragmentUnchanged: readFileSync(FRAG, 'utf8') === frag0,
  fragmentContainsNewText: readFileSync(FRAG, 'utf8').includes('legacy テキスト編集') });
cdp.close(); main.close(); console.log('DONE');
