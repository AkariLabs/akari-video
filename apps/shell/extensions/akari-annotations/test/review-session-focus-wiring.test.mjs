import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const timelineSource = readFileSync(
    new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8'
);
const panelSource = readFileSync(
    new URL('../src/browser/akari-review-panel-widget.ts', import.meta.url), 'utf8'
);

test('録音帯 focus はパネル open の解決を待たず同期送信し、タイマーで一度再送する', () => {
    const start = timelineSource.indexOf('    protected focusReviewSession(');
    const end = timelineSource.indexOf('\n    protected ', start + 1);
    const method = timelineSource.slice(start, end);
    const firstDispatch = method.indexOf('this.dispatchReviewSessionFocus(sessionId)');
    const open = method.indexOf('this.commands.executeCommand(OPEN_AKARI_REVIEW_PANEL_ID)');
    const retry = method.lastIndexOf('this.dispatchReviewSessionFocus(sessionId)');
    assert.ok(firstDispatch >= 0 && firstDispatch < open);
    assert.ok(open < retry);
    assert.match(method, /window\.setTimeout/);
    assert.doesNotMatch(method, /\.then\s*\(/);
});

test('パネルは focus セッション ID を保持し、一覧再描画後に毎回ハイライトを戻す', () => {
    assert.match(panelSource, /this\.focusedReviewSessionId = detail\.sessionId/);
    assert.match(panelSource, /this\.revealReviewSession\(this\.focusedReviewSessionId\)/);
    assert.doesNotMatch(panelSource, /focusedReviewSessionId\s*=\s*undefined/);
});
