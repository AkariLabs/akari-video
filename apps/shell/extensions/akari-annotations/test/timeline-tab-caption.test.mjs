import assert from 'node:assert/strict';
import test from 'node:test';
import uriModule from '@theia/core/lib/common/uri.js';

import { timelineTabCaption } from '../lib/common/timeline-tab-caption.js';

const URI = uriModule.default;
const root = new URI('file:///tmp/2026-08-31-object-tree-manual-test');

test('edit.json があるときはワークスペース名と相対パスを表示する', () => {
    assert.equal(timelineTabCaption(root, root.resolve('project/edit.json')),
        'タイムライン — 2026-08-31-object-tree-manual-test/project/edit.json');
});

test('edit.json がないときは編集データなしと表示する', () => {
    assert.equal(timelineTabCaption(root, undefined), 'タイムライン — 編集データなし');
});

test('深い階層の edit.json もルートからの相対パスを保持する', () => {
    assert.equal(timelineTabCaption(root, root.resolve('a/b/project/edit.json')),
        'タイムライン — 2026-08-31-object-tree-manual-test/a/b/project/edit.json');
});

test('ルート外の edit.json は絶対 URI にフォールバックする', () => {
    const editUri = new URI('file:///elsewhere/project/edit.json');
    assert.equal(timelineTabCaption(root, editUri), `タイムライン — ${editUri.toString()}`);
});

test('異なるスキームの edit.json は絶対 URI にフォールバックする', () => {
    const editUri = new URI('https://example.com/project/edit.json');
    assert.equal(timelineTabCaption(root, editUri), `タイムライン — ${editUri.toString()}`);
});
