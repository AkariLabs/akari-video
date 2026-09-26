#!/usr/bin/env node
// 本票の L1 用に Electron を 1 つ起動して PID を出す（l1-lib.mjs の launch）。起動後はこのプロセスだけ抜け、Electron は残る。
// 使い方: node launch.mjs <repo> <project> <isoDir> [--port=9627]
import path from 'node:path';
import { launch } from './l1-lib.mjs';
const [repo, project, isoDir] = process.argv.slice(2);
const port = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9627);
const shellDir = path.join(repo, 'apps', 'shell');
const electron = path.join(shellDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const session = await launch({ shellDir, electron, project, port, isoDir });
session.cdp.close();
console.log(JSON.stringify({ pid: session.pid, port }));
process.exit(0);
