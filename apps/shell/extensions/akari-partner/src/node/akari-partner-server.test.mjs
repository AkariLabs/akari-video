import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePartnerProcessLaunch } from '../../lib/node/akari-partner-server.js';

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
