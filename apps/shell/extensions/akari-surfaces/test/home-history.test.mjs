import test from 'node:test';
import assert from 'node:assert/strict';
import { eventHistoryEntry, exportHistoryEntry, sortHomeHistory } from '../lib/browser/home/home-history.js';

test('既知の出来事を日本語化し、不明な種類を残す', () => {
    assert.equal(eventHistoryEntry({ type: 'project-created', timestamp: '2026-10-08T10:00:00Z' })?.label, 'プロジェクトを作った');
    assert.equal(eventHistoryEntry({ type: 'custom-event', at: 12 })?.label, 'custom-event');
    assert.equal(eventHistoryEntry({ timestamp: 12 }), undefined);
});

test('出来事と書き出しを時刻の新しい順に混ぜる', () => {
    const rows = sortHomeHistory([
        eventHistoryEntry({ type: 'assets-imported', at: 100 }),
        exportHistoryEntry('完成.mp4', 300),
        eventHistoryEntry({ type: 'report-created', at: 200 })
    ]);
    assert.deepEqual(rows.map(row => row.label), ['書き出し（完成.mp4）', '分析レポートを作った', '素材を入れた']);
});
