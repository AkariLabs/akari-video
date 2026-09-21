// ページを再読み込みして UI 状態（残った取り込みの枠など）をリセットし、ライブラリの指定カテゴリを開き直す。
import { connectMain, evalMain } from './cdp-lib.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
const cdp = await connectMain(Number(process.env.CDP_PORT || 9423));
await cdp.send('Page.reload', {});
for (let i = 0; i < 60; i++) { await sleep(1000); try { if (await evalMain(cdp, `!!document.getElementById('akari-role-buckets-widget')`)) break; } catch {} }
await sleep(3000); cdp.close(); process.exit(0);
