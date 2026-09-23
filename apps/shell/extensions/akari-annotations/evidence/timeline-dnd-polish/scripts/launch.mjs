#!/usr/bin/env node
// 実機を起動してタイムラインを開き、置いた文字を 1 本置いたところで止める（ラッパー作成の検証スクリプト）。
// Electron はこのプロセスの終了後も残る（PID を出力。止めるのは stop.mjs <pid>）。
// 使い方: node launch.mjs <repo> <project> <isoDir> [--port=9459]
import path from 'node:path';
import { command, launch, sleep } from './l1-lib.mjs';
import { evalOn } from './cdp-lib.mjs';
import { captionsOf, openProject, shellCall, waitFor } from './l1-common.mjs';

const [repo, project, isoDir] = process.argv.slice(2);
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9459);
const SHELL = path.join(repo, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const session = await launch({ shellDir: SHELL, electron: ELECTRON, project, port: PORT, isoDir });
console.log(JSON.stringify({ pid: session.pid }));
await openProject(session, project, 4, PORT);
if (!(await captionsOf(project)).some(c => c.time_domain === 'output')) {
    await evalOn(session.cdp, command('akari.caption.placeText', { start: 3, end: 6, text: '置いた文字 1' }));
    await waitFor('placed text saved', async () => (await captionsOf(project)).some(c => c.time_domain === 'output'));
}
await sleep(1500);
session.cdp.close();
console.log(JSON.stringify({ pid: session.pid, ready: true }));
process.exit(0);
