import { readFileSync, chmodSync, statSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { CDP, listTargets, screenshot as rawScreenshot } from './cdp-lib.mjs';
import { connectPreview, evalOn } from './lib.mjs';

const [, , portArg, projectDir, outDir] = process.argv;
const port = Number(portArg);
const EDIT = path.join(projectDir, 'edit.json');
const log = [];
const record = (step, data) => { log.push({ step, ...data }); console.log(`[${step}]`, JSON.stringify(data)); };
const shot = async (cdp, f) => { try { await Promise.race([rawScreenshot(cdp, f), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 20000))]); console.log('[screenshot]', f); } catch (e) { console.log('[screenshot-failed]', String(e.message)); } };

const targets = await listTargets(port);
const main = new CDP(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await main.connect();
await main.send('Page.enable');

const { cdp, contextId } = await connectPreview(port);
const ev = (e) => evalOn(cdp, e, contextId);
record('connected', { editExists: !!statSync(EDIT) });

const beforeText = readFileSync(EDIT, 'utf8');
chmodSync(EDIT, 0o444);
record('edit-json-readonly', { mode: (statSync(EDIT).mode & 0o777).toString(8) });

const failure = await ev(`(async () => {
  const el = document.querySelector('[data-akari-layer-id="pip-1"]');
  if (!el) return { ok: false, reason: 'layer missing' };
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 200));
  const common = { bubbles: true, cancelable: true, composed: true, pointerType: 'mouse', isPrimary: true, button: 0, shiftKey: true };
  const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const before = { x: el.dataset.akariTransformX, y: el.dataset.akariTransformY };
  el.dispatchEvent(new PointerEvent('pointerdown', { ...common, pointerId: 95001, buttons: 1, clientX: cx, clientY: cy }));
  for (const f of [0.5, 1]) {
    window.dispatchEvent(new PointerEvent('pointermove', { ...common, pointerId: 95001, buttons: 1, clientX: cx - 30 * f, clientY: cy - 12 * f }));
    await new Promise(r2 => setTimeout(r2, 40));
  }
  window.dispatchEvent(new PointerEvent('pointerup', { ...common, pointerId: 95001, buttons: 0, clientX: cx - 30, clientY: cy - 12 }));
  await new Promise(r2 => setTimeout(r2, 6000));
  const b = document.getElementById('write-error-banner');
  const msg = document.getElementById('write-error-message');
  const cs = getComputedStyle(b);
  const rect = b.getBoundingClientRect();
  return { ok: true, before, after: { x: el.dataset.akariTransformX, y: el.dataset.akariTransformY },
    bannerHidden: b.hidden, bannerVisibleRect: { w: Math.round(rect.width), h: Math.round(rect.height) },
    message: msg.textContent, background: cs.backgroundColor, color: cs.color, role: b.getAttribute('role'),
    dismissButton: !!document.getElementById('write-error-dismiss') };
})()`);
record('failure-banner', failure);
await shot(main, path.join(outDir, 'l1-05-write-error-banner.png'));
const dismissed = await ev(`(async () => {
  document.getElementById('write-error-dismiss').click();
  await new Promise(r => setTimeout(r, 300));
  return { bannerHidden: document.getElementById('write-error-banner').hidden };
})()`);
record('banner-dismissed', dismissed);
chmodSync(EDIT, 0o644);
record('edit-json-restored', { unchanged: readFileSync(EDIT, 'utf8') === beforeText, mode: (statSync(EDIT).mode & 0o777).toString(8) });
cdp.close(); main.close();
console.log('DONE');
