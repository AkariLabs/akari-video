// 最後のタブを選んでホームをスクロール外へ出し、退避ボタンの表示・当たり判定・実クリックでホームへ戻るかを記録する。
// usage: CDP_PORT=9451 node anchor-click.mjs <out.json>
import { connectMain, evalMain, realClick, screenshot, sleep } from './cdp-lib.mjs';
import { writeFile } from 'node:fs/promises';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9451));
const last = await evalMain(cdp, `(() => { const tabs = [...document.querySelectorAll('#theia-main-content-panel .lm-TabBar-tab')]; const t = tabs[tabs.length - 1]; t.scrollIntoView(); const r = t.getBoundingClientRect(); const sc = t.parentElement.parentElement.getBoundingClientRect(); return { x: Math.min(r.left + r.width / 2, sc.right - 10), y: r.top + r.height / 2, count: tabs.length }; })()`);
await realClick(cdp, last.x, last.y); await sleep(1500);
const state = () => evalMain(cdp, `(() => { const a = document.querySelector('#theia-main-content-panel .akari-home-tab-anchor'); const r = a.getBoundingClientRect(); const hit = r.width ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
  const home = [...document.querySelectorAll('#theia-main-content-panel .lm-TabBar-tab')].find(t => t.textContent.includes('ホーム')).getBoundingClientRect(); const sc = document.querySelector('#theia-main-content-panel .lm-TabBar-content').parentElement.getBoundingClientRect();
  return { anchorHidden: a.hidden, anchorRect: [r.left, r.top, r.width, r.height], hitIsAnchor: hit === a, hit: hit ? hit.className : null, homeLeft: home.left, scrollerLeft: sc.left, scrollerWidth: sc.width, current: document.querySelector('#theia-main-content-panel .lm-TabBar-tab.lm-mod-current')?.textContent.trim() }; })()`);
const before = await state();
// 高負荷時にスクショが返らないことがあるので、判定の記録を優先してスクショは失敗しても続行する
await screenshot(cdp, process.argv[2].replace(/\.json$/, '-shown.png')).catch(e => console.log('screenshot skipped:', e.message));
let after = null;
if (!before.anchorHidden) {
    await realClick(cdp, before.anchorRect[0] + before.anchorRect[2] / 2, before.anchorRect[1] + before.anchorRect[3] / 2);
    await sleep(1500);
    after = await state();
}
await writeFile(process.argv[2], JSON.stringify({ tabCount: last.count, before, after }, null, 1));
console.log(JSON.stringify({ before, after }));
cdp.close(); process.exit(0);
