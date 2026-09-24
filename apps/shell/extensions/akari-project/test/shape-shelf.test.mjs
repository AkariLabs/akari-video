import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    buildShapeShelfRows, parseRecentShapes, parseShapeShelfJsonl, pushRecentShape, searchShapeShelf,
    SHAPE_SHELF_LINE_ROW, SHAPE_SHELF_RECENT_LIMIT, shapeShelfDragPayload, shapeShelfRowItems, shapeShelfRowLabel
} from '../lib/common/shape-shelf.js';
import { LIBRARY_PRIMARY_TILES, resolveOpenableLibraryCategory, searchLibraryHome } from '../lib/common/library-home-view.js';

// 棚の正本（presets/shapes/index.jsonl）をそのまま読む。
const raw = readFileSync(new URL('../../../../../presets/shapes/index.jsonl', import.meta.url), 'utf8');
const presets = parseShapeShelfJsonl(raw);
const emptySources = { catalogItems: [], presetShowcase: { textstyle: [], textanim: [], lut: [] }, transitions: [] };

test('jsonl を読み、壊れた行と重複 id は捨てる', () => {
    assert.equal(presets.length, 276);
    const parsed = parseShapeShelfJsonl([
        '{"id":"a","category":"basic","name":"A","vb":[100,100],"d":"M0 0L1 1Z","kind":"fill","defaults":{}}',
        'not json',
        '{"id":"a","category":"basic","name":"A2","vb":[100,100],"d":"M0 0L1 1Z","kind":"fill","defaults":{}}',
        '{"id":"b","category":"basic","name":"B","vb":[0,100],"d":"M0 0Z","kind":"fill","defaults":{}}',
        '{"id":"c","category":"basic","name":"C","vb":[10,10],"d":"M0 0Z","kind":"unknown","defaults":{}}',
        ''
    ].join('\n'));
    assert.deepEqual(parsed.map(preset => preset.name), ['A']);
    const rounded = presets.find(preset => preset.id === 'basic-rounded-square');
    assert.deepEqual(rounded.rounded_from, { base: 'basic-square', radius: 36 });
});

test('棚の行: 最近使用が無いときは ライン → jsonl のカテゴリ順（漫画の吹き出しが最後）', () => {
    const rows = buildShapeShelfRows(presets, []);
    assert.deepEqual(rows.map(row => row.key), [
        'line', 'basic', 'polygon', 'star', 'arrow', 'flow', 'bubble', 'cloud', 'heart', 'banner', 'drop', 'gear',
        'asterisk', 'organic', 'wave', 'abstract', 'manga'
    ]);
    assert.deepEqual(rows.map(row => row.label).slice(0, 3), ['ライン', '基本の図形', '多角形']);
    assert.equal(rows.at(-1).label, '漫画の吹き出し');
    const line = rows[0];
    assert.deepEqual(line.items.map(item => item.id), SHAPE_SHELF_LINE_ROW);
    assert.equal(line.total, 45);
    const basic = rows[1];
    assert.equal(basic.items.length, 14);
    assert.equal(basic.total, 15);
    const organic = rows.find(row => row.key === 'organic');
    assert.equal(organic.items.length, 14);
    assert.equal(organic.total, 37);
    // 1 行 14 件（行の中で左右に送る）。全部は「すべて表示」。
    assert.ok(rows.every(row => row.items.length <= 15));
});

test('最近使用した項目は先頭の行・置いた順（新しいものが先）・棚に無い id は出さない', () => {
    let recent = [];
    for (const id of ['star-5', 'heart-heart', 'line-dash-tri-tri', 'manga-shout', 'star-5']) recent = pushRecentShape(recent, id);
    assert.deepEqual(recent, ['star-5', 'manga-shout', 'line-dash-tri-tri', 'heart-heart']);
    const rows = buildShapeShelfRows(presets, [...recent, 'gone-shape']);
    assert.equal(rows[0].key, 'recent');
    assert.equal(rows[0].label, '最近使用した項目');
    assert.deepEqual(rows[0].items.map(item => item.id), recent);
    assert.equal(rows[0].total, 4);
    assert.equal(rows[1].key, 'line');
    const many = presets.slice(0, 30).map(preset => preset.id).reduce((list, id) => pushRecentShape(list, id), []);
    assert.equal(many.length, SHAPE_SHELF_RECENT_LIMIT);
    assert.equal(buildShapeShelfRows(presets, many)[0].items.length, 12);
    assert.equal(shapeShelfRowItems(presets, 'recent', many).length, SHAPE_SHELF_RECENT_LIMIT);
});

test('最近使用の保存値は壊れていても空に倒し、重複と上限を整える', () => {
    assert.deepEqual(parseRecentShapes(null), []);
    assert.deepEqual(parseRecentShapes('{'), []);
    assert.deepEqual(parseRecentShapes('{"a":1}'), []);
    assert.deepEqual(parseRecentShapes('["a",3,"b","a",""]'), ['a', 'b']);
    assert.equal(parseRecentShapes(JSON.stringify(Array.from({ length: 40 }, (_, i) => `s${i}`))).length, SHAPE_SHELF_RECENT_LIMIT);
});

test('すべて表示: ラインは 45 本全部、カテゴリはその行の全部', () => {
    const lines = shapeShelfRowItems(presets, 'line', []);
    assert.equal(lines.length, 45);
    assert.ok(lines.every(item => item.kind === 'line'));
    assert.ok(lines.some(item => item.id === 'line-dash-tri-tri'));
    assert.equal(shapeShelfRowItems(presets, 'manga', []).length, 12);
    assert.equal(shapeShelfRowItems(presets, 'abstract', []).length, 50);
    assert.equal(shapeShelfRowLabel('manga'), '漫画の吹き出し');
});

test('検索は図形の名前（と行の名前）で当たり、ID では当たらない', () => {
    const hearts = searchShapeShelf(presets, 'ハート');
    assert.ok(hearts.length >= 12);
    assert.ok(hearts.some(item => item.id === 'heart-heart'));
    const shout = searchShapeShelf(presets, '叫び').map(item => item.id);
    assert.ok(shout.includes('manga-shout'));
    assert.ok(searchShapeShelf(presets, '漫画の吹き出し').length >= 12);
    const dashed = searchShapeShelf(presets, '破線・三角');
    assert.ok(dashed.some(item => item.id === 'line-dash-tri-tri'));
    assert.ok(dashed.every(item => item.kind === 'line'));
    assert.equal(searchShapeShelf(presets, 'ＳＴＡＲ-5').length, 0);
    assert.equal(searchShapeShelf(presets, 'star-5').length, 0);
    assert.equal(searchShapeShelf(presets, '5 点の星')[0].id, 'star-5');
    assert.deepEqual(searchShapeShelf(presets, '   '), []);
});

test('ライブラリの検索欄から図形の名前で当たり、押すと図形の棚が開く', () => {
    const hits = searchLibraryHome('星', { ...emptySources, shapes: presets });
    assert.ok(hits.length > 0);
    assert.ok(hits.every(hit => hit.categoryKey === 'shapes' && hit.kind === 'shape'));
    assert.ok(hits.some(hit => hit.label === '5 点の星'));
    assert.deepEqual(searchLibraryHome('星', emptySources), []);
    assert.equal(resolveOpenableLibraryCategory('shapes'), 'shapes');
    const tile = LIBRARY_PRIMARY_TILES.find(item => item.key === 'shapes');
    assert.equal(tile.status, 'live');
});

test('ドラッグの payload は kind: shape + preset（仮枠用に名前と vb）', () => {
    const star = presets.find(preset => preset.id === 'star-5');
    assert.deepEqual(shapeShelfDragPayload(star), { kind: 'shape', preset: 'star-5', name: '5 点の星', vb: [100, 95] });
});
