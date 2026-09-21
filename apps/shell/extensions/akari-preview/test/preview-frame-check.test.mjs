import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectPreviewFrame, inspectPreviewFrameSentinel, runPreviewFrameCaptureAttempts, srgbToDisplayP3 } from '../lib/common/preview-frame-check.js';

const empty = () => ({ captions: [], chrome: [] });
const rect = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 };
const caption = { rect, color: [230, 150, 60] };
const badge = { rect, colors: [[90, 60, 120]], kind: 'fill' };
function bitmap(width = 100, height = 100, paint = () => [10, 15, 20], order = 'RGBA') {
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const [r, g, b, a = 255] = paint(x, y);
        pixels.set(order === 'BGRA' ? [b, g, r, a] : order === 'ARGB' ? [a, r, g, b] : [r, g, b, a], (y * width + x) * 4);
    }
    return pixels;
}

test('sRGB to Display P3 conversion preserves white/black and maps yellow to the measured blue range', () => {
    assert.deepEqual(srgbToDisplayP3([0, 0, 0]), [0, 0, 0]);
    assert.deepEqual(srgbToDisplayP3([255, 255, 255]), [255, 255, 255]);
    const yellow = [255, 255, 0];
    const converted = srgbToDisplayP3(yellow);
    assert.deepEqual(converted.slice(0, 2), [255, 255]);
    assert(converted[2] >= 80 && converted[2] <= 90);
    assert.deepEqual(yellow, [255, 255, 0]);
});

test('measured Display P3 yellow caption passes in every byte order; missing caption still fails', () => {
    const expectations = { ...empty(), captions: [{ rect, color: [255, 255, 0] }] };
    for (const order of ['RGBA', 'BGRA', 'ARGB']) {
        const pixels = bitmap(100, 100, (x, y) => x >= 30 && x < 50 && y >= 30 && y < 50
            ? [255, 255, 85] : [203, 122, 75], order);
        assert.deepEqual(inspectPreviewFrame(pixels, 100, 100, expectations, order), { ok: true, reasons: [] });
        assert.deepEqual(inspectPreviewFrame(bitmap(100, 100, () => [203, 122, 75], order), 100, 100, expectations, order),
            { ok: false, reasons: ['caption-missing'] });
    }
});

test('Display P3 badge border and fill colors still report chrome-leak', () => {
    // Gray is the L1 badge border. Green additionally proves conversion is needed: its P3
    // channels differ by more than 12 and do not satisfy the blue-dominance fallback.
    for (const color of [[143, 163, 180], [0, 255, 0]]) for (const kind of ['edge', 'fill']) {
        const expectations = { ...empty(), chrome: [{ rect, colors: [color], kind, band: { x: 0.02, y: 0.02 } }] };
        const converted = srgbToDisplayP3(color);
        for (const order of ['RGBA', 'BGRA']) {
            const pixels = bitmap(100, 100, (x, y) => x >= 20 && x < 80 && y >= 20 && y < 80
                && (kind === 'fill' || x < 22 || x >= 78 || y < 22 || y >= 78) ? converted : [203, 122, 75], order);
            assert.deepEqual(inspectPreviewFrame(pixels, 100, 100, expectations, order), { ok: false, reasons: ['chrome-leak'] });
            assert.equal(inspectPreviewFrame(bitmap(100, 100, () => [203, 122, 75], order), 100, 100, expectations, order).ok, true);
        }
    }
});

test('caption presence requires enough matching pixels inside its rectangle; absent captions require none', () => {
    assert.equal(inspectPreviewFrame(bitmap(), 100, 100, empty()).ok, true);
    const expectations = { ...empty(), captions: [caption] };
    assert.deepEqual(inspectPreviewFrame(bitmap(), 100, 100, expectations), { ok: false, reasons: ['caption-missing'] });
    assert.equal(inspectPreviewFrame(bitmap(100, 100, (x, y) => x >= 25 && x < 35 && y >= 25 && y < 35 ? caption.color : [0, 0, 0]), 100, 100, expectations).ok, true);
    assert.equal(inspectPreviewFrame(bitmap(100, 100, (x, y) => x < 10 ? caption.color : [0, 0, 0]), 100, 100, expectations).ok, false);
    assert.equal(inspectPreviewFrame(bitmap(100, 100, () => [...caption.color, 0]), 100, 100, expectations).ok, false);
});

test('caption threshold is max(30 pixels, 0.5% of the padded rectangle) and tolerance is 40', () => {
    const expectations = { ...empty(), captions: [caption] };
    for (const [count, ok] of [[29, false], [30, true]]) {
        const pixels = bitmap(100, 100, (x, y) => y === 30 && x >= 25 && x < 25 + count ? [190, 190, 100] : [0, 0, 0]);
        assert.equal(inspectPreviewFrame(pixels, 100, 100, expectations).ok, ok);
    }
    const pixels = bitmap(400, 400, (x, y) => y === 100 && x >= 100 && x < 140 ? caption.color : [0, 0, 0]);
    assert.equal(inspectPreviewFrame(pixels, 400, 400, expectations).ok, false);
});

test('badge leak uses a 30% ratio, not a few incidental matching video pixels', () => {
    const expectations = { ...empty(), chrome: [badge] };
    assert.equal(inspectPreviewFrame(bitmap(), 100, 100, expectations).ok, true);
    for (const [rows, ok] of [[1, true], [17, true], [18, false], [60, false]]) {
        const pixels = bitmap(100, 100, (x, y) => x >= 20 && x < 80 && y >= 20 && y < 20 + rows ? badge.colors[0] : [0, 0, 0]);
        assert.equal(inspectPreviewFrame(pixels, 100, 100, expectations).ok, ok);
    }
    assert.deepEqual(inspectPreviewFrame(bitmap(100, 100, () => badge.colors[0]), 100, 100, expectations).reasons, ['chrome-leak']);
});

test('edge bands detect outlines while ignoring a matching image in the interior', () => {
    const expectations = { ...empty(), chrome: [{ ...badge, kind: 'edge', band: { x: 0.02, y: 0.02 } }] };
    const edge = (x, y) => x >= 20 && x < 80 && y >= 20 && y < 80 && (x < 22 || x >= 78 || y < 22 || y >= 78);
    const pixels = bitmap(100, 100, (x, y) => edge(x, y) ? badge.colors[0] : [0, 0, 0]);
    assert.deepEqual(inspectPreviewFrame(pixels, 100, 100, expectations).reasons, ['chrome-leak']);
    const interior = bitmap(100, 100, (x, y) => x >= 22 && x < 78 && y >= 22 && y < 78 ? badge.colors[0] : [0, 0, 0]);
    assert.equal(inspectPreviewFrame(interior, 100, 100, expectations).ok, true);
    const topOnly = bitmap(100, 100, (x, y) => edge(x, y) && y < 22 ? badge.colors[0] : [0, 0, 0]);
    assert.equal(inspectPreviewFrame(topOnly, 100, 100, expectations).ok, true);
});

test('chrome matches color within 12 or blue dominance by more than 30', () => {
    const expectations = { ...empty(), chrome: [badge] };
    for (const [color, ok] of [[[102, 72, 132], false], [[103, 73, 120], true], [[0, 50, 200], false]]) {
        assert.equal(inspectPreviewFrame(bitmap(100, 100, () => color), 100, 100, expectations).ok, ok);
    }
});

test('normalized rectangles work at different output sizes; RGBA/BGRA/ARGB are explicit', () => {
    for (const size of [100, 200, 400]) for (const order of ['RGBA', 'BGRA', 'ARGB']) {
        const pixels = bitmap(size, size, (x, y) => x >= size * 0.3 && x < size * 0.5 && y >= size * 0.3 && y < size * 0.5 ? caption.color : [0, 0, 0], order);
        assert.equal(inspectPreviewFrame(pixels, size, size, { ...empty(), captions: [caption] }, order).ok, true);
    }
    assert.equal(inspectPreviewFrame(bitmap(100, 100, () => caption.color, 'BGRA'), 100, 100, { ...empty(), captions: [caption] }, 'RGBA').ok, false);
    assert.throws(() => inspectPreviewFrame(new Uint8Array(4), 100, 100, empty()), /Invalid preview bitmap/);
});

async function attempts(results) {
    const calls = [], saved = [], notified = [];
    const ok = await runPreviewFrameCaptureAttempts({ max: 3,
        attempt: async index => { calls.push(index); return { index, ok: results[index] }; },
        inspect: frame => ({ ok: frame.ok, reasons: frame.ok ? [] : ['chrome-leak'] }),
        save: async frame => { saved.push(frame.index); }, notify: text => notified.push(text)
    });
    return { ok, calls, saved, notified };
}
test('first capture leaks, second passes: save only the second, exactly once', async () => {
    assert.deepEqual(await attempts([false, true]), { ok: true, calls: [0, 1], saved: [1], notified: [] });
});
test('three failures: never save and notify the exact retry message', async () => {
    assert.deepEqual(await attempts([false, false, false]), { ok: false, calls: [0, 1, 2], saved: [], notified: ['コマを保存できませんでした。もう一度押してください'] });
});
test('normal capture: one attempt, one save', async () => {
    assert.deepEqual(await attempts([true]), { ok: true, calls: [0], saved: [0], notified: [] });
});

test('sentinel is uniform across color spaces/orders; icon lines exceeding 24 and 2% mean stale', () => {
    for (const order of ['RGBA', 'BGRA', 'ARGB']) {
        assert.equal(inspectPreviewFrameSentinel(bitmap(28, 28, () => [72, 40, 25], order), 28, 28, order), false);
        const icon = bitmap(28, 28, (x, y) => x >= 10 && x < 12 && y >= 7 && y < 21 ? [180, 80, 40] : [72, 40, 25], order);
        assert.equal(inspectPreviewFrameSentinel(icon, 28, 28, order), true);
        const subtle = bitmap(28, 28, (x, y) => x >= 10 && x < 12 ? [96, 64, 49] : [72, 40, 25], order);
        assert.equal(inspectPreviewFrameSentinel(subtle, 28, 28, order), false);
    }
    for (const [width, count, stale] of [[28, 15, false], [28, 16, true], [10, 5, false], [10, 6, true]]) {
        const pixels = bitmap(width, width, (x, y) => y === 5 && x >= 1 && x <= count ? [255, 255, 255] : [0, 0, 0]);
        assert.equal(inspectPreviewFrameSentinel(pixels, width, width), stale);
    }
    // One damaged corner does not change the median background or pass the minimum count.
    assert.equal(inspectPreviewFrameSentinel(bitmap(28, 28, (x, y) => x === 0 && y === 0 ? [255, 0, 0] : [0, 0, 0]), 28, 28), false);
});

test('stale-frame retries save only the second frame, or never save after three stale frames', async () => {
    for (const results of [[true, false], [true, true, true]]) {
        let attempts = 0;
        const saved = [], notified = [];
        await runPreviewFrameCaptureAttempts({
            attempt: async index => { attempts++; return { index, pixels: bitmap(28, 28, (x, y) => results[index] && x === 14 ? [220, 220, 220] : [20, 20, 20]) }; },
            inspect: frame => {
                const stale = inspectPreviewFrameSentinel(frame.pixels, 28, 28);
                return { ok: !stale, reasons: stale ? ['stale-frame'] : [] };
            },
            save: async frame => { saved.push(frame.index); }, notify: text => notified.push(text)
        });
        assert.equal(attempts, results.length);
        assert.deepEqual(saved, results.length === 2 ? [1] : []);
        assert.deepEqual(notified, results.length === 2 ? [] : ['コマを保存できませんでした。もう一度押してください']);
    }
});

test('empty fill color candidates skip blended black but retain blue detection', () => {
    const expectations = { ...empty(), chrome: [{ rect, kind: 'fill', colors: [] }] };
    assert.equal(inspectPreviewFrame(bitmap(100, 100, () => [0, 0, 0]), 100, 100, expectations).ok, true);
    assert.equal(inspectPreviewFrame(bitmap(100, 100, () => [72, 40, 25]), 100, 100, expectations).ok, true);
    assert.deepEqual(inspectPreviewFrame(bitmap(100, 100, () => [0, 0, 200]), 100, 100, expectations).reasons, ['chrome-leak']);
});
