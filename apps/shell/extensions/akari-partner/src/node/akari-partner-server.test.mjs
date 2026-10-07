import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
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

test('DeepSeek Harness は dsh web を起動する', () => {
    assert.deepEqual(resolvePartnerProcessLaunch('deepseek', '/usr/local/bin/dsh', 'darwin', {}), { args: ['web'] });
    assert.deepEqual(resolvePartnerProcessLaunch('deepseek', 'C:\\Users\\creator\\.local\\dsh.cmd', 'win32', {
        ComSpec: 'C:\\Windows\\cmd.exe'
    }), {
        executablePath: 'C:\\Windows\\cmd.exe',
        args: ['/d', '/s', '/c', 'C:\\Users\\creator\\.local\\dsh.cmd', 'web']
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
