import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveLayerHitRegionClip } from '../lib/common/layer-hit-region.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'), 'utf8');

test('全画面 telop video の native hit 領域を alpha 実体矩形へ絞る', () => {
    const clip = resolveLayerHitRegionClip(
        1920,
        1080,
        { x: 0, y: 0, w: 1, h: 1 },
        { x: 1920 * 0.0292, y: 1080 * 0.0519, w: 1920 * 0.8, h: 1080 * 0.8444 }
    );
    const values = [...clip.matchAll(/[\d.]+/g)].map(match => Number(match[0]));
    assert.deepEqual(values.map(value => Number(value.toFixed(2))), [5.19, 17.08, 10.37, 2.92]);
});

test('crop と alpha 実体矩形は交差を native hit 領域にする', () => {
    assert.equal(
        resolveLayerHitRegionClip(
            1000,
            500,
            { x: 0.1, y: 0.2, w: 0.5, h: 0.6 },
            { x: 200, y: 50, w: 600, h: 300 }
        ),
        'inset(20% 40% 30% 20%)'
    );
});

test('baked layer は実体計測まで全面 hit を無効化し、計測値を clip-path 消費側へ渡す', () => {
    assert.match(source, /if \(layer\.kind === 'baked'\) layerVideo\.style\.pointerEvents = 'none'/);
    assert.match(source, /const syncLayerHitRegion = \(entry, forceMeasure = false\) =>/);
    assert.match(source, /entry\.video\.dataset\.akariOpaqueX = String\(box\.x\)/);
    assert.match(source, /layerVideo\.style\.clipPath = resolveLayerHitRegionClipFn\(/);
    assert.match(source, /entry\.video\.addEventListener\('seeked', \(\) => syncLayerHitRegion\(entry, true\)\)/);
});
