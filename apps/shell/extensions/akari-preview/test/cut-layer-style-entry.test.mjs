import assert from 'node:assert/strict';
import test from 'node:test';

import { cutLayerStyleBoxPx, cutLayerStyleEntryTransform } from '../lib/common/cut-layer-style-entry.js';

const near = (actual, expected, message) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} != ${expected}`);
const t = (over = {}) => ({ x: 0, y: 0, scale: 1, rotate: 0, ...over });

test('横長ソース → 縦出力: contain fit は幅で決まり scale へ焼き込まれる', () => {
    // 1920x1080 のソースを 1080x1920 の出力へ contain fit すると 1080/1920 = 0.5625。
    const entry = cutLayerStyleEntryTransform(t(), 1920, 1080, 1080, 1920);
    near(entry.scale, 1080 / 1920, 'scale');
    // 焼き込んだ box が出力幅いっぱい・元の見た目と同じであること。
    const box = cutLayerStyleBoxPx({ width: 1920, height: 1080 }, { x: 0, y: 0, w: 1, h: 1 }, entry.scale);
    near(box.width, 1080, 'box.width = 出力幅');
    near(box.height, 1080 * 1080 / 1920, 'box.height = アスペクト維持');
});

test('縦長ソース → 横出力: contain fit は高さで決まる', () => {
    const entry = cutLayerStyleEntryTransform(t(), 1080, 1920, 1920, 1080);
    near(entry.scale, 1080 / 1920, 'scale');
    const box = cutLayerStyleBoxPx({ width: 1080, height: 1920 }, { x: 0, y: 0, w: 1, h: 1 }, entry.scale);
    near(box.height, 1080, 'box.height = 出力高');
    assert.ok(box.width <= 1920 + 1e-9, 'box.width は出力幅に収まる');
});

test('同寸（fit = 1）では恒等', () => {
    const entry = cutLayerStyleEntryTransform(t({ x: 12, y: -8, rotate: 15 }), 1920, 1080, 1920, 1080);
    assert.deepEqual(entry, { x: 12, y: -8, scale: 1, rotate: 15 });
});

test('scale ≠ 1 は fit を掛けた値になり、x / y / rotate は不変', () => {
    const entry = cutLayerStyleEntryTransform(t({ x: 40, y: -25, scale: 1.5, rotate: -12 }), 1920, 1080, 1280, 720);
    near(entry.scale, 1.5 * (1280 / 1920), 'scale × fit');
    assert.equal(entry.x, 40);
    assert.equal(entry.y, -25);
    assert.equal(entry.rotate, -12);
});

test('output.geometry: "source" の文書では恒等（fit を掛けない）', () => {
    const transform = t({ x: 7, y: 9, scale: 1.25, rotate: 33 });
    const migrated = cutLayerStyleEntryTransform(transform, 1920, 1080, 1080, 1920, 'source');
    assert.deepEqual(migrated, { x: 7, y: 9, scale: 1.25, rotate: 33 });
    // 未宣言（= 現行 schema）は従来どおり fit 焼き込み。
    const legacy = cutLayerStyleEntryTransform(transform, 1920, 1080, 1080, 1920, undefined);
    near(legacy.scale, 1.25 * (1080 / 1920), '未宣言では fit が掛かる');
});

test('寸法が使えないときは恒等（NaN を書き戻さない）', () => {
    for (const args of [[0, 1080, 1280, 720], [1920, 0, 1280, 720], [1920, 1080, 0, 720], [1920, 1080, 1280, 0]]) {
        const entry = cutLayerStyleEntryTransform(t({ scale: 2 }), ...args);
        assert.equal(entry.scale, 2, `恒等: ${args.join(',')}`);
    }
    const broken = cutLayerStyleEntryTransform(
        { x: Number.NaN, y: undefined, scale: -1, rotate: Number.NaN },
        1920, 1080, 1920, 1080
    );
    assert.deepEqual(broken, { x: 0, y: 0, scale: 1, rotate: 0 });
});

test('cutLayerStyleBoxPx は crop の部分窓ぶんだけ小さい箱を返す', () => {
    const natural = { width: 1920, height: 1080 };
    const full = cutLayerStyleBoxPx(natural, { x: 0, y: 0, w: 1, h: 1 }, 1);
    assert.deepEqual(full, { width: 1920, height: 1080 });

    // 上辺を 25% クロップ（y > 0・h < 1）した窓。
    const cropped = cutLayerStyleBoxPx(natural, { x: 0, y: 0.25, w: 1, h: 0.75 }, 1);
    near(cropped.width, 1920, 'width は crop.w のまま');
    near(cropped.height, 1080 * 0.75, 'height は crop.h ぶん縮む');

    // scale はそのまま掛かる。
    const scaled = cutLayerStyleBoxPx(natural, { x: 0.1, y: 0.2, w: 0.5, h: 0.4 }, 2);
    near(scaled.width, 1920 * 0.5 * 2, 'width = natural × crop.w × scale');
    near(scaled.height, 1080 * 0.4 * 2, 'height = natural × crop.h × scale');

    // 壊れた入力でも負や NaN を返さない。
    const broken = cutLayerStyleBoxPx({ width: Number.NaN, height: -3 }, { x: 0, y: 0, w: 0, h: undefined }, 0);
    assert.equal(broken.width, 0);
    assert.equal(broken.height, 0);
});
