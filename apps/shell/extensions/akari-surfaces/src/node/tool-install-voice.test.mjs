import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';
import { setLanguage } from '@akari-video/i18n';
beforeEach(() => setLanguage('ja'));
afterEach(() => setLanguage(undefined));
import { gzipSync } from 'node:zlib';
import {
    VOICE_ENGINE_PINS, expectedVoiceManifest, inspectVoiceEngine, installVoiceEngine,
    resolveVoiceHome, runToolsCli, voiceRuntimeKey
} from '../../../../../../packages/akari-tools/bin/tools.mjs';
import { installTool } from '../../lib/node/tool-install.js';
import { detectTools } from '../../lib/node/tool-detection.js';

function tarEntry(name, bytes, type = '0') {
    const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    header.write('0000644\0', 100, 'ascii');
    header.write('0000000\0', 108, 'ascii');
    header.write('0000000\0', 116, 'ascii');
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
    header.write('00000000000\0', 136, 'ascii');
    header.write('        ', 148, 'ascii');
    header.write(type, 156, 'ascii');
    header.write('ustar\0', 257, 'ascii');
    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
    return Buffer.concat([header, data, Buffer.alloc((512 - data.length % 512) % 512)]);
}

function fakePackage(name, version, required, extra = []) {
    const entries = [
        tarEntry('package/package.json', JSON.stringify({ name, version })),
        tarEntry(`package/${required}`, 'binary'),
        ...extra.map(path => tarEntry(`package/${path}`, 'other-platform'))
    ];
    return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
}

function fixture() {
    const packageA = fakePackage('sherpa-onnx-node', '1.13.8', 'addon.js');
    const packageB = fakePackage('onnxruntime-node', '1.30.0', 'bin/napi-v6/win32/x64/onnxruntime_binding.node',
        ['bin/napi-v6/darwin/arm64/onnxruntime_binding.node']);
    const modelA = Buffer.from('model A');
    const modelB = Buffer.from('model B');
    const pins = {
        runtimes: { 'win32-x64': [
            { name: 'sherpa-onnx-node', version: '1.13.8', required: 'addon.js', bytes: packageA.length, unpackedBytes: 1024,
                integrity: `sha512-${createHash('sha512').update(packageA).digest('base64')}` },
            { name: 'onnxruntime-node', version: '1.30.0', required: 'bin/napi-v6/win32/x64/onnxruntime_binding.node',
                keep: 'bin/napi-v6/win32/x64/', bytes: packageB.length, unpackedBytes: 1024,
                integrity: `sha512-${createHash('sha512').update(packageB).digest('base64')}` }
        ] },
        models: [modelA, modelB].map((buffer, index) => ({
            file: `model-${index}.onnx`, url: `https://example.test/model-${index}.onnx`,
            sha256: createHash('sha256').update(buffer).digest('hex'), bytes: buffer.length, license: 'MIT'
        }))
    };
    const assets = new Map([
        ['https://registry.npmjs.org/sherpa-onnx-node/-/sherpa-onnx-node-1.13.8.tgz', packageA],
        ['https://registry.npmjs.org/onnxruntime-node/-/onnxruntime-node-1.30.0.tgz', packageB],
        ...pins.models.map((pin, index) => [pin.url, [modelA, modelB][index]])
    ]);
    return { pins, assets };
}

function mockFetch(assets, calls, override) {
    return async url => {
        calls.push(url);
        if (override) return override(url, assets.get(url));
        const bytes = assets.get(url);
        return bytes ? { ok: true, arrayBuffer: async () => bytes } : { ok: false, status: 404 };
    };
}

const enoughSpace = async () => ({ bavail: 1000000, bsize: 4096 });
const install = (voiceHome, pins, fetchImpl, extras = {}) => installVoiceEngine({
    voiceHome, platform: 'win32', arch: 'x64', pins, fetchImpl, statfs: enoughSpace, ...extras
});

async function scratch(t) {
    const dir = await mkdtemp(join(tmpdir(), 'akari-voice-test-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    return dir;
}

async function materializeReady(voiceHome) {
    const manifest = expectedVoiceManifest('win32', 'x64');
    for (const pin of VOICE_ENGINE_PINS.runtimes['win32-x64']) {
        const dir = join(voiceHome, 'runtime/win32-x64/node_modules', pin.name);
        await mkdir(join(dir, pin.required, '..'), { recursive: true });
        await writeFile(join(dir, 'package.json'), JSON.stringify({ name: pin.name, version: pin.version }));
        await writeFile(join(dir, pin.required), 'x');
    }
    await mkdir(join(voiceHome, 'models'));
    for (const model of manifest.models) {
        const handle = await open(join(voiceHome, 'models', model.file), 'w');
        await handle.truncate(model.bytes);
        await handle.close();
    }
    await writeFile(join(voiceHome, 'manifest.json'), JSON.stringify(manifest));
    return manifest;
}

test('新規取得、manifest の形、間引き、2 回目と部分修復', async t => {
    const voiceHome = await scratch(t);
    const { pins, assets } = fixture();
    const calls = [];
    const fetchImpl = mockFetch(assets, calls);
    const first = await install(voiceHome, pins, fetchImpl);
    assert.equal(first.outcome, 'installed');
    assert.equal(calls.length, 4);
    assert.equal((await readdir(voiceHome)).some(name => name.startsWith('.staging-')), false);
    assert.equal((await readFile(join(voiceHome, 'runtime/win32-x64/node_modules/sherpa-onnx-node/addon.js'), 'utf8')), 'binary');
    await stat(join(voiceHome, 'runtime/win32-x64/node_modules/onnxruntime-node/bin/napi-v6/win32/x64/onnxruntime_binding.node'));
    await assert.rejects(stat(join(voiceHome, 'runtime/win32-x64/node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node')));
    assert.equal((await readFile(join(voiceHome, 'models/model-0.onnx'))).toString(), 'model A');
    const manifest = JSON.parse(await readFile(join(voiceHome, 'manifest.json')));
    assert.deepEqual(Object.keys(manifest), ['version', 'runtime', 'models']);
    assert.deepEqual(Object.keys(manifest.runtime), ['platform', 'arch', 'packages']);
    assert.deepEqual(Object.keys(manifest.runtime.packages[0]), ['name', 'version', 'integrity']);
    assert.deepEqual(Object.keys(manifest.models[0]), ['file', 'url', 'sha256', 'bytes', 'license']);
    calls.length = 0;
    assert.equal((await install(voiceHome, pins, fetchImpl)).outcome, 'unchanged');
    assert.equal(calls.length, 0);
    await unlink(join(voiceHome, 'manifest.json'));
    assert.equal((await install(voiceHome, pins, fetchImpl)).outcome, 'installed');
    assert.equal(calls.length, 0);
    await writeFile(join(voiceHome, 'models/model-0.onnx'), 'Model A');
    assert.equal((await install(voiceHome, pins, fetchImpl)).outcome, 'installed');
    assert.deepEqual(calls, ['https://example.test/model-0.onnx']);
    calls.length = 0;
    await unlink(join(voiceHome, 'runtime/win32-x64/node_modules/sherpa-onnx-node/addon.js'));
    assert.equal((await install(voiceHome, pins, fetchImpl)).outcome, 'installed');
    assert.equal(calls.length, 1);
    assert.match(calls[0], /sherpa-onnx-node/);
});

test('integrity、sha256、HTTP、容量、危険な tar を拒否し半端な配置を残さない', async t => {
    const voiceHome = await scratch(t);
    const base = fixture();
    const goodFetch = mockFetch(base.assets, []);
    assert.equal((await install(voiceHome, base.pins, goodFetch)).outcome, 'installed');
    const originalManifest = await readFile(join(voiceHome, 'manifest.json'));
    const originalEntries = await readdir(voiceHome);
    const cases = [
        { kind: 'integrity', change: p => { p.runtimes['win32-x64'][0].integrity = 'sha512-bad'; }, expected: /検証に失敗/ },
        { kind: 'sha256', change: p => { p.models[0].sha256 = '0'.repeat(64); }, expected: /検証に失敗/ },
        { kind: 'http', change: p => { p.models[0].sha256 = '0'.repeat(64); }, fetch: async () => ({ ok: false, status: 500 }), expected: /取得に失敗/ }
    ];
    for (const scenario of cases) {
        const { pins, assets } = fixture();
        scenario.change(pins);
        const requiredFile = join(voiceHome, 'runtime/win32-x64/node_modules/sherpa-onnx-node/addon.js');
        if (scenario.kind === 'integrity') await unlink(requiredFile);
        const result = await install(voiceHome, pins, scenario.fetch || mockFetch(assets, []));
        assert.equal(result.outcome, 'failed', scenario.kind);
        assert.match(result.message, scenario.expected);
        assert.deepEqual(await readFile(join(voiceHome, 'manifest.json')), originalManifest);
        assert.deepEqual(await readdir(voiceHome), originalEntries);
        if (scenario.kind === 'integrity') await writeFile(requiredFile, 'binary');
    }
    const calls = [];
    const { pins, assets } = fixture();
    pins.models[0].sha256 = '0'.repeat(64);
    assert.equal((await install(voiceHome, pins, mockFetch(assets, calls), { statfs: async () => ({ bavail: 0, bsize: 4096 }) })).outcome, 'failed');
    assert.equal(calls.length, 0);
    const badTar = gzipSync(Buffer.concat([tarEntry('package/../escape', 'bad'), Buffer.alloc(1024)]));
    pins.runtimes['win32-x64'][0].integrity = `sha512-${createHash('sha512').update(badTar).digest('base64')}`;
    pins.runtimes['win32-x64'][0].bytes = badTar.length;
    assets.set('https://registry.npmjs.org/sherpa-onnx-node/-/sherpa-onnx-node-1.13.8.tgz', badTar);
    await unlink(join(voiceHome, 'runtime/win32-x64/node_modules/sherpa-onnx-node/addon.js'));
    assert.equal((await install(voiceHome, pins, mockFetch(assets, []))).outcome, 'failed');
    assert.deepEqual(await readdir(voiceHome), originalEntries);
});

test('inspect の状態、置き場の優先順、固定表', async t => {
    const voiceHome = await scratch(t);
    assert.equal((await inspectVoiceEngine({ voiceHome, platform: 'win32', arch: 'x64' })).state, 'missing');
    assert.equal((await inspectVoiceEngine({ voiceHome, platform: 'linux', arch: 'x64' })).state, 'unsupported');
    assert.equal(resolveVoiceHome({ env: { AKARI_VOICE_HOME: '/voice', AKARI_HOME: '/akari' }, homeDir: '/home' }), '/voice');
    assert.equal(resolveVoiceHome({ env: { AKARI_HOME: '/akari' }, homeDir: '/home' }), join('/akari', 'tools', 'voice'));
    assert.equal(resolveVoiceHome({ env: {}, homeDir: '/home' }), join('/home', '.akari', 'tools', 'voice'));
    for (const key of ['win32-x64', 'darwin-arm64', 'darwin-x64']) {
        const [platform, arch] = key.split('-');
        assert.equal(voiceRuntimeKey(platform, arch), key);
        for (const pin of VOICE_ENGINE_PINS.runtimes[key]) {
            assert.match(pin.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
            assert.match(`https://registry.npmjs.org/${pin.name}/-/${pin.name}-${pin.version}.tgz`, /^https:\/\//);
        }
        for (const model of expectedVoiceManifest(platform, arch).models) {
            assert.match(model.sha256, /^[a-f0-9]{64}$/);
            assert.match(model.url, /^https:\/\//);
        }
    }
    assert.equal(VOICE_ENGINE_PINS.runtimes['darwin-x64'].some(pin => pin.name === 'onnxruntime-node'), false);
    // 点検は固定表を使う。大きな実モデルは sparse file としてサイズだけ合わせる。
    const manifest = await materializeReady(voiceHome);
    assert.equal((await inspectVoiceEngine({ voiceHome, platform: 'win32', arch: 'x64' })).state, 'ready');
    await writeFile(join(voiceHome, 'manifest.json'), JSON.stringify({ ...manifest, version: 2 }));
    assert.equal((await inspectVoiceEngine({ voiceHome, platform: 'win32', arch: 'x64' })).state, 'outdated');
    await writeFile(join(voiceHome, 'manifest.json'), JSON.stringify(manifest));
    await unlink(join(voiceHome, 'runtime/win32-x64/node_modules/sherpa-onnx-node/addon.js'));
    assert.equal((await inspectVoiceEngine({ voiceHome, platform: 'win32', arch: 'x64' })).state, 'broken');
});

test('アプリの導入進捗、検出の並び、CLI の出力', async t => {
    const voiceHome = await scratch(t);
    const { pins, assets } = fixture();
    const progress = [];
    const installed = await installTool('voice', { voiceHome, platform: 'win32', arch: 'x64', voicePins: pins,
        fetchImpl: mockFetch(assets, []), statfs: enoughSpace, onProgress: item => progress.push(item) });
    assert.equal(installed.outcome, 'installed');
    assert.ok(progress.length > 0);
    assert.ok(progress.every(item => item.toolId === 'voice' && item.kind === 'download'));
    const missing = await detectTools({ platform: 'win32', arch: 'x64', voiceHome: join(voiceHome, 'absent'),
        env: { PATH: '' }, homeDir: voiceHome, repoRoot: voiceHome, devSearchRoots: [],
        runCommand: async () => ({ ok: false, stdout: '', stderr: '' }), pathExists: async () => false,
        fetchImpl: async () => ({ ok: false }) });
    const index = missing.tools.findIndex(item => item.id === 'voicevox');
    assert.equal(missing.tools[index + 1].id, 'voice');
    assert.equal(missing.tools[index + 1].available, false);
    const output = []; const errors = [];
    const cliHome = join(voiceHome, 'cli');
    const readyHome = join(voiceHome, 'real-ready');
    await materializeReady(readyHome);
    const ready = await detectTools({ platform: 'win32', arch: 'x64', voiceHome: readyHome,
        env: { PATH: '' }, homeDir: voiceHome, repoRoot: voiceHome, devSearchRoots: [],
        runCommand: async () => ({ ok: false, stdout: '', stderr: '' }), pathExists: async () => false,
        fetchImpl: async () => ({ ok: false }) });
    assert.equal(ready.tools.find(item => item.id === 'voice').available, true);
    const cliOptions = { env: { AKARI_VOICE_HOME: cliHome }, homeDir: voiceHome, platform: 'win32', arch: 'x64',
        stdout: { write: value => output.push(value) }, stderr: { write: value => errors.push(value) },
        fetchImpl: mockFetch(assets, []), statfs: enoughSpace, pins };
    assert.equal(await runToolsCli(['install', 'voice', '--json'], cliOptions), 0);
    assert.equal(JSON.parse(output.at(-1)).outcome, 'installed');
    assert.ok(errors.some(line => /%/.test(line)));
    assert.equal(await runToolsCli(['status', 'voice'], cliOptions), 1);
    assert.match(output.at(-1), /outdated/);
    assert.equal(await runToolsCli(['status', 'voice'], { ...cliOptions, env: { AKARI_VOICE_HOME: readyHome } }), 0);
    assert.match(output.at(-1), /ready/);
    assert.equal(await runToolsCli(['--help'], cliOptions), 0);
    assert.equal(await runToolsCli(['bad'], cliOptions), 2);
});
