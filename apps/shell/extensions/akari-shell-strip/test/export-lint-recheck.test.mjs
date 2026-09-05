import test from 'node:test';
import assert from 'node:assert/strict';
import {
    LINT_RECHECK_WATCHED_FILES,
    formatLintCheckedAt,
    lintRecheckHint,
    shouldRecheckLintForPath,
    shouldWatchForLintRecheck
} from '../lib/common/export-lint-recheck.js';

test('shouldRecheckLintForPath: 編集ドキュメントの変更だけを引き金にする', () => {
    assert.equal(shouldRecheckLintForPath('/project/edit.json'), true);
    assert.equal(shouldRecheckLintForPath('/project/captions.json'), true);
    assert.equal(shouldRecheckLintForPath('C:\\project\\edit.json'), true);
    assert.equal(shouldRecheckLintForPath('edit.json'), true);
    // 書き出し・レポート・素材の更新では再検査しない（lint の入力ではない）。
    assert.equal(shouldRecheckLintForPath('/project/.akari/lint.json'), false);
    assert.equal(shouldRecheckLintForPath('/project/exports/final.mp4'), false);
    assert.equal(shouldRecheckLintForPath('/project/edit.json.tmp'), false);
    assert.equal(shouldRecheckLintForPath('/project/assets/edit.json/'), true);
    assert.deepEqual([...LINT_RECHECK_WATCHED_FILES], ['edit.json', 'captions.json']);
});

test('shouldWatchForLintRecheck: lint 停止画面を開いている間だけ張る', () => {
    assert.equal(shouldWatchForLintRecheck('lint-failed', true), true);
    assert.equal(shouldWatchForLintRecheck('lint-failed', false), false);
    assert.equal(shouldWatchForLintRecheck('rendering', true), false);
    assert.equal(shouldWatchForLintRecheck('done', true), false);
    assert.equal(shouldWatchForLintRecheck(undefined, true), false);
});

test('formatLintCheckedAt: 未検査と未来時刻は「未検査」に落とす', () => {
    const now = new Date('2026-09-03T12:34:56');
    assert.equal(formatLintCheckedAt(undefined, now), '未検査');
    assert.equal(formatLintCheckedAt(Number.NaN, now), '未検査');
    assert.equal(formatLintCheckedAt(now.getTime() + 600_000, now), '未検査');
    assert.equal(formatLintCheckedAt(new Date('2026-09-03T09:05:07').getTime(), now), '09:05:07');
});

test('lintRecheckHint: 検査中・未検査・検査済みで文言を切り替える', () => {
    const now = new Date('2026-09-03T12:34:56');
    assert.equal(lintRecheckHint({ rechecking: true }, now), 'いま検査し直しています…');
    assert.equal(
        lintRecheckHint({ rechecking: false }, now),
        '編集を保存すると自動でもう一度検査します。'
    );
    assert.equal(
        lintRecheckHint({ rechecking: false, checkedAt: new Date('2026-09-03T12:30:00').getTime() }, now),
        '編集を保存すると自動でもう一度検査します（直近の検査 12:30:00）。'
    );
});
