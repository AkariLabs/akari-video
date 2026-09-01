import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { planDaihonUpdate, planHighlight } = require('../lib/common/daihon-reconcile.js');

const row = (id, text = id) => ({
    id, start: 0, end: 1, outStart: 0, outEnd: 1, text,
    words: [{ text, start: 0, end: 1 }], fragmentBreakWordIndex: null,
    edited: false, timeDomain: 'source'
});

test('planDaihonUpdate は生成・削除・順序を key で計画する', () => {
    const plan = planDaihonUpdate([row('a'), row('b')], [row('b'), row('c')]);
    assert.deepEqual(plan.create.map(item => item.id), ['c']);
    assert.deepEqual(plan.remove, ['a']);
    assert.deepEqual(plan.order, ['b', 'c']);
});

test('planDaihonUpdate は text が変わった行だけ update する', () => {
    const plan = planDaihonUpdate([row('a'), row('b')], [row('a', 'changed'), row('b')]);
    assert.deepEqual(plan.update.map(item => item.id), ['a']);
});

test('planDaihonUpdate は words・edited・出力窓の変化を検出する', () => {
    const before = [row('words'), row('edited'), row('window')];
    const after = [
        { ...row('words'), words: [{ text: 'new', start: 0, end: 1 }] },
        { ...row('edited'), edited: true },
        { ...row('window'), outStart: null, outEnd: null }
    ];
    assert.deepEqual(planDaihonUpdate(before, after).update.map(item => item.id), ['words', 'edited', 'window']);
});

test('planHighlight は同じ語なら空、語が変われば該当語だけ返す', () => {
    const current = { rowId: 'a', wordIndex: 1 };
    assert.deepEqual(planHighlight(current, current), { rowIds: [], words: [] });
    assert.deepEqual(planHighlight(current, { rowId: 'a', wordIndex: 2 }), {
        rowIds: ['a'],
        words: [{ rowId: 'a', wordIndex: 1 }, { rowId: 'a', wordIndex: 2 }]
    });
});

test('planHighlight は行が変われば前後2行だけ返す', () => {
    assert.deepEqual(planHighlight(
        { rowId: 'a', wordIndex: 0 }, { rowId: 'b', wordIndex: null }
    ), {
        rowIds: ['a', 'b'],
        words: [{ rowId: 'a', wordIndex: 0 }]
    });
});
