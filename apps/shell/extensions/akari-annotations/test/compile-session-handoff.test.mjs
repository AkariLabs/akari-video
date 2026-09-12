import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    compileClipboardFailureFooter,
    compileClipboardFailureNotice,
    compileCopiedMessage,
    planCompileHandoff,
    sessionSortKey
} from '../lib/common/compile-session-handoff.js';

const sessions = [
    { id: 's-0001', startedAt: '2026-09-12T01:00:00.000Z' },
    { id: 's-0002', startedAt: '2026-09-12T02:00:00.000Z' }
];

test('省略時は最新の録音セッションをコピー対象にする', () => {
    assert.equal(sessionSortKey(sessions[0]), 1);
    assert.deepEqual(planCompileHandoff(sessions), {
        kind: 'copy',
        sessionId: 's-0002',
        prompt: 'review セッション s-0002 をコンパイルして'
    });
});

test('id 指定時は最新以外の録音セッションをコピー対象にできる', () => {
    assert.deepEqual(planCompileHandoff(sessions, 's-0001'), {
        kind: 'copy',
        sessionId: 's-0001',
        prompt: 'review セッション s-0001 をコンパイルして'
    });
});

test('未知の id 指定は notice にする', () => {
    assert.deepEqual(planCompileHandoff(sessions, 's-9999'), {
        kind: 'notice',
        notice: '指定した録音セッションが見つかりません: s-9999'
    });
});

test('録音セッションが空なら notice にする', () => {
    assert.deepEqual(planCompileHandoff([]), {
        kind: 'notice',
        notice: '録音済みセッションがありません。先に録音してください。'
    });
});

test('コピー成功時の footer とトースト文言を返す', () => {
    const prompt = 'review セッション s-0002 をコンパイルして';
    assert.equal(
        compileCopiedMessage(prompt),
        `「${prompt}」をクリップボードにコピーしました。パートナーへ貼り付けてください。`
    );
});

test('クリップボード失敗時は notice と定型文で終わる footer を返す', () => {
    const prompt = 'review セッション s-0002 をコンパイルして';
    assert.equal(compileClipboardFailureNotice('denied'), 'クリップボードにコピーできません: denied');
    assert.equal(compileClipboardFailureFooter(prompt).endsWith(prompt), true);
});

test('パートナーペインへフォーカスを移すコマンドを widget に残さない', () => {
    const widgetSource = readFileSync(
        new URL('../src/browser/akari-review-panel-widget.ts', import.meta.url),
        'utf8'
    );
    assert.equal(widgetSource.includes('beginOnboarding'), false);
    assert.equal(widgetSource.includes('BEGIN_PARTNER_ONBOARDING'), false);
});
