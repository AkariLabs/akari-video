// 本体ページのスクリーンショット: node shot.mjs <out.png>
import { CDP, listTargets, screenshot } from './cdp-lib.mjs';
const port = Number(process.env.CDP_PORT || 9622);
const target = (await listTargets(port)).find(t => t.type === 'page');
const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
await screenshot(cdp, process.argv[2]); cdp.close(); process.exit(0);
