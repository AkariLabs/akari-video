import assert from 'node:assert/strict';
import test from 'node:test';
import {
    pendingCompileSessions,
    reviewSessionBadge,
    sessionIdForAnnotation
} from '../lib/browser/review-model.js';

test('状態バッジをライフサイクルへ写像し orphaned を優先する', () => {
    assert.deepEqual(reviewSessionBadge({ id: 's-1', startedAt: '', status: 'recorded' }), {
        key: 'recorded', label: '録音済み', hint: 'まだチケットになっていません — コンパイルでチケット化'
    });
    assert.deepEqual(reviewSessionBadge({ id: 's-2', startedAt: '', status: 'transcribed' }), {
        key: 'transcribed', label: '文字起こし済み'
    });
    assert.deepEqual(reviewSessionBadge({ id: 's-3', startedAt: '', status: 'compiled' }), {
        key: 'compiled', label: 'コンパイル済み'
    });
    assert.deepEqual(reviewSessionBadge({ id: 's-4', startedAt: '', status: 'compiled', orphaned: true }), {
        key: 'orphaned', label: '未完了'
    });
    assert.equal(reviewSessionBadge({ id: 's-5', startedAt: '' }).key, 'recorded');
    assert.equal(reviewSessionBadge({ id: 's-6', startedAt: '', status: 'future-status' }).key, 'recorded');
});

test('未コンパイル一覧は compiled を除外してセッション番号順に並べる', () => {
    const pending = pendingCompileSessions([
        { id: 's-0010', startedAt: '', status: 'transcribed' },
        { id: 's-0002', startedAt: '', status: 'compiled' },
        { id: 's-0003', startedAt: '', orphaned: true },
        { id: 's-0001', startedAt: '', status: 'recorded' },
        { id: 'legacy-b', startedAt: '', status: 'recorded' },
        { id: 'legacy-a', startedAt: '', status: 'recorded' }
    ]);
    assert.deepEqual(pending.map(session => session.id), [
        'legacy-a', 'legacy-b', 's-0001', 's-0003', 's-0010'
    ]);
});

test('注釈の由来は compiledAnnotations を優先し検証済み session id へ縮退する', () => {
    const sessions = [
        { id: 's-0001', startedAt: '', compiledAnnotations: ['a-0002'] },
        { id: 's-0003', startedAt: '', compiledAnnotations: ['a-0002', 'a-0004'] }
    ];
    assert.equal(sessionIdForAnnotation({ id: 'a-0002', input: 'typed' }, sessions), undefined);
    assert.equal(sessionIdForAnnotation({ id: 'a-0002', input: 'session' }, sessions), 's-0001');
    assert.equal(sessionIdForAnnotation({
        id: 'a-0003', input: 'session', session: { id: 's-0099' }
    }, sessions), 's-0099');
    assert.equal(sessionIdForAnnotation({
        id: 'a-0003', input: 'session', session: { id: 'session-99' }
    }, sessions), undefined);
});
