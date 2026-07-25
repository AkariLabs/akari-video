import assert from 'node:assert/strict';
import test from 'node:test';

import { fitPreviewCompositeRect } from '../lib/common/preview-composite-layout.js';

const closeTo = (actual, expected, epsilon = 1e-9) => {
    assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} should be within ${epsilon} of ${expected}`);
};

test('fits a 16:9 output frame inside a wider preview wrapper', () => {
    const rect = fitPreviewCompositeRect(1590, 704, 1280, 720);

    closeTo(rect.width, 704 * 16 / 9);
    closeTo(rect.height, 704);
    closeTo(rect.x, (1590 - 704 * 16 / 9) / 2);
    closeTo(rect.y, 0);

    const frameScale = rect.width / 1280;
    closeTo(1280 * frameScale, rect.width);
    closeTo(720 * frameScale, rect.height);
});

test('fits a portrait output frame inside a wider preview wrapper', () => {
    const rect = fitPreviewCompositeRect(1200, 700, 1080, 1920);

    closeTo(rect.width, 700 * 1080 / 1920);
    closeTo(rect.height, 700);
    closeTo(rect.x, (1200 - rect.width) / 2);
    closeTo(rect.y, 0);
});

test('falls back to the available box before media metadata is ready', () => {
    assert.deepEqual(
        fitPreviewCompositeRect(800, 450, 0, 0),
        { x: 0, y: 0, width: 800, height: 450 }
    );
});
