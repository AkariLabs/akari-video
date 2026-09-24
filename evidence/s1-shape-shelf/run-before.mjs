#!/usr/bin/env node
// L1 BEFORE（検証専用）: ライブラリのホームの「図形」タイルが「近日」で押せないことを記録する。
// 使い方: node evidence/s1-shape-shelf/run-before.mjs --shell <apps/shell> --out <出力 dir>
// 環境変数 AKARI_CDP_PORT（既定 9553）

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { evaluate, executeCommand, launchShell, makeScratch, rectOf, screenshot, scrub, sleep, waitFor } from './cdp-lib.mjs';
import { writeFixtureProject } from './fixture.mjs';

const argument = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const shellDir = path.resolve(argument('shell'));
const outDir = path.resolve(argument('out', '.'));
const port = Number(process.env.AKARI_CDP_PORT ?? 9553);
await mkdir(outDir, { recursive: true });

const dirs = await makeScratch('libcanvas-s1-before-');
await writeFixtureProject(dirs.project);
const report = { label: 'before', port };
let shell;
try {
  shell = await launchShell({ shellDir, dirs, port });
  const { main } = shell;
  await sleep(10000);
  await evaluate(main, `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent?.trim()==='開くだけ'); if(b)b.click(); return true; })()`);
  report.open = await executeCommand(main, 'akari.catalog.open', { tab: 'library' });
  const tile = '[data-akari-library-primary-tile="shapes"]';
  report.tileFound = Boolean(await waitFor(main, `Boolean(document.querySelector('${tile}'))`, 60000));
  await sleep(1500);
  report.tile = await evaluate(main, `(() => {
    const node = document.querySelector('${tile}');
    return node && { disabled: node.disabled, soon: node.getAttribute('data-akari-library-soon'),
      title: node.getAttribute('title'), text: node.textContent };
  })()`);
  const panel = await evaluate(main, `(() => {
    let node = document.querySelector('${tile}');
    while (node && !(node.getBoundingClientRect().height > 400 && node.getBoundingClientRect().width < 800)) node = node.parentElement;
    const r = node?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  })()`);
  report.panelShot = panel ? await screenshot(main, path.join(outDir, 'before-library-home.png'), panel) : undefined;
  report.tileRect = await rectOf(main, tile);
  report.consoleErrors = [...new Set(shell.consoleErrors.map(scrub))].slice(-8);
} catch (error) {
  report.error = scrub(error?.stack ?? error);
} finally {
  await shell?.stop();
  await sleep(500);
  await dirs.dispose();
}
await writeFile(path.join(outDir, 'before.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
