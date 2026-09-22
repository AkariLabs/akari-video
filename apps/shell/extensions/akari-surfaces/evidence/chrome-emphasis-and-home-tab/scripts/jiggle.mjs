// 選択中のホームタブ上でマウスを ±1px ずつ細かく動かし続け（実マウスの手ぶれ相当）、3 秒間 rAF ごとに
// タブ帯の DOM スナップショット（タブ rect / class・退避ボタン・ホバー札・スクロールバー）の変化を記録する。
// usage: CDP_PORT=9451 node jiggle.mjs <out.json> [scrollLeft]
import { connectMain, evalMain, sleep } from './cdp-lib.mjs';
import { writeFile } from 'node:fs/promises';
const [out, sl] = process.argv.slice(2);
const cdp = await connectMain(Number(process.env.CDP_PORT || 9451));
const pos = await evalMain(cdp, `(() => { const sc = document.querySelector('#theia-main-content-panel .lm-TabBar-content').parentElement; ${sl !== undefined ? `sc.scrollLeft = ${sl};` : ''} const t = sc.querySelector('.lm-TabBar-tab').getBoundingClientRect(); const s = sc.getBoundingClientRect(); return { x: (Math.max(t.left, s.left) + Math.min(t.right, s.right)) / 2, y: t.top + t.height / 2 }; })()`);
// 位置の上書き: JX（タブ左端からの px）/ JY（タブ下端からの px、負で上）
if (process.env.JX || process.env.JY) { const t = await evalMain(cdp, `(() => { const r = document.querySelector('#theia-main-content-panel .lm-TabBar-tab').getBoundingClientRect(); return [r.left, r.bottom]; })()`); if (process.env.JX) pos.x = t[0] + Number(process.env.JX); if (process.env.JY) pos.y = t[1] + Number(process.env.JY); }
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y, button: 'none' });
const rec = evalMain(cdp, `new Promise(resolve => {
  const bar = document.querySelector('#theia-main-content-panel .lm-TabBar');
  const r2 = v => Math.round(v * 100) / 100;
  const snap = () => {
    const sc = bar.querySelector('.lm-TabBar-content').parentElement;
    const tabs = [...bar.querySelectorAll('.lm-TabBar-tab')].map(t => { const r = t.getBoundingClientRect(); return [r2(r.left), r2(r.top), r2(r.width), r2(r.height), t.className]; });
    const anchor = [...bar.querySelectorAll('.akari-home-tab-anchor')].map(b => { const r = b.getBoundingClientRect(); return [b.hidden, r2(r.left), r2(r.width)]; });
    const rails = [...bar.querySelectorAll('.ps__rail-x, .ps__rail-y')].map(e => [e.className, getComputedStyle(e).opacity, r2(e.getBoundingClientRect().width)]);
    const hover = [...document.querySelectorAll('.theia-hover, .lm-Widget.theia-hover, [class*="hover-"]')].filter(e => e.getBoundingClientRect().width > 0).map(e => { const r = e.getBoundingClientRect(); return [e.className.slice(0, 40), r2(r.left), r2(r.top)]; });
    return JSON.stringify({ tabs, anchor, rails, hover, scrollLeft: sc.scrollLeft, barClass: bar.className });
  };
  let prev = snap(); const first = prev; let changes = 0, frames = 0; const samples = []; const t0 = performance.now();
  const tick = () => { const s = snap(); frames++; if (s !== prev) { changes++; if (samples.length < 20) samples.push({ t: Math.round(performance.now() - t0), from: JSON.parse(prev), to: JSON.parse(s) }); prev = s; }
    if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else resolve({ frames, changes, first: JSON.parse(first), samples }); };
  requestAnimationFrame(tick);
})`, 20000);
const t0 = Date.now(); let i = 0;
while (Date.now() - t0 < 3000) { const d = (i++ % 4) - 1.5; await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x + d, y: pos.y - (i % 2), button: 'none' }); await sleep(30); }
const result = await rec; result.mouse = pos; result.moves = i;
await writeFile(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ frames: result.frames, changes: result.changes, moves: i }));
for (const s of result.samples.slice(0, 6)) {
    const diff = Object.keys(s.to).filter(k => JSON.stringify(s.to[k]) !== JSON.stringify(s.from[k]));
    console.log(s.t, diff.map(k => k + ': ' + JSON.stringify(s.from[k]).slice(0, 200) + ' -> ' + JSON.stringify(s.to[k]).slice(0, 200)).join(' | '));
}
cdp.close(); process.exit(0);
