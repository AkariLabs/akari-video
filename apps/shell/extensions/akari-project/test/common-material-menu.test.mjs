import './support/i18n-ja.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMaterialContextMenuItems } from '../lib/common/material-context-menu-items.js';
import { visibleMaterialMenuItems } from '../lib/browser/akari-context-menu.js';

test('shared scene materials keep reading actions and omit source mutations', () => {
    const regular = buildMaterialContextMenuItems('material', true, { materialKind: 'video' });
    const shared = visibleMaterialMenuItems(regular, true).map(item => item.id);
    for (const id of ['open', 'add-to-timeline', 'reveal', 'copy-path', 'show-info']) assert.ok(shared.includes(id), id);
    for (const id of ['rename', 'delete', 'move-to-assets']) assert.ok(!shared.includes(id), id);
    assert.deepEqual(visibleMaterialMenuItems(regular, false), regular);
    assert.deepEqual(regular.slice(-3).map(item => item.id), ['rename', 'delete', 'ask-agent']);
});

test('shared unorganized rows omit move to assets; project root rows retain it', () => {
    const regular = buildMaterialContextMenuItems('unorganized', false);
    assert.ok(regular.some(item => item.id === 'move-to-assets'));
    const shared = visibleMaterialMenuItems(regular, true);
    for (const id of ['rename', 'delete', 'move-to-assets']) assert.ok(!shared.some(item => item.id === id), id);
    assert.ok(shared.some(item => item.id === 'open'));
});

