// ホームの主要タイル（data-akari-library-primary-tile=<key>）を実マウスでクリックし、結果を記録する（ラッパー作成の検証スクリプト）。
// 使い方: node tile.mjs <project> <tileKey> <out.json> [--seek=<秒>]（seek = 先にタイムラインのその秒をクリックしてプレイヘッドを置く）
// 記録: クリック前後の captions.json / edit.json の変化・新しい字幕・「文字」行のチップ・プレイヘッド・開いた一覧（カテゴリページ）・通知
import { writeFile } from 'node:fs/promises';
import { CHIPS, NOTICES, PLAYHEAD, ROWS, S, TIME_X, captionRows, connect, evalOn, readCaptionsText, readEditText, sleep } from './common.mjs';
import { realClick } from './cdp-lib.mjs';
const [project, key, outFile] = process.argv.slice(2);
const seek = process.argv.find(v => v.startsWith('--seek='))?.slice(7);
const cdp = await connect();
const rec = { tile: key, at: new Date().toISOString() };
if (seek !== undefined) {
  const tx = await evalOn(cdp, TIME_X); await evalOn(cdp, ROWS);
  const ruler = await evalOn(cdp, `(()=>{const s=document.querySelector('.akari-timeline-scroll');const r=s.getBoundingClientRect();return r.top-12})()`);
  rec.seekClick = { x: Math.round(tx.x0 + Number(seek) * tx.pps), y: Math.round(ruler), targetTime: Number(seek) };
  await realClick(cdp, rec.seekClick.x, rec.seekClick.y); await sleep(1200);
}
rec.playheadDisplay = await evalOn(cdp, PLAYHEAD);
const tile = await evalOn(cdp, `(()=>{const t=document.querySelector('[data-akari-library-primary-tile=${S(key)}]');if(!t)return null;t.scrollIntoView({block:'nearest'});const r=t.getBoundingClientRect();
 return{x:r.left+r.width/2,y:r.top+r.height/2,disabled:t.disabled,draggable:t.getAttribute('draggable'),kind:t.getAttribute('data-akari-library-tile-kind'),texts:[...t.querySelectorAll('span')].map(s=>s.textContent.trim())}})()`);
rec.tileBefore = tile;
const capBefore = await readCaptionsText(project); const editBefore = await readEditText(project);
if (tile) await realClick(cdp, tile.x, tile.y);
let capAfter = capBefore; for (let i = 0; i < 20; i++) { await sleep(250); capAfter = await readCaptionsText(project); if (capAfter !== capBefore) break; }
await sleep(1200); capAfter = await readCaptionsText(project);
const ids = new Set(captionRows(capBefore).map(c => c.id));
rec.captionsChanged = capAfter !== capBefore;
rec.editChanged = (await readEditText(project)) !== editBefore;
rec.newCaptions = captionRows(capAfter).filter(c => !ids.has(c.id));
rec.chips = (await evalOn(cdp, CHIPS)).filter(c => rec.newCaptions.some(n => n.id === c.id));
rec.page = await evalOn(cdp, `(()=>{const home=document.querySelector('[data-akari-library-home]');const page=[...document.querySelectorAll('[data-akari-library-category]')].find(e=>!e.closest('[data-akari-library-home]')&&e.querySelector('[data-akari-library-back]'));
 return{homeVisible:Boolean(home),category:page?.getAttribute('data-akari-library-category')??null,title:page?[...page.querySelectorAll('span,div')].find(e=>e.children.length===0&&e.textContent.trim()&&!e.hasAttribute('data-akari-library-category-count')&&!/ライブラリ/.test(e.textContent))?.textContent.trim()??null:null,
 count:page?.querySelector('[data-akari-library-category-count]')?.getAttribute('data-akari-library-category-count')??null,
 cards:document.querySelectorAll('[data-akari-catalog-item]').length,presetCards:document.querySelectorAll('[data-akari-catalog-preset-item]').length}})()`);
rec.notices = await evalOn(cdp, NOTICES);
await writeFile(outFile, JSON.stringify(rec, null, 1) + '\n'); console.log(JSON.stringify(rec)); cdp.close(); process.exit(0);
