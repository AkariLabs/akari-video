// プレビューで字幕を実クリックで選び、ミニパネルの「マイスタイルに保存」を実クリック → 開いたダイアログを記録。
// 使い方: node previewsave.mjs <project> <captionId> <seek秒> [--hover]
import path from 'node:path';
import { connect, evalOn, sleep } from './common.mjs';
import { realClick } from './cdp-lib.mjs';
import { command } from './l1-lib.mjs';
import { PLATE_CENTER, TOOLS, calibrate, toPage, view } from './view.mjs';
const [project, id, seek] = process.argv.slice(2);
const PORT = Number(process.env.CDP_PORT || 9485);
const cdp = await connect();
await cdp.send('Runtime.enable');
await evalOn(cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time: Number(seek) }));
await sleep(1500);
const v = await view(PORT);
const off = await calibrate(cdp, v);
const c = await v.eval(PLATE_CENTER(id));
const rec = { id, seek: Number(seek) };
if (c) { const p = toPage(off, c); await realClick(cdp, p.x, p.y); await sleep(1200); }
rec.tools = await v.eval(TOOLS);
const b = await v.eval(`(()=>{const b=document.querySelector('[data-caption-tool="my-style-save"]');if(!b)return null;const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
rec.button = Boolean(b);
if (b) {
    const p = toPage(off, b);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
    const t0 = Date.now(); let tip = null;
    while (Date.now() - t0 < 1000) { tip = await v.eval(`(()=>{const t=document.querySelector('[data-caption-tool="my-style-save"] .akari-caption-tool-tip');if(!t)return null;const cs=getComputedStyle(t);return cs.visibility!=='hidden'&&cs.display!=='none'&&Number(cs.opacity)>0?t.textContent:null})()`); if (tip) break; await sleep(25); }
    rec.tooltip = { text: tip, ms: Date.now() - t0 };
    if (process.argv.includes('--hover')) { console.log(JSON.stringify(rec)); v.close(); cdp.close(); process.exit(0); }
    await realClick(cdp, p.x, p.y); await sleep(1200);
}
rec.dialog = await evalOn(cdp, `(()=>{const d=document.querySelector('[data-akari-my-style-dialog]');return d?{name:d.querySelector('[data-akari-my-style-name]').value}:null})()`);
console.log(JSON.stringify(rec, null, 1));
v.close(); cdp.close(); process.exit(0);
