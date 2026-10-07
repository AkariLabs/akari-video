import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn as spawnProcess, spawnSync } from 'node:child_process';
import { launchDshWeb, parseDshWebUrlLine, buildDshWebArgs, maskToken } from '../../lib/node/dsh-web-launcher.js';
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
            child.stderr.write('fixture stderr failure\n');
            setImmediate(() => child.emit('exit', 7));
        }
    });
    return child;
}

async function launchFixture(t, mode, timeoutMs = 1500) {
    const fixture = await fakeExecutable(t);
    const logs = [];
    const stopped = [];
    let realChild;
    let simulated = false;
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
        timeoutMs, log: line => logs.push(line), stop,
        spawn: (command, args, options) => {
            realChild = fixture.trackChild(spawnProcess(command, args, options));
            return realChild;
        }
    };
    try {
        return { result: await launchDshWeb(input), logs, stopped };
    } catch (error) {
        if (!/EPERM/.test(String(error)) || realChild?.pid) throw error;
        simulated = true;
        const fallback = { ...input, spawn: () => simulatedSpawn(mode) };
        return { result: await launchDshWeb(fallback), logs, stopped };
    }
}

test('dsh web arguments keep the patch immediately after the profile', () => {
    const patchPath = join(tmpdir(), 'akari.patch.yml');
    const expected = ['--profile', 'web', '--patch', patchPath, '--no-open', '--port', '0'];
    const posix = buildDshWebArgs('dsh', patchPath, 'linux', {});
    assert.deepEqual(posix, { command: 'dsh', args: expected });
    const shim = join(tmpdir(), 'dsh.cmd');
    const windows = buildDshWebArgs(shim, patchPath, 'win32', { ComSpec: 'cmd.exe' });
    assert.deepEqual(windows, { command: 'cmd.exe', args: ['/d', '/s', '/c', shim, ...expected] });
});

test('dsh web URL parser ignores the LAN suffix and log masking hides the token', () => {
    const line = 'dsh web: http://127.0.0.1:42317/?token=abc (LAN: ignored)';
    assert.equal(parseDshWebUrlLine(line), 'http://127.0.0.1:42317/?token=abc');
    assert.equal(parseDshWebUrlLine('other output'), undefined);
    assert.equal(maskToken(line), 'dsh web: http://127.0.0.1:42317/?token=*** (LAN: ignored)');
});

test('fake dsh executable returns a nonzero port, token and pid while masking the log', async t => {
    const { result, logs } = await launchFixture(t, 'success');
    assert.equal(new URL(result.url).searchParams.get('token'), 'abc');
    assert.ok(Number(new URL(result.url).port) > 0);
    assert.ok(result.pid > 0);
    assert.ok(logs.some(line => line.includes('token=***')));
    assert.ok(logs.every(line => !line.includes('token=abc')));
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
    try {
        await assert.rejects(launchDshWeb(input), /dsh web startup timed out/);
    } catch (error) {
        if (!/EPERM/.test(String(error)) || child?.pid) throw error;
        simulated = true;
        await assert.rejects(launchDshWeb({ ...input, spawn: () => simulatedSpawn('timeout') }), /dsh web startup timed out/);
    }
    assert.equal(stopped.length, 1);
    assert.ok(stopped[0] > 0);
});

test('fake dsh executable reports stderr on nonzero exit', async t => {
    await assert.rejects(launchFixture(t, 'error').then(value => value.result), /fixture stderr failure/);
});
