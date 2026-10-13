import { t as annotationT, setLanguage as setAnnotationLanguage } from '@akari-video/i18n';
import * as annotationI18n from '@akari-video/i18n';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { setLanguage } from '@akari-video/i18n';
import { after as resetLanguageAfter } from 'node:test';
setLanguage('ja');
resetLanguageAfter(() => setLanguage(undefined));



setAnnotationLanguage('ja');
globalThis.t = annotationT;
globalThis.i18n_1 = annotationI18n;
test.beforeEach(() => { setAnnotationLanguage('ja'); globalThis.t = annotationT; globalThis.i18n_1 = annotationI18n; });
test.after(() => { setAnnotationLanguage(undefined); delete globalThis.t; delete globalThis.i18n_1; });
const ja = JSON.parse(readFileSync(new URL('../../../../../packages/i18n/locales/ja/annotations.json', import.meta.url), 'utf8'));

const panelSource = readFileSync(
    new URL('../src/browser/akari-review-panel-widget.ts', import.meta.url), 'utf8'
);
const boardSource = readFileSync(
    new URL('../src/browser/akari-review-board-widget.ts', import.meta.url), 'utf8'
);

test('パネルはプロジェクトルート基準で状態を受け取りライフサイクルを説明する', () => {
    const stateStart = panelSource.indexOf('        const onReviewSessionState =');
    const stateEnd = panelSource.indexOf('\n        window.addEventListener(REVIEW_SESSION_STATE_EVENT', stateStart);
    const stateHandler = panelSource.slice(stateStart, stateEnd);
    assert.match(stateHandler, /state\.projectRootUri/);
    assert.doesNotMatch(stateHandler, /state\.editUri/);

    const attachStart = panelSource.indexOf('    protected override onAfterAttach(');
    const attachEnd = panelSource.indexOf('\n    protected ', attachStart + 1);
    const attach = panelSource.slice(attachStart, attachEnd);
    assert.match(attach, /super\.onAfterAttach\(msg\)/);
    assert.match(attach, /this\.refreshReviewSessionContext\(\)/);
    assert.match(panelSource, /data-review-sessions-hint/);
    assert.match(panelSource, /t\('annotations\.reviewPanelWidget\.text\.aRecordIDrewWhileTalkingWhen'\)/);
    assert.equal(ja['annotations.reviewPanelWidget.text.aRecordIDrewWhileTalkingWhen'], '再生しながら話して描くと、あとで AI がコメントにまとめます。イヤホンで聞いてください。');
});

test('ボードは共通の状態語彙と未コンパイル操作を表示する', () => {
    for (const [key, label] of [['notSupported', '未対応'], ['alreadySupported', '対応済み'], ['confirmed', '確認済み']]) {
        assert.match(boardSource, new RegExp(`get title\\(\\) \\{ return t\\('annotations\\.reviewBoardWidget\\.text\\.${key}'\\); \\}`));
        assert.equal(ja[`annotations.reviewBoardWidget.text.${key}`], label);
    }
    assert.match(boardSource, /data-board-sessions/);
    assert.match(boardSource, /data-board-session-compile/);
    assert.match(boardSource, /planCompileHandoff\(this\.reviewSessions, sessionId\)/);
    assert.doesNotMatch(boardSource, /akari\.partner/);
});

test('ボードは attach・プロジェクト変更・注釈集合変更のときだけセッションを再取得する', () => {
    const refreshStart = boardSource.indexOf('    protected refreshReviewSessions(');
    const refreshEnd = boardSource.indexOf('\n    protected ', refreshStart + 1);
    const refreshMethod = boardSource.slice(refreshStart, refreshEnd);
    assert.match(refreshMethod, /force = false/);
    assert.match(refreshMethod, /this\.model\.annotations\.map\(annotation => annotation\.id\)\.join\('\\n'\)/);
    assert.match(refreshMethod, /if \(!force && !projectRootChanged && !annotationsChanged\) \{\s*return;/);
    assert.doesNotMatch(refreshMethod, /statusFilter|selectedSourceT/);

    const attachStart = boardSource.indexOf('    protected override onAfterAttach(');
    const attachEnd = boardSource.indexOf('\n    protected ', attachStart + 1);
    assert.match(boardSource.slice(attachStart, attachEnd), /this\.refreshReviewSessions\(true\)/);
});
