import assert from 'node:assert/strict';
import test from 'node:test';
import {
    alignDelta, barItems, elementMenuPosition, formatRange, geometryValues, paintCss, parseContextBarState, shortcutLabel, windowValues
} from '../lib/common/context-bar-view.js';
import { previewContextBarPageScript } from '../lib/browser/preview-context-bar-page.js';

const base = { editUri: 'file:///p/edit.json', selectedId: 'a', parentId: null, locked: false, hasCorners: false, multi: 0,
    styleCopy: null, output: { width: 1920, height: 1080 }, lockedIds: [], sourcePath: null };
const state = (kind, item, extra = {}) => parseContextBarState({ ...base, kind, item, ...extra });
const keys = items => items.filter(item => item.kind !== 'separator').map(item => item.key);

test('状態の読み取り: 形の崩れたものは捨てる・ロック中の id を持つ', () => {
    assert.equal(parseContextBarState(null), undefined);
    assert.equal(parseContextBarState({ selectedId: 'a' }), undefined);
    const parsed = parseContextBarState({ ...base, kind: 'shape', item: {}, lockedIds: ['a', 3, 'b'] });
    assert.deepEqual(parsed.lockedIds, ['a', 'b']);
});

test('上のバー: 種類で項目が変わる（図形 / ライン / 写真 / そのほか / キャンバス）', () => {
    const square = { source: { kind: 'shape', shape: 'path', params: { fill: '#3b82f6', stroke: 'none', strokeWidth: 0 } } };
    assert.deepEqual(keys(barItems(state('shape', square, { hasCorners: true }))),
        ['fill', 'stroke', 'weight', 'radius', 'opacity', 'anim', 'arrange']);
    assert.deepEqual(keys(barItems(state('shape', square))), ['fill', 'stroke', 'weight', 'opacity', 'anim', 'arrange']);
    const fill = barItems(state('shape', square))[0];
    assert.equal(fill.paint, '#3b82f6');
    assert.equal(fill.path, 'source.params.fill');
    // 太さ 0 の枠は「なし」の丸
    assert.equal(barItems(state('shape', square)).find(item => item.key === 'stroke').paint, 'none');
    const line = { source: { kind: 'shape', shape: 'line', params: { stroke: '#000000', strokeWidth: 4 } } };
    assert.deepEqual(keys(barItems(state('line', line))), ['stroke', 'weight', 'dash', 'ends', 'opacity', 'anim', 'arrange']);
    const photo = keys(barItems(state('photo', { source: { kind: 'media', src: 'photo' } })));
    assert.deepEqual(photo.slice(0, 2), ['edit', 'replace']);
    assert.ok(['cutout', 'eraser', 'photoColor', 'crop', 'flip', 'opacity', 'anim', 'arrange', 'style'].every(key => photo.includes(key)));
    assert.deepEqual(keys(barItems(state('text', { source: { kind: 'caption' } }))), ['opacity', 'anim', 'arrange', 'style']);
    assert.deepEqual(keys(barItems(state('canvas', { source: { kind: 'group' } }))), ['opacity', 'anim', 'arrange']);
    assert.deepEqual(barItems(state('shape', square, { selectedId: null })), []);
});

test('窓の値: 不透明度・太さ・線の種類・端・反転 / 配置の数値', () => {
    const item = { opacity: 0.4, flip: { h: true }, transform: { x: 12.34, y: -5, scaleX: 2, scaleY: 0.5, rotate: 30 },
        source: { kind: 'shape', shape: 'line', params: { strokeWidth: 6, dash: 'dot', lineCap: 'round', endCap: 'triangle', width: 500, height: 40 } } };
    const values = windowValues(state('line', item));
    assert.equal(values.opacity, 40);
    assert.equal(values.weight, 6);
    assert.equal(values.weightMin, 1);
    assert.equal(values.dash, 'dot');
    assert.equal(values.round, true);
    assert.equal(values.startCap, 'none');
    assert.equal(values.endCap, 'triangle');
    assert.equal(values.flipH, true);
    assert.deepEqual(geometryValues(state('line', item)), { x: 12.3, y: -5, rotate: 30, width: 1000, height: 20 });
    assert.equal(geometryValues(state('photo', { source: { kind: 'media' } })).width, undefined);
});

test('色の丸: 単色・なし・グラデーション', () => {
    assert.equal(paintCss('#ff0000'), '#ff0000');
    assert.equal(paintCss('none'), 'none');
    assert.equal(paintCss(undefined), 'none');
    assert.equal(paintCss({ type: 'linear', angle: 0, stops: [{ color: '#000', offset: 0 }, { color: '#fff', offset: 1 }] }),
        'linear-gradient(90deg, #000 0%, #fff 100%)');
});

test('小さなメニューの置き場所: 箱の上の中央 / 上のバーとぶつかるときは回転・移動ボタンの下', () => {
    const area = { left: 0, top: 0, width: 400, height: 300 };
    const menu = { width: 160, height: 34 };
    const above = elementMenuPosition({ left: 100, top: 150, width: 100, height: 60 }, menu, area, 50);
    assert.deepEqual(above, { left: 70, top: 106, placement: 'above' });
    const below = elementMenuPosition({ left: 100, top: 60, width: 100, height: 60 }, menu, area, 50);
    assert.equal(below.placement, 'below');
    assert.equal(below.top, 60 + 60 + 52);
    // 端では画面の中へ寄せる
    assert.equal(elementMenuPosition({ left: 0, top: 200, width: 20, height: 20 }, menu, area, 50).left, 4);
});

test('画面に揃える: 見えている箱を端・中央へ動かす量', () => {
    const output = { width: 1920, height: 1080 };
    const box = { x: 100, y: 200, width: 400, height: 300 };
    assert.deepEqual(alignDelta(box, output, 'left'), { dx: -100, dy: 0 });
    assert.deepEqual(alignDelta(box, output, 'center'), { dx: 660, dy: 0 });
    assert.deepEqual(alignDelta(box, output, 'right'), { dx: 1420, dy: 0 });
    assert.deepEqual(alignDelta(box, output, 'middle'), { dx: 0, dy: 190 });
    assert.deepEqual(alignDelta(box, output, 'bottom'), { dx: 0, dy: 580 });
});

test('表記: 時間の範囲・ショートカット', () => {
    assert.equal(formatRange(1, 6), '0:01.0–0:06.0');
    assert.equal(formatRange(61.25, 75), '1:01.3–1:15.0');
    assert.equal(shortcutLabel('C', { mac: true, alt: true }), '⌥⌘C');
    assert.equal(shortcutLabel('V', { mac: false }), 'Ctrl+V');
    assert.equal(shortcutLabel('Delete', { mac: true }), 'DELETE');
});

test('webview に差し込むスクリプトは構文として正しい', () => {
    assert.doesNotThrow(() => new Function(previewContextBarPageScript));
    assert.match(previewContextBarPageScript, /akari-preview-context-lock/u);
});
