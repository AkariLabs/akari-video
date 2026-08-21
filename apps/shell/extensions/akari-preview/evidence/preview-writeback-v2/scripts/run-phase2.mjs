import { readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, listTargets, screenshot as rawScreenshot } from './cdp-lib.mjs';
import { connectPreview, connectMain, evalOn } from './lib.mjs';
const [, , portArg, projectDir, outDir] = process.argv;
const port = Number(portArg);
const EDIT = path.join(projectDir, 'edit.json');
const itemOf = (id) => { for (const t of JSON.parse(readFileSync(EDIT, 'utf8')).tracks) for (const i of (t.items || [])) if (i.id === id) return i; };
const record = (s, d) => console.log(`[${s}]`, JSON.stringify(d));
const main = await connectMain(port);
for (let i = 0; i < 60; i++) { if (await evalOn(main, `!!(window.theia && window.theia.container)`)) break; await sleep(1000); }
await evalOn(main, `(() => {
  const bd = window.theia.container._bindingDictionary; const keys = [...bd._map.keys()];
  const C = keys.find(k => typeof k === 'function' && k.prototype && typeof k.prototype.executeCommand === 'function' && typeof k.prototype.registerCommand === 'function');
  void window.theia.container.get(C).executeCommand('akari.preview.ensureVisible', { editUri: ${JSON.stringify('file://' + path.join(process.argv[3], 'edit.json'))} });
  return true; })()`);
await sleep(6000);
const { cdp, contextId } = await connectPreview(port);
const dom = await evalOn(cdp, `(() => {
  const o = document.querySelector('[data-overlay-id="title-1"]');
  const cs = o ? getComputedStyle(o) : null;
  const l = document.querySelector('[data-akari-layer-id="pip-1"]');
  return { overlay: cs ? { x: cs.getPropertyValue('--x').trim(), y: cs.getPropertyValue('--y').trim(), scale: cs.getPropertyValue('--scale').trim(), text: (o.querySelector('.akari-title-text')||{}).textContent } : null,
    layer: l ? { x: l.dataset.akariTransformX, y: l.dataset.akariTransformY, scale: l.dataset.akariTransformScale } : null }; })()`, contextId);
record('after-restart-dom', dom);
record('after-restart-file', { title1: itemOf('title-1').transform, pip1: itemOf('pip-1').transform });
try { await Promise.race([rawScreenshot(main, path.join(outDir, 'l1-06-after-restart.png')), new Promise((_, r) => setTimeout(() => r(new Error('t')), 20000))]); console.log('[screenshot] ok'); } catch { console.log('[screenshot-failed]'); }
cdp.close(); main.close(); console.log('DONE');
