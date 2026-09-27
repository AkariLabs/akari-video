#!/usr/bin/env node
// 調査用: Electron を 1 つ起動して PID を出す（common.mjs の start）。起動後はこのプロセスだけ抜け、Electron は残る。
// 使い方: node launch.mjs <作業用ディレクトリ>   （fixture/spoken を ws へ写してから起動）
import { cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { paths, start } from './common.mjs';
const p = paths(process.argv[2]);
await rm(p.PJ, { recursive: true, force: true });
await cp(path.join(p.WORK, 'fixture', 'spoken'), p.PJ, { recursive: true });
const session = await start(p);
session.cdp.close();
console.log(JSON.stringify({ pid: session.pid }));
process.exit(0);
