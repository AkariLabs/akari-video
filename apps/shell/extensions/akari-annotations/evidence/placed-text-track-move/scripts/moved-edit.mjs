// 段へ移した置いた文字が、移した後もタイムラインのクリックで選べ、プレビュー上で掴んで動かせるか（ラッパー作成の検証スクリプト・r1）。
// 1) タイムラインのチップを実クリック → 選択の状態・インスペクター側に文字が出ているか 2) プレビューの字幕行のプレートを実マウスで右へ 60px 動かす → captions.json の位置が変わるか
// 使い方: node moved-edit.mjs <project> <captionId> <out.json> [--shot=<prefix>]
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from './cdp-lib.mjs';
import { CHIPS, view } from './l1-common.mjs';
import { stageGeometry } from './stage.mjs';

const [project, id, outFile] = process.argv.slice(2);
const shot = process.argv.find(v => v.startsWith('--shot='))?.slice(7);
const port = Number(process.env.CDP_PORT || 9627);
const caps = () => { const p = JSON.parse(readFileSync(path.join(project, 'captions.json'), 'utf8')); return (Array.isArray(p) ? p : p.captions); };
const edit = () => JSON.parse(readFileSync(path.join(project, 'edit.json'), 'utf8'));
const target = (await listTargets(port)).find(t => t.type === 'page');
const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect(); await cdp.send('Runtime.enable');
const rec = { id };
const item = edit().tracks.flatMap(t => (t.items ?? []).map(i => ({ track: t.id, ...i }))).find(i => i.source?.kind === 'caption' && i.source.id === id);
rec.itemBefore = item ?? null;
const chip = (await evalOn(cdp, CHIPS)).find(c => c.id === id);
rec.chipBefore = chip;
await realClick(cdp, chip.left + Math.min(chip.width / 2, 40), chip.top + chip.height / 2);
await sleep(1500);
rec.chipAfterClick = (await evalOn(cdp, CHIPS)).find(c => c.id === id);
rec.inspectorShowsText = await evalOn(cdp, `(()=>{const tl=document.querySelector('.akari-annotations');return [...document.querySelectorAll('textarea,input,[contenteditable=true]')].filter(e=>!tl?.contains(e)&&e.getBoundingClientRect().width>0).some(e=>(e.value??e.textContent??'').includes('置いた文字'))})()`);
if (shot) await screenshot(cdp, `${shot}-selected.png`);
// プレビューのプレート中心（本体ページの CSS px）
const v = await view(port);
const plate = await v.eval(`(()=>{const p=document.getElementById('caption-plate-'+encodeURIComponent(${JSON.stringify(item ? item.id : id)}));if(!p)return null;const l=p.querySelector('.akari-caption__line')||p;const s=document.getElementById('preview-stage').getBoundingClientRect();const r=l.getBoundingClientRect();return{fx:(r.x+r.width/2-s.x)/s.width,fy:(r.y+r.height/2-s.y)/s.height,z:getComputedStyle(p).zIndex}})()`);
rec.plate = plate;
const geo = await stageGeometry(cdp, edit().output);
const before = caps().find(c => c.id === id);
rec.captionBefore = before;
if (plate && geo) {
    const x0 = geo.host.x + plate.fx * geo.host.w, y0 = geo.host.y + plate.fy * geo.host.h, x1 = x0 + 60;
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0, button: 'none' }); await sleep(80);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 }); await sleep(80);
    for (let s = 1; s <= 12; s++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * s / 12, y: y0, button: 'left', buttons: 1 }); await sleep(30); }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y0, button: 'left', buttons: 0, clickCount: 1 });
    rec.previewDrag = { from: { x: x0, y: y0 }, to: { x: x1, y: y0 } };
    for (let i = 0; i < 24 && JSON.stringify(caps().find(c => c.id === id)) === JSON.stringify(before); i++) await sleep(250);
    await sleep(800);
}
rec.captionAfter = caps().find(c => c.id === id);
rec.captionPositionChanged = JSON.stringify(rec.captionAfter?.text_style?.position) !== JSON.stringify(before?.text_style?.position);
rec.itemAfter = edit().tracks.flatMap(t => (t.items ?? []).map(i => ({ track: t.id, ...i }))).find(i => i.source?.kind === 'caption' && i.source.id === id) ?? null;
if (shot) await screenshot(cdp, `${shot}-preview-moved.png`);
writeFileSync(outFile, `${JSON.stringify(rec, null, 1)}\n`);
console.log(JSON.stringify({ selected: rec.chipAfterClick?.cls, inspectorShowsText: rec.inspectorShowsText, plate, posBefore: before?.text_style?.position, posAfter: rec.captionAfter?.text_style?.position, changed: rec.captionPositionChanged, itemTrack: [rec.itemBefore?.track, rec.itemAfter?.track] }));
cdp.close(); process.exit(0);
