// 2 枚の出力の枠のスクショを比べ、矩形の内側と外側の平均画素差を出す（LUT が写真だけに当たったかの確認）: node pxdiff.mjs <before.png> <after.png> x0 y0 x1 y1
import { load } from './bbox.mjs';
const [a, b, x0, y0, x1, y1] = process.argv.slice(2); const A = load(a), B = load(b);
let inS = 0, inN = 0, outS = 0, outN = 0;
for (let y = 0; y < A.h; y += 2) for (let x = 0; x < A.w; x += 2) { const p = A.px(x, y), q = B.px(x, y); const d = Math.abs(p[0]-q[0]) + Math.abs(p[1]-q[1]) + Math.abs(p[2]-q[2]); const inside = x >= +x0 && x < +x1 && y >= +y0 && y < +y1; if (inside) { inS += d; inN++; } else { outS += d; outN++; } }
console.log(JSON.stringify({ size: [A.w, A.h], meanAbsDiffInsidePhoto: +(inS / inN).toFixed(2), meanAbsDiffOutside: +(outS / outN).toFixed(2) }));
