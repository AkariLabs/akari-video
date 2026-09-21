// r1: right-click a project-panel asset group card (data-akari-material-path) with a real mouse
// event and record the visible context-menu labels, then close it with Escape.
// Usage: node ctxmenu.mjs <materialPath> <out.json>
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain, evalMain } from '../../materials-tab-hardening/cdp-lib.mjs';
const [path, outFile] = process.argv.slice(2);
const cdp = await connectMain(Number(process.env.CDP_PORT || 9388));
const ev = expr => evalMain(cdp, expr, 30000);
const card = await ev(`(() => { const e=document.querySelector('[data-akari-material-path=${JSON.stringify(path)}]'); if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, draggable: e.getAttribute('draggable') }; })()`);
if (!card) { console.log('card not found'); process.exit(1); }
await ev(`document.querySelectorAll('[data-akari-context-menu]').forEach(p => p.remove())`); // drop a menu left over from a previous run
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x, y: card.y });
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: card.x, y: card.y, button: 'right', buttons: 2, clickCount: 1 });
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: card.x, y: card.y, button: 'right', buttons: 0, clickCount: 1 });
await sleep(800);
const menu = await ev(`[...document.querySelectorAll('[data-akari-context-menu] button')].map(b=>b.textContent.trim()).filter(Boolean)`);
const k = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
const rec = { path, card, menu, hasAddToTimeline: menu.includes('タイムラインに追加'), at: new Date().toISOString() };
writeFileSync(outFile, JSON.stringify(rec, null, 1)); console.log(JSON.stringify(rec)); process.exit(0);
