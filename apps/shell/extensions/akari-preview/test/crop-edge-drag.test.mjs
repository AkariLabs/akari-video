import assert from 'node:assert/strict';
import test from 'node:test';

import { cropRectAfterEdgeDrag } from '../lib/common/crop-edge-drag.js';

// webview 側の CROP_MIN と同じ下限（空クロップ化を防ぐ）。
const MIN = 0.02;
const full = () => ({ x: 0, y: 0, w: 1, h: 1 });
const near = (actual, expected, message) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);

test('辺バーを内側へ引くと掴んだ辺だけが動き、他の 3 辺は不動', () => {
    const n = cropRectAfterEdgeDrag(full(), 'n', { x: 0.5, y: 0.25 }, MIN);
    assert.deepEqual(n, { x: 0, y: 0.25, w: 1, h: 0.75 });

    const s = cropRectAfterEdgeDrag(full(), 's', { x: 0.5, y: 0.8 }, MIN);
    assert.deepEqual(s, { x: 0, y: 0, w: 1, h: 0.8 });

    const w = cropRectAfterEdgeDrag(full(), 'w', { x: 0.3, y: 0.5 }, MIN);
    assert.deepEqual(w, { x: 0.3, y: 0, w: 0.7, h: 1 });

    const e = cropRectAfterEdgeDrag(full(), 'e', { x: 0.6, y: 0.5 }, MIN);
    assert.deepEqual(e, { x: 0, y: 0, w: 0.6, h: 1 });
});

test('辺バーを外側へ戻すとソース端まで解除される（0..1 でクランプ）', () => {
    const prev = { x: 0.2, y: 0.3, w: 0.5, h: 0.4 };

    // ソース端の内側で止めた場合は掴んだ辺だけが動く。
    const w = cropRectAfterEdgeDrag(prev, 'w', { x: 0.05, y: 0.5 }, MIN);
    near(w.x, 0.05, 'w: 左辺だけが動く');
    near(w.w, 0.65, 'w: 右辺は不動');
    near(w.y, 0.3, 'w: y は不動');
    near(w.h, 0.4, 'w: h は不動');

    const e = cropRectAfterEdgeDrag(prev, 'e', { x: 0.95, y: 0.5 }, MIN);
    near(e.x, 0.2, 'e: x は不動');
    near(e.w, 0.75, 'e: 右辺だけが動く');

    const n = cropRectAfterEdgeDrag(prev, 'n', { x: 0.5, y: 0.05 }, MIN);
    near(n.y, 0.05, 'n: 上辺だけが動く');
    near(n.h, 0.65, 'n: 下辺は不動');

    const s = cropRectAfterEdgeDrag(prev, 's', { x: 0.5, y: 0.95 }, MIN);
    near(s.y, 0.3, 's: 上辺は不動');
    near(s.h, 0.65, 's: 下辺だけが動く');
});

test('ソース端を越えて引き切ると当該軸のクロップが全解除される（従来の clampCrop 挙動）', () => {
    const prev = { x: 0.2, y: 0.3, w: 0.5, h: 0.4 };

    // 掴んだ辺を端の外まで引くと生の幅/高さが 1 を越え、1 へクランプされて x/y が 0 に落ちる。
    for (const [dir, point] of [['e', { x: 1.8, y: 0.5 }], ['w', { x: -0.9, y: 0.5 }]]) {
        const result = cropRectAfterEdgeDrag(prev, dir, point, MIN);
        near(result.x, 0, `${dir}: x は 0 へ`);
        near(result.w, 1, `${dir}: 幅は全解除`);
        near(result.y, 0.3, `${dir}: y は不動`);
        near(result.h, 0.4, `${dir}: h は不動`);
    }

    for (const [dir, point] of [['s', { x: 0.5, y: 3 }], ['n', { x: 0.5, y: -2 }]]) {
        const result = cropRectAfterEdgeDrag(prev, dir, point, MIN);
        near(result.y, 0, `${dir}: y は 0 へ`);
        near(result.h, 1, `${dir}: 高さは全解除`);
        near(result.x, 0.2, `${dir}: x は不動`);
        near(result.w, 0.5, `${dir}: w は不動`);
    }
});

test('掴んだ辺が対辺を越えても CROP_MIN で止まる', () => {
    const n = cropRectAfterEdgeDrag(full(), 'n', { x: 0.5, y: 1.4 }, MIN);
    near(n.y, 1 - MIN, 'n: 上辺は下辺 - CROP_MIN で止まる');
    near(n.h, MIN, 'n: 高さは CROP_MIN');

    const s = cropRectAfterEdgeDrag(full(), 's', { x: 0.5, y: -0.5 }, MIN);
    near(s.y, 0, 's: 上辺は不動');
    near(s.h, MIN, 's: 高さは CROP_MIN');

    const w = cropRectAfterEdgeDrag(full(), 'w', { x: 2, y: 0.5 }, MIN);
    near(w.x, 1 - MIN, 'w: 左辺は右辺 - CROP_MIN で止まる');
    near(w.w, MIN, 'w: 幅は CROP_MIN');

    const e = cropRectAfterEdgeDrag(full(), 'e', { x: -3, y: 0.5 }, MIN);
    near(e.x, 0, 'e: 左辺は不動');
    near(e.w, MIN, 'e: 幅は CROP_MIN');
});

test('角ハンドル（2 文字）は 2 辺を同時に動かす — ⛶ モードの従来挙動と同じ式', () => {
    const nw = cropRectAfterEdgeDrag(full(), 'nw', { x: 0.25, y: 0.4 }, MIN);
    assert.deepEqual(nw, { x: 0.25, y: 0.4, w: 0.75, h: 0.6 });

    const se = cropRectAfterEdgeDrag(full(), 'se', { x: 0.7, y: 0.9 }, MIN);
    assert.deepEqual(se, { x: 0, y: 0, w: 0.7, h: 0.9 });

    // 参照実装 = 差し替え前の webview の computeNext（対辺アンカー固定 + clampCrop）。
    const reference = (prev, dir, point, min) => {
        const anchorRight = prev.x + prev.w;
        const anchorBottom = prev.y + prev.h;
        let nextX = prev.x;
        let nextY = prev.y;
        let nextRight = anchorRight;
        let nextBottom = anchorBottom;
        if (dir.indexOf('w') >= 0) nextX = Math.min(point.x, anchorRight - min);
        if (dir.indexOf('e') >= 0) nextRight = Math.max(point.x, prev.x + min);
        if (dir.indexOf('n') >= 0) nextY = Math.min(point.y, anchorBottom - min);
        if (dir.indexOf('s') >= 0) nextBottom = Math.max(point.y, prev.y + min);
        const cw = Math.min(1, Math.max(min, nextRight - nextX));
        const ch = Math.min(1, Math.max(min, nextBottom - nextY));
        return {
            x: Math.min(1 - cw, Math.max(0, nextX)),
            y: Math.min(1 - ch, Math.max(0, nextY)),
            w: cw,
            h: ch
        };
    };
    const prev = { x: 0.1, y: 0.2, w: 0.6, h: 0.5 };
    for (const dir of ['n', 'e', 's', 'w', 'nw', 'ne', 'se', 'sw']) {
        for (const point of [
            { x: 0.05, y: 0.05 }, { x: 0.45, y: 0.55 }, { x: 1.6, y: -0.4 }, { x: -0.4, y: 1.6 }
        ]) {
            assert.deepEqual(
                cropRectAfterEdgeDrag(prev, dir, point, MIN),
                reference(prev, dir, point, MIN),
                `${dir} @ ${point.x},${point.y}`
            );
        }
    }
});

test('壊れた入力でも 0..1 の使える矩形を返す', () => {
    const broken = cropRectAfterEdgeDrag(
        { x: Number.NaN, y: undefined, w: 0, h: -1 },
        'n',
        { x: Number.NaN, y: 0.5 },
        MIN
    );
    assert.ok(broken.x >= 0 && broken.y >= 0);
    assert.ok(broken.w > 0 && broken.w <= 1);
    assert.ok(broken.h > 0 && broken.h <= 1);
    assert.ok(broken.x + broken.w <= 1 + 1e-9);
    assert.ok(broken.y + broken.h <= 1 + 1e-9);
});
