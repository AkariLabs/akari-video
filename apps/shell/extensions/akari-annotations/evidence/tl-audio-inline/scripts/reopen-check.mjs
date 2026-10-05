#!/usr/bin/env node
// 形つきの edit.json を開き直したあとの確認（ラッパー作成の検証スクリプト）。
// BGM の左上の丸を右へ dx px ドラッグしてフェードを付け、曲線の形の属性が保存済みの fade_in_shape と一致すること、
// 丸のクリックで出るメニューの ✓ が保存済みの形に付いていることを見る。最後に Cmd+Z でフェードを戻す（byte 一致）。
// 使い方: node reopen-check.mjs <project> <out.json> [dx=80]
import { writeFileSync } from 'node:fs';
import { realClick } from './cdp-lib.mjs';
import { CLIP, MENU, UNDO, attach, audioItem, editText, evalOn, key, sleep, waitChange } from './l1-common.mjs';

const [project, out, dxArg] = process.argv.slice(2);
const dx = Number(dxArg ?? 80);
const cdp = await attach();
const ev = expr => evalOn(cdp, expr);
const rec = { at: new Date().toISOString(), saved: (({ fade_in_shape, fade_out_shape }) => ({ fade_in_shape, fade_out_shape }))(audioItem(project, 'bgm-1')) };
const before = editText(project);
let c = await ev(CLIP('bgm'));
const h = c.fadeHandles.find(x => x.attrs.akariAudioFadeHandle === 'in');
const mv = (x, y, b) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: b ? 'left' : 'none', buttons: b });
await mv(h.cx, h.cy, 0); await sleep(80);
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: h.cx, y: h.cy, button: 'left', buttons: 1, clickCount: 1 }); await sleep(80);
for (let s = 1; s <= 12; s++) { await mv(h.cx + dx * s / 12, h.cy, 1); await sleep(30); }
await sleep(200);
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: h.cx + dx, y: h.cy, button: 'left', buttons: 0, clickCount: 1 });
rec.fadeChanged = await waitChange(project, before);
rec.item = audioItem(project, 'bgm-1');
c = await ev(CLIP('bgm'));
rec.curves = c.fadeCurves.map(x => x.attrs);
const h2 = c.fadeHandles.find(x => x.attrs.akariAudioFadeHandle === 'in');
await realClick(cdp, h2.cx, h2.cy);
await sleep(500);
rec.menu = (await ev(MENU)).map(m => ({ shape: m.shape, text: m.text, checked: m.checked }));
await key(cdp, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(400);
await ev(`(()=>{document.activeElement?.blur?.();return true})()`);
await key(cdp, UNDO);
for (let i = 0; i < 40 && editText(project) !== before; i++) await sleep(200);
rec.undoByteEqual = editText(project) === before;
writeFileSync(out, `${JSON.stringify(rec, null, 1)}\n`);
console.log(JSON.stringify(rec));
cdp.close(); process.exit(0);
