#!/usr/bin/env node
// 実機を起動してタイムラインを開いたところで止める（ラッパー作成の検証スクリプト）。
// Electron はこのプロセスの終了後も残る（PID を出力。止めるのは `kill <pid>`）。
// 使い方: node launch.mjs <apps/shell> <project> <isoDir> [--port=9465]
import { PORT_DEFAULT, start } from './l1-common.mjs';

const [shellDir, project, isoDir] = process.argv.slice(2);
const PORT = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? PORT_DEFAULT);
if (PORT !== 9465 || !project?.includes('tl-cut-commands') || !isoDir?.includes('tl-cut-commands')) {
    throw new Error('Use the dedicated fixture and isolated state with port 9465.');
}
const session = await start({ shellDir, project, isoDir, port: PORT });
session.cdp.close();
console.log(JSON.stringify({ pid: session.pid, ready: true }));
process.exit(0);
