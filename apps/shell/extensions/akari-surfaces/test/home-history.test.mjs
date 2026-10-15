import test, { after as afterI18nTest } from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
afterI18nTest(() => setLanguage(undefined));
const { eventHistoryEntry, exportHistoryEntry, sortHomeHistory } = await import("../lib/browser/home/home-history.js");


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

test('新しい履歴種別と担当者を日本語で表示する', () => {
    const labels = ['project-created', 'material-transcript', 'report-generated', 'report-approved', 'edit-completed', 'export-completed']
        .map(type => eventHistoryEntry({ type, by: 'partner' })?.label);
    assert.deepEqual(labels, ['パートナー: プロジェクトを作った', 'パートナー: 文字起こし', 'パートナー: 分析レポート',
        'パートナー: レポートを承認', 'パートナー: 編集を終えた', 'パートナー: 書き出し']);
    assert.equal(eventHistoryEntry({ type: 'edit-completed', by: 'user' })?.label, 'あなた: 編集を終えた');
});

test('自動化の 3 種の出来事を担当者・門名・決定で表示する', () => {
    for (const [actor, expected] of [['partner', '相棒'], ['external', '外のエージェント'], ['unattended', '無人']]) {
        assert.equal(eventHistoryEntry({ type: 'agent-action', actor, summary: '無音を切った', occurredAt: '2026-10-16T01:00:00Z' })?.label,
            `${expected}: 無音を切った`);
    }
    const resolved = eventHistoryEntry({ type: 'gate-resolved', requestId: 'req-1', decision: 'approved', occurredAt: '2026-10-16T01:02:00Z' });
    assert.equal(eventHistoryEntry({ type: 'gate-requested', requestId: 'req-1', gate: 'lab-submit', summary: '作り方を提出', occurredAt: '2026-10-16T01:01:00Z' })?.label,
        '確認待ち: Lab への提出 — 作り方を提出');
    assert.equal(resolved?.label, '承認しました: Lab への提出');
    assert.equal(resolved?.time, Date.parse('2026-10-16T01:02:00Z'));
    assert.equal(eventHistoryEntry({ type: 'gate-resolved', requestId: 'req-1', decision: 'declined' })?.label,
        'やめました: Lab への提出');
});

test('未知の門は i18n キーに変換せず元の門名を表示する', () => {
    const requested = eventHistoryEntry({ type: 'gate-requested', requestId: 'req-unknown', gate: 'foo-bar', summary: '確認する' });
    const resolved = eventHistoryEntry({ type: 'gate-resolved', requestId: 'req-unknown', decision: 'approved' });
    assert.equal(requested?.label, '確認待ち: foo-bar — 確認する');
    assert.equal(resolved?.label, '承認しました: foo-bar');
});
