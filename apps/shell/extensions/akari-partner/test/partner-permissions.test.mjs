import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, utimes, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PARTNER_CATALOG } from '../lib/browser/partner-catalog.js';
import { partnerPermissionArgs, partnerPermissionEnv, normalizePartnerPermissionMode,
    appliedPartnerPermissionMode } from '../lib/common/partner-permissions.js';
import { AkariPartnerServerImpl, probePartnerCliHelp, resolvePartnerProcessLaunch } from '../lib/node/akari-partner-server.js';

const args = {
    claude: [['--permission-mode', 'auto'], ['--dangerously-skip-permissions']],
    codex: [['--approve-for-me'], ['--dangerously-bypass-approvals-and-sandbox']],
    grok: [['--permission-mode', 'auto'], ['--always-approve']],
    devin: [['--permission-mode', 'smart'], ['--permission-mode', 'bypass']],
    cursor: [['--auto-review'], ['--yolo']],
    copilot: [['--allow-all'], ['--allow-all']],
    antigravity: [['--dangerously-skip-permissions'], ['--dangerously-skip-permissions']],
    commandcode: [['--yolo'], ['--yolo']],
    opencode: [[], ['--auto']],
    pi: [['--approve'], ['--approve']],
    deepseek: [[], []]
};

test('カタログの全 agent × 3 モードが対応表と一致する', () => {
    assert.deepEqual(new Set(PARTNER_CATALOG.map(entry => entry.agent)), new Set(Object.keys(args)));
    for (const [agent, [auto, bypass]] of Object.entries(args)) {
        assert.deepEqual(partnerPermissionArgs(agent, 'auto'), auto, `${agent} auto`);
        assert.deepEqual(partnerPermissionArgs(agent, 'ask'), [], `${agent} ask`);
        assert.deepEqual(partnerPermissionArgs(agent, 'bypass'), bypass, `${agent} bypass`);
        assert.deepEqual(partnerPermissionEnv(agent, 'auto'), {}, `${agent} auto env`);
        assert.deepEqual(partnerPermissionEnv(agent, 'ask'), {}, `${agent} ask env`);
        assert.deepEqual(partnerPermissionEnv(agent, 'bypass'),
            agent === 'deepseek' ? { DSH_PERMISSION_MODE: 'danger-full-access' } : {}, `${agent} bypass env`);
    }
    assert.equal(appliedPartnerPermissionMode('copilot', 'auto', ['--allow-all']), 'bypass');
    assert.equal(appliedPartnerPermissionMode('claude', 'auto', []), 'ask');
});

test('不正な RPC 設定値は auto に戻す', async t => {
    for (const value of [undefined, null, 'AUTO', 'danger-full-access', {}, 1]) {
        assert.equal(normalizePartnerPermissionMode(value), 'auto');
    }
    const root = await mkdtemp(join(tmpdir(), 'akari-permission-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const executable = join(root, 'claude.exe');
    await writeFile(executable, 'fake executable');
    class Server extends AkariPartnerServerImpl {
        async probeCliHelp() { return { kind: 'ok', help: '--permission-mode <MODE>' }; }
        resolveCliPathEnv() { return {}; }
        resolveMediaBinEnv() { return {}; }
    }
    const launch = await new Server().prepareLaunch('claude', executable, 'invalid');
    assert.deepEqual(launch.args, ['--permission-mode', 'auto']);
    assert.equal(launch.appliedPermissionMode, 'auto');
});

test('時間切れ・失敗は覚えず次回再確認し、正常な --help は更新時刻まで覚える', async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-permission-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const executable = join(root, 'codex.exe');
    await writeFile(executable, 'fake executable');
    class Server extends AkariPartnerServerImpl {
        probes = 0;
        results = [
            { kind: 'timeout' }, { kind: 'failed' },
            { kind: 'ok', help: '--help only' }, { kind: 'ok', help: '--approve-for-me' }
        ];
        async probeCliHelp() { this.probes++; return this.results.shift(); }
        resolveCliPathEnv() { return {}; }
        resolveMediaBinEnv() { return {}; }
    }
    const server = new Server();
    const timeout = await server.prepareLaunch('codex', executable, 'auto');
    assert.deepEqual(timeout.args, []);
    assert.equal(timeout.appliedPermissionMode, 'ask');
    assert.match(timeout.log[0], /確認が時間切れ/);
    const failed = await server.prepareLaunch('codex', executable, 'auto');
    assert.deepEqual(failed.args, []);
    assert.match(failed.log[0], /確認に失敗/);
    const missing = await server.prepareLaunch('codex', executable, 'auto');
    assert.deepEqual(missing.args, []);
    assert.match(missing.log[0], /フラグが無い/);
    await server.prepareLaunch('codex', executable, 'auto');
    assert.equal(server.probes, 3, '正常に出た help だけ同じパスと更新時刻でキャッシュする');
    await utimes(executable, new Date(1000), new Date(Date.now() + 10_000));
    const updated = await server.prepareLaunch('codex', executable, 'auto');
    assert.deepEqual(updated.args, ['--approve-for-me']);
    assert.equal(server.probes, 4);
    await server.prepareLaunch('codex', executable, 'auto');
    assert.equal(server.probes, 4);
});

test('非同期の --help 確認中に他の backend 処理が進む', async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-permission-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const executable = join(root, 'codex.exe');
    await writeFile(executable, 'fake executable');
    let finishProbe;
    let startedProbe;
    const started = new Promise(resolve => { startedProbe = resolve; });
    class Server extends AkariPartnerServerImpl {
        probeCliHelp() { startedProbe(); return new Promise(resolve => { finishProbe = resolve; }); }
        resolveCliPathEnv() { return {}; }
        resolveMediaBinEnv() { return {}; }
    }
    const server = new Server();
    const pending = server.prepareLaunch('codex', executable, 'auto');
    await started;
    assert.equal(typeof finishProbe, 'function');
    const other = await server.prepareLaunch('deepseek', executable, 'auto');
    assert.deepEqual(other.args, []);
    finishProbe({ kind: 'ok', help: '--approve-for-me' });
    assert.deepEqual((await pending).args, ['--approve-for-me']);
});

test('execFile の 15 秒打ち切り・異常終了・空出力を区別する', async () => {
    const executable = 'C:\\fake\\codex.exe';
    const calls = [];
    const run = (error, stdout = '') => (command, argv, options, callback) => {
        calls.push({ command, argv, options });
        setTimeout(() => callback(error, stdout, ''), 10);
    };
    let progressed = false;
    const pending = probePartnerCliHelp(executable, 'win32', {}, run(null, '--approve-for-me'));
    setImmediate(() => { progressed = true; });
    assert.deepEqual(await pending, { kind: 'ok', help: '--approve-for-me' });
    assert.equal(progressed, true);
    assert.equal(calls[0].options.timeout, 15_000);
    assert.deepEqual(await probePartnerCliHelp(executable, 'win32', {}, run(Object.assign(new Error('timeout'), { killed: true }), '--approve-for-me')),
        { kind: 'timeout' });
    assert.deepEqual(await probePartnerCliHelp(executable, 'win32', {}, run(Object.assign(new Error('exit 1'), { code: 1 }), '--approve-for-me')),
        { kind: 'failed' });
    assert.deepEqual(await probePartnerCliHelp(executable, 'win32', {}, run(Object.assign(new Error('output too large'),
        { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', killed: true }))), { kind: 'failed' });
    assert.deepEqual(await probePartnerCliHelp(executable, 'win32', {}, run(null, '')),
        { kind: 'failed' });
    assert.deepEqual(await probePartnerCliHelp(executable, 'win32', {}, () => { throw new Error('spawn failed'); }),
        { kind: 'failed' });
});

test('偽の実行ファイルの --help 応答でフラグを確認する', async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-permission-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const directory = join(root, 'fake cli');
    await mkdir(directory);
    const executable = join(directory, process.platform === 'win32' ? 'codex.cmd' : 'codex');
    if (process.platform === 'win32') {
        await writeFile(executable, '@echo off\r\nif "%1"=="--help" echo --approve-for-me\r\n');
    } else {
        await writeFile(executable, '#!/bin/sh\nif [ "$1" = "--help" ]; then echo --approve-for-me; fi\n');
        await chmod(executable, 0o755);
    }
    const calls = [];
    const help = await probePartnerCliHelp(executable, process.platform, process.env, (command, argv, options, callback) => {
        calls.push({ command, argv, options });
        setImmediate(() => callback(null, '--approve-for-me\n', ''));
    });
    assert.deepEqual(help, { kind: 'ok', help: '--approve-for-me' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.timeout, 15_000);
    assert.ok([calls[0].command, ...calls[0].argv].join(' ').includes(executable));
});

test('Windows .cmd/.bat は権限引数を cmd.exe 経由で渡し、メタ文字を help に渡さない', async () => {
    for (const extension of ['cmd', 'bat']) {
        const shim = `C:\\User Folder\\claude.${extension}`;
        assert.deepEqual(resolvePartnerProcessLaunch('claude', shim, 'win32', { ComSpec: 'cmd.exe' },
            ['--permission-mode', 'auto']), {
            executablePath: 'cmd.exe', args: ['/d', '/s', '/c', shim, '--permission-mode', 'auto']
        });
        const calls = [];
        await probePartnerCliHelp(shim, 'win32', { ComSpec: 'cmd.exe' }, (command, argv, options, callback) => {
            calls.push({ command, argv, options }); setImmediate(() => callback(null, '--permission-mode', ''));
        });
        assert.deepEqual(calls[0].argv, ['/d', '/s', '/c', `""${shim}" "--help""`]);
        assert.equal(calls[0].options.windowsVerbatimArguments, true);
    }
    assert.deepEqual(await probePartnerCliHelp('C:\\unsafe&name.cmd', 'win32', {}, () => { throw new Error('must not run'); }),
        { kind: 'failed' });
});
