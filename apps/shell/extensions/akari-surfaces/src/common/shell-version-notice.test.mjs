import assert from 'node:assert/strict';
import test from 'node:test';

// update-feed.test.mjs と同じ理由でこのファイルは src/common/ に同居させている
// （`test/` は本タスクの所有パス外）。`npm run build:ext`（tsc -b）でこの隣の
// shell-version-notice.ts をコンパイルした後、
// `node --test src/common/shell-version-notice.test.mjs` として直接実行できる。
import {
    buildReleaseNotesUrl,
    evaluateVersionNotice,
    formatVersionNoticeText,
    parseShellLastVersion,
    withRecordedVersion
} from '../../lib/common/shell-version-notice.js';

test('parseShellLastVersion: 壊れた JSON は例外を投げず null', () => {
    assert.equal(parseShellLastVersion('{ not json'), null);
});

test('parseShellLastVersion: 正常な JSON はそのまま返す', () => {
    const record = parseShellLastVersion(JSON.stringify({ lastVersion: '0.1.2', updatedAt: '2026-08-01T00:00:00.000Z' }));
    assert.equal(record.lastVersion, '0.1.2');
});

test('evaluateVersionNotice: 記録が無い（初回起動）ときは shouldNotify: false', () => {
    assert.deepEqual(evaluateVersionNotice('0.1.3', null), { shouldNotify: false });
});

test('evaluateVersionNotice: 記録はあるが lastVersion が無い（壊れた記録）ときも shouldNotify: false', () => {
    assert.deepEqual(evaluateVersionNotice('0.1.3', { updatedAt: 'x' }), { shouldNotify: false });
});

test('evaluateVersionNotice: 前回と同じ版なら shouldNotify: false', () => {
    assert.deepEqual(evaluateVersionNotice('0.1.3', { lastVersion: '0.1.3' }), { shouldNotify: false });
});

test('evaluateVersionNotice: 前回と違う版なら shouldNotify: true + previousVersion', () => {
    const status = evaluateVersionNotice('0.1.3', { lastVersion: '0.1.2' });
    assert.equal(status.shouldNotify, true);
    assert.equal(status.previousVersion, '0.1.2');
});

test('evaluateVersionNotice: ダウングレード（前回の方が新しい）でも版が違えば shouldNotify: true', () => {
    // task.md は「前回起動時と違う版」とだけ指定しており、上下方向は問わない
    // （壊れた配布 / ロールバックでの実機確認を優先する）。
    const status = evaluateVersionNotice('0.1.2', { lastVersion: '0.1.3' });
    assert.equal(status.shouldNotify, true);
    assert.equal(status.previousVersion, '0.1.3');
});

test('formatVersionNoticeText: task.md 指示どおりの文言', () => {
    assert.equal(formatVersionNoticeText('0.2.0'), 'AKARI Video を v0.2.0 に更新しました');
});

test('withRecordedVersion: version と updatedAt をそのまま組み立てる', () => {
    assert.deepEqual(
        withRecordedVersion('0.2.0', '2026-08-03T00:00:00.000Z'),
        { lastVersion: '0.2.0', updatedAt: '2026-08-03T00:00:00.000Z' }
    );
});

test('buildReleaseNotesUrl: GitHub リリースタグの規約どおり', () => {
    assert.equal(buildReleaseNotesUrl('0.2.0'), 'https://github.com/AkariLabs/akari-video/releases/tag/v0.2.0');
});
