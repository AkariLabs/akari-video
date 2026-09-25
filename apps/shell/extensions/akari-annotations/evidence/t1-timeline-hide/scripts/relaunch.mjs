#!/usr/bin/env node
// 同じ隔離ディレクトリ（user-data-dir / THEIA_CONFIG_DIR / AKARI_HOME）を消さずに Electron を起動し直す（利用者ごとの設定が残るかの確認用）。
// 使い方: node relaunch.mjs <repo> <project> <isoDir> [--port=9562]
import path from 'node:path';
import { openSync } from 'node:fs';
import { spawn } from 'node:child_process';
const [repo, project, isoDir] = process.argv.slice(2);
const port = Number(process.argv.find(v => v.startsWith('--port='))?.slice(7) ?? 9562);
const shellDir = path.join(repo, 'apps', 'shell');
const electron = path.join(shellDir, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const log = openSync(path.join(isoDir, 'electron.log'), 'a');
const child = spawn(electron, [shellDir, project, `--remote-debugging-port=${port}`, `--user-data-dir=${isoDir}`, '--no-sandbox'], {
    env: { ...process.env, THEIA_CONFIG_DIR: isoDir, AKARI_HOME: path.join(isoDir, 'akari-home') }, detached: true, stdio: ['ignore', log, log]
});
child.unref();
console.log(JSON.stringify({ pid: child.pid, port }));
process.exit(0);
