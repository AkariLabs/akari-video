// タイムラインの A1 行の時刻 t をクリックして状態を出す: node clickt.mjs <t>
import { connect, evalOn, sleep } from './common.mjs';
import { realClick } from './cdp-lib.mjs';
import { FIND_TIMELINE, STATE } from './tdp-lib.mjs';
const t = Number(process.argv[2]); const cdp = await connect();
const y = await evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('.akari-track-header-name')].find(e=>e.textContent.trim().startsWith('A1'));e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return b.top+b.height/2})()`);
await sleep(300);
const g = await evalOn(cdp, `(()=>{const w=${FIND_TIMELINE};const r=w.strip.getBoundingClientRect();return{l:r.left,w:r.width,vs:w.viewStart,vis:w.visibleDuration()}})()`);
const x = g.l + (t - g.vs) / g.vis * g.w;
const hit = await evalOn(cdp, `(()=>{const e=document.elementFromPoint(${x},${y});return e?e.tagName+'.'+String(e.className).slice(0,60):null})()`);
await realClick(cdp, x, y); await sleep(2500);
const s = await evalOn(cdp, STATE);
console.log(JSON.stringify({ t, x: Math.round(x), y: Math.round(y), hit, playheadT: s.playheadT, transport: s.transport?.t, footer: await evalOn(cdp, `(document.querySelector('.akari-annotations-footer')||{}).textContent??null`) }));
cdp.close(); process.exit(0);
