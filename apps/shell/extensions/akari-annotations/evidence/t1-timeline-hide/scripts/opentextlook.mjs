// ライブラリのホーム → 詳細 → 「スタイル・動き・フォント」または LUT を開く: node opentextlook.mjs look|lut
import { connect, evalOn, sleep } from './common.mjs';
import { realClick } from './cdp-lib.mjs';
const which = process.argv[2] ?? 'look';
const cdp = await connect();
const at = async sel => { const p = await evalOn(cdp, `(()=>{const b=document.querySelector(${JSON.stringify(sel)});if(!b)return null;b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return[r.left+r.width/2,r.top+r.height/2]})()`); if (p) { await realClick(cdp, p[0], p[1]); await sleep(1500); } return !!p; };
const back = await evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&/^←?\\s*ライブ/.test(e.textContent.trim())&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().top>80);if(!e)return null;const r=e.getBoundingClientRect();return[r.left+r.width/2,r.top+r.height/2]})()`);
if (back) { await realClick(cdp, back[0], back[1]); await sleep(1000); }
if (!(await evalOn(cdp, `Boolean(document.querySelector('[data-akari-library-details]'))`))) await at('[data-akari-library-details-toggle]');
const ok = await at(which === 'lut' ? '[data-akari-library-details] [data-akari-library-category=lut]' : '[data-akari-library-text-look-row]');
console.log(JSON.stringify({ which, ok })); cdp.close(); process.exit(0);
