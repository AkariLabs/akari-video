// 選択中のホームタブにマウスを載せ続け、3 秒間 rAF ごとにタブ・退避ボタンの rect / hidden / class を記録して変化回数を数える。
// usage: CDP_PORT=9451 node hover-jitter.mjs <out.json> [openTabs=0]
import { connectMain, evalMain, realClick, sleep } from './cdp-lib.mjs';
import { writeFile } from 'node:fs/promises';
const [out, openTabsArg] = process.argv.slice(2);
const openTabs = Number(openTabsArg || 0);
const cdp = await connectMain(Number(process.env.CDP_PORT || 9451));
const tabCount = () => evalMain(cdp, `document.querySelectorAll('#theia-main-content-panel .lm-TabBar-tab').length`);
for (let i = 1; (await tabCount()) - 1 < openTabs && i <= 16; i++) {
    const p = await evalMain(cdp, `(() => { const e = document.querySelector('[data-akari-output-path="planning/note-${String(i).padStart(2, '0')}.md"]'); if (!e) return null; e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; })()`);
    if (!p) break;
    await realClick(cdp, p.x, p.y);
    await sleep(900);
}
// ホームタブ（見えていれば本体、隠れていれば退避ボタン）をクリックして選択
// ホームタブがスクローラー外に見切れていれば、見えている退避ボタンを狙う
const homeTabExpr = `(() => { const t = [...document.querySelectorAll('#theia-main-content-panel .lm-TabBar-tab')].find(t => t.textContent.includes('ホーム')); const sc = t.parentElement.parentElement.getBoundingClientRect(); let r = t.getBoundingClientRect(); let via = 'tab';
  const a = document.querySelector('#theia-main-content-panel .akari-home-tab-anchor');
  if (r.left < sc.left || r.right > sc.right) { if (a && !a.hidden) { r = a.getBoundingClientRect(); via = 'anchor'; } else { const vl = Math.max(r.left, sc.left), vr = Math.min(r.right, sc.right); return { x: (vl + vr) / 2, y: r.top + r.height / 2, via: 'partial' }; } }
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, via }; })()`;
let h = await evalMain(cdp, homeTabExpr);
await realClick(cdp, h.x, h.y);
await sleep(1200);
h = await evalMain(cdp, homeTabExpr);
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: h.x, y: h.y, button: 'none' });
const result = await evalMain(cdp, `new Promise(resolve => {
  const snap = () => {
    const tabs = [...document.querySelectorAll('#theia-main-content-panel .lm-TabBar-tab')].map(t => { const r = t.getBoundingClientRect(); return [t.textContent.trim().slice(0, 12), Math.round(r.left * 100) / 100, Math.round(r.width * 100) / 100, t.className]; });
    const anchors = [...document.querySelectorAll('.akari-home-tab-anchor')].map(b => { const r = b.getBoundingClientRect(); return [b.hidden, Math.round(r.left * 100) / 100, Math.round(r.width * 100) / 100]; });
    const sc = document.querySelector('#theia-main-content-panel .lm-TabBar-content')?.parentElement?.getBoundingClientRect();
    return JSON.stringify({ tabs, anchors, scroller: sc ? [Math.round(sc.left * 100) / 100, Math.round(sc.width * 100) / 100] : null });
  };
  const frames = []; let prev = snap(); let changes = 0; const samples = [];
  const t0 = performance.now();
  const tick = () => {
    const s = snap(); frames.push(1);
    if (s !== prev) { changes++; if (samples.length < 12) samples.push({ t: Math.round(performance.now() - t0), from: JSON.parse(prev), to: JSON.parse(s) }); prev = s; }
    if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else resolve({ frames: frames.length, changes, samples, final: JSON.parse(s), hoverSelected: document.querySelector('#theia-main-content-panel .lm-TabBar-tab.lm-mod-current')?.textContent.trim(), hovered: [...document.querySelectorAll(':hover')].pop()?.className });
  };
  requestAnimationFrame(tick);
})`, 20000);
result.openTabsRequested = openTabs; result.mouse = h;
await writeFile(out, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ frames: result.frames, changes: result.changes, tabs: result.final.tabs.length, anchors: result.final.anchors, hovered: result.hovered }));
cdp.close(); process.exit(0);
