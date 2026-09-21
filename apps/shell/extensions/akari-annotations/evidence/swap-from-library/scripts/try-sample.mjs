// Real click on a swap-shelf card, then sample the timeline playhead line every 150 ms for 8 s (DUR = timeline length in s).
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain, evalMain, realClick } from './cdp-lib.mjs';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9395));
const ev = expr => evalMain(cdp, expr, 30000);
const DUR = Number(process.env.DUR || 45);
const PH = `(() => { const e=[...document.querySelector('.akari-annotations-widget').querySelectorAll('div')].find(e=>{const r=e.getBoundingClientRect(); return r.width>0&&r.width<=4&&r.height>150&&e.style.left.endsWith('%')}); return parseFloat(e.style.left); })()`;
const key = process.argv[2];
const pos = await ev(`(() => { const c=document.querySelector('[data-akari-swap-candidate=${JSON.stringify(key)}]'); c.scrollIntoView({block:'center'}); const r=c.getBoundingClientRect(); return [r.left+r.width/2, r.top+Math.min(40, r.height/3)]; })()`);
const t0 = Date.now();
await realClick(cdp, pos[0], pos[1]);
const samples = [];
while (Date.now() - t0 < Number(process.env.MS || 8000)) { samples.push([Date.now() - t0, Math.round((await ev(PH)) * DUR * 10) / 1000]); await sleep(150); }
writeFileSync(process.argv[3], JSON.stringify({ key, at: new Date().toISOString(), samples }, null, 1));
console.log(JSON.stringify(samples)); process.exit(0);
