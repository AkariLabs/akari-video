// Back to the Library home, open the category whose label equals argv[2], and summarise its cards.
import { connectMain, evalMain, realClick } from '../../materials-tab-hardening/cdp-lib.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9388));
const label = process.argv[2];
const back = await evalMain(cdp, `(() => { const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&/^←?\\s*ライブラリ$/.test(e.textContent.trim())&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().top>80); if(!e) return null; const r=e.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; })()`);
if (back) { await realClick(cdp, back[0], back[1]); await sleep(800); }
const pos = await evalMain(cdp, `(() => { const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()===${JSON.stringify(label)}&&e.getBoundingClientRect().width>0); if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; })()`);
await realClick(cdp, pos[0], pos[1]); await sleep(2000);
console.log(label, JSON.stringify(await evalMain(cdp, `(() => { const cards=[...document.querySelectorAll('[data-akari-catalog-item]')]; const m={}; for (const e of cards) { const k='draggable='+e.getAttribute('draggable')+' add='+e.querySelectorAll('[data-akari-catalog-action=add]').length+' state='+e.getAttribute('data-akari-catalog-item-state'); m[k]=(m[k]||0)+1; } const hint=[...document.querySelectorAll('*')].filter(e=>e.children.length===0&&/ドラッグ|使う|取り込み/.test(e.textContent)&&e.getBoundingClientRect().width>0).map(e=>e.textContent.trim())[0]; return { cards: cards.length, summary: m, hint }; })()`)));
process.exit(0);
