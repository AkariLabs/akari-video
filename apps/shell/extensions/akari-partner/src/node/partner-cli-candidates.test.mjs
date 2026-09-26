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
