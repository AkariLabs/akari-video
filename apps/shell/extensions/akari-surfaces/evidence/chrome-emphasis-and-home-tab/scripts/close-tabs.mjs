// ホーム以外のタブを後ろから keep 個を残して閉じる。usage: node close-tabs.mjs <keep>
import { connectMain, evalMain, realClick, sleep } from './cdp-lib.mjs';
const keep = Number(process.argv[2] || 0);
const cdp = await connectMain(Number(process.env.CDP_PORT || 9451));
for (let n = 0; n < 30; n++) {
    const p = await evalMain(cdp, `(() => { const tabs = [...document.querySelectorAll('#theia-main-content-panel .lm-TabBar-tab.lm-mod-closable')]; if (tabs.length <= ${keep}) return null; const t = tabs[tabs.length - 1]; t.scrollIntoView(); const c = t.querySelector('.lm-TabBar-tabCloseIcon'); const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (!p) break;
    await realClick(cdp, p.x, p.y); await sleep(700);
}
console.log(await evalMain(cdp, `document.querySelectorAll('#theia-main-content-panel .lm-TabBar-tab').length`));
cdp.close(); process.exit(0);
