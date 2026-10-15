import assert from 'node:assert/strict';
import test from 'node:test';
import { parseScriptLines, scriptTimelineRow } from '../lib/common/script-lines.js';

const source = lines => JSON.stringify({ version: 0, kind: 'akari-script', lines });

test('台本の予定とメモを at → id 順に読み、任意値だけ採用する', () => {
    assert.deepEqual(parseScriptLines(source([
        { id: 'p-b', kind: 'plan', at: 3, text: '済', duration: 2, done: true },
        { id: 'p-c', kind: 'plan', at: 0, text: '予定', duration: 0, done: 'true' },
        { id: 'm-b', kind: 'memo', at: 3, text: '後' },
        { id: 'p-a', kind: 'plan', at: 3, text: '同時', duration: -1, done: false },
        { id: 'm-a', kind: 'memo', at: 3, text: '前' }
    ])), {
        plans: [
            { id: 'p-c', at: 0, text: '予定' },
            { id: 'p-a', at: 3, text: '同時', done: false },
            { id: 'p-b', at: 3, duration: 2, text: '済', done: true }
        ],
        memos: [{ id: 'm-a', at: 3, text: '前' }, { id: 'm-b', at: 3, text: '後' }]
    });
});

test('壊れた JSON・kind・行を捨て、妥当な行は残す', () => {
    assert.deepEqual(parseScriptLines('{'), { plans: [], memos: [] });
    assert.deepEqual(parseScriptLines(source([
        null, {}, { id: 'x', kind: 'unknown', at: 0, text: 'x' },
        { id: 'n', kind: 'memo', at: -1, text: 'x' },
        { id: 'inf', kind: 'memo', at: 1e999, text: 'x' },
        { id: 'blank', kind: 'memo', at: 0, text: '' },
        { id: 'long', kind: 'memo', at: 0, text: 'x'.repeat(501) },
        { id: 'ok', kind: 'memo', at: 0, text: '残る' },
        { id: 'ok', kind: 'memo', at: 1, text: '重複' }
    ])), { plans: [], memos: [{ id: 'ok', at: 0, text: '残る' }] });
    assert.deepEqual(parseScriptLines(JSON.stringify({ version: 0, kind: 'wrong', lines: [] })),
        { plans: [], memos: [] });
});

test('script.json が無い・読めない・壊れた場合は段を出さない', () => {
    assert.equal(scriptTimelineRow(undefined), undefined);
    assert.equal(scriptTimelineRow('{'), undefined);
    assert.equal(scriptTimelineRow(JSON.stringify({ version: 0, kind: 'wrong', lines: [] })), undefined);
    assert.deepEqual(scriptTimelineRow(source([])), { plans: [], memos: [] });
});
