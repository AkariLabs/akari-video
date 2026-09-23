// ページ内で式を評価する（-f <file> で式をファイルから）/ --shot <png> でスクリーンショット（ラッパー作成の検証スクリプト）。
import { readFileSync } from 'node:fs';
import { CDP, evalOn, listTargets, screenshot } from './cdp-lib.mjs';
const port = Number(process.env.CDP_PORT || 9459);
const target = (await listTargets(port)).find(t => t.type === 'page');
const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
const arg = process.argv[2];
if (arg === '--shot') { await screenshot(cdp, process.argv[3]); console.log('shot', process.argv[3]); }
else { const expr = arg === '-f' ? readFileSync(process.argv[3], 'utf8') : arg; console.log(JSON.stringify(await evalOn(cdp, expr), null, 1)); }
cdp.close(); process.exit(0);
