import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { win32 } from 'node:path';
import test from 'node:test';

// プレビュー用 GPU 設定が利用者の明示値を上書きせず、未設定と 2 だけを変更する回帰を守る。
// 本物の registry helper に純粋な spawnSync を注入し、引数と REG_SZ の解析まで検証する。
// 実機の reg.exe は起動せず、非 Windows・読み書き失敗も RPC の結果だけで扱う。
const require = createRequire(import.meta.url);
const { AkariPreviewServiceImpl } = require('../lib/node/akari-preview-service.js');
const KEY = 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences';
const EXE = 'X:\\akari\\bin\\..\\app.exe';
const NORMALIZED_EXE = win32.resolve(EXE);

function fixture(t, { raw = null, platform = 'win32', executable = EXE, fail = null } = {}) {
    const calls = [];
    const fakeSpawnSync = (command, args, options) => {
        calls.push({ command, args, options });
        if (fail === 'query-error' && args[0] === 'query') {
            return { error: new Error('reg unavailable') };
        }
        let status = 0;
        let text = '';
        if (args[0] === 'query') {
            status = raw === null ? 1 : 0;
            text = raw === null ? '' : `${KEY}\r\n    ${NORMALIZED_EXE}    REG_SZ    ${raw}\r\n`;
        } else if (args[0] === fail) {
            status = 1;
        } else if (args[0] === 'add') {
            raw = args[7];
        } else if (args[0] === 'delete') {
            raw = null;
        } else {
            assert.fail(`unexpected registry operation: ${args[0]}`);
        }
        return { status, stdout: Buffer.from(text, 'latin1'), stderr: Buffer.alloc(0) };
    };
    class TestService extends AkariPreviewServiceImpl {
        gpuPreferencePlatform() { return platform; }
        gpuPreferenceExecutable() { return executable; }
        createGpuPreferenceRegistry(module) {
            return module.createRegistryAccess({ spawnSync: fakeSpawnSync, systemRoot: 'C:\\Windows', env: {} });
        }
    }
    const listeners = new Set(process.listeners('exit'));
    const service = new TestService();
    const addedListeners = process.listeners('exit').filter(listener => !listeners.has(listener));
    t.after(() => addedListeners.forEach(listener => process.removeListener('exit', listener)));
    return { service, calls, mutations: () => calls.filter(call => call.args[0] !== 'query') };
}

test('unset writes exactly one normalized REG_SZ value and reads the resulting state', async t => {
    const { service, calls, mutations } = fixture(t);
    const initial = await service.getGpuPreferenceState();
    assert.deepEqual(initial, {
        platform: 'win32', supported: true, executable: NORMALIZED_EXE, current: 'unset', raw: null
    });
    assert.deepEqual(await service.setHighPerformanceGpu(false), { ok: true, state: initial });
    assert.equal(mutations().length, 0);
    assert.deepEqual(await service.setHighPerformanceGpu(true), {
        ok: true, state: { ...initial, current: 'high-performance', raw: 'GpuPreference=2;' }
    });
    assert.deepEqual(mutations().map(call => call.args), [
        ['add', KEY, '/v', NORMALIZED_EXE, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f']
    ]);
    for (const call of calls) {
        assert.equal(call.command, win32.join('C:\\Windows', 'System32', 'reg.exe'));
        assert.deepEqual(call.options, { encoding: 'buffer', windowsHide: true });
        if (call.args[0] === 'query') assert.deepEqual(call.args, ['query', KEY, '/v', NORMALIZED_EXE]);
    }
});

test('existing 2 is idempotent when enabled and removed exactly once when disabled', async t => {
    const { service, mutations } = fixture(t, { raw: 'GpuPreference=2;' });
    const initial = await service.getGpuPreferenceState();
    assert.equal(initial.current, 'high-performance');
    assert.equal(initial.raw, 'GpuPreference=2;');
    assert.deepEqual(await service.setHighPerformanceGpu(true), { ok: true, state: initial });
    assert.equal(mutations().length, 0);
    assert.deepEqual(await service.setHighPerformanceGpu(false), {
        ok: true, state: { ...initial, current: 'unset', raw: null }
    });
    assert.deepEqual(mutations().map(call => call.args), [['delete', KEY, '/v', NORMALIZED_EXE, '/f']]);
});

for (const [raw, current] of [['GpuPreference=1;', 'power-saving'], ['GpuPreference=0;', 'other']]) {
    test(`${raw} respects the user preference for both enable and disable`, async t => {
        const { service, mutations } = fixture(t, { raw });
        const initial = await service.getGpuPreferenceState();
        assert.equal(initial.current, current);
        assert.equal(initial.raw, raw);
        for (const enabled of [true, false]) {
            assert.deepEqual(await service.setHighPerformanceGpu(enabled), {
                ok: false, reason: 'user-preference', state: initial
            });
        }
        assert.equal(mutations().length, 0);
    });
}

test('non Windows does not load the module or access the registry', async t => {
    const { service, calls } = fixture(t, { platform: 'darwin' });
    service.loadGpuPreferenceModule = () => assert.fail('must not load on non Windows');
    const state = { platform: 'darwin', supported: false, executable: null, current: 'unknown', raw: null };
    assert.deepEqual(await service.getGpuPreferenceState(), state);
    assert.deepEqual(await service.setHighPerformanceGpu(true), { ok: false, reason: 'unsupported', state });
    assert.equal(calls.length, 0);
});

for (const [fail, raw, enabled, reason] of [
    ['add', null, true, /^registry-write-failed: reg add exited 1/],
    ['delete', 'GpuPreference=2;', false, /^registry-remove-failed: reg delete exited 1/]
]) {
    test(`${fail} failure returns a reason and preserves the previous state`, async t => {
        const { service, mutations } = fixture(t, { raw, fail });
        const initial = await service.getGpuPreferenceState();
        const result = await service.setHighPerformanceGpu(enabled);
        assert.equal(result.ok, false);
        assert.match(result.reason, reason);
        assert.deepEqual(result.state, initial);
        assert.equal(mutations().length, 1);
    });
}

test('missing reg.exe reports unsupported with the normalized executable and never writes', async t => {
    const { service, mutations } = fixture(t, { fail: 'query-error' });
    const state = { platform: 'win32', supported: false, executable: NORMALIZED_EXE, current: 'unknown', raw: null };
    assert.deepEqual(await service.getGpuPreferenceState(), state);
    assert.deepEqual(await service.setHighPerformanceGpu(true), { ok: false, reason: 'unsupported', state });
    assert.equal(mutations().length, 0);
});

test('normalization or module loading failure reports unsupported without registry access', async t => {
    const { service, calls } = fixture(t, { executable: '' });
    const state = { platform: 'win32', supported: false, executable: null, current: 'unknown', raw: null };
    assert.deepEqual(await service.getGpuPreferenceState(), state);
    service.loadGpuPreferenceModule = async () => { throw new Error('helper missing'); };
    assert.deepEqual(await service.getGpuPreferenceState(), state);
    assert.deepEqual(await service.setHighPerformanceGpu(true), { ok: false, reason: 'unsupported', state });
    assert.equal(calls.length, 0);
});

test('protocol declares both RPCs and the complete GPU state contract', async () => {
    const source = await readFile(new URL('../src/common/akari-preview-protocol.ts', import.meta.url), 'utf8');
    const service = source.match(/export interface AkariPreviewService \{([^]*?)\n\}/)?.[1];
    assert.ok(service);
    assert.match(service, /getGpuPreferenceState\(\): Promise<GpuPreferenceState>;/);
    assert.match(service, /setHighPerformanceGpu\(enabled: boolean\): Promise<SetHighPerformanceGpuResult>;/);
    const current = source.match(/export type GpuPreferenceCurrent = ([^;]+);/)?.[1];
    assert.ok(current);
    assert.deepEqual([...current.matchAll(/'([^']+)'/g)].map(match => match[1]),
        ['high-performance', 'power-saving', 'unset', 'other', 'unknown']);
    const state = source.match(/export interface GpuPreferenceState \{([^]*?)\n\}/)?.[1];
    assert.ok(state);
    for (const field of [/platform: string;/, /supported: boolean;/, /executable: string \| null;/,
        /current: GpuPreferenceCurrent;/, /raw: string \| null;/]) assert.match(state, field);
    assert.match(source, /export type SetHighPerformanceGpuResult =\s*\| \{ ok: true; state: GpuPreferenceState \}\s*\| \{ ok: false; reason: string; state: GpuPreferenceState \};/);
});
