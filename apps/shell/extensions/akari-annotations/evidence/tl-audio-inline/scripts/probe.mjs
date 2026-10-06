#!/usr/bin/env node
// 音声クリップ 3 本の現状（印・丸・線・点・曲線の有無と矩形、行の高さ）を採る（ラッパー作成の検証スクリプト）。
// 使い方: node probe.mjs <out.json> [--shot=<png>]
import { writeFileSync } from 'node:fs';
import { screenshot } from './cdp-lib.mjs';
import { CLIP, HEADERS, attach, evalOn } from './l1-common.mjs';
const [out] = process.argv.slice(2);
const shot = process.argv.find(v => v.startsWith('--shot='))?.slice(7);
const cdp = await attach();
const rec = { at: new Date().toISOString(), headers: await evalOn(cdp, HEADERS), clips: {} };
for (const id of ['bgm', 'bgm-1', 'nar-1', 'sfx-1']) rec.clips[id] = await evalOn(cdp, CLIP(id));
if (shot) await screenshot(cdp, shot);
writeFileSync(out, `${JSON.stringify(rec, null, 1)}\n`);
console.log(JSON.stringify({ headers: rec.headers, clips: Object.fromEntries(Object.entries(rec.clips).map(([k, v]) => [k, v && { h: v.h, w: v.w, kf: v.kfMarkers.length, fade: v.fadeHandles.length, line: v.gainLine.length, pts: v.kfPoints.length, curves: v.fadeCurves.length }])) }));
cdp.close(); process.exit(0);
