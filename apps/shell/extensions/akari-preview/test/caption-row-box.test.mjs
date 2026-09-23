import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { captionRowWrapRect } from '../lib/common/caption-row-box.js';

const source = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');

test('default row box marks the 92% wrap width, centered inside a full-frame plate', () => {
    const rect = captionRowWrapRect(
        { left: 100, right: 776, top: 300, bottom: 350 },
        '92%', 676 / 1280, 'stretch', 'center'
    );
    assert.ok(Math.abs((rect.right - rect.left) - 621.92) < 0.01);
    assert.ok(Math.abs(rect.left - 127.04) < 0.01);
    assert.ok(Math.abs(rect.right - 748.96) < 0.01);
});

test('explicit-x and block row boxes respect their fixed width and alignment', () => {
    const placed = captionRowWrapRect(
        { left: -100, right: 522, top: 300, bottom: 350 },
        '100%', 676 / 1280, 'flex-start', 'left'
    );
    assert.deepEqual(placed, { left: -100, right: 522, top: 300, bottom: 350 });
    const right = captionRowWrapRect(
        { left: 100, right: 776, top: 300, bottom: 350 },
        '80%', 676 / 1280, 'flex-end', 'right'
    );
    assert.ok(Math.abs(right.left - 235.2) < 0.01);
    assert.equal(right.right, 776);
    const pixels = captionRowWrapRect(
        { left: 100, right: 776, top: 300, bottom: 350 },
        '600px', 676 / 1280, 'center', 'center'
    );
    assert.ok(Math.abs((pixels.right - pixels.left) - 316.875) < 0.01);
});

test('preview measures the line or block max-width before drawing the row box', () => {
    const start = source.indexOf('const updateCaptionRowBox = () => {');
    const end = source.indexOf('const roundCaptionRatioUnclamped =', start);
    const update = source.slice(start, end);
    assert.match(update, /querySelector\('\.akari-caption__block'\)/);
    assert.match(update, /querySelector\('\.akari-caption__line'\)/);
    assert.match(update, /lineStyle\?\.maxWidth/);
    assert.match(update, /captionRowWrapRectFn\(/);
    assert.doesNotMatch(update, /captionOutputPoint\(plateRect\.left, plateRect\.top\)/);
});
