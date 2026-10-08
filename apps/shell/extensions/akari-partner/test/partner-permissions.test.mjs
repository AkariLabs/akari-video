import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, utimes, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { PARTNER_CATALOG } from '../lib/browser/partner-catalog.js';
import { partnerPermissionArgs, partnerPermissionEnv, normalizePartnerPermissionMode,
    appliedPartnerPermissionMode } from '../lib/common/partner-permissions.js';
import { AkariPartnerServerImpl, partnerHelpSupportsArgs, probePartnerCliHelp, resolvePartnerProcessLaunch,
    stopPartnerCliHelpProcess } from '../lib/node/akari-partner-server.js';

function fakeSpawn(output = '', code = 0, delay = 0) {
    const calls = [];
    const run = (command, argv, options) => {
        calls.push({ command, argv, options });
        const child = new EventEmitter();
        child.pid = 1234;
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = () => true;
        setTimeout(() => { child.stdout.write(output); child.emit('close', code, null); }, delay);
        return child;
    };
    return { run, calls };
}

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
    assert.equal(appliedPartnerPermissionMode('claude', 'auto', []), 'default');
    assert.equal(appliedPartnerPermissionMode('opencode', 'auto', []), 'default');
    assert.equal(appliedPartnerPermissionMode('deepseek', 'ask', []), 'default');
    for (const agent of ['copilot', 'antigravity', 'commandcode', 'pi']) {
        assert.equal(appliedPartnerPermissionMode(agent, 'auto', partnerPermissionArgs(agent, 'auto')), 'bypass', agent);
    }
    for (const mode of ['auto', 'ask', 'bypass']) {
        assert.equal(appliedPartnerPermissionMode('pi', mode, []), 'bypass');
    }
    for (const key of ['__proto__', 'constructor', 'toString']) {
        assert.deepEqual(partnerPermissionArgs(key, 'auto'), []);
    }
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
        async probeCliHelp() { return { kind: 'ok', help: '--permission-mode <MODE>\n  (choices: "auto", "bypass")' }; }
        resolveCliPathEnv() { return {}; }
        resolveMediaBinEnv() { return {}; }
    }
    const launch = await new Server().prepareLaunch('claude', executable, 'invalid');
    assert.deepEqual(launch.args, ['--permission-mode', 'auto']);
    assert.equal(launch.appliedPermissionMode, 'auto');
});

test('prepareLaunch は値付きフラグを help の選択肢で確認する', async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-permission-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const executable = join(root, 'claude.exe');
    await writeFile(executable, 'fake executable');
    class Server extends AkariPartnerServerImpl {
        constructor(help) { super(); this.help = help; }
        async probeCliHelp() { return { kind: 'ok', help: this.help }; }
        resolveCliPathEnv() { return {}; }
        resolveMediaBinEnv() { return {}; }
    }
    const oldHelp = await new Server('--permission-mode <MODE>').prepareLaunch('claude', executable, 'auto');
    assert.deepEqual(oldHelp.args, []);
    assert.equal(oldHelp.appliedPermissionMode, 'default');
    const accepted = await new Server('--permission-mode <MODE>\n  (choices: "ask", "auto")')
        .prepareLaunch('claude', executable, 'auto');
    assert.deepEqual(accepted.args, ['--permission-mode', 'auto']);
    assert.equal(accepted.appliedPermissionMode, 'auto');
});

test('時間切れ・失敗は覚えず次回再確認し、正常な --help は更新時刻まで覚える', async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-permission-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const executable = join(root, 'codex.exe');
    await writeFile(executable, 'fake executable');
    class Server extends AkariPartnerServerImpl {
        probes = 0;
        pathValue = '';
        results = [
            { kind: 'timeout' }, { kind: 'failed' },
            { kind: 'ok', help: '--help only' }, { kind: 'ok', help: '--approve-for-me' }
        ];
        async probeCliHelp() { this.probes++; return this.results.shift(); }
        resolveCliPathEnv() { return this.pathValue ? { PATH: this.pathValue } : {}; }
        resolveMediaBinEnv() { return {}; }
    }
    const server = new Server();
    const timeout = await server.prepareLaunch('codex', executable, 'auto');
    assert.deepEqual(timeout.args, []);
    assert.equal(timeout.appliedPermissionMode, 'default');
    assert.equal(timeout.permissionFallbackReason, '時間切れ');
    assert.match(timeout.log[0], /確認が時間切れ/);
    const failed = await server.prepareLaunch('codex', executable, 'auto');
    assert.deepEqual(failed.args, []);
    assert.equal(failed.permissionFallbackReason, '確認失敗');
    assert.match(failed.log[0], /確認に失敗/);
    const missing = await server.prepareLaunch('codex', executable, 'auto');
    assert.deepEqual(missing.args, []);
    assert.equal(missing.permissionFallbackReason, 'フラグ無し');
    assert.match(missing.log[0], /フラグが無い/);
    await server.prepareLaunch('codex', executable, 'auto');
    assert.equal(server.probes, 3, '正常に出た help だけ同じパスと更新時刻でキャッシュする');
    await utimes(executable, new Date(1000), new Date(Date.now() + 10_000));
    const updated = await server.prepareLaunch('codex', executable, 'auto');
    assert.deepEqual(updated.args, ['--approve-for-me']);
    assert.equal(server.probes, 4);
    await server.prepareLaunch('codex', executable, 'auto');
    assert.equal(server.probes, 4);
    server.pathValue = 'changed-path';
    server.results.push({ kind: 'ok', help: '--approve-for-me' });
    await server.prepareLaunch('codex', executable, 'auto');
    assert.equal(server.probes, 5, 'PTY PATH が変わった場合は help を再確認する');
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

test('help probe は専用 Node を含む PTY と同じ PATH を受け取る', async t => {
    const root = await mkdtemp(join(tmpdir(), 'akari-permission-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const oldHome = process.env.AKARI_HOME;
    process.env.AKARI_HOME = root;
    t.after(() => { if (oldHome === undefined) delete process.env.AKARI_HOME; else process.env.AKARI_HOME = oldHome; });
    const nodeRoot = join(root, 'runtime', 'node', 'v24.21.0');
    const bin = process.platform === 'win32' ? nodeRoot : join(nodeRoot, 'bin');
    await mkdir(bin, { recursive: true });
    await Promise.all([
        writeFile(join(nodeRoot, 'command-code-installed'), ''),
        writeFile(join(bin, process.platform === 'win32' ? 'node.exe' : 'node'), ''),
        writeFile(join(bin, process.platform === 'win32' ? 'npm.cmd' : 'npm'), '')
    ]);
    const executable = join(root, 'command-code.exe');
    await writeFile(executable, 'fake executable');
    let probeEnv;
    class Server extends AkariPartnerServerImpl {
        resolveCliPathEnv() { return { PATH: process.platform === 'win32' ? 'C:\\base' : '/base' }; }
        resolveMediaBinEnv() { return {}; }
        async probeCliHelp(_path, env) { probeEnv = env; return { kind: 'ok', help: '--yolo' }; }
    }
    const launch = await new Server().prepareLaunch('commandcode', executable, 'auto');
    assert.deepEqual(launch.args, ['--yolo']);
    assert.equal(probeEnv.PATH, launch.env.PATH);
    assert.ok(probeEnv.PATH.startsWith(bin), probeEnv.PATH);
});

test('help probe は非同期で、時間切れに子孫プロセスを止める', async () => {
    const executable = 'C:\\fake\\codex.exe';
    const fake = fakeSpawn('--approve-for-me', 0, 10);
    let progressed = false;
    const pending = probePartnerCliHelp(executable, 'win32', {}, fake.run);
    setImmediate(() => { progressed = true; });
    assert.deepEqual(await pending, { kind: 'ok', help: '--approve-for-me' });
    assert.equal(progressed, true);
    assert.equal(fake.calls[0].options.windowsHide, true);
    assert.deepEqual(await probePartnerCliHelp(executable, 'win32', {}, fakeSpawn('--approve-for-me', 1).run),
        { kind: 'failed' });
    assert.deepEqual(await probePartnerCliHelp(executable, 'win32', {}, fakeSpawn('').run), { kind: 'failed' });
    assert.deepEqual(await probePartnerCliHelp(executable, 'win32', {}, () => { throw new Error('spawn failed'); }),
        { kind: 'failed' });
    const child = new EventEmitter();
    child.pid = 4567;
    child.exitCode = null;
    child.signalCode = null;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { throw new Error('parent-only kill'); };
    let stopped;
    const timeout = await probePartnerCliHelp(executable, 'win32', {}, () => child,
        (pid, platform, found) => { stopped = [pid, platform, found]; }, 5);
    assert.deepEqual(timeout, { kind: 'timeout' });
    assert.deepEqual(stopped, [4567, 'win32', child]);
    child.exitCode = 0;
    stopped = undefined;
    assert.deepEqual(await probePartnerCliHelp(executable, 'win32', {}, () => child,
        () => { stopped = true; }, 5), { kind: 'timeout' });
    assert.equal(stopped, undefined, '終了済みの PID には taskkill を出さない');
    child.exitCode = null;
    child.signalCode = 'SIGTERM';
    assert.deepEqual(await probePartnerCliHelp(executable, 'win32', {}, () => child,
        () => { stopped = true; }, 5), { kind: 'timeout' });
    assert.equal(stopped, undefined, 'シグナルで終了済みの PID も止め直さない');
});

test('Windows は taskkill /T、POSIX は process group を止める', () => {
    const child = { kill: () => assert.fail('fallback should not run') };
    let call;
    stopPartnerCliHelpProcess(4567, 'win32', child, (command, argv, options, callback) => {
        call = { command, argv, options };
        callback(null);
    });
    assert.deepEqual(call.argv, ['/T', '/F', '/PID', '4567']);
    assert.equal(call.command, win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'));
    assert.match(call.command, /^[A-Za-z]:\\/);
    assert.equal(call.options.windowsHide, true);
    stopPartnerCliHelpProcess(4567, 'linux', child, undefined, (pid, signal) => { call = { pid, signal }; });
    assert.deepEqual(call, { pid: -4567, signal: 'SIGKILL' });
});

test('値付きフラグは help の選択肢にも値があるときだけ採用する', () => {
    assert.equal(partnerHelpSupportsArgs('--permission-mode <MODE>', ['--permission-mode', 'auto']), false);
    assert.equal(partnerHelpSupportsArgs('--permission-mode <MODE>\n  (choices: "acceptEdits", "auto", "bypass")',
        ['--permission-mode', 'auto']), true);
    assert.equal(partnerHelpSupportsArgs('--permission-mode <MODE>\n  [possible values: default, smart, bypass]',
        ['--permission-mode', 'smart']), true);
    assert.equal(partnerHelpSupportsArgs('--permission-mode <MODE>\n  (choices: "automatic")',
        ['--permission-mode', 'auto']), false);
    assert.equal(partnerHelpSupportsArgs('--permission-mode <MODE>\n  (choices: "auto")',
        ['--permission-mode', 'smart']), false);
    assert.equal(partnerHelpSupportsArgs('--permission-mode <MODE>\n  (choices: "ask")\n  auto is documented elsewhere',
        ['--permission-mode', 'auto']), false);
    assert.equal(partnerHelpSupportsArgs('--allow-dangerously-skip-permissions',
        ['--dangerously-skip-permissions']), false);
    assert.equal(partnerHelpSupportsArgs('--allow-all-but-sandbox', ['--allow-all']), false);
    assert.equal(partnerHelpSupportsArgs('  --allow-all, --help', ['--allow-all']), true);
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
    const fake = fakeSpawn('--approve-for-me\n');
    const help = await probePartnerCliHelp(executable, process.platform, process.env, fake.run);
    assert.deepEqual(help, { kind: 'ok', help: '--approve-for-me' });
    assert.equal(fake.calls.length, 1);
    assert.ok([fake.calls[0].command, ...fake.calls[0].argv].join(' ').includes(executable));
});

test('Windows .cmd/.bat は権限引数を cmd.exe 経由で渡し、メタ文字を help に渡さない', async () => {
    for (const extension of ['cmd', 'bat']) {
        const shim = `C:\\User Folder\\claude.${extension}`;
        assert.deepEqual(resolvePartnerProcessLaunch('claude', shim, 'win32', { ComSpec: 'cmd.exe' },
            ['--permission-mode', 'auto']), {
            executablePath: 'cmd.exe', args: ['/d', '/s', '/c', shim, '--permission-mode', 'auto']
        });
        const fake = fakeSpawn('--permission-mode');
        await probePartnerCliHelp(shim, 'win32', { ComSpec: 'cmd.exe' }, fake.run);
        assert.deepEqual(fake.calls[0].argv, ['/d', '/s', '/c', `""${shim}" "--help""`]);
        assert.equal(fake.calls[0].options.windowsVerbatimArguments, true);
    }
    for (const name of ['C:\\unsafe&name.cmd', 'C:\\unsafe%name.cmd']) {
        const fake = fakeSpawn('--help');
        assert.deepEqual(await probePartnerCliHelp(name, 'win32', {}, fake.run), { kind: 'failed' });
        assert.equal(fake.calls.length, 0, `${name} を起動しない`);
    }
});
