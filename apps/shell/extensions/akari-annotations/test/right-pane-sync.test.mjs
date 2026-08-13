import assert from 'node:assert/strict';
import test from 'node:test';

import {
    AKARI_INSPECTOR_WIDGET_ID,
    PARTNER_WIDGET_ID,
    resolveRightPaneSyncAction
} from '../lib/common/right-pane-sync.js';

const REVIEW_PANEL_WIDGET_ID = 'akari-review-panel-widget';

test('注釈パネルが current なら選択があっても同期をスキップする', () => {
    assert.equal(resolveRightPaneSyncAction(REVIEW_PANEL_WIDGET_ID, true), 'skip');
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

test('同期対象外のウィジェットが current なら同期をスキップする', () => {
    assert.equal(resolveRightPaneSyncAction('unrelated-right-widget', true), 'skip');
    assert.equal(resolveRightPaneSyncAction('unrelated-right-widget', false), 'skip');
});
