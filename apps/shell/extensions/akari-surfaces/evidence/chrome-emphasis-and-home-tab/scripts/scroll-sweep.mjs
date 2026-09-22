// ホーム選択中にスクローラーの scrollLeft を 0..max で振り、各位置でホームタブ（見えている部分）にマウスを載せて 1 秒間の変化回数を数える。
// usage: CDP_PORT=9451 node scroll-sweep.mjs <out.json>
import { connectMain, evalMain, sleep } from './cdp-lib.mjs';
import { writeFile } from 'node:fs/promises';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9451));
const info = await evalMain(cdp, `(() => { const sc = document.querySelector('#theia-main-content-panel .lm-TabBar-content').parentElement; return { max: sc.scrollWidth - sc.clientWidth, cw: sc.clientWidth, sw: sc.scrollWidth }; })()`);
const rows = [];
for (let k = 0; k <= info.max + 4; k += 2) {
    const pos = await evalMain(cdp, `(() => { const sc = document.querySelector('#theia-main-content-panel .lm-TabBar-content').parentElement; sc.scrollLeft = ${k};
      return new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => { const t = sc.querySelector('.lm-TabBar-tab'); const a = document.querySelector('#theia-main-content-panel .akari-home-tab-anchor'); const s = sc.getBoundingClientRect(); const tr = t.getBoundingClientRect();
        const target = (a && !a.hidden) ? a.getBoundingClientRect() : { left: Math.max(tr.left, s.left), right: Math.min(tr.right, s.right), top: tr.top, height: tr.height };
        r({ x: (target.left + target.right) / 2, y: target.top + target.height / 2, scrollLeft: sc.scrollLeft, anchorHidden: a?.hidden }); }))); })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pos.x, y: pos.y, button: 'none' });
    const r = await evalMain(cdp, `new Promise(resolve => { const sc = document.querySelector('#theia-main-content-panel .lm-TabBar-content').parentElement; const a = document.querySelector('#theia-main-content-panel .akari-home-tab-anchor');
      const snap = () => JSON.stringify([a?.hidden, Math.round(sc.getBoundingClientRect().width*100)/100, sc.scrollLeft, [...sc.querySelectorAll('.lm-TabBar-tab')].map(t => Math.round(t.getBoundingClientRect().left*100)/100)]);
      let prev = snap(), changes = 0, frames = 0, first = prev; const t0 = performance.now();
      const tick = () => { const s = snap(); frames++; if (s !== prev) { changes++; prev = s; } if (performance.now() - t0 < 1000) requestAnimationFrame(tick); else resolve({ frames, changes, first, last: s }); }; requestAnimationFrame(tick); })`);
    rows.push({ k, ...pos, ...r });
    if (r.changes) console.log('JITTER at', k, JSON.stringify(r));
}
await writeFile(process.argv[2], JSON.stringify({ info, rows }, null, 1));
console.log(JSON.stringify(info), 'positions', rows.length, 'jittering', rows.filter(r => r.changes).length, 'maxChanges', Math.max(...rows.map(r => r.changes)));
cdp.close(); process.exit(0);
