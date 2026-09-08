import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { computeLeftPanelOrder } = require('../lib/browser/left-panel-order.js');
const FIXED_ORDER = [
    'explorer-view-container', 'akari-role-buckets-widget', 'search-view-container',
    'vsx-extensions-view-container', 'akari-settings-opener', 'akari-menu-widget'
];

test('LEFT_PANEL_FIXED_ORDER matches the actual ALLOWLIST ID sequence', () => {
    const source = ts.createSourceFile('curation.ts', readFileSync(
        new URL('../src/browser/akari-activity-bar-curation.ts', import.meta.url), 'utf8'
    ), ts.ScriptTarget.Latest, true);
    const declarations = source.statements.filter(ts.isVariableStatement)
        .flatMap(statement => [...statement.declarationList.declarations]);
    const initializer = name => {
        const declaration = declarations.find(node => node.name.getText(source) === name);
        assert.ok(declaration?.initializer, name);
        return declaration.initializer.getText(source);
    };
    const { fixed, allowed } = new Function('EXPLORER_VIEW_CONTAINER_ID', `
        const ROLE_BUCKETS_WIDGET_ID = ${initializer('ROLE_BUCKETS_WIDGET_ID')};
        const MENU_WIDGET_ID = ${initializer('MENU_WIDGET_ID')};
        const ALLOWLIST = ${initializer('ALLOWLIST')};
        return { fixed: ${initializer('LEFT_PANEL_FIXED_ORDER')}, allowed: ALLOWLIST.map(entry => entry.id) };
    `)(FIXED_ORDER[0]);
    assert.deepEqual(fixed, allowed);
    assert.deepEqual(fixed, FIXED_ORDER);
});

test('restored tabs with settings first return to the fixed order without mutating input', () => {
    const current = Object.freeze([
        'akari-settings-opener', 'akari-menu-widget', 'search-view-container',
        'akari-role-buckets-widget', 'vsx-extensions-view-container'
    ]);
    const ordered = computeLeftPanelOrder(current, FIXED_ORDER);
    assert.deepEqual(ordered, FIXED_ORDER.slice(1));
    assert.deepEqual(computeLeftPanelOrder(ordered, FIXED_ORDER), ordered);
});

test('unknown IDs move to the end and retain their relative order', () => {
    const current = ['extra-2', 'akari-settings-opener', 'extra-1', 'search-view-container', 'extra-3'];
    assert.deepEqual(computeLeftPanelOrder(current, FIXED_ORDER), [
        'search-view-container', 'akari-settings-opener', 'extra-2', 'extra-1', 'extra-3'
    ]);
});

test('missing tabs stay absent and a later attached settings tab is placed above the menu', () => {
    const current = ['akari-menu-widget', 'explorer-view-container'];
    assert.deepEqual(computeLeftPanelOrder(current, FIXED_ORDER), ['explorer-view-container', 'akari-menu-widget']);
    assert.deepEqual(computeLeftPanelOrder([...current, 'akari-settings-opener'], FIXED_ORDER), [
        'explorer-view-container', 'akari-settings-opener', 'akari-menu-widget'
    ]);
});

test('empty current order yields no tabs', () => {
    assert.deepEqual(computeLeftPanelOrder([], FIXED_ORDER), []);
});

test('empty fixed order preserves all existing tabs', () => {
    assert.deepEqual(computeLeftPanelOrder(['extra-2', 'extra-1'], []), ['extra-2', 'extra-1']);
});
