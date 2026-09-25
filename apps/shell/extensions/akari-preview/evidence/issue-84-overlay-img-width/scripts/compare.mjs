#!/usr/bin/env node
// issue #84: 各面の計測 JSON を突き合わせ、受け入れ条件を判定する。usage: compare.mjs <outDir>
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const out = process.argv[2];
const read = async f => JSON.parse(await readFile(path.join(out, f), 'utf8'));
// 表示プロファイルの差（シェル/Chrome のスクリーンショットは色空間変換後）を吸収するため色を分類で比べる
const cls = p => { if (!p) return 'none'; const [r, g, b] = p;
  if (Math.abs(r - g) < 12 && Math.abs(g - b) < 12) return 'grey';
  if (r > 200 && g > 200 && b < 150) return 'yellow';
  if (r > 200 && b > 200 && g < 100) return 'magenta';
  if (r > 200 && g < 100 && b < 100) return 'red';
  if (g > 200 && r < 150 && b < 150) return 'green';
  if (b > 200 && r < 60 && g < 60) return 'blue';
  return `other(${r},${g},${b})`; };
const classes = px => Object.fromEntries(Object.entries(px).map(([k, v]) => [k, cls(v)]));
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const result = {};
for (const mode of ['compat', 'source']) {
  const before = await read(`before-${mode}-shell.json`);
  const after = await read(`after-${mode}-shell.json`);
  const webB = await read(`before-${mode}-web.json`);
  const webA = await read(`after-${mode}-web.json`);
  const osr = JSON.parse(await readFile(path.join(out, `osr-${mode}-pixels.json`), 'utf8'));
  const osrClasses = classes(osr.pixels);
  const surfaces = {
    'shell-main(before)': { m: before.measure, c: classes(before.pixels) },
    'shell-v0.1.79-sim': { m: before.simulated079.measure, c: classes(before.simulated079.pixels) },
    'shell-after': { m: after.measure, c: classes(after.pixels) },
    'webui-before': { m: webB.measure, c: classes(webB.pixels) },
    'webui-after': { m: webA.measure, c: classes(webA.pixels) }
  };
  const rows = {};
  for (const [name, { m, c }] of Object.entries(surfaces)) {
    const mism = Object.keys(osrClasses).filter(k => c[k] !== osrClasses[k]);
    rows[name] = { imgW: m.img.logical.w, imgH: m.img.logical.h, imgRelToFrame: m.img.relToFrame, imgMaxWidth: m.img.computed['max-width'],
      frame: m.frame.logical, capImgW: m.capImg.w, kbdBorder: m.kbd['border-top-width'], codeColor: m.code.color, vwBox: m.vwBox, pxBox: m.pxBox,
      pixelMismatchVsExport: mism.map(k => `${k}: ${c[k]} (export ${osrClasses[k]})`) };
  }
  const a = surfaces['shell-after'].m; const b = surfaces['shell-main(before)'].m;
  const checks = {
    imgWidth1300: near(a.img.logical.w, 1300),
    imgPos: near(a.img.relToFrame.x, -152) && near(a.img.relToFrame.y, -270),
    pixelsMatchExport: rows['shell-after'].pixelMismatchVsExport.length === 0,
    webuiPixelsMatchExport: rows['webui-after'].pixelMismatchVsExport.length === 0,
    vwBoxUnchanged: JSON.stringify(a.vwBox) === JSON.stringify(b.vwBox),
    pxBoxUnchanged: JSON.stringify(a.pxBox) === JSON.stringify(b.pxBox),
    authorCapHonoured: near(a.capImg.w, 300)
  };
  result[mode] = { exportClasses: osrClasses, rows, checks };
}
await writeFile(path.join(out, 'compare.json'), JSON.stringify(result, null, 2) + '\n');
for (const [mode, r] of Object.entries(result)) {
  console.log(`== ${mode}`, JSON.stringify(r.checks));
  for (const [n, row] of Object.entries(r.rows)) console.log(`  ${n}: img ${row.imgW}x${row.imgH} @${row.imgRelToFrame.x},${row.imgRelToFrame.y} max-width=${row.imgMaxWidth} cap=${row.capImgW} kbdBorder=${row.kbdBorder} code=${row.codeColor} mismatch=${JSON.stringify(row.pixelMismatchVsExport)}`);
}
