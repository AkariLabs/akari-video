import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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
    assert.match(panelSource, /喋りながら描いた記録。コンパイルすると下のコメント（チケット）になります/);
});

test('ボードは共通の状態語彙と未コンパイル操作を表示する', () => {
    assert.match(boardSource, /title: '未対応'/);
    assert.match(boardSource, /title: '対応済み'/);
    assert.match(boardSource, /title: '確認済み'/);
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
