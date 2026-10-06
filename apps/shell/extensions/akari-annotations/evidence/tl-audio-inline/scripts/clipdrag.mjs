#!/usr/bin/env node
// クリップ上の点（左端からの px オフセット ox・上端からの比率 fy）を実マウスで dx だけ横に動かし、対象アイテムの at / duration / source / fade の変化と Cmd+Z 1 手の byte 一致を見る（ラッパー作成の検証スクリプト）。
// 使い方: node clipdrag.mjs <project> <clipId> <itemId> <ox|-ox(右端から)> <fy> <dx>
import { CLIP, UNDO, attach, audioItem, editText, evalOn, key, sleep, waitChange } from './l1-common.mjs';
const [project, id, itemId, ox, fy, dx] = process.argv.slice(2);
const cdp = await attach();
const c = await evalOn(cdp, CLIP(id));
const x0 = Number(ox) >= 0 ? c.left + Number(ox) : c.left + c.w + Number(ox), y0 = c.top + c.h * Number(fy);
const before = editText(project), itemBefore = audioItem(project, itemId);
const mv = (x, y, b) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: b ? 'left' : 'none', buttons: b });
await mv(x0, y0, 0); await sleep(80);
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 }); await sleep(80);
for (let s = 1; s <= 14; s++) { await mv(x0 + dx * s / 14, y0, 1); await sleep(30); }
await sleep(200);
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x0 + Number(dx), y: y0, button: 'left', buttons: 0, clickCount: 1 });
const changed = await waitChange(project, before);
const itemAfter = audioItem(project, itemId);
const pick = i => ({ at: i.at, duration: i.duration, in: i.source?.in, out: i.source?.out, fade_in: i.fade_in, fade_out: i.fade_out });
let undo = null;
if (changed) { await evalOn(cdp, `(()=>{document.activeElement?.blur?.();return true})()`); await key(cdp, UNDO); for (let i = 0; i < 40 && editText(project) !== before; i++) await sleep(200); undo = editText(project) === before; }
console.log(JSON.stringify({ id, start: { x: x0, y: y0 }, dx: Number(dx), changed, before: pick(itemBefore), after: pick(itemAfter), undoByteEqual: undo }));
cdp.close(); process.exit(0);
