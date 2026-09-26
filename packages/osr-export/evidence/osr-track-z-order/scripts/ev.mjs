// 本体ページで式を評価して JSON を出す: node ev.mjs '<expr>'
import { CDP, evalOn, listTargets } from './cdp-lib.mjs';
const port = Number(process.env.CDP_PORT || 9629);
const target = (await listTargets(port)).find(t => t.type === 'page');
const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
console.log(JSON.stringify(await evalOn(cdp, process.argv[2]), null, 1));
cdp.close(); process.exit(0);
