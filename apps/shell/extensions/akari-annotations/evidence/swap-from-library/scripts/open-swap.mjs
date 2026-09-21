// Real clicks: select a timeline clip (data-akari-item-id=argv[2]) → make sure the inspector is visible → its 情報 tab →
// the "⇄ 候補を見る" button; then wait for the swap shelf. Prints the shelf head.
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain, evalMain, realClick } from './cdp-lib.mjs';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9395));
const ev = expr => evalMain(cdp, expr, 30000);
const center = sel => ev(`(() => { const e = ${sel}; if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width) return null; return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
const clip = await center(`document.querySelector('.akari-annotations-widget [data-akari-item-id=${JSON.stringify(process.argv[2])}]')`);
await realClick(cdp, ...clip); await sleep(1200);
const inspectorVisible = await ev(`(() => { const w = document.getElementById('akari-inspector-widget'); return !!w && w.getBoundingClientRect().width > 0 && !w.classList.contains('lm-mod-hidden'); })()`);
if (!inspectorVisible) { await realClick(cdp, ...(await center(`document.getElementById('shell-tab-akari-inspector-widget')`))); await sleep(1200); }
const tab = await center(`[...document.querySelectorAll('#akari-inspector-widget button, #akari-inspector-widget [role=tab]')].find(b => b.textContent.trim() === '情報' && b.getBoundingClientRect().width > 0)`);
if (tab) { await realClick(cdp, ...tab); await sleep(800); }
const button = await center(`[...document.querySelectorAll('[data-akari-material-swap] button')].find(b => b.getBoundingClientRect().width > 0)`);
if (!button) { console.log(JSON.stringify({ clip, inspectorVisible, tab, button: null })); process.exit(1); }
await realClick(cdp, ...button);
let head = null;
for (let k = 0; k < 30 && !head; k++) { await sleep(300); head = await ev(`document.querySelector('[data-akari-swap-shelf]')?.firstElementChild?.textContent.trim() ?? null`); }
console.log(JSON.stringify({ clip, inspectorOpened: !inspectorVisible, tab, button, head })); process.exit(head ? 0 : 1);
