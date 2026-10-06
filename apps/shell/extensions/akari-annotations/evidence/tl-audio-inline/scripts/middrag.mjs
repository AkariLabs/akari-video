#!/usr/bin/env node
// 指定要素（クリップ内の data 属性セレクタ）を実マウスで押して dx/dy 動かした「離す前」の状態（readout・要素の位置）を採ってスクショし、離す（ラッパー作成の検証スクリプト）。
// 使い方: node middrag.mjs <clipId> <innerSelector> <dx> <dy> <png> [--escape]
import { screenshot } from './cdp-lib.mjs';
import { READOUT, attach, evalOn, sleep, S } from './l1-common.mjs';
const [id, sel, dx, dy, png] = process.argv.slice(2);
const cdp = await attach();
const q = `(()=>{const e=document.querySelector('[data-akari-item-kind="audio"][data-akari-item-id=${S(id)}] ${sel}');if(!e)return null;const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,connected:e.isConnected}})()`;
const a = await evalOn(cdp, q);
const mv = (x, y, b) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: b ? 'left' : 'none', buttons: b });
await mv(a.x, a.y, 0); await sleep(80);
await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', buttons: 1, clickCount: 1 }); await sleep(80);
for (let s = 1; s <= 12; s++) { await mv(a.x + dx * s / 12, a.y + dy * s / 12, 1); await sleep(30); }
await sleep(300);
const mid = { readout: await evalOn(cdp, READOUT), element: await evalOn(cdp, q) };
await screenshot(cdp, png);
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: a.x + Number(dx), y: a.y + Number(dy), button: 'left', buttons: 0, clickCount: 1 });
console.log(JSON.stringify({ start: a, mid }));
cdp.close(); process.exit(0);
