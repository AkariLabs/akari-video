// シェルが描画され preload が消えるまで待つ。usage: CDP_PORT=9451 node waitready.mjs
import { connectMain, evalMain } from './cdp-lib.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
let cdp;
for (let i = 0; i < 300 && !cdp; i++) { try { cdp = await connectMain(Number(process.env.CDP_PORT || 9451)); } catch { await sleep(2000); } }
for (let i = 0; i < 300; i++) {
    const ok = await evalMain(cdp, `(() => !document.querySelector('.theia-preload') && !!document.querySelector('#theia-main-content-panel .lm-TabBar-tab'))()`).catch(() => false);
    if (ok) { console.log('ready after', i, 's'); break; }
    await sleep(1000);
}
await sleep(3000);
cdp.close(); process.exit(0);
