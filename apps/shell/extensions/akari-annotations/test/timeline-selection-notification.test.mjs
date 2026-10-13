import assert from 'node:assert/strict';
import test from 'node:test';

import { TimelineSelectionModel } from '../lib/browser/timeline-selection-model.js';
import { sameSelectionValue } from '../lib/common/selection-value-equality.js';

test('等価判定はキー順を無視し、関数と Map の内容を区別する', () => {
    assert.equal(sameSelectionValue({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
    assert.equal(sameSelectionValue({ callback: () => 1 }, { callback: () => 2 }), false);
    assert.equal(sameSelectionValue(new Map([['a', 1]]), new Map([['a', 2]])), false);
    assert.equal(sameSelectionValue(new Map([['a', 1], ['b', 2]]),
        new Map([['b', 2], ['a', 1]])), true);
});

test('同じ選択の通知を捨て、同一タスク内の変更を一回だけ通知する', async () => {
    const model = new TimelineSelectionModel();
    let notifications = 0;
    const seen = [];
    model.onChanged(() => { notifications++; seen.push(model.snapshot); });
    model.snapshot = { kind: 'caption', id: 'c1', text: '字幕' };
    model.treeSelection = { kind: 'item', id: 'c1', itemKind: 'caption', trackId: 'captions' };
    model.snapshot = { kind: 'caption', id: 'c1', text: '字幕' };
    model.snapshot = { kind: 'caption', id: 'c1', text: '最新' };
    await Promise.resolve();
    assert.equal(notifications, 1);
    assert.equal(seen[0].text, '最新');
    model.snapshot = { kind: 'caption', id: 'c1', text: '変更' };
    await Promise.resolve();
    assert.equal(notifications, 2);
});
