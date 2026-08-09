import assert from 'node:assert/strict';
import test from 'node:test';

// shell-version-notice.test.mjs と同じ理由でこのファイルは src/common/ に同居させている
// （`test/` は本タスクの所有パス外）。`npm run build:ext`（tsc -b）でこの隣の
// project-display-name.ts をコンパイルした後、
// `node --test src/common/project-display-name.test.mjs` として直接実行できる。
import { parseIntakeTitle, resolveProjectDisplayName } from '../../lib/common/project-display-name.js';

test('parseIntakeTitle: title が文字列ならそのまま返す', () => {
    assert.equal(parseIntakeTitle({ title: '夏祭りレポート' }), '夏祭りレポート');
});

test('parseIntakeTitle: title が null なら null', () => {
    assert.equal(parseIntakeTitle({ title: null }), null);
});

test('parseIntakeTitle: title キー自体が無ければ null（既存プロジェクト）', () => {
    assert.equal(parseIntakeTitle({ version: 1, status: 'draft' }), null);
});

test('parseIntakeTitle: title が空文字・空白のみなら null（未設定扱い）', () => {
    assert.equal(parseIntakeTitle({ title: '' }), null);
    assert.equal(parseIntakeTitle({ title: '   ' }), null);
});

test('parseIntakeTitle: title が文字列以外の型なら null', () => {
    assert.equal(parseIntakeTitle({ title: 123 }), null);
});

test('parseIntakeTitle: parsed 自体が null/undefined でも例外を投げず null', () => {
    assert.equal(parseIntakeTitle(null), null);
    assert.equal(parseIntakeTitle(undefined), null);
});

test('resolveProjectDisplayName: title ありならフォルダ名より title を優先する', () => {
    assert.equal(resolveProjectDisplayName('夏祭りレポート', '2026-08-09-new-video'), '夏祭りレポート');
});

test('resolveProjectDisplayName: title が null ならフォルダ名にフォールバックする', () => {
    assert.equal(resolveProjectDisplayName(null, '2026-08-09-new-video'), '2026-08-09-new-video');
});

test('resolveProjectDisplayName: title が undefined（既存プロジェクト）でもフォルダ名にフォールバックする', () => {
    assert.equal(resolveProjectDisplayName(undefined, '2026-08-08-video-13'), '2026-08-08-video-13');
});
