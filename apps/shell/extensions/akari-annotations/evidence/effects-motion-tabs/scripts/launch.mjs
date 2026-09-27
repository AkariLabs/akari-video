#!/usr/bin/env node
// 調査用: Electron を 1 つ起動して PID を出す（common.mjs の start）。起動後はこのプロセスだけ抜け、Electron は残る。
// 使い方: node launch.mjs <作業用ディレクトリ> [bag|nobag]
import { openProject, paths, start } from './common.mjs';
const p = paths(process.argv[2], process.argv[3] || 'bag');
const session = await start(p);
await openProject(session, p.PJ, 1);
session.cdp.close();
console.log(JSON.stringify({ pid: session.pid }));
process.exit(0);
