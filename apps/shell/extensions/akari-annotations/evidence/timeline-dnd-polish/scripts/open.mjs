#!/usr/bin/env node
// 起動済みの実機（ページ再読み込み後など）にアタッチして、タイムラインを開き、置いた文字が無ければ 1 本置く（ラッパー作成の検証スクリプト）。
// 使い方: node open.mjs <project> [--port=9459]
import { command, sleep, waitEval } from './l1-lib.mjs';
import { CDP, evalOn, listTargets } from './cdp-lib.mjs';
import { captionsOf, openProject, waitFor } from './l1-common.mjs';
const [project] = process.argv.slice(2);
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9459);
const target = (await listTargets(PORT)).find(t => t.type === 'page');
const cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect(); await cdp.send('Runtime.enable');
await waitEval(cdp, `Boolean(window.theia&&window.theia.container&&document.getElementById('theia-app-shell')&&document.querySelector('.theia-preload.theia-hidden, body:not(:has(.theia-preload))'))`, { label: 'Theia workbench', timeoutMs: 300_000 });
await sleep(3000);
await openProject({ cdp }, project, 4, PORT);
if (!(await captionsOf(project)).some(c => c.time_domain === 'output')) {
    await evalOn(cdp, command('akari.caption.placeText', { start: 3, end: 6, text: '置いた文字 1' }));
    await waitFor('placed text saved', async () => (await captionsOf(project)).some(c => c.time_domain === 'output'));
}
await evalOn(cdp, `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='開くだけ');b?.click();const d=window.theia.container._bindingDictionary;const k=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');window.theia.container.get(k).collapsePanel('right');return true})()`);
await sleep(3000);
cdp.close(); console.log('ready'); process.exit(0);
