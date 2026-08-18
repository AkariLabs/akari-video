import assert from 'node:assert/strict';
import test from 'node:test';

import {
    AKARI_INSPECTOR_WIDGET_ID,
    PARTNER_WIDGET_ID,
    resolveRightPaneSyncAction
} from '../lib/common/right-pane-sync.js';

const REVIEW_PANEL_WIDGET_ID = 'akari-review-panel-widget';

test('注釈パネルが current で選択があればインスペクターを常駐だけさせる（焦点は奪わない）', () => {
    assert.equal(resolveRightPaneSyncAction(REVIEW_PANEL_WIDGET_ID, true), 'attach-inspector');
});

test('注釈パネルが current なら選択がなくても同期をスキップする', () => {
    assert.equal(resolveRightPaneSyncAction(REVIEW_PANEL_WIDGET_ID, false), 'skip');
});

test('インスペクターが current で選択がなければパートナーを表示する', () => {
    assert.equal(resolveRightPaneSyncAction(AKARI_INSPECTOR_WIDGET_ID, false), 'show-partner');
});

test('パートナーが current で選択があればインスペクターを開く', () => {
    assert.equal(resolveRightPaneSyncAction(PARTNER_WIDGET_ID, true), 'open-inspector');
});

test('右エリアに current がなく選択があればインスペクターを開く', () => {
    assert.equal(resolveRightPaneSyncAction(undefined, true), 'open-inspector');
});

test('右エリアに current がなく選択もなければパートナーを表示する', () => {
    assert.equal(resolveRightPaneSyncAction(undefined, false), 'show-partner');
});

test('インスペクターが current で選択があればインスペクターを開く', () => {
    assert.equal(resolveRightPaneSyncAction(AKARI_INSPECTOR_WIDGET_ID, true), 'open-inspector');
});

test('パートナーが current で選択がなければパートナーを表示する', () => {
    assert.equal(resolveRightPaneSyncAction(PARTNER_WIDGET_ID, false), 'show-partner');
});

test('同期対象外のウィジェット（パートナー AI 等）が current でも、選択があればインスペクターを常駐させる', () => {
    assert.equal(resolveRightPaneSyncAction('unrelated-right-widget', true), 'attach-inspector');
    assert.equal(resolveRightPaneSyncAction('plugin-view-container:workbench.view.extension.claude-sidebar-secondary', true), 'attach-inspector');
});

test('同期対象外のウィジェットが current で選択がなければ何もしない', () => {
    assert.equal(resolveRightPaneSyncAction('unrelated-right-widget', false), 'skip');
});
