import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn as spawnProcess, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { DshWebEarlyExitError, launchDshWeb, parseDshWebUrlLine, buildDshWebArgs } from '../../lib/node/dsh-web-launcher.js';
import { DSH_WEB_PORT_MIN, DSH_WEB_PORT_MAX, normalizeWebCwdKey, dshWebPortCandidates,
    selectDshWebPort } from '../../lib/node/dsh-web-port.js';
import { maskToken, maskDshOutput } from '../../lib/common/dsh-output-mask.js';
import { AkariPartnerServerImpl, resolvePartnerProcessLaunch } from '../../lib/node/akari-partner-server.js';

test('同意なしの導入要求は説明表を含む結果になる', async () => {
    class StubServer extends AkariPartnerServerImpl {
        spawnBootstrapProcess() {
            const child = new EventEmitter();
            child.stdout = new PassThrough();
            child.stderr = new PassThrough();
            child.kill = () => undefined;
            setImmediate(() => {
                child.stdout.write('{"consentRequired":true}\n');
                child.emit('exit', 0);
            });
            return child;
        }
    }
    const result = await new StubServer().bootstrap('claude');
    assert.equal(result.consentRequired, true);
    assert.equal(result.disclosure.name, 'Claude Code');
    assert.ok(result.disclosure.provider);
    assert.ok(result.disclosure.termsUrl);
});

test('Windows の Command Code npm shim は cmd.exe 経由で PTY 起動する', () => {
    assert.deepEqual(
        resolvePartnerProcessLaunch(
            'commandcode',
            'C:\\Users\\creator\\AppData\\Roaming\\npm\\command-code.cmd',
            'win32',
            { ComSpec: 'C:\\Windows\\System32\\cmd.exe' }
        ),
        {
            executablePath: 'C:\\Windows\\System32\\cmd.exe',
            args: [
                '/d',
                '/s',
                '/c',
                'C:\\Users\\creator\\AppData\\Roaming\\npm\\command-code.cmd'
            ]
        }
    );
});

test('POSIX と他パートナーの起動計画は従来どおり変更しない', () => {
    assert.deepEqual(resolvePartnerProcessLaunch('commandcode', '/opt/bin/command-code', 'darwin', {}), { args: [] });
    assert.deepEqual(resolvePartnerProcessLaunch('codex', 'C:\\tools\\codex.exe', 'win32', {}), { args: [] });
});

test('Windows の Pi npm shim も cmd.exe 経由で起動し、Devin は引数なし', () => {
    assert.deepEqual(resolvePartnerProcessLaunch('pi', 'C:\\Users\\creator\\.local\\pi.cmd', 'win32', { ComSpec: 'C:\\Windows\\cmd.exe' }), {
        executablePath: 'C:\\Windows\\cmd.exe', args: ['/d', '/s', '/c', 'C:\\Users\\creator\\.local\\pi.cmd']
    });
    assert.deepEqual(resolvePartnerProcessLaunch('devin', 'C:\\devin\\devin.exe', 'win32', {}), { args: [] });
});

test('DeepSeek Harness の PTY 起動計画は web 引数を含めない', () => {
    assert.deepEqual(resolvePartnerProcessLaunch('deepseek', '/usr/local/bin/dsh', 'darwin', {}), { args: [] });
    assert.deepEqual(resolvePartnerProcessLaunch('deepseek', 'C:\\Users\\creator\\.local\\dsh.cmd', 'win32', {
        ComSpec: 'C:\\Windows\\cmd.exe'
    }), {
        executablePath: 'C:\\Windows\\cmd.exe',
        args: ['/d', '/s', '/c', 'C:\\Users\\creator\\.local\\dsh.cmd']
    });
});

test('Windows の Claude npm shim は cmd.exe 経由、ネイティブ exe は直接起動する', () => {
    const shim = 'C:\\Users\\creator\\AppData\\Roaming\\npm\\claude.cmd';
    assert.deepEqual(resolvePartnerProcessLaunch('claude', shim, 'win32', { ComSpec: 'C:\\Windows\\cmd.exe' }), {
        executablePath: 'C:\\Windows\\cmd.exe', args: ['/d', '/s', '/c', shim]
    });
    assert.deepEqual(resolvePartnerProcessLaunch('claude', 'C:\\tools\\claude.exe', 'win32', {}), { args: [] });
    assert.deepEqual(resolvePartnerProcessLaunch('claude', 'C:\\tools\\claude.bat', 'win32', { ComSpec: 'C:\\Windows\\cmd.exe' }), {
        executablePath: 'C:\\Windows\\cmd.exe', args: ['/d', '/s', '/c', 'C:\\tools\\claude.bat']
    });
});

function stopProcessTree(child) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32') {
        const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore', windowsHide: true
        });
        if (result.status !== 0) child.kill();
    } else {
        try { process.kill(-child.pid, 'SIGTERM'); }
        catch { child.kill(); }
    }
}

// The fake executable delegates to this fixture so the success case can bind port 0.
async function fakeExecutable(t) {
    const root = await mkdtemp(join(tmpdir(), 'akari-dsh-launch-'));
    const children = [];
    t.after(async () => {
        for (const { child, closed } of children) {
            stopProcessTree(child);
            await closed;
        }
        await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });
    const trackChild = child => {
        const closed = new Promise(resolve => child.once('close', resolve));
        children.push({ child, closed });
        return child;
    };
    const scriptPath = join(root, 'fixture.cjs');
    await writeFile(scriptPath, `
const mode = process.env.AKARI_TEST_DSH_MODE;
if (mode === 'success') {
    const server = require('node:http').createServer((_request, response) => response.end('ok'));
    server.listen(0, '127.0.0.1', () => {
        console.log('dsh web: http://127.0.0.1:' + server.address().port + '/?token=abc (LAN: ignored)');
        setTimeout(() => server.close(), 200);
    });
} else if (mode === 'timeout') {
    setInterval(() => {}, 1000);
} else {
    console.error('fixture stderr failure');
    process.exitCode = 7;
}
`);
    const executablePath = join(root, process.platform === 'win32' ? 'dsh.cmd' : 'dsh');
    if (process.platform === 'win32') {
        await writeFile(executablePath, '@echo off\r\n"%AKARI_TEST_NODE%" "%AKARI_TEST_SCRIPT%"\r\n');
    } else {
        await writeFile(executablePath, '#!/bin/sh\nexec "$AKARI_TEST_NODE" "$AKARI_TEST_SCRIPT"\n');
        await chmod(executablePath, 0o755);
    }
    return { executablePath, scriptPath, root, trackChild };
}

function simulatedSpawn(mode) {
    const child = new EventEmitter();
    child.pid = 43217;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    setImmediate(() => {
        if (mode === 'success') child.stdout.write('dsh web: http://127.0.0.1:42317/?token=abc (LAN: ignored)\n');
        if (mode === 'error') {
            child.emit('exit', 7);
            child.stderr.write('fixture stderr failure');
            setImmediate(() => child.emit('close', 7));
        }
    });
    return child;
}

async function launchFixture(t, mode, timeoutMs = 1500, port) {
    const fixture = await fakeExecutable(t);
    const logs = [];
    const stopped = [];
    let realChild;
    let simulated = false;
    let spawnArgs;
    const env = {
        ...process.env, AKARI_TEST_NODE: process.execPath,
        AKARI_TEST_SCRIPT: fixture.scriptPath, AKARI_TEST_DSH_MODE: mode
    };
    const stop = pid => {
        stopped.push(pid);
        if (simulated) return;
        if (realChild?.pid === pid) stopProcessTree(realChild);
    };
    const input = {
        executablePath: fixture.executablePath, cwd: fixture.root, env,
        patchPath: join(fixture.root, 'akari.patch.yml'), platform: process.platform,
        timeoutMs, port, log: line => logs.push(line), stop,
        spawn: (command, args, options) => {
            spawnArgs = args;
            realChild = fixture.trackChild(spawnProcess(command, args, options));
            return realChild;
        }
    };
    try {
        const result = await launchDshWeb(input);
        return { result, logs, stopped, spawnArgs,
            expectedArgs: buildDshWebArgs(fixture.executablePath, input.patchPath, process.platform, env, port).args };
    } catch (error) {
        if (!/EPERM/.test(String(error)) || realChild?.pid) throw error;
        simulated = true;
        const fallback = { ...input, spawn: (_command, args) => { spawnArgs = args; return simulatedSpawn(mode); } };
        const result = await launchDshWeb(fallback);
        return { result, logs, stopped, spawnArgs,
            expectedArgs: buildDshWebArgs(fixture.executablePath, input.patchPath, process.platform, env, port).args };
    }
}

test('dsh web arguments keep the patch immediately after the profile', () => {
    const patchPath = join(tmpdir(), 'akari.patch.yml');
    const expected = ['--profile', 'web', '--patch', patchPath, '--no-open', '--port', '20042'];
    const posix = buildDshWebArgs('dsh', patchPath, 'linux', {}, 20042);
    assert.deepEqual(posix, { command: 'dsh', args: expected });
    const shim = join(tmpdir(), 'dsh.cmd');
    const windows = buildDshWebArgs(shim, patchPath, 'win32', { ComSpec: 'cmd.exe' }, 20042);
    assert.deepEqual(windows, { command: 'cmd.exe',
        args: ['/d', '/s', '/c', '"' + [shim, ...expected].map(arg => `"${arg}"`).join(' ') + '"'],
        windowsVerbatimArguments: true });
    assert.deepEqual(buildDshWebArgs('dsh', patchPath, 'linux', {}).args,
        ['--profile', 'web', '--patch', patchPath, '--no-open', '--port', '0']);
    for (const port of [0, 19999, 45000, 65536, 20000.5, NaN, Infinity, '20042']) {
        assert.throws(() => buildDshWebArgs('dsh', patchPath, 'linux', {}, port), /Invalid dsh web port/);
    }
});

test('project port candidates are stable, distinct, in range, and use the normalized cwd key', () => {
    const first = normalizeWebCwdKey('C:\\Work\\Project\\', 'win32');
    assert.equal(first, normalizeWebCwdKey('c:/work/project', 'win32'));
    const candidates = dshWebPortCandidates(first);
    assert.deepEqual(candidates, dshWebPortCandidates(first));
    assert.equal(candidates.length, 4);
    assert.equal(new Set(candidates).size, 4);
    assert.ok(candidates.every(port => Number.isInteger(port) && port >= DSH_WEB_PORT_MIN && port <= DSH_WEB_PORT_MAX));
    assert.notEqual(candidates[0], dshWebPortCandidates(normalizeWebCwdKey('C:/Work/Other', 'win32'))[0]);
});

test('four distinct in-range ports are produced for 2000 project keys', () => {
    for (let index = 0; index < 2000; index++) {
        const candidates = dshWebPortCandidates(`C:/work/project-${index}`);
        assert.equal(new Set(candidates).size, 4);
        assert.ok(candidates.every(port => port >= DSH_WEB_PORT_MIN && port <= DSH_WEB_PORT_MAX));
    }
});

test('busy candidates advance in hash order and exhaustion uses automatic port', async () => {
    const key = normalizeWebCwdKey('C:/Work/Project', 'win32');
    const candidates = dshWebPortCandidates(key);
    const visited = [];
    const next = await selectDshWebPort(key, async port => {
        visited.push(port);
        return port === candidates[1];
    });
    assert.deepEqual(visited, candidates.slice(0, 2));
    assert.deepEqual(next, { port: candidates[1], skipped: [candidates[0]] });
    assert.deepEqual(await selectDshWebPort(key, async () => false), { skipped: candidates });
});

test('a port occupied on loopback is skipped by the real listen probe', async t => {
    const key = normalizeWebCwdKey('C:/Work/OccupiedPort', 'win32');
    const [first] = dshWebPortCandidates(key);
    const blocker = createServer();
    try {
        await new Promise((resolve, reject) => {
            blocker.once('error', reject);
            blocker.listen(first, '127.0.0.1', resolve);
        });
    } catch (error) {
        if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
            t.skip(`fixture port ${first} cannot be reserved`);
            return;
        }
        throw error;
    }
    try {
        const choice = await selectDshWebPort(key);
        assert.equal(choice.skipped[0], first);
        assert.notEqual(choice.port, first);
    } finally {
        await new Promise(resolve => blocker.close(resolve));
    }
});

for (const host of ['0.0.0.0', '::']) {
    test(`a port occupied on ${host} is skipped`, async t => {
        const key = normalizeWebCwdKey(`C:/Work/OccupiedPort-${host}`, 'win32');
        const [first] = dshWebPortCandidates(key);
        const blocker = createServer();
        try {
            await new Promise((resolve, reject) => {
                blocker.once('error', reject);
                blocker.listen({ port: first, host, ipv6Only: host === '::' }, resolve);
            });
        } catch (error) {
            if (['EADDRINUSE', 'EACCES', 'EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes(error.code)) {
                t.skip(`fixture cannot reserve ${host}:${first}`);
                return;
            }
            throw error;
        }
        try {
            const choice = await selectDshWebPort(key);
            assert.equal(choice.skipped[0], first);
        } finally {
            await new Promise(resolve => blocker.close(resolve));
        }
    });
}

test('Windows cmd quoting keeps spaced paths in one argument and rejects metacharacters', () => {
    const shim = join(tmpdir(), 'user with spaces', 'dsh.cmd');
    const patch = join(tmpdir(), 'user with spaces', 'akari.patch.yml');
    const result = buildDshWebArgs(shim, patch, 'win32', { ComSpec: 'cmd.exe' });
    assert.equal(result.args.length, 4);
    assert.ok(result.args[3].startsWith(`""${shim}" "--profile" "web" "--patch" "${patch}"`));
    assert.equal(result.windowsVerbatimArguments, true);
    for (const character of ['&', '^', '%', '!', '"', '\n', '\r']) {
        const unsafeShim = shim.replace(/\.cmd$/, `${character}.cmd`);
        assert.throws(() => buildDshWebArgs(unsafeShim, patch, 'win32', {}), error => {
            assert.match(error.message, /実行ファイルのパス/);
            assert.ok(error.message.includes(unsafeShim));
            return true;
        });
        assert.throws(() => buildDshWebArgs(shim, patch + character, 'win32', {}), error => {
            assert.match(error.message, /パッチのパス/);
            assert.ok(error.message.includes(patch));
            return true;
        });
        assert.deepEqual(buildDshWebArgs(unsafeShim, patch, 'linux', {}).args,
            ['--profile', 'web', '--patch', patch, '--no-open', '--port', '0']);
        assert.equal(buildDshWebArgs(shim + character, patch, 'win32', {}).command, shim + character);
    }
    const native = buildDshWebArgs('C:\\tools\\dsh.exe', patch + '&', 'win32', {});
    assert.equal(native.command, 'C:\\tools\\dsh.exe');
    assert.equal(native.args[3], patch + '&');
});

test('dsh web URL parser ignores the LAN suffix and log masking hides the token', () => {
    const line = 'dsh web: http://127.0.0.1:42317/?token=abc (LAN: ignored)';
    assert.equal(parseDshWebUrlLine(line), 'http://127.0.0.1:42317/?token=abc');
    assert.equal(parseDshWebUrlLine('other output'), undefined);
    assert.equal(maskToken(line), 'dsh web: http://127.0.0.1:42317/?token=*** (LAN: ignored)');
    assert.equal(maskDshOutput('token=abc key=fixture-secret', ['fixture-secret']), 'token=*** key=***');
});

test('fake dsh executable returns a nonzero port, token and pid while masking the log', async t => {
    const { result, logs, spawnArgs, expectedArgs } = await launchFixture(t, 'success', 1500, 23456);
    assert.deepEqual(spawnArgs, expectedArgs);
    assert.equal(new URL(result.url).searchParams.get('token'), 'abc');
    assert.ok(Number(new URL(result.url).port) > 0);
    assert.ok(result.pid > 0);
    assert.ok(logs.some(line => line.includes('token=***')));
    assert.ok(logs.every(line => !line.includes('token=abc')));
});

test('launchDshWeb passes --port 0 to spawn when no port is specified', async t => {
    const { spawnArgs, expectedArgs } = await launchFixture(t, 'success');
    assert.deepEqual(spawnArgs, expectedArgs);
    assert.ok(spawnArgs.join(' ').includes('0'));
});

test('silent fake dsh executable times out and stops its pid', async t => {
    const fixture = await fakeExecutable(t);
    const stopped = [];
    let child;
    let simulated = false;
    const env = {
        ...process.env, AKARI_TEST_NODE: process.execPath,
        AKARI_TEST_SCRIPT: fixture.scriptPath, AKARI_TEST_DSH_MODE: 'timeout'
    };
    const input = {
        executablePath: fixture.executablePath, cwd: fixture.root, env,
        patchPath: join(fixture.root, 'akari.patch.yml'), platform: process.platform,
        timeoutMs: 500, log: () => undefined,
        stop: pid => {
            stopped.push(pid);
            if (simulated) return;
            if (child?.pid === pid) stopProcessTree(child);
        },
        spawn: (command, args, options) => {
            child = fixture.trackChild(spawnProcess(command, args, options));
            return child;
        }
    };
    const assertTimeout = error => {
        assert.ok(!(error instanceof DshWebEarlyExitError));
        assert.match(error.message, /dsh web startup timed out/);
        return true;
    };
    try {
        await assert.rejects(launchDshWeb(input), assertTimeout);
    } catch (error) {
        if (!/EPERM/.test(String(error)) || child?.pid) throw error;
        simulated = true;
        await assert.rejects(launchDshWeb({ ...input, spawn: () => simulatedSpawn('timeout') }), assertTimeout);
    }
    assert.equal(stopped.length, 1);
    assert.ok(stopped[0] > 0);
});

test('spawn error is not an early process exit', async () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const input = {
        executablePath: 'dsh', cwd: process.cwd(), env: process.env,
        patchPath: join(tmpdir(), 'akari.patch.yml'), platform: process.platform,
        timeoutMs: 1000, log: () => undefined, stop: () => undefined,
        spawn: () => {
            setImmediate(() => child.emit('error', new Error('fixture spawn error')));
            return child;
        }
    };
    await assert.rejects(launchDshWeb(input), error => {
        assert.ok(!(error instanceof DshWebEarlyExitError));
        assert.match(error.message, /fixture spawn error/);
        return true;
    });
});

test('fake dsh executable reports stderr on nonzero exit', async t => {
    await assert.rejects(launchFixture(t, 'error').then(value => value.result), error => {
        assert.ok(error instanceof DshWebEarlyExitError);
        assert.match(error.message, /fixture stderr failure/);
        return true;
    });
});
