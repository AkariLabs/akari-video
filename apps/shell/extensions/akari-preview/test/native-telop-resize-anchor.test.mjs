import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { layerResizeCornerPoint } from '../lib/common/layer-resize-anchor.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'), 'utf8');

test('ネイティブテロップを含む layer resize は pointerdown 時の対角アンカーを固定する', () => {
    const layerResize = source.slice(
        source.indexOf('for (const handle of layerHandleElements)'),
        source.indexOf('for (const handle of layerCropHandleElements)')
    );
    assert.match(layerResize, /const oppositeKind = \{ nw: 'se', ne: 'sw', se: 'nw', sw: 'ne' \}\[kind\]/);
    assert.match(layerResize, /layerResizeCornerPointFn\(/);
    assert.match(layerResize, /window\.akari\.interaction\.computeAnchorResizeSnap\(\{/);
    assert.match(layerResize, /window\.akari\.interaction\.anchorPreservingTranslate\(\{/);
    assert.match(layerResize, /anchorStageX: anchor\.x[\s\S]*anchorStageY: anchor\.y/);
    assert.doesNotMatch(layerResize, /Math\.hypot\(event\.clientX - center\.x/);
});

test('実体コーナー基準の拡大と往復は対角ドリフト 0.25px 以下で可逆', () => {
    const tolerance = 0.25;
    const center = { x: 100, y: 80 };
    const startScale = 0.9848080971000006;
    const startTransform = { x: 41.365954777887225, y: 0 };
    const stageCenter = { x: 960, y: 540 };
    const anchor = layerResizeCornerPoint(center.x, center.y, 49.32, 12.59, 0, 'nw');
    const translateAt = scale => {
        const ratio = scale / startScale;
        const dx = anchor.x - stageCenter.x;
        const dy = anchor.y - stageCenter.y;
        return {
            x: dx - ratio * (dx - startTransform.x),
            y: dy - ratio * (dy - startTransform.y)
        };
    };
    const anchorAt = (scale, transform) => {
        const ratio = scale / startScale;
        return {
            x: stageCenter.x + transform.x + ratio * (anchor.x - stageCenter.x - startTransform.x),
            y: stageCenter.y + transform.y + ratio * (anchor.y - stageCenter.y - startTransform.y)
        };
    };
    const enlargedScale = startScale * 1.8;
    const enlargedAnchor = anchorAt(enlargedScale, translateAt(enlargedScale));
    assert.ok(Math.hypot(enlargedAnchor.x - anchor.x, enlargedAnchor.y - anchor.y) <= tolerance);
    const returnedAnchor = anchorAt(startScale, translateAt(startScale));
    assert.ok(Math.hypot(returnedAnchor.x - anchor.x, returnedAnchor.y - anchor.y) <= tolerance);
    assert.ok(Math.abs(translateAt(startScale).x - startTransform.x) < 1e-12);
    assert.ok(Math.abs(translateAt(startScale).y - startTransform.y) < 1e-12);
});

test('回転時も resize handle の装飾矩形ではなく描画 box の対角を返す', () => {
    const nw = layerResizeCornerPoint(200, 120, 80, 40, 30, 'nw');
    const se = layerResizeCornerPoint(200, 120, 80, 40, 30, 'se');
    assert.ok(Math.abs((nw.x + se.x) / 2 - 200) < 1e-9);
    assert.ok(Math.abs((nw.y + se.y) / 2 - 120) < 1e-9);
    assert.ok(Math.abs(Math.hypot(se.x - nw.x, se.y - nw.y) - Math.hypot(80, 40)) < 1e-9);
});
