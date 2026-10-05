#!/usr/bin/env node
// 実機を起動してタイムラインを開いたところで止める（ラッパー作成の検証スクリプト）。Electron はこのプロセスの終了後も残る（PID を出力）。
// 使い方: node launch.mjs <repo> <project> <isoDir>   （CDP ポートは環境変数 CDP_PORT、既定 9463）
import path from 'node:path';
import { launch } from './l1-lib.mjs';
import { PORT, openTimeline } from './l1-common.mjs';

const [repo, project, isoDir] = process.argv.slice(2);
const SHELL = path.join(repo, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const session = await launch({ shellDir: SHELL, electron: ELECTRON, project, port: PORT, isoDir });
console.log(JSON.stringify({ pid: session.pid }));
await openTimeline(session.cdp);
session.cdp.close();
console.log(JSON.stringify({ pid: session.pid, ready: true }));
process.exit(0);
