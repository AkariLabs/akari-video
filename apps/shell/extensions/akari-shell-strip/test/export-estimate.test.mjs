import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateExport, formatEstimate } from '../lib/common/export-estimate.js';

const BASE = {
    frames: 300,
    width: 1920,
    height: 1080,
    fps: 30,
    quality: 'standard',
    encoder: 'videotoolbox',
    engine: 'gpu'
};

test('estimateExport: GPU 固定表と音声ビットレートを含める', () => {
    const estimate = estimateExport(BASE);
    assert.equal(estimate.seconds, 11.4);
    assert.equal(estimate.bytes, 10_240_000);
});

test('estimateExport: engine が一致する前回実測をコマ単価に使う', () => {
    const estimate = estimateExport({
        ...BASE,
        lastRun: { frames: 100, width: 1920, height: 1080, elapsedMs: 5000, engine: 'gpu' }
    });
    assert.equal(estimate.seconds, 24);
});

test('estimateExport: 前回実測と固定表を画素数比で補正する', () => {
    const fixed = estimateExport({ ...BASE, width: 3840, height: 2160 });
    assert.equal(fixed.seconds, 18.6);
    const measured = estimateExport({
        ...BASE,
        width: 3840,
        height: 2160,
        lastRun: { frames: 100, width: 1920, height: 1080, elapsedMs: 5000, engine: 'gpu' }
    });
    assert.equal(measured.seconds, 69);
});

test('formatEstimate: 時間は 10 秒、容量は MB / GB 単位へ丸める', () => {
    assert.deepEqual(formatEstimate(4, 18_400_000), { time: '約 10 秒', size: '約 18 MB' });
    assert.deepEqual(formatEstimate(78, 1_240_000_000), { time: '約 1 分 20 秒', size: '約 1.2 GB' });
});

test('estimateExport: HEVC の容量目安は同じ設定の H.264 の 0.6 倍', () => {
    const h264 = estimateExport({ ...BASE, codec: 'h264' });
    const hevc = estimateExport({ ...BASE, codec: 'hevc' });
    assert.equal(hevc.seconds, h264.seconds);
    assert.equal(hevc.bytes, h264.bytes * 0.6);
});

test('estimateExport: ProRes 422 HQ は 1080p30 を約 220 Mbps で見積もる', () => {
    const estimate = estimateExport({ ...BASE, codec: 'prores422' });
    assert.equal(estimate.bytes, (220 + 1.536) * 1_000_000 * 10 / 8);
});

test('estimateExport: PNG は 1080p 基準 1 コマ 1.2 MB と画素数比で見積もる', () => {
    const full = estimateExport({ ...BASE, codec: 'png' });
    const halfPixels = estimateExport({ ...BASE, width: 960, height: 1080, codec: 'png' });
    const audioBytes = 1.536 * 1_000_000 * 10 / 8;
    assert.equal(full.bytes, 1_200_000 * 300 + audioBytes);
    assert.equal(halfPixels.bytes, 1_200_000 * 300 * 0.5 + audioBytes);
});
