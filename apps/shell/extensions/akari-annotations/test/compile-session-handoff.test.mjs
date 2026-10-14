import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setLanguage } from '@akari-video/i18n';
import { after as resetLanguageAfter } from 'node:test';
setLanguage('ja');
resetLanguageAfter(() => setLanguage(undefined));
const { compileClipboardFailureFooter, compileClipboardFailureNotice, compileCopiedMessage, planCompileHandoff, sessionSortKey } = await import('../lib/common/compile-session-handoff.js');



const sessions = [
    { id: 's-0001', startedAt: '2026-09-12T01:00:00.000Z' },
    { id: 's-0002', startedAt: '2026-09-12T02:00:00.000Z' }
];

test('省略時は最新の録音セッションをコピー対象にする', () => {
    assert.equal(sessionSortKey(sessions[0]), 1);
    assert.deepEqual(planCompileHandoff(sessions), {
        kind: 'copy',
        sessionId: 's-0002',
        prompt: 'レビューの録音 s-0002 を文字起こしして、コメントにまとめて'
    });
});

test('id 指定時は最新以外の録音セッションをコピー対象にできる', () => {
    assert.deepEqual(planCompileHandoff(sessions, 's-0001'), {
        kind: 'copy',
        sessionId: 's-0001',
        prompt: 'レビューの録音 s-0001 を文字起こしして、コメントにまとめて'
    });
});

test('未知の id 指定は notice にする', () => {
    assert.deepEqual(planCompileHandoff(sessions, 's-9999'), {
        kind: 'notice',
        notice: '指定した録音が見つかりません: s-9999'
    });
});

test('録音セッションが空なら notice にする', () => {
    assert.deepEqual(planCompileHandoff([]), {
        kind: 'notice',
        notice: '録音がありません。先に録音してください。'
    });
});

test('コピー成功時の footer とトースト文言を返す', () => {
    const prompt = 'レビューの録音 s-0002 を文字起こしして、コメントにまとめて';
    assert.equal(
        compileCopiedMessage(prompt),
        `「${prompt}」をクリップボードにコピーしました。パートナーへ貼り付けてください。`
    );
});

test('クリップボード失敗時は notice と定型文で終わる footer を返す', () => {
    const prompt = 'レビューの録音 s-0002 を文字起こしして、コメントにまとめて';
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
