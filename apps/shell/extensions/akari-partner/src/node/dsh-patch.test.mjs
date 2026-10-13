import { after as afterI18n } from 'node:test';
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
afterI18n(() => setLanguage(undefined));
import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import {
    detectDeepSeekConnection, buildDshPatchYaml, buildDshSessionId
} from '../../lib/node/dsh-patch.js';

const homeDir = resolve('fixture-home');
const pluginPath = resolve('fixture-plugin', 'akari-cwd-workspace.mjs');
const fixtureSecret = ['fixture', 'secret', 'not-a-real-key'].join('-');

test('DeepSeek API key takes precedence without reading auth.json', () => {
    let reads = 0;
    const result = detectDeepSeekConnection({
        env: { DEEPSEEK_API_KEY: fixtureSecret }, homeDir,
        readFile: () => { reads++; throw new Error('should not read auth.json'); }
    });
    assert.equal(result.provider, 'deepseek-official');
    assert.match(result.note, /DEEPSEEK_API_KEY/);
    assert.equal(result.secret, undefined);
    assert.equal(reads, 0);
});

test('OpenCode Go login supplies its key only as a process secret', () => {
    let requested;
    const result = detectDeepSeekConnection({
        env: {}, homeDir,
        readFile: file => {
            requested = file;
            return JSON.stringify({ 'opencode-go': { type: 'api', key: fixtureSecret } });
        }
    });
    assert.equal(requested, join(homeDir, '.local', 'share', 'opencode', 'auth.json'));
    assert.equal(result.provider, 'opencode-go');
    assert.match(result.note, /OpenCode Go/);
    assert.deepEqual(result.secret, { OPENCODE_GO_API_KEY: fixtureSecret });
    assert.equal(result.guidance, undefined);
});

test('missing credentials keep the official provider with setup guidance', () => {
    const result = detectDeepSeekConnection({
        env: {}, homeDir, readFile: () => { throw new Error('missing'); }
    });
    assert.equal(result.provider, 'deepseek-official');
    assert.equal(result.secret, undefined);
    assert.match(result.note, /未設定/);
    assert.match(result.guidance, /Settings → Models/);
});

test('connection detail has no display prefix in either language', () => {
    try {
        for (const language of ['ja', 'en']) {
            setLanguage(language);
            const connection = detectDeepSeekConnection({
                env: { DEEPSEEK_API_KEY: fixtureSecret }, homeDir,
                readFile: () => { throw new Error('should not read auth.json'); }
            });
            assert.equal(connection.provider, 'deepseek-official');
            assert.ok(connection.detail.includes('DeepSeek'));
            assert.equal(connection.detail.includes('接続先:'), false);
            assert.equal(connection.detail.includes('Destination:'), false);
        }
    } finally { setLanguage('ja'); }
});

test('patch uses an absolute plugin path and replaces the default model', () => {
    const sessionId = buildDshSessionId(homeDir);
    const official = buildDshPatchYaml({ pluginPath, provider: 'deepseek-official', appVersion: '1.2.3', sessionId });
    const go = buildDshPatchYaml({ pluginPath, provider: 'opencode-go', appVersion: '1.2.3', sessionId });
    for (const yaml of [official, go]) {
        assert.ok(yaml.includes('name: ' + JSON.stringify(pluginPath)));
        assert.match(yaml, /- id: agent-default-model\n  config: \{ provider: (?:deepseek-official|opencode-go), model: deepseek-v4-pro \}/);
        assert.ok(!yaml.includes(fixtureSecret));
    }
    assert.match(official, /provider: deepseek-official, model: deepseek-v4-pro/);
    assert.doesNotMatch(official, /- id: llm-pi-ai/);
    assert.match(go, /provider: opencode-go, model: deepseek-v4-pro/);
    assert.match(go, /- id: llm-pi-ai/);
    assert.match(go, /apiKeyEnv: OPENCODE_GO_API_KEY/);
    assert.match(go, /x-opencode-session: akari-[0-9a-f]{16}/);
    assert.throws(() => buildDshPatchYaml({
        pluginPath: 'relative-plugin.mjs', provider: 'opencode-go', appVersion: '1.2.3', sessionId
    }), /absolute/);
});

test('OpenCode Go offers both DeepSeek V4 Flash and V4 Pro', () => {
    const go = buildDshPatchYaml({ pluginPath, provider: 'opencode-go', appVersion: '1.2.3', sessionId: buildDshSessionId(homeDir) });
    const models = go.slice(go.indexOf('        models:\n')).split('\n').filter(line => line.startsWith('          - '));
    assert.deepEqual(models, [
        '          - { id: deepseek-v4-flash, name: DeepSeek V4 Flash (OpenCode Go), contextWindow: 131072 }',
        '          - { id: deepseek-v4-pro, name: DeepSeek V4 Pro (OpenCode Go), contextWindow: 131072 }'
    ]);
    assert.ok(go.endsWith('}\n'));
});

test('generated patches leave the DeepSeek UI theme to its own settings', () => {
    const input = { pluginPath, appVersion: '1.2.3', sessionId: buildDshSessionId(homeDir), theme: 'dark' };
    for (const provider of ['deepseek-official', 'opencode-go']) {
        assert.doesNotMatch(buildDshPatchYaml({ ...input, provider }), /- id: ui-theme/);
    }
});

test('session id is stable for a project and distinct between projects', () => {
    const first = buildDshSessionId(resolve('project-one'));
    assert.equal(first, buildDshSessionId(resolve('project-one')));
    assert.notEqual(first, buildDshSessionId(resolve('project-two')));
    assert.match(first, /^akari-[0-9a-f]{16}$/);
});

test('patch rejects malformed session ids and app versions', () => {
    const valid = { pluginPath, provider: 'opencode-go', appVersion: '1.2.3-rc.1',
        sessionId: buildDshSessionId(homeDir) };
    for (const sessionId of ['akari-short', 'akari-0123456789ABCDEF', 'bad-0123456789abcdef']) {
        assert.throws(() => buildDshPatchYaml({ ...valid, sessionId }), /session id/);
    }
    for (const appVersion of ['', '1.2.3/unsafe', '1.2.3\nextra', 'x'.repeat(41)]) {
        assert.throws(() => buildDshPatchYaml({ ...valid, appVersion }), /app version/);
    }
    assert.match(buildDshPatchYaml(valid), /akari-video\/1\.2\.3-rc\.1/);
});
