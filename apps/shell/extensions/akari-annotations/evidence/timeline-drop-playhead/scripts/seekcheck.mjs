// 意図的なシークが従来どおり効くか: プレビューのシーク命令・タイムラインのクリック・0 秒へのシーク・キーボードの ← → を順に行い、
// タイムラインの再生ヘッド / transport / プレビュー表示を記録する: node seekcheck.mjs <project> <out.json>
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { connect, evalOn, sleep } from './common.mjs';
import { command } from './l1-lib.mjs';
import { realClick } from './cdp-lib.mjs';
import { FIND_TIMELINE, INSTALL, STATE } from './tdp-lib.mjs';
import { webviewContexts } from './stage.mjs';
const [project, outFile] = process.argv.slice(2);
const cdp = await connect(); await evalOn(cdp, INSTALL);
const label = async () => { const wv = await webviewContexts(); const v = await evalOn(wv.cdp, `(document.getElementById('time-label')||{}).textContent??null`, wv.inner); wv.cdp.close(); return v; };
const snap = async name => ({ step: name, ...(await evalOn(cdp, STATE)), preview: await label() });
const steps = [];
const editUri = `file://${path.resolve(project)}/edit.json`;
for (const t of [2, 0, 9.5]) { await evalOn(cdp, command('akari.preview.seekOutput', { editUri, time: t })); await sleep(2500); steps.push({ expect: t, ...(await snap(`preview.seekOutput ${t}`)) }); }
// タイムラインの空き（音の行の下）をクリック = その時刻へシーク
const geo = await evalOn(cdp, `(()=>{const w=${FIND_TIMELINE};w.node.querySelector('.akari-track-header-name');const r=w.strip.getBoundingClientRect();return{l:r.left,t:r.top,w:r.width,h:r.height,vs:w.viewStart,vis:w.visibleDuration()}})()`);
for (const t of [7, 3]) {
  const x = geo.l + (t - geo.vs) / geo.vis * geo.w;
  const y = await evalOn(cdp, `(()=>{const e=[...document.querySelectorAll('.akari-track-header-name')].find(e=>e.textContent.trim().startsWith('A1'));e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return b.top+b.height/2})()`);
  await realClick(cdp, x, y); await sleep(2500); steps.push({ expect: t, ...(await snap(`timeline click ${t}`)) });
}
await writeFile(outFile, JSON.stringify(steps, null, 1) + '\n');
for (const s of steps) console.log(s.step, 'expect', s.expect, 'playheadT', s.playheadT?.toFixed?.(2), 'transport', s.transport?.t?.toFixed?.(2), 'preview', s.preview);
cdp.close(); process.exit(0);
