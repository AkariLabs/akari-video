import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { computeLeftPanelOrder } = require('../lib/browser/left-panel-order.js');
const ids = require('../lib/common/rail-ids.js');
const FIXED_ORDER = [
    ids.RAIL_EXPAND_ID, ids.RAIL_PROJECT_OPENER_ID, ids.RAIL_LIBRARY_OPENER_ID,
    ids.RAIL_SKILLS_WIDGET_ID, ids.RAIL_EXPORT_OPENER_ID, 'explorer-view-container',
    'search-view-container', ids.RAIL_CHANNEL_WIDGET_ID, ids.RAIL_DEVELOPER_OPENER_ID,
    ids.RAIL_SETTINGS_OPENER_ID, ids.RAIL_ROLE_BUCKETS_WIDGET_ID
];

test('左レールの固定順と許可順が設計順に一致する', () => {
    const source = ts.createSourceFile('curation.ts', readFileSync(
        new URL('../src/browser/akari-activity-bar-curation.ts', import.meta.url), 'utf8'
    ), ts.ScriptTarget.Latest, true);
    const declarations = source.statements.filter(ts.isVariableStatement)
        .flatMap(statement => [...statement.declarationList.declarations]);
    const initializer = name => declarations.find(node => node.name.getText(source) === name)?.initializer?.getText(source);
    const resolve = new Function(...Object.keys(ids), 'EXPLORER_VIEW_CONTAINER_ID', `
        const ALLOWLIST = ${initializer('ALLOWLIST')};
        return { fixed: ${initializer('LEFT_PANEL_FIXED_ORDER')}, allowed: ALLOWLIST.map(entry => entry.id) };
    `);
    const { fixed, allowed } = resolve(...Object.values(ids), 'explorer-view-container');
    assert.deepEqual(fixed, FIXED_ORDER);
    assert.deepEqual(allowed, FIXED_ORDER);
});

test('未接続のタブは追加せず、復元順を整える', () => {
    const current = Object.freeze([ids.RAIL_SETTINGS_OPENER_ID, ids.RAIL_SKILLS_WIDGET_ID,
        ids.RAIL_ROLE_BUCKETS_WIDGET_ID, ids.RAIL_EXPAND_ID]);
    assert.deepEqual(computeLeftPanelOrder(current, FIXED_ORDER),
        FIXED_ORDER.filter(id => current.includes(id)));
});

test('未登録のタブは末尾に相対順のまま残す', () => {
    const current = ['extra-2', ids.RAIL_SETTINGS_OPENER_ID, 'extra-1', ids.RAIL_EXPAND_ID];
    assert.deepEqual(computeLeftPanelOrder(current, FIXED_ORDER),
        [ids.RAIL_EXPAND_ID, ids.RAIL_SETTINGS_OPENER_ID, 'extra-2', 'extra-1']);
});
