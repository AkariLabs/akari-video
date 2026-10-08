import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import test from 'node:test';
import { AkariEarServiceImpl } from '../lib/node/ear-service.js';

const helperPath = resolve(import.meta.dirname, '../../../../../packages/akari-ear/test/fixtures/fake-helper.mjs');
const earModulePath = resolve(import.meta.dirname, '../../../../../packages/akari-ear/src/index.mjs');
const options = { helperPath, earModulePath, platform: 'darwin', darwinMajor: 25,
    env: { AKARI_VIBE_STT_BIN: helperPath }, nowEpochMs: () => 1000 };

test('資格なしで note が起動し、2 回目は動作中の用途を返す', async () => {
    const service = new AkariEarServiceImpl(options);
    try {
        const first = await service.start({ purpose: 'note' });
        assert.notEqual(first.state, 'error');
        const second = await service.start({ purpose: 'trial' });
        assert.equal(second.state, 'error');
        assert.match(second.message, /note/);
    } finally { await service.stop(); }
});

test('trial は一時ファイルを残さない', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ear-trial-'));
    const previous = process.env.TMPDIR;
    process.env.TMPDIR = root;
    const service = new AkariEarServiceImpl(options);
    try {
        const before = await readdir(root);
        assert.notEqual((await service.start({ purpose: 'trial' })).state, 'error');
        await service.stop();
        assert.deepEqual(await readdir(root), before);
    } finally {
        if (previous === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = previous;
        await rm(root, { recursive: true, force: true });
    }
});

test('紙の確定発話は紙の時計と command 印を持つ', async () => {
    const service = new AkariEarServiceImpl(options);
    const final = new Promise(resolveFinal => service.setClient({
        onStatus() {}, onLevel() {}, onUtterance(value) { if (value.final) resolveFinal(value); }
    }));
    try {
        await service.start({ purpose: 'note' });
        await service.notifyRoughCanvas({ type: 'roughCanvas.opened', canvasId: 'a', at: 1000 });
        const value = await final;
        assert.equal(value.kind, 'command');
        await service.notifyRoughCanvas({ type: 'roughCanvas.closed', canvasId: 'a', at: 2000 });
        const transcript = await service.takeTranscript('a');
        assert.equal(transcript.engine, 'speech-analyzer');
        assert.equal(transcript.openedRecT, 0);
        assert.deepEqual(transcript.segments, [{ t0: 0.1, t1: 0.2, text: 'もう1枚', kind: 'command' }]);
        assert.equal(await service.takeTranscript('a'), undefined);
    } finally { await service.stop(); }
});

test('部品が見つからなければ両エンジンを理由付きで無効にする', async () => {
    const service = new AkariEarServiceImpl({ earModulePath: '/missing/ear.mjs' });
    const capabilities = await service.getCapabilities();
    assert.equal(capabilities.engines.length, 2);
    assert.ok(capabilities.engines.every(engine => !engine.available && engine.reason === '聞き取り部品が見つかりません'));
});

test('録音後の確定結果も紙の時計に入り、backend 名を engine に写す', async () => {
    const service = new AkariEarServiceImpl({ earModulePath, platform: 'win32', nowEpochMs: () => 1000,
        transcribe: async () => ({ backend: 'speech-analyzer',
            segments: [{ t0: 0.5, t1: 1, text: '記録', confidence: 0.9 }] }) });
    try {
        const started = await service.start({ purpose: 'note' });
        assert.equal(started.engine, 'record-then-transcribe');
        await service.notifyRoughCanvas({ type: 'roughCanvas.opened', canvasId: 'record', at: 1000 });
        await service.appendAudio(new Uint8Array(320));
        await service.notifyRoughCanvas({ type: 'roughCanvas.closed', canvasId: 'record', at: 2000 });
        await service.stop();
        assert.deepEqual(await service.takeTranscript('record'), { engine: 'speech-analyzer', locale: 'ja-JP', openedRecT: 0,
            segments: [{ t0: 0.5, t1: 1, text: '記録', kind: 'speech', confidence: 0.9 }] });
    } finally { await service.stop(); }
});

test('Jev は明示的に未対応を返す', async () => {
    const service = new AkariEarServiceImpl(options);
    assert.deepEqual(await service.start({ purpose: 'jev' }),
        { state: 'error', mic: 'unknown', message: 'Jev の聞き取りは今後の更新で対応します' });
});

function wav({ channels = 1, rate = 16000, bits = 16, junk = false } = {}) {
    const fmt = Buffer.alloc(24);
    fmt.write('fmt ', 0); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(1, 8);
    fmt.writeUInt16LE(channels, 10); fmt.writeUInt32LE(rate, 12);
    fmt.writeUInt32LE(rate * channels * bits / 8, 16);
    fmt.writeUInt16LE(channels * bits / 8, 20); fmt.writeUInt16LE(bits, 22);
    const data = Buffer.alloc(8 + 3200);
    data.write('data', 0); data.writeUInt32LE(3200, 4);
    const extra = junk ? Buffer.from('JUNK\x04\x00\x00\x00abcd', 'binary') : Buffer.alloc(0);
    const header = Buffer.alloc(12);
    header.write('RIFF', 0); header.writeUInt32LE(4 + fmt.length + extra.length + data.length, 4);
    header.write('WAVE', 8);
    return Buffer.concat([header, fmt, extra, data]);
}

test('検証用入力は有効な通常ファイルだけを採用し、data が後ろの WAV を読む', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ear-input-'));
    const good = join(root, 'good.wav');
    const bad = join(root, 'bad.wav');
    await writeFile(good, wav({ junk: true }));
    await writeFile(bad, wav({ channels: 2 }));
    try {
        const common = { earModulePath, platform: 'win32', transcribe: async () => ({ segments: [] }) };
        const valid = new AkariEarServiceImpl({ ...common, env: { AKARI_EAR_TEST_FILE: good } });
        assert.equal((await valid.getCapabilities()).testInput, true);
        assert.equal(valid.testAudio(good).length, 3200);
        const invalid = new AkariEarServiceImpl({ ...common, env: { AKARI_EAR_TEST_FILE: bad } });
        assert.match((await invalid.start({ purpose: 'note' })).message, /16kHz/);
        assert.equal((await invalid.getCapabilities()).testInput, true);
        const absent = [undefined, 'relative.wav', join(root, 'missing'), root];
        for (const path of absent) {
            const service = new AkariEarServiceImpl({ ...common, env: path ? { AKARI_EAR_TEST_FILE: path } : {} });
            assert.equal((await service.getCapabilities()).testInput, undefined);
        }
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('録音型の検証入力は実マイクなしで音声チャンクを文字起こしへ渡す', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ear-input-'));
    const path = join(root, 'fixture.wav');
    await writeFile(path, wav());
    let bytes = 0;
    const service = new AkariEarServiceImpl({ earModulePath, platform: 'win32',
        env: { AKARI_EAR_TEST_FILE: path }, transcribe: async file => {
            const written = await import('node:fs/promises').then(fs => fs.readFile(file));
            bytes = written.readUInt32LE(40);
            return { segments: [{ t0: 0, t1: 0.1, text: '確認' }] };
        } });
    try {
        assert.equal((await service.start({ purpose: 'note' })).state, 'listening');
        await new Promise(setImmediate);
        await service.stop();
        assert.equal(bytes, 3200);
    } finally { await service.stop(); await rm(root, { recursive: true, force: true }); }
});
