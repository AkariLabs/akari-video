// Playhead = the timeline's blue playhead line (style.left % × timeline length DUR, default 45 s).
// Click "▶ もう一度" on the trial bar (real click) and sample the timeline playhead every 200 ms for 7 s.
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { connectMain, evalMain, realClick } from './cdp-lib.mjs';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9395));
const ev = expr => evalMain(cdp, expr, 30000);
const CMD = `(() => { const d=window.theia.container._bindingDictionary; const C=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.executeCommand==='function'); return window.theia.container.get(C); })()`;
const DUR = Number(process.env.DUR || 45);
const PH = `(() => { const e=[...document.querySelector('.akari-annotations-widget').querySelectorAll('div')].find(e=>{const r=e.getBoundingClientRect(); return r.width>0&&r.width<=4&&r.height>150&&e.style.left.endsWith('%')}); return parseFloat(e.style.left); })()`;
const pos = await ev(`(() => { const b=[...document.querySelectorAll('[data-akari-material-trial] button')].find(x=>x.textContent.trim()==='▶ もう一度'); const r=b.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; })()`);
const t0 = Date.now();
await realClick(cdp, pos[0], pos[1]);
const samples = [];
while (Date.now() - t0 < 7000) { samples.push([Date.now() - t0, Math.round((await ev(PH)) * DUR * 10) / 1000]); await sleep(200); }
writeFileSync(process.argv[2], JSON.stringify({ at: new Date().toISOString(), samples }, null, 1));
console.log(JSON.stringify(samples)); process.exit(0);
