// 調査用: 本体ページで式を評価して JSON を出す: node ev.mjs '<expr>'   / node ev.mjs --shot <out.png>
import { CDP, evalOn, listTargets, screenshot } from './cdp-lib.mjs';
const port = Number(process.env.CDP_PORT || 9633);
const target = (await listTargets(port)).find(t => t.type === 'page');
const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
if (process.argv[2] === '--shot') await screenshot(cdp, process.argv[3]);
else console.log(JSON.stringify(await evalOn(cdp, process.argv[2]), null, 1));
cdp.close(); process.exit(0);
