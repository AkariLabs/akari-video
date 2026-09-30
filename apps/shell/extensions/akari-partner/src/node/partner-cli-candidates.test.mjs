import test from 'node:test';
import assert from 'node:assert/strict';
import { partnerCliCandidates } from '../../lib/node/partner-cli-candidates.js';
import { bootstrapRunner } from '../../lib/node/bootstrap-runner.js';

test('設定と bootstrap に渡す候補関数は Command Code の正式名と既定配置を共有する', () => {
    const homeDir = '/tmp/akari-candidate-home';
    const env = { PATH: '/tmp/akari-path' };
    assert.deepEqual(partnerCliCandidates('commandcode', { homeDir, platform: 'darwin', env }), [
        `${homeDir}/.local/bin/command-code`, '/opt/homebrew/bin/command-code',
        '/usr/local/bin/command-code', '/usr/bin/command-code', '/tmp/akari-path/command-code'
    ]);
    assert.ok(partnerCliCandidates('grok', { homeDir, platform: 'darwin', env }).includes(`${homeDir}/.grok/bin/grok`));
    assert.ok(partnerCliCandidates('devin', { homeDir, platform: 'win32', env: { PATH: '', LOCALAPPDATA: 'C:\\Local' } })
        .some(candidate => /devin[\\/]cli[\\/]bin[\\/]devin\.exe$/.test(candidate)));
    assert.ok(partnerCliCandidates('pi', { homeDir, platform: 'win32', env: { PATH: '', PATHEXT: '.COM;.EXE;.CMD' } })[0].endsWith('pi.com'));
    assert.ok(partnerCliCandidates('codex', { homeDir, platform: 'win32', env: { PATH: '', PATHEXT: '.COM;.EXE' }, nativeOnly: true })[0].endsWith('codex.exe'));
    assert.match(bootstrapRunner.toString(), /candidatePaths\(config\.agent/);
});

test('Windows の Claude 候補はネイティブ、APPDATA npm、PATH の順で実行可能な拡張子だけを含む', () => {
    const homeDir = '/tmp/akari-candidate-home';
    const env = { APPDATA: '/tmp/akari-appdata', PATH: '/tmp/akari-path', PATHEXT: '.PS1;.JS;.CMD;.EXE;.BAT' };
    const candidates = partnerCliCandidates('claude', { homeDir, platform: 'win32', env });
    assert.deepEqual(candidates, [
        ...['.local/bin', '.claude/bin', '.claude/local'].flatMap(dir =>
            ['.exe', '.cmd', '.bat'].map(ext => `${homeDir}/${dir}/claude${ext}`)),
        ...['.exe', '.cmd', '.bat'].map(ext => `/tmp/akari-appdata/npm/claude${ext}`),
        ...['.exe', '.cmd', '.bat'].map(ext => `/tmp/akari-path/claude${ext}`)
    ]);
    assert.ok(candidates.every(candidate => /\.(?:exe|cmd|bat)$/.test(candidate)));
    assert.deepEqual(partnerCliCandidates('claude', { homeDir, platform: 'win32', env: { PATH: '' } }).slice(9, 12),
        ['.exe', '.cmd', '.bat'].map(ext => `${homeDir}/AppData/Roaming/npm/claude${ext}`));
});

test('Claude の拡張子制限は他エージェントの PATHEXT と候補順を変えない', () => {
    const homeDir = '/tmp/akari-candidate-home';
    const env = { APPDATA: '/tmp/akari-appdata', PATH: '/tmp/akari-path', PATHEXT: '.PS1;.EXE;.CMD' };
    assert.deepEqual(partnerCliCandidates('pi', { homeDir, platform: 'win32', env }),
        ['.local/bin', '.local', '/tmp/akari-appdata/npm', '/tmp/akari-path'].flatMap(dir =>
            ['.ps1', '.exe', '.cmd'].map(ext => `${dir.startsWith('/') ? dir : `${homeDir}/${dir}`}/pi${ext}`)));
    assert.deepEqual(partnerCliCandidates('codex', { homeDir, platform: 'win32', env, nativeOnly: true }), [
        `${homeDir}/.local/bin/codex.exe`, `${homeDir}/AppData/Local/AKARI Video/codex/current/bin/codex.exe`,
        '/tmp/akari-path/codex.exe'
    ]);
});
