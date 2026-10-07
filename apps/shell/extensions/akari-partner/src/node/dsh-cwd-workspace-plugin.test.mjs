import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DSH_CWD_WORKSPACE_PLUGIN_SOURCE } from '../../lib/node/dsh-cwd-workspace-plugin.js';

async function writePlugin(t) {
    const root = await mkdtemp(join(tmpdir(), 'akari-dsh-plugin-'));
    t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
    const file = join(root, 'akari-cwd-workspace.mjs');
    await writeFile(file, DSH_CWD_WORKSPACE_PLUGIN_SOURCE);
    return file;
}

async function loadPlugin(t) {
    return import(pathToFileURL(await writePlugin(t)).href);
}

const RUNNER_SOURCE = `
import(process.argv[1]).then(({ apply }) => {
    apply({ workspaceRegistry: { async create() { throw new Error('fixture registration unavailable'); } } });
    setInterval(() => {}, 1000);
}).catch(error => { console.error(error); process.exitCode = 1; });
`;

function spawnPluginRunner(file, parentPid) {
    const child = spawn(process.execPath, ['-e', RUNNER_SOURCE, pathToFileURL(file).href], {
        env: { ...process.env, AKARI_PARTNER_PARENT_PID: String(parentPid) },
        stdio: 'ignore', windowsHide: true
    });
    let spawnError;
    child.on('error', error => spawnError = error);
    const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal, spawnError })));
    return { child, closed };
}

async function waitForClose(closed, timeoutMs) {
    let timer;
    try {
        return await Promise.race([
            closed.then(result => ({ closed: true, result })),
            new Promise(resolve => { timer = setTimeout(() => resolve({ closed: false }), timeoutMs); })
        ]);
    } finally {
        clearTimeout(timer);
    }
}

test('embedded dsh plugin registers cwd and moves it before the first workspace', async t => {
    const plugin = await loadPlugin(t);
    assert.equal(plugin.name, 'akari-cwd-workspace');
    assert.deepEqual(plugin.inject, ['workspaceRegistry']);
    assert.equal(typeof plugin.apply, 'function');
    assert.deepEqual(plugin.default, { name: plugin.name, inject: plugin.inject, apply: plugin.apply });

    const calls = [];
    const registry = {
        async create(cwd) {
            calls.push(['create', cwd]);
            return { id: 'cwd-workspace' };
        },
        list() {
            calls.push(['list']);
            return [{ id: 'previous-workspace' }];
        },
        async insertBefore(id, beforeId) {
            calls.push(['insertBefore', id, beforeId]);
        }
    };
    plugin.apply({ workspaceRegistry: registry });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [
        ['create', process.cwd()],
        ['list'],
        ['insertBefore', 'cwd-workspace', 'previous-workspace']
    ]);
});

test('embedded dsh plugin keeps registration when insertBefore throws', async t => {
    const plugin = await loadPlugin(t);
    const calls = [];
    plugin.apply({ workspaceRegistry: {
        async create(cwd) {
            calls.push(['create', cwd]);
            return { id: 'cwd-workspace' };
        },
        list() { return [{ id: 'previous-workspace' }]; },
        async insertBefore() { throw new Error('ordering unavailable'); }
    } });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [['create', process.cwd()]]);
});

test('embedded dsh plugin has no @deepseek-ai import', () => {
    assert.equal(DSH_CWD_WORKSPACE_PLUGIN_SOURCE.includes('@deepseek-ai/'), false);
});

test('embedded dsh plugin exits when its parent pid has ended', async t => {
    const exitedParent = spawn(process.execPath, ['-e', ''], { stdio: 'ignore', windowsHide: true });
    assert.ok(exitedParent.pid > 0);
    const parentExit = await new Promise((resolve, reject) => {
        exitedParent.once('error', reject);
        exitedParent.once('close', resolve);
    });
    assert.equal(parentExit, 0);
    const runner = spawnPluginRunner(await writePlugin(t), exitedParent.pid);
    try {
        const outcome = await waitForClose(runner.closed, 6000);
        assert.equal(outcome.closed, true, 'plugin did not exit after parent ended');
        assert.equal(outcome.result.spawnError, undefined);
        assert.equal(outcome.result.code, 0);
    } finally {
        if (runner.child.exitCode === null && runner.child.signalCode === null) runner.child.kill();
        await runner.closed;
    }
});

test('embedded dsh plugin stays alive while its parent pid exists', async t => {
    const runner = spawnPluginRunner(await writePlugin(t), process.pid);
    try {
        const outcome = await waitForClose(runner.closed, 5100);
        assert.equal(outcome.closed, false, 'plugin exited while parent was alive');
    } finally {
        if (runner.child.exitCode === null && runner.child.signalCode === null) runner.child.kill();
        await runner.closed;
    }
});
