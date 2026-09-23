#!/usr/bin/env node
// 詳細の開閉の記憶の確認用（ラッパー作成の検証スクリプト）: 同じ --user-data-dir / THEIA_CONFIG_DIR を消さずに Electron を起動し直す。
// 使い方: node relaunch.mjs <repo> <project> <isoDir> [--port=9467]（l1-lib.mjs の launch は isoDir を消すので使わない）
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import path from 'node:path';
import { listTargets, sleep } from './cdp-lib.mjs';
const [repo, project, isoDir] = process.argv.slice(2);
const port = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9467);
const shellDir = path.join(repo, 'apps', 'shell');
const electron = path.join(shellDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const log = openSync(path.join(isoDir, 'electron-relaunch.log'), 'a');
const child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`, `--user-data-dir=${isoDir}`, '--no-sandbox'], {
    env: { ...process.env, THEIA_CONFIG_DIR: isoDir, AKARI_HOME: path.join(isoDir, 'akari-home') },
    stdio: ['ignore', log, log], detached: true
});
child.unref();
let target;
const deadline = Date.now() + 180_000;
while (Date.now() < deadline && !target) {
    try { target = (await listTargets(port)).find(item => item.type === 'page'); } catch {}
    if (!target) await sleep(400);
}
console.log(JSON.stringify({ pid: child.pid, port, target: Boolean(target) }));
process.exit(target ? 0 : 1);
