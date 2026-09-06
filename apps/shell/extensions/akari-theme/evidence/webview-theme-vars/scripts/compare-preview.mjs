#!/usr/bin/env node
// 回帰 (α) の突き合わせ: before-preview.json と after-preview.json の
// プレビュー領域グリッド（8px 格子）の画素差を出す。
//   node compare-preview.mjs --out <dir>
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const out = args.get('--out');
if (!out) throw new Error('usage: compare-preview.mjs --out <dir>');
const before = JSON.parse(await readFile(path.join(out, 'before-preview.json'), 'utf8'));
const after = JSON.parse(await readFile(path.join(out, 'after-preview.json'), 'utf8'));

const sameRect = JSON.stringify(before.rect) === JSON.stringify(after.rect);
const n = Math.min(before.grid.length, after.grid.length);
let max = 0; let sum = 0; let worst = null; let over2 = 0;
for (let i = 0; i < n; i++) {
  const a = before.grid[i]; const b = after.grid[i];
  if (!a || !b) continue;
  const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  sum += d;
  if (d > 2) over2++;
  if (d > max) { max = d; worst = { index: i, before: a, after: b }; }
}
const result = {
  sameRect, rectBefore: before.rect, rectAfter: after.rect, samples: n,
  maxDelta: max, meanDelta: Number((sum / n).toFixed(4)), samplesOverDelta2: over2, worst,
  shellBefore: before.shell, shellAfter: after.shell,
  pass: sameRect && max <= 2
};
await writeFile(path.join(out, 'preview-regression.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
