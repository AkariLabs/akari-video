import assert from 'node:assert/strict';
import test from 'node:test';
import {
    reviewSessionRanges,
    reviewSessionRangesFromJsonl
} from '../lib/common/review-session-ranges.js';

test('play seek pause play の通過区間を分断し、隣接区間と停止点をマージする', () => {
    assert.deepEqual(reviewSessionRanges([
        { recT: 0, type: 'start', timelineT: 5, playing: false },
        { recT: 1, type: 'play', timelineT: 5 },
        { recT: 2, type: 'tick', timelineT: 7 },
        { recT: 3, type: 'seek', from: 7, to: 20 },
        { recT: 4, type: 'tick', timelineT: 22 },
        { recT: 5, type: 'pause', timelineT: 23 },
        { recT: 6, type: 'play', timelineT: 23 },
        { recT: 7, type: 'tick', timelineT: 24 },
        { recT: 8, type: 'end', timelineT: 24 }
    ]), [
        { start: 5, end: 7 },
        { start: 20, end: 24 }
    ]);
});

test('巻き戻し seek の前後を別区間として出力時刻順に返す', () => {
    assert.deepEqual(reviewSessionRanges([
        { type: 'start', timelineT: 10, playing: true },
        { type: 'tick', timelineT: 12 },
        { type: 'seek', from: 12, to: 4 },
        { type: 'tick', timelineT: 6 },
        { type: 'end', timelineT: 6 }
    ]), [
        { start: 4, end: 6 },
        { start: 10, end: 12 }
    ]);
});

test('orphaned セッションは end がなくても最後の観測で閉じる', () => {
    assert.deepEqual(reviewSessionRanges([
        { type: 'start', timelineT: 2, playing: true },
        { type: 'tick', timelineT: 3.5 }
    ]), [{ start: 2, end: 3.5 }]);
});

test('停止中の滞在を点で残し、壊れた行と未知イベントを無視する', () => {
    assert.deepEqual(reviewSessionRangesFromJsonl([
        JSON.stringify({ type: 'start', timelineT: 8, playing: false }),
        '{broken',
        JSON.stringify({ type: 'ui.click', timelineT: 99 }),
        JSON.stringify({ type: 'seek', from: 8, to: 11 }),
        JSON.stringify({ type: 'tool.mode', timelineT: 100 })
    ].join('\n')), [
        { start: 8, end: 8 },
        { start: 11, end: 11 }
    ]);
});

test('旧 active state 由来の非 iterable 入力は空として扱う', () => {
    assert.deepEqual(reviewSessionRanges(undefined), []);
    assert.deepEqual(reviewSessionRanges({}), []);
});
