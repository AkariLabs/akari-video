#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { CDP, evalOn, keyPress, listTargets } from '../../timeline-tracks/scripts/cdp-lib.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
const port = Number(args.get('--port'));
const output = args.get('--out');
if (!Number.isInteger(port) || port <= 0 || !output) {
  throw new Error('usage: run-regression-ui.mjs --port <p> --out <file>');
}
const waitFor = async (description, predicate, timeoutMs = 20000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if (await predicate()) return; } catch {}
    await sleep(100);
  }
  throw new Error(`timed out: ${description}`);
};

const targets = await listTargets(port);
const target = targets.find(entry => entry.type === 'page' && /localhost/u.test(entry.url))
  ?? targets.find(entry => entry.type === 'page');
if (!target) throw new Error('Theia page target not found');
const cdp = new CDP(target.webSocketDebuggerUrl);
await cdp.connect();
try {
  await cdp.send('Runtime.enable');
  await waitFor('frontend ready', () => evalOn(cdp, `document.readyState === 'complete'`));
  const onboarding = await evalOn(cdp, `(() => {
    const button=[...document.querySelectorAll('button')].find(element=>element.textContent?.trim()==='開くだけ');
    if(button){button.click();return true}return false;
  })()`);
  if (onboarding) await sleep(400);
  let opened = await evalOn(cdp, `Boolean(document.getElementById('akari-annotations-widget'))`);
  for (let attempt = 0; attempt < 3 && !opened; attempt++) {
    await keyPress(cdp, { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 });
    await sleep(250);
    await cdp.send('Input.insertText', { text: 'タイムラインを開く' });
    await keyPress(cdp, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await sleep(1000);
    opened = await evalOn(cdp, `Boolean(document.getElementById('akari-annotations-widget'))`);
  }
  if (!opened) throw new Error('timeline did not open');
  await sleep(500);
  const measurement = await evalOn(cdp, `(() => {
    const round2 = value => { const rounded=Math.round(value*100)/100; return Object.is(rounded,-0)?0:rounded; };
    const chips=[...document.querySelectorAll('[data-akari-item-kind="caption"]')].map(element=>{
      const rect=element.getBoundingClientRect();
      return { id:element.dataset.akariItemId??'', left:round2(rect.left), top:round2(rect.top),
        width:round2(rect.width), height:round2(rect.height) };
    }).sort((left,right)=>(left.id<right.id?-1:left.id>right.id?1:0)||left.left-right.left||left.top-right.top);
    const captionRowTops=[...new Set(chips.map(chip=>chip.top))].sort((left,right)=>left-right);
    const treeRows=[...document.querySelectorAll('[data-akari-tree-row-id]')]
      .map(element=>element.dataset.akariTreeRowId??'');
    return {
      captionRows:captionRowTops.length,
      captionRowTops,
      captionChips:chips,
      treeRowCount:treeRows.length,
      treeRows
    };
  })()`);
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await writeFile(path.resolve(output), `${JSON.stringify(measurement, null, 2)}\n`);
} finally {
  cdp.close();
}
