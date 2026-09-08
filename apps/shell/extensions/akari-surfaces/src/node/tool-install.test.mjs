import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { installTool, resolveWhisperModelOverride, resolveWhisperModelPath, WHISPER_MODEL_FILENAME } from '../../lib/node/tool-install.js';
import { detectTools } from '../../lib/node/tool-detection.js';
import { SPEECH_ANALYZER_MANUAL_INSTALL_GUIDANCE } from '../../lib/common/tool-guidance.js';

const noExternalWork = {
    env: {}, homeDir: '/isolated', repoRoot: '/isolated/repo', whisperBin: '',
    runCommand: async () => assert.fail('外部コマンドは呼ばない'),
    pathExists: async () => false,
    fetchImpl: async () => assert.fail('ネットワークは呼ばない'),
    listDir: async () => []
};

for (const [name, env, expected, warningCount] of [
    ['両方なら WHISPER_CPP_MODEL', { WHISPER_CPP_MODEL: '/primary.bin', AKARI_WHISPER_MODEL: '/legacy.bin' }, '/primary.bin', 0],
    ['WHISPER_CPP_MODEL のみ', { WHISPER_CPP_MODEL: '/primary.bin' }, '/primary.bin', 0],
    ['AKARI_WHISPER_MODEL のみなら警告して採用', { AKARI_WHISPER_MODEL: '/legacy.bin' }, '/legacy.bin', 1],
    ['どちらもなければ undefined', {}, undefined, 0]
]) {
    test(`モデル override: ${name}`, async t => {
        const warn = t.mock.method(console, 'warn', () => {});
        const before = { ...env };
        assert.equal(resolveWhisperModelOverride(env), expected);
        assert.equal(warn.mock.callCount(), 0, '優先順位の決定自体は純関数');
        assert.equal(await resolveWhisperModelPath({ ...noExternalWork, env, pathExists: async path => path === expected }), expected);
        assert.equal(warn.mock.callCount(), warningCount);
        if (warningCount) {
            assert.match(warn.mock.calls[0].arguments[0], /AKARI_WHISPER_MODEL.*WHISPER_CPP_MODEL/);
        }
        assert.deepEqual(env, before);
    });
}

for (const platform of ['darwin', 'win32', 'linux']) {
    test(`SpeechAnalyzer は ${platform} でも自動導入を一切せず skipped`, async t => {
        const runCommand = t.mock.fn(noExternalWork.runCommand);
        const pathExists = t.mock.fn(noExternalWork.pathExists);
        const fetchImpl = t.mock.fn(noExternalWork.fetchImpl);
        assert.deepEqual(await installTool('speech-analyzer', { ...noExternalWork, platform, runCommand, pathExists, fetchImpl }), {
            id: 'speech-analyzer', outcome: 'skipped', message: SPEECH_ANALYZER_MANUAL_INSTALL_GUIDANCE
        });
        assert.equal(runCommand.mock.callCount(), 0);
        assert.equal(pathExists.mock.callCount(), 0);
        assert.equal(fetchImpl.mock.callCount(), 0);
    });
}

test('隔離した偽モデルへの override は導入と検出で同じ絶対パスになる', async t => {
    const scratch = await mkdtemp(join(tmpdir(), 'akari-install-model-'));
    t.after(() => rm(scratch, { recursive: true, force: true }));
    const modelPath = join(scratch, 'override.bin');
    await writeFile(modelPath, 'fake model');
    const options = {
        ...noExternalWork, platform: 'linux', homeDir: scratch, repoRoot: scratch,
        env: { WHISPER_CPP_MODEL: modelPath },
        pathExists: async path => path === modelPath,
        runCommand: async command => ({ ok: command === 'whisper-cli', stdout: 'fake whisper', stderr: '' }),
        resourcesPath: '', devSearchRoots: [scratch]
    };
    const detected = (await detectTools(options)).tools.find(tool => tool.id === 'whisper');
    assert.equal(detected.model.path, modelPath);
    assert.equal(await resolveWhisperModelPath(options), detected.model.path);
});

test('アプリ管理モデルの再帰探索・除外・順序は検出側と一致する', async () => {
    const modelsDir = '/isolated/.akari/tools/models';
    const modelPath = `${modelsDir}/nested/ggml-tiny.bin`;
    for (const override of ['/override.bin', '/missing.bin', '/ggml-small.en.bin', undefined]) {
        const options = {
            ...noExternalWork, platform: 'linux', env: { WHISPER_CPP_MODEL: override },
            resourcesPath: '', devSearchRoots: ['/isolated/repo'],
            pathExists: async path => ['/override.bin', '/ggml-small.en.bin', modelPath, `${modelsDir}/ggml-small.en.bin`].includes(path),
            listDir: async path => path === modelsDir ? ['for-tests-ggml-tiny.bin', 'ggml-small.en.bin', 'nested/ggml-tiny.bin'] : [],
            runCommand: async command => ({ ok: command === 'whisper-cli', stdout: 'fake whisper', stderr: '' })
        };
        const installed = await resolveWhisperModelPath(options);
        const detected = (await detectTools(options)).tools.find(tool => tool.id === 'whisper').model.path;
        assert.equal(installed, override === '/override.bin' ? override : modelPath);
        assert.equal(installed, detected);
    }
});

test('repoRoot / whisperBin 未指定でも安全に探索し、相対 override は絶対パスにする', async () => {
    assert.equal(await resolveWhisperModelPath({ ...noExternalWork, repoRoot: undefined, whisperBin: undefined }), undefined);
    assert.equal(await resolveWhisperModelPath({
        ...noExternalWork, env: { WHISPER_CPP_MODEL: 'custom.bin' }, pathExists: async path => path === 'custom.bin'
    }), resolve('custom.bin'));
});

test('モデルがなければ既存の DL 先とハッシュ検証を維持する', async () => {
    const payload = Buffer.from('fake model');
    const writes = [];
    const dirs = [];
    const result = await installTool('whisper', {
        ...noExternalWork, platform: 'linux',
        fetchImpl: async () => ({ ok: true, arrayBuffer: async () => payload }),
        whisperModelSha256: createHash('sha256').update(payload).digest('hex'),
        ensureDir: async path => { dirs.push(path); },
        writeFile: async (path, data) => { writes.push({ path, data }); }
    });
    assert.equal(result.outcome, 'installed');
    assert.deepEqual(dirs, ['/isolated/.akari/tools/models']);
    assert.deepEqual(writes, [{ path: join(dirs[0], WHISPER_MODEL_FILENAME), data: payload }]);
});

test('解決済みモデルがあれば installTool はモデルを再ダウンロードしない', async () => {
    const result = await installTool('whisper', {
        ...noExternalWork, platform: 'darwin',
        listDir: async path => path === '/isolated/.akari/tools/models' ? ['ggml-tiny.bin'] : [],
        pathExists: async path => path === '/isolated/.akari/tools/models/ggml-tiny.bin',
        runCommand: async () => ({ ok: true, stdout: '', stderr: '' })
    });
    assert.equal(result.outcome, 'installed');
});
