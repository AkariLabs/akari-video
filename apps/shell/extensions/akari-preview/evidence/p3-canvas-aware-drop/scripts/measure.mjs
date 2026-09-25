// プレビューに描かれた写真の位置を実測する: 出力の枠を出力 px の倍率で撮り（stageshot）、下地の色から外れた画素の外接矩形を取る（bbox）。
// 使い方: node measure.mjs <project> <out.png> <region x0,y0,x1,y1（出力 px）> [expectX,expectY]
import { execFileSync } from 'node:child_process';
const [project, out, region, expect] = process.argv.slice(2);
const here = new URL('.', import.meta.url).pathname;
const shot = JSON.parse(execFileSync('node', [here + 'stageshot.mjs', project, out], { encoding: 'utf8' }));
const box = JSON.parse(execFileSync('node', [here + 'bbox.mjs', out, String(shot.output.width), String(shot.output.height), `--region=${region}`], { encoding: 'utf8' }));
const rec = { shot, ...box };
if (expect) {
  const [ex, ey] = expect.split(',').map(Number);
  rec.expectCenter = { x: ex, y: ey };
  if (box.centerOutputPx) rec.centerError = { x: +(box.centerOutputPx.x - ex).toFixed(2), y: +(box.centerOutputPx.y - ey).toFixed(2) };
  rec.expectWidth = shot.output.width / 4;
  if (box.bboxOutputPx) rec.widthError = +(box.bboxOutputPx.w - shot.output.width / 4).toFixed(2);
}
console.log(JSON.stringify(rec));
