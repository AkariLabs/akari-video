// Open library home → category label argv[2]
import { connectMain, evalMain, realClick } from '../../materials-tab-hardening/cdp-lib.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9455));
const label = process.argv[2];
const back = await evalMain(cdp, `(() => { const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&/^←?\\s*ライブラリ$/.test(e.textContent.trim())&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().top>80); if(!e) return null; const r=e.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; })()`);
if (back) { await realClick(cdp, back[0], back[1]); await sleep(800); }
const pos = await evalMain(cdp, `(() => { const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()===${JSON.stringify(label)}&&e.getBoundingClientRect().width>0); if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return [r.left+r.width/2, r.top+r.height/2]; })()`);
await realClick(cdp, pos[0], pos[1]); await sleep(2500);
console.log(JSON.stringify(await evalMain(cdp, `({cards:document.querySelectorAll('[data-akari-catalog-item]').length, toggles:document.querySelectorAll('[data-akari-catalog-audio-toggle]').length})`)));
process.exit(0);
