import test from 'node:test';
import assert from 'node:assert/strict';
import { EDITOR_STATUS_ITEM_IDS, isEditorStatusItem } from '../lib/browser/statusbar/editor-status-item-filter.js';

test('テキストエディタ由来のステータスバー項目だけを抑止する', () => {
    assert.deepEqual(EDITOR_STATUS_ITEM_IDS, [
        'editor-status-cursor-position',
        'editor-status-encoding',
        'editor-status-eol',
        'editor-status-tabbing-config',
        'editor-status-language',
        'editor-language-status-items',
        'editor-formatter-status'
    ]);
    for (const id of EDITOR_STATUS_ITEM_IDS) {
        assert.equal(isEditorStatusItem(id), true, id);
    }
});

test('AKARI 項目と他の拡張項目を残す', () => {
    for (const id of [
        'akari-statusbar-account',
        'akari-statusbar-resources',
        'akari-timeline-issue',
        'akari-timeline-message',
        'timeline-status-seat',
        'theia-notification-center',
        'claude-code',
        'editor-status-custom',
        'other-editor-status-language'
    ]) {
        assert.equal(isEditorStatusItem(id), false, id);
    }
});
