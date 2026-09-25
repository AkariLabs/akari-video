// タイムラインを開き、プレビューを出す（l1-common の openProject）: node open.mjs <project> [seek]
import { CDP, listTargets } from './cdp-lib.mjs';
import { openProject } from './l1-common.mjs';
const port = Number(process.env.CDP_PORT || 9562);
const target = (await listTargets(port)).find(t => t.type === 'page');
const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect(); await cdp.send('Runtime.enable');
await openProject({ cdp }, process.argv[2], Number(process.argv[3] ?? 1), port);
cdp.close(); process.exit(0);
