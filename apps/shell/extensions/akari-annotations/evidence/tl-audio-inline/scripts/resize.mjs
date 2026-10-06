#!/usr/bin/env node
// 行ヘッダ下端のつまみを実マウスでドラッグして、指定トラックの行の高さを target px にする（ラッパー作成の検証スクリプト）。
// 使い方: node resize.mjs <trackId> <targetPx>
import { realDragMod } from './cdp-lib.mjs';
import { HEADERS, RESIZE_HANDLES, attach, evalOn, sleep } from './l1-common.mjs';
const [trackId, target] = process.argv.slice(2);
const cdp = await attach();
const header = (await evalOn(cdp, HEADERS)).find(h => h.trackId === trackId);
const handle = (await evalOn(cdp, RESIZE_HANDLES)).find(h => h.trackId === trackId);
const dy = Number(target) - header.h;
await realDragMod(cdp, [{ x: handle.x, y: handle.y }, { x: handle.x, y: handle.y + dy }], { steps: 12 });
await sleep(800);
console.log(JSON.stringify({ trackId, before: header.h, after: (await evalOn(cdp, HEADERS)).find(h => h.trackId === trackId)?.h }));
cdp.close(); process.exit(0);
