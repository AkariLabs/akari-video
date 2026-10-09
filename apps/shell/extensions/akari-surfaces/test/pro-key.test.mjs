import test from 'node:test';
import assert from 'node:assert/strict';
import { hasProKey, proGate } from '../lib/common/pro-key.js';

test('商品 ID の pro を区切りで判定する', () => {
    assert.equal(hasProKey([{ id: 'akari-pro', kind: null }]), true);
    assert.equal(hasProKey([{ id: 'video-pro-monthly', kind: null }]), true);
});

test('kind の subscription を判定する', () => {
    assert.equal(hasProKey([{ id: 'monthly', kind: 'subscription' }]), true);
});

test('買い切りパスも鍵として扱う', () => {
    assert.equal(hasProKey([{ id: 'lab-lifetime', kind: null }]), true);
});

test('別の単語に含まれる pro は拾わない', () => {
    for (const id of ['product', 'prores', 'professional']) {
        assert.equal(hasProKey([{ id, kind: null }]), false, id);
    }
});

test('空・不正な入力では鍵なしとして扱う', () => {
    assert.equal(hasProKey([]), false);
    assert.equal(hasProKey(null), false);
    assert.equal(hasProKey([null, { id: 'product', kind: null }]), false);
});

test('無料の型は鍵なしでも通し、Pro の型だけ鍵で分ける', () => {
    assert.equal(proGate('free', false), true);
    assert.equal(proGate('pro', false), false);
    assert.equal(proGate('pro', true), true);
});
