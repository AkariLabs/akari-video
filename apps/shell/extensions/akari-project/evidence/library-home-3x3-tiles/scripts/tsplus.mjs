// テキストスタイルのカードの ＋ を実マウスでクリックし、置かれた文字とプレイヘッドを記録。
// 使い方: node tsplus.mjs <project> <presetId> <out.json> [--seek=<秒>]（seek = 先にタイムラインのその秒をクリックしてプレイヘッドを置く）
import { writeFile } from 'node:fs/promises';
import { CHIPS, NOTICES, PLAYHEAD, ROWS, S, TIME_X, captionRows, cardSelector, connect, evalOn, readCaptionsText, sleep } from './common.mjs';
import { realClick } from './cdp-lib.mjs';
const [project, presetId, outFile] = process.argv.slice(2);
const seek = process.argv.find(v => v.startsWith('--seek='))?.slice(7);
const cdp = await connect();
const rec = { presetId, at: new Date().toISOString() };
if (seek !== undefined) {
  const tx = await evalOn(cdp, TIME_X); const rows = await evalOn(cdp, ROWS);
  const ruler = await evalOn(cdp, `(()=>{const s=document.querySelector('.akari-timeline-scroll');const r=s.getBoundingClientRect();return r.top-12})()`);
  rec.seekClick = { x: Math.round(tx.x0 + Number(seek) * tx.pps), y: Math.round(ruler), targetTime: Number(seek) };
  await realClick(cdp, rec.seekClick.x, rec.seekClick.y); await sleep(1200);
}
rec.playheadDisplay = await evalOn(cdp, PLAYHEAD);
rec.footerBefore = await evalOn(cdp, `[...document.querySelectorAll('.akari-annotations *, [class*=akari] *')].filter(e=>e.children.length===0&&/シーク|時刻/.test(e.textContent)&&e.getBoundingClientRect().width>0).map(e=>e.textContent.trim()).slice(-1)[0]??null`);
const btn = await evalOn(cdp, `(()=>{const c=document.querySelector(${S(cardSelector(presetId))});c.scrollIntoView({block:'center'});const b=c.querySelector('[data-akari-catalog-action=add]');if(!b)return null;const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,label:b.getAttribute('aria-label'),text:b.textContent.trim()}})()`);
rec.button = btn;
const before = await readCaptionsText(project);
if (btn) await realClick(cdp, btn.x, btn.y);
let after = before; for (let i = 0; i < 20; i++) { await sleep(250); after = await readCaptionsText(project); if (after !== before) break; }
await sleep(1200); after = await readCaptionsText(project);
const ids = new Set(captionRows(before).map(c => c.id));
rec.captionsChanged = after !== before;
rec.newCaptions = captionRows(after).filter(c => !ids.has(c.id));
rec.chips = (await evalOn(cdp, CHIPS)).filter(c => rec.newCaptions.some(n => n.id === c.id));
rec.notices = await evalOn(cdp, NOTICES);
await writeFile(outFile, JSON.stringify(rec, null, 1) + '\n'); console.log(JSON.stringify(rec)); cdp.close(); process.exit(0);
