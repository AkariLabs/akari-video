#!/usr/bin/env node
// 音声クリップ本体（中央）を実マウスでダブルクリックし、専用画面（ダイアログ）が開くか・中のセレクトを採って Esc で閉じる（ラッパー作成の検証スクリプト）。
// 使い方: node dblclick.mjs <clipId> <out.json> [--shot=<png>] [--keep]
import { writeFileSync } from 'node:fs';
import { realClick, screenshot } from './cdp-lib.mjs';
import { CLIP, DIALOG, attach, evalOn, key, sleep } from './l1-common.mjs';
const [id, out] = process.argv.slice(2);
const shot = process.argv.find(v => v.startsWith('--shot='))?.slice(7);
const cdp = await attach();
const clip = await evalOn(cdp, CLIP(id));
const x = clip.left + clip.w / 2, y = clip.top + clip.h * 0.35;
await realClick(cdp, x, y, { clickCount: 2 });
await sleep(1500);
const dialog = await evalOn(cdp, DIALOG);
if (shot) await screenshot(cdp, shot);
if (!process.argv.includes('--keep')) { await key(cdp, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(600); }
const rec = { id, point: { x, y }, dialogOpened: Boolean(dialog), dialog, closed: !(await evalOn(cdp, DIALOG)) };
writeFileSync(out, `${JSON.stringify(rec, null, 1)}\n`);
console.log(JSON.stringify({ id, opened: rec.dialogOpened, title: dialog?.text?.slice(0, 40), selects: dialog?.selects?.map(s => `${s.name}=${s.value}`), closed: rec.closed }));
cdp.close(); process.exit(0);
