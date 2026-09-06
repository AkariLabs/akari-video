import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { AkariPreviewServiceImpl } = require('../lib/node/akari-preview-service.js');
const stubPath = fileURLToPath(new URL('./fixtures/waveform-ffmpeg-stub.mjs', import.meta.url));

async function fixture(t, plan = {}) {
    const base = await mkdtemp(join(tmpdir(), 'akari-waveform-peaks-'));
    t.after(() => rm(base, { recursive: true, force: true }));
    const project = join(base, 'project');
    await mkdir(project);
    const asset = join(project, 'source.mp4');
    await writeFile(asset, 'stub source');
    const argsOut = join(base, 'args.json');
    const planPath = join(base, 'plan.json');
    await writeFile(planPath, JSON.stringify({ argsOut, segments: [], exitCode: 0, stderr: '', ...plan }));
    const previous = process.env.AKARI_TEST_WAVEFORM_PLAN;
    process.env.AKARI_TEST_WAVEFORM_PLAN = planPath;
    t.after(() => {
        if (previous === undefined) delete process.env.AKARI_TEST_WAVEFORM_PLAN;
        else process.env.AKARI_TEST_WAVEFORM_PLAN = previous;
    });
    const service = new AkariPreviewServiceImpl();
    const root = pathToFileURL(project).toString();
    service.workspaceServer = {
        getMostRecentlyUsedWorkspace: async () => root,
        getRecentWorkspaces: async () => [root]
    };
    service.resolveWaveformFfmpegCommand = async () => ({ command: process.execPath, prefixArgs: [stubPath] });
    const request = { assetUri: pathToFileURL(asset).toString(), workspaceRoots: [root] };
    return { base, project, asset, argsOut, service, request };
}

function assertPeaks(result, samples, maximum) {
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.durationSec, samples / 8000);
    assert.equal(result.peaks.length, result.buckets);
    assert.ok(result.buckets >= 1 && result.buckets <= maximum);
    assert.ok(result.peaks.every(value => value >= 0 && value <= 1));
}

test('24000 サンプルを 3 秒のピーク列へ写し、mono 8000 Hz の引数を順序どおり渡す', async t => {
    const data = await fixture(t, {
        segments: [0.25, 1, 0].map(amplitude => ({ samples: 8000, amplitude }))
    });
    const result = await data.service.buildWaveformPeaks(data.request);
    assertPeaks(result, 24000, 4000);
    assert.equal(result.buckets, Math.ceil(24000 / 1024));
    // 境界をまたぐバケットには大きい側の振幅が入る。
    for (let i = 0; i < result.buckets; i += 1) {
        const start = i * 1024;
        const end = Math.min(24000, start + 1024);
        const expected = start < 16000 && end > 8000 ? 1 : start < 8000 ? 0.25 : 0;
        assert.ok(Math.abs(result.peaks[i] - expected) < 0.01, `bucket ${i}`);
    }
    assert.deepEqual(JSON.parse(await readFile(data.argsOut, 'utf8')), [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-i', await realpath(data.asset),
        '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'
    ]);
});

test('サンプルが無ければ終了コードに関係なく no audio stream を返す', async t => {
    for (const exitCode of [0, 1]) {
        await t.test(`終了コード ${exitCode}`, async t => {
            const data = await fixture(t, { exitCode, stderr: 'Output file does not contain any stream\n' });
            assert.deepEqual(await data.service.buildWaveformPeaks(data.request), { ok: false, reason: 'no audio stream' });
        });
    }
});

test('workspace 外の素材を ffmpeg 起動前に拒否する', async t => {
    const data = await fixture(t);
    const outside = join(data.base, 'outside.mp4');
    await writeFile(outside, 'outside');
    data.service.resolveWaveformFfmpegCommand = async () => assert.fail('境界外では ffmpeg を解決しない');
    const result = await data.service.buildWaveformPeaks({ ...data.request, assetUri: pathToFileURL(outside).toString() });
    assert.equal(result.ok, false);
    assert.match(result.reason, /open workspace/u);
});

test('workspace 内の symlink 経由でも外の素材を拒否する', async t => {
    const data = await fixture(t);
    const outside = join(data.base, 'outside.mp4');
    const link = join(data.project, 'link.mp4');
    await writeFile(outside, 'outside');
    try {
        await symlink(outside, link, 'file');
    } catch (error) {
        if (process.platform === 'win32' && error.code === 'EPERM') return t.skip('symlink 作成権限なし');
        throw error;
    }
    const result = await data.service.buildWaveformPeaks({ ...data.request, assetUri: pathToFileURL(link).toString() });
    assert.equal(result.ok, false);
    assert.match(result.reason, /open workspace/u);
});

test('複数回の折り畳みでも尺と大振幅の位置を保持し、奇数バケットの末尾も残す', async t => {
    for (const buckets of [64, 65]) {
        await t.test(`${buckets} バケット`, async t => {
            const prefix = 1024 * (buckets - 1);
            const total = 1024 * buckets * 3 + 17;
            const data = await fixture(t, { segments: [
                { samples: prefix, amplitude: 0 },
                { samples: 1024, amplitude: 1 },
                { samples: total - prefix - 1024, amplitude: 0 }
            ] });
            const result = await data.service.buildWaveformPeaks({ ...data.request, buckets });
            assertPeaks(result, total, buckets);
            assert.equal(result.buckets, Math.ceil(total / 4096));
            assert.equal(result.peaks[Math.floor(prefix / 4096)], 1);
            assert.equal(result.peaks[0], 0);
            assert.equal(result.peaks.at(-1), 0);
        });
    }
});

test('buckets を下限・上限へクランプし小数も整数へ丸める', async t => {
    const samples = 1024 * 70;
    const data = await fixture(t, { segments: [{ samples, amplitude: 0.25 }] });
    for (const [buckets, expected] of [[5, 35], [999999, 70], [64.6, 35]]) {
        const result = await data.service.buildWaveformPeaks({ ...data.request, buckets });
        assertPeaks(result, samples, 20000);
        assert.equal(result.buckets, expected);
    }
});

test('奇数バイトの chunk を持ち越し、大量 stderr と非ゼロ終了でも読めたピークを返す', async t => {
    const data = await fixture(t, { segments: [{ samples: 4097, amplitude: 0.37 }],
        chunkBytes: 1023, chunkDelayMs: 5, exitCode: 1, stderr: 'diagnostic\n'.repeat(10000) });
    const result = await data.service.buildWaveformPeaks(data.request);
    assertPeaks(result, 4097, 4000);
    assert.ok(result.peaks.every(value => Math.abs(value - 0.37) < 0.001));
});

test('不正入力・素材欠落・ffmpeg 不在を throw せず失敗結果へ写す', async t => {
    const data = await fixture(t);
    for (const request of [null, 'asset', {}, { assetUri: 1 }]) {
        assert.deepEqual(await data.service.buildWaveformPeaks(request), { ok: false, reason: 'invalid waveform peaks request' });
    }
    const missing = await data.service.buildWaveformPeaks({ ...data.request,
        assetUri: pathToFileURL(join(data.project, 'missing.mp4')).toString() });
    assert.equal(missing.ok, false);
    assert.ok(missing.reason.length > 0);
    data.service.resolveWaveformFfmpegCommand = async () => ({ command: join(data.base, 'missing-ffmpeg'), prefixArgs: [] });
    assert.deepEqual(await data.service.buildWaveformPeaks(data.request), { ok: false, reason: 'ffmpeg not found' });
});
