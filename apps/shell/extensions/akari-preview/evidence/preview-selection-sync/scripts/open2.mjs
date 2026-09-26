// タイムラインを開き、プレビューを出す（字幕チップを待たない版）: node open2.mjs <project> [seek]
import path from 'node:path';
import { CDP, evalOn, listTargets, sleep } from './cdp-lib.mjs';
import { command } from './l1-lib.mjs';
const port = Number(process.env.CDP_PORT || 9624);
const target = (await listTargets(port)).find(t => t.type === 'page');
const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect(); await cdp.send('Runtime.enable');
const project = process.argv[2]; const seek = Number(process.argv[3] ?? 1);
await evalOn(cdp, command('akari.annotations.open')).catch(() => null);
const deadline = Date.now() + 180000;
while (Date.now() < deadline) {
  await evalOn(cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time: seek })).catch(() => null);
  await sleep(3000);
  if ((await listTargets(port)).some(t => t.type === 'iframe' && /webview\/index\.html/u.test(t.url))) break;
}
await sleep(3000);
await evalOn(cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(project, 'edit.json')}`, time: seek })).catch(() => null);
console.log('opened'); cdp.close(); process.exit(0);
