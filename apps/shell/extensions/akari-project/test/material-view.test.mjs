import test from 'node:test';
import assert from 'node:assert/strict';
import {
    applyMaterialViewPatch, DEFAULT_MATERIAL_VIEW, describeMaterialView, filterMaterials, sortMaterials
} from '../lib/common/material-view.js';

const entries = [
    { name: 'b-roll 素材10', kind: 'video', durationSeconds: 10 },
    { name: 'B-ROLL 素材2', kind: 'video', durationSeconds: 2 },
    { name: 'b-roll 音', kind: 'audio', durationSeconds: 1 },
    { name: '素材2', kind: 'image' },
    { name: '素材10', kind: 'image' }
];

test('部分更新、取り消し、未知値の無視、種類の固定順と重複除去', () => {
    const initial = structuredClone(DEFAULT_MATERIAL_VIEW);
    const filtered = applyMaterialViewPatch(initial, { kinds: ['audio', 'video', 'audio'] });
    assert.deepEqual(filtered.previous, initial);
    assert.deepEqual(filtered.applied.kinds, ['video', 'audio']);
    assert.deepEqual(filtered.applied.sort, initial.sort);

    const sorted = applyMaterialViewPatch(filtered.applied, { sort: { by: 'duration', order: 'desc' } });
    assert.deepEqual(sorted.previous, filtered.applied);
    assert.deepEqual(sorted.applied.kinds, filtered.applied.kinds);
    assert.deepEqual(sorted.applied.sort, { by: 'duration', order: 'desc' });
    assert.deepEqual(applyMaterialViewPatch(sorted.applied, filtered.previous).applied, initial);
    assert.deepEqual(initial, DEFAULT_MATERIAL_VIEW);

    assert.deepEqual(applyMaterialViewPatch(filtered.applied, { kinds: ['x'] }).applied, filtered.applied);
    assert.deepEqual(applyMaterialViewPatch(filtered.applied, { sort: { by: 'size' } }).applied, filtered.applied);
    assert.deepEqual(applyMaterialViewPatch(filtered.applied, { sort: { order: 'sideways' } }).applied, filtered.applied);
    assert.deepEqual(applyMaterialViewPatch(filtered.applied, { kinds: ['x', 'image'] }).applied.kinds, ['image']);
    assert.deepEqual(applyMaterialViewPatch(filtered.applied, { kinds: [] }).applied.kinds, []);
});

test('種類と検索語を併用し、空の種類はすべてを対象にする', () => {
    const state = applyMaterialViewPatch(DEFAULT_MATERIAL_VIEW, { kinds: ['video'] }).applied;
    const filtered = filterMaterials(entries, state, ' B-RoLl ');
    assert.deepEqual(sortMaterials(filtered, { by: 'duration', order: 'asc' }).map(entry => entry.name),
        ['B-ROLL 素材2', 'b-roll 素材10']);
    assert.equal(filterMaterials(entries, DEFAULT_MATERIAL_VIEW, '').length, entries.length);
    assert.equal(filterMaterials(entries, DEFAULT_MATERIAL_VIEW, 'b-roll').length, 3);
});

test('名前順は日本語の数字を自然順にし、入力配列を変えない', () => {
    const original = entries.slice();
    assert.deepEqual(sortMaterials(entries.slice(3), { by: 'name', order: 'asc' }).map(entry => entry.name),
        ['素材2', '素材10']);
    assert.deepEqual(sortMaterials(entries.slice(3), { by: 'name', order: 'desc' }).map(entry => entry.name),
        ['素材10', '素材2']);
    assert.deepEqual(entries, original);
});

test('長さ順は未計測を昇順・降順とも最後にし、同値は名前と入力順で安定する', () => {
    const values = [
        { name: '素材10', durationSeconds: 2 },
        { name: '未計測2' },
        { name: '素材2', durationSeconds: 2, id: 1 },
        { name: '素材2', durationSeconds: 2, id: 2 },
        { name: '短い', durationSeconds: 1 },
        { name: '未計測1' }
    ];
    assert.deepEqual(sortMaterials(values, { by: 'duration', order: 'asc' }).map(item => item.name),
        ['短い', '素材2', '素材2', '素材10', '未計測1', '未計測2']);
    assert.deepEqual(sortMaterials(values, { by: 'duration', order: 'desc' }).map(item => item.name),
        ['素材2', '素材2', '素材10', '短い', '未計測1', '未計測2']);
    assert.deepEqual(sortMaterials(values, { by: 'duration', order: 'asc' }).filter(item => item.name === '素材2').map(item => item.id), [1, 2]);
    assert.equal(values[0].name, '素材10');
});

test('状態の短い説明は既定で空、種類と並べ替えを表示する', () => {
    assert.equal(describeMaterialView(DEFAULT_MATERIAL_VIEW), '');
    assert.equal(describeMaterialView({ kinds: ['video'], sort: { by: 'duration', order: 'asc' } }), '動画 · 長さの短い順');
    assert.equal(describeMaterialView({ kinds: ['audio', 'image'], sort: { by: 'name', order: 'desc' } }), '音・画像 · 名前の降順');
});

test('3D グループは実効種類で絞り、既存の動画とは区別する', () => {
    const values = [
        { name: 'シーン', kind: 'video', assetGroup: { category: 'scene3d' } },
        { name: '動画', kind: 'video' },
        { name: '画像', kind: 'image' }
    ];
    const threeD = applyMaterialViewPatch(DEFAULT_MATERIAL_VIEW, { kinds: ['3d'] }).applied;
    assert.deepEqual(filterMaterials(values, threeD, '').map(item => item.name), ['シーン']);
    const video = applyMaterialViewPatch(DEFAULT_MATERIAL_VIEW, { kinds: ['video'] }).applied;
    assert.deepEqual(filterMaterials(values, video, '').map(item => item.name), ['動画']);
});

test('作成日順は取り込み日時へフォールバックし、日時なしは最後', () => {
    const values = [
        { name: 'なし' },
        { name: '取り込み', importedAt: '2026-01-02T00:00:00Z' },
        { name: '作成', createdAt: '2026-01-03T00:00:00Z', importedAt: '2026-01-01T00:00:00Z' }
    ];
    assert.deepEqual(sortMaterials(values, { by: 'created', order: 'desc' }).map(item => item.name), ['作成', '取り込み', 'なし']);
    assert.deepEqual(sortMaterials(values, { by: 'created', order: 'asc' }).map(item => item.name), ['取り込み', '作成', 'なし']);
    assert.equal(describeMaterialView({ kinds: [], sort: { by: 'created', order: 'desc' } }), '新しい順');
    assert.equal(describeMaterialView({ kinds: [], sort: { by: 'created', order: 'asc' } }), '古い順');
});
