// 本体ページを再読込してワークベンチの復帰を待つ（保存 → 再読込の確認用）: node reload.mjs
import { connect, sleep } from './common.mjs';
import { waitEval } from './l1-lib.mjs';
const cdp = await connect(); await cdp.send('Page.enable');
await cdp.send('Page.reload', { ignoreCache: true });
await sleep(3000);
cdp.close();
const again = await connect();
await waitEval(again, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell'))`, { label: 'Theia workbench', timeoutMs: 180_000 });
console.log('reloaded'); again.close(); process.exit(0);
