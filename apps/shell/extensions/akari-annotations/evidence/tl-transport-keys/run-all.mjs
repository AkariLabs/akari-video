import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { once } from 'node:events';
import { createConnection } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../../../', import.meta.url));
const here = fileURLToPath(new URL('./', import.meta.url));
const portOccupied = await new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port: 9464 });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.setTimeout(1000, () => { socket.destroy(); resolve(true); });
});
if (portOccupied) throw new Error('CDP port 9464 is already in use; no Electron was started');
const prepared = spawnSync(process.execPath, [join(here, 'prepare-fixture.mjs')], { encoding: 'utf8' });
if (prepared.status !== 0) throw new Error(prepared.stderr || 'fixture preparation failed');
const fixture = JSON.parse(prepared.stdout);

const electronLog = openSync(join(fixture.base, 'electron.log'), 'w');
const runLog = openSync(join(fixture.base, 'run.log'), 'w');
const env = { ...process.env, THEIA_CONFIG_DIR: fixture.config, AKARI_HOME: fixture.akariHome };
delete env.ELECTRON_RUN_AS_NODE;
const electron = spawn(join(root, 'apps/shell/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), [
    join(root, 'apps/shell'), fixture.workspace, '--remote-debugging-port=9464',
    `--user-data-dir=${fixture.userData}`, '--no-sandbox'
], {
    env,
    stdio: ['ignore', electronLog, electronLog]
});
if (!electron.pid) throw new Error('Electron did not start');

try {
    const run = spawn(process.execPath, [join(here, 'run-l1.mjs')], {
        stdio: ['ignore', runLog, runLog]
    });
    const [code] = await once(run, 'exit');
    console.log(JSON.stringify({ fixture: fixture.base, electronPid: electron.pid, runLog: join(fixture.base, 'run.log'), exitCode: code }));
    if (code !== 0) process.exitCode = 1;
} finally {
    electron.kill('SIGTERM');
    await Promise.race([once(electron, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))]);
    if (electron.exitCode === null && electron.signalCode === null) electron.kill('SIGKILL');
    closeSync(electronLog);
    closeSync(runLog);
}
