// 素材パネルの切り替えが実際に表示される（幅 > 0）まで待つ。usage: CDP_PORT=9434 node waitready.mjs
import { connectMain, evalMain } from '../../materials-tab-hardening/cdp-lib.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9434));
for (let i = 0; i < 120; i++) {
    const ok = await evalMain(cdp, `(() => { const b = document.querySelector('[data-akari-panel-segment]'); return !!b && b.getBoundingClientRect().width > 0 && !document.querySelector('.theia-preload') && (document.getElementById('theia-left-content-panel')?.getBoundingClientRect().width ?? 0) > 100; })()`);
    if (ok) { console.log('ready after', i, 's'); break; }
    if (i === 20) { // 左パネルが畳まれていれば素材アイコンで開く
        await evalMain(cdp, `(() => { const el = [...document.querySelectorAll('.codicon-files')].find(e => e.getBoundingClientRect().width > 0); el?.click(); })()`);
    }
    await sleep(1000);
}
await sleep(1500);
cdp.close(); process.exit(0);
