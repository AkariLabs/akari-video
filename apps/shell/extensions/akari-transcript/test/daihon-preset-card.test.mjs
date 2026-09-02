import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { orderPresetsForPicker, presetCardStyle } = require('../lib/common/daihon-preset-card.js');

test('color・size_px・weight をカード用 CSS へ写す', () => {
    assert.deepEqual(presetCardStyle({ color: '#abcdef', size_px: 28, weight: 700 }), {
        color: '#abcdef', fontSize: '7.5px', fontWeight: '700'
    });
});

test('size_px のプレビューは 15px を上限にする', () => {
    assert.equal(presetCardStyle({ size_px: 168 }).fontSize, '15px');
});

test('stroke は比率縮小し 1px を上限にする', () => {
    assert.equal(
        presetCardStyle({ stroke: { color: '#000000', width_px: 9 } }).webkitTextStroke,
        '1px #000000'
    );
});

test('background の color と radius_px を CSS へ写す', () => {
    assert.deepEqual(presetCardStyle({ background: { color: '#c62828', radius_px: 8 } }), {
        backgroundColor: '#c62828', borderRadius: '2.14px'
    });
});

test('16 進色 shadow は textShadow に近似する', () => {
    assert.equal(presetCardStyle({ shadow: {
        color: '#000000', distance_px: 4, angle_deg: 90, blur_px: 6
    } }).textShadow, '0px 1.07px 1.61px #000000');
});

test('rgba shadow・glow・未知キーは無視する', () => {
    assert.deepEqual(presetCardStyle({
        shadow: { color: 'rgba(0,0,0,.6)', blur_px: 8 },
        glow: { color: '#00ffff' }, mystery: true
    }), {});
});

test('無料 3 種を先頭へ固定する', () => {
    const catalog = Object.fromEntries([
        ['other', { id: 'other', name: 'other', category: 'subtitle', style: {} }],
        ['subtitle-news', { id: 'subtitle-news', name: 'news', category: 'subtitle', style: {} }],
        ['subtitle-variety', { id: 'subtitle-variety', name: 'pop', category: 'subtitle', style: {} }],
        ['subtitle-standard', { id: 'subtitle-standard', name: 'standard', category: 'subtitle', style: {} }]
    ]);
    assert.deepEqual(orderPresetsForPicker(catalog).map(item => item.id), [
        'subtitle-standard', 'subtitle-variety', 'subtitle-news', 'other'
    ]);
});

test('残りはカテゴリ順・同カテゴリ id 昇順にする', () => {
    const entries = [
        ['z-title', 'title'], ['b-emphasis', 'emphasis'], ['a-decorative', 'decorative'],
        ['a-emphasis', 'emphasis'], ['a-price', 'price'], ['z-subtitle', 'subtitle']
    ].map(([id, category]) => [id, { id, name: id, category, style: {} }]);
    assert.deepEqual(orderPresetsForPicker(Object.fromEntries(entries)).map(item => item.id), [
        'z-subtitle', 'a-emphasis', 'b-emphasis', 'a-price', 'a-decorative', 'z-title'
    ]);
});
