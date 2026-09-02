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
