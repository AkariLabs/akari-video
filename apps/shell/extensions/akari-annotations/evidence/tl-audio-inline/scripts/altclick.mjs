#!/usr/bin/env node
// 音声クリップ上の指定位置（クリップ左端からの比率 fx・上端からの比率 fy）を ⌥クリックし、edit.json の byte 変化を見る（ラッパー作成の検証スクリプト）。
// 使い方: node altclick.mjs <project> <clipId> <fx> <fy> <out.json>
import { writeFileSync } from 'node:fs';
import { realClick } from './cdp-lib.mjs';
import { CLIP, attach, editSha, editText, evalOn, waitChange } from './l1-common.mjs';
const [project, id, fx, fy, out] = process.argv.slice(2);
const cdp = await attach();
const clip = await evalOn(cdp, CLIP(id));
const before = editText(project), sha0 = editSha(project);
const x = clip.left + clip.w * Number(fx), y = clip.top + clip.h * Number(fy);
await realClick(cdp, x, y, { modifiers: 1 });
const changed = await waitChange(project, before, 4000);
const rec = { id, point: { x, y }, changed, byteEqual: editSha(project) === sha0 };
writeFileSync(out, `${JSON.stringify(rec, null, 1)}\n`);
console.log(JSON.stringify(rec));
cdp.close(); process.exit(0);
