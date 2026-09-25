import assert from 'node:assert/strict';
import test from 'node:test';
import { shapeMarkup } from '@akari-video/edit-store';
import { shapeLiveMarkup, shapeLiveParams } from '../lib/browser/inspector/shape-live.js';

const rect = {
    shape: 'rounded-rect',
    params: { width: 600, height: 340, fill: '#a6a6a6', strokeWidth: 0, cornerRadius: 0 }
};

test('数値のつまみは書き込みと同じ丸めで SVG を作り直す', () => {
    const stroked = shapeLiveMarkup({ itemId: 'box-a', ...rect, outputWidth: 1920 }, 'strokeWidth', 8);
    assert.equal(stroked, shapeMarkup({ shape: 'rounded-rect', params: { ...rect.params, strokeWidth: 8 } },
        'box-a', 1920));
    assert.match(stroked, /stroke-width="8"/);
    const rounded = shapeLiveMarkup({ itemId: 'box-a', ...rect, outputWidth: 1920 }, 'cornerRadius', 120);
    assert.equal(rounded, shapeMarkup({ shape: 'rounded-rect', params: { ...rect.params, cornerRadius: 100 } },
        'box-a', 1920));
    assert.match(rounded, /rx="100"/);
});

test('線の太さは line だけ最小 1 にし、範囲外は書き込みと同じ値にする', () => {
    const line = { shape: 'line', params: { width: 600, height: 80, stroke: '#000000', strokeWidth: 4 } };
    assert.equal(shapeLiveMarkup({ itemId: 'l', ...line, outputWidth: 1920 }, 'strokeWidth', 0),
        shapeMarkup({ shape: 'line', params: { ...line.params, strokeWidth: 1 } }, 'l', 1920));
    assert.equal(shapeLiveParams('rounded-rect', rect.params, 'strokeWidth', 500).strokeWidth, 100);
});

test('塗りの色は hex のときだけ降ろし、途中の入力では送らない', () => {
    const filled = shapeLiveMarkup({ itemId: 'box-a', ...rect, outputWidth: 1920 }, 'fill', '#f97316');
    assert.equal(filled, shapeMarkup({ shape: 'rounded-rect', params: { ...rect.params, fill: '#f97316' } },
        'box-a', 1920));
    assert.match(filled, /fill="#f97316"/);
    assert.equal(shapeLiveMarkup({ itemId: 'box-a', ...rect, outputWidth: 1920 }, 'fill', '#f9'), undefined);
    assert.equal(shapeLiveMarkup({ itemId: 'box-a', ...rect, outputWidth: 1920 }, 'stroke', 'none'), undefined);
});

test('色なし・色ありは枠の自動太さまで書き込みと同じにする', () => {
    assert.equal(shapeLiveParams('rounded-rect', rect.params, 'fillMode', 'なし').fill, 'none');
    assert.deepEqual(shapeLiveParams('rounded-rect', rect.params, 'strokeMode', '色'),
        { ...rect.params, stroke: '#000000', strokeWidth: 4 });
    assert.equal(shapeLiveParams('bubble', { tail: 'point' }, 'fillMode', '色').fill, '#ffffff');
    assert.equal(shapeLiveParams('rounded-rect', rect.params, 'fillMode', '変な値'), undefined);
});

test('吹き出しのしっぽの角度・長さ・幅が SVG の形へ届く', () => {
    const bubble = {
        shape: 'bubble',
        params: { width: 600, height: 340, style: 'ellipse', tail: 'point',
            tailAngle: 210, tailLength: 45, tailWidth: 30, seed: 1 }
    };
    const moved = shapeLiveMarkup({ itemId: 'b', ...bubble, outputWidth: 1920 }, 'tailAngle', 300);
    const base = shapeLiveMarkup({ itemId: 'b', ...bubble, outputWidth: 1920 }, 'tailAngle', 210);
    assert.notEqual(base, moved);
    assert.equal(moved, shapeMarkup({ shape: 'bubble', params: { ...bubble.params, tailAngle: 300 } }, 'b', 1920));
    assert.equal(shapeLiveMarkup({ itemId: 'b', ...bubble, outputWidth: 1920 }, 'tailLength', 80),
        shapeMarkup({ shape: 'bubble', params: { ...bubble.params, tailLength: 80 } }, 'b', 1920));
    assert.equal(shapeLiveMarkup({ itemId: 'b', ...bubble, outputWidth: 1920 }, 'tailWidth', 60),
        shapeMarkup({ shape: 'bubble', params: { ...bubble.params, tailWidth: 60 } }, 'b', 1920));
});

test('線種やしっぽの選択も保存値へ戻せる', () => {
    assert.equal(shapeLiveParams('line', {}, 'dash', '破線').dash, 'dash');
    assert.equal(shapeLiveParams('bubble', {}, 'tail', '小さな丸').tail, 'dots');
    assert.equal(shapeLiveParams('bubble', {}, 'tail', '変な値'), undefined);
});

test('対応していないキーや図形の欠落は何も送らない', () => {
    assert.equal(shapeLiveMarkup({ itemId: 'box-a', ...rect }, 'seed', 2), undefined);
    assert.equal(shapeLiveMarkup({ itemId: 'box-a', params: rect.params }, 'strokeWidth', 8), undefined);
    assert.equal(shapeLiveParams(undefined, rect.params, 'strokeWidth', 8), undefined);
});
