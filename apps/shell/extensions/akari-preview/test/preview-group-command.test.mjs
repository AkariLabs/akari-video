import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildPreviewContextMenuMessage, previewGroupMenuVisible } from '../lib/common/preview-context-menu.js';

const host = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const contribution = readFileSync(new URL('../../akari-annotations/src/browser/akari-annotations-contribution.ts', import.meta.url), 'utf8');
const l1 = readFileSync(new URL('../evidence/preview-group-command-v1/scripts/run-l1.mjs', import.meta.url), 'utf8');

test('context payload copies the scoped set without changing the primary cut argument', () => {
  const ids = ['a', 'b'];
  const message = buildPreviewContextMenuMessage(25, 25,
    { left: 0, top: 0, width: 100, height: 100 }, 1.5, 'cut-1',
    { selectedIds: ids, selectionKind: 'multi', scopeId: null });
  assert.deepEqual(message, { type: 'akari-preview-context-menu', x: .25, y: .25,
    timelineT: 1.5, selectedPrimary: 'cut-1', selectedIds: ['a', 'b'],
    selectionKind: 'multi', scopeId: null });
  ids.pop();
  assert.deepEqual(message.selectedIds, ['a', 'b']);
});

test('selection forward carries the validated set while legacy primary remains', () => {
  assert.match(host, /overlayIds\?: string\[\]/u);
  assert.match(host, /message\.overlayIds\.every\(\(id: unknown\) => typeof id === 'string'\)/u);
  assert.match(host, /overlayId: message\.overlayId,[\s\S]*overlayIds: message\.overlayIds/u);
  assert.match(host, /selectedOverlayIds\.some\(\(id, index\) => id !== lastReportedOverlayIds\[index\]\)/u);
  assert.match(contribution, /Array\.isArray\(request\.overlayIds\)[\s\S]*handleOverlayMultiSelection/u);
  assert.match(contribution, /handleOverlaySelection\(request\.videoUri, request\.overlayId\)/u);
});

test('shared webview menu receives an output-only argument and exact visibility gates', () => {
  assert.match(host, /args: \[this\.previewGroupMenuContext\]/u);
  assert.match(host, /context === this\.previewGroupMenuContext/u);
  assert.match(host, /previewGroupMenuVisible\(context, kind\)/u);
  assert.match(host, /kind === 'output' && editUri/u);
  assert.match(host, /akari\.preview\.groupCommand/u);
  const selected = { source: 'akari-output-preview', selectionKind: 'multi', selectedIds: ['a', 'b'] };
  assert.equal(previewGroupMenuVisible(selected, 'group'), true);
  assert.equal(previewGroupMenuVisible({ ...selected, source: 'other-webview' }, 'group'), false);
  assert.equal(previewGroupMenuVisible({ ...selected, selectedIds: ['a'] }, 'group'), false);
  assert.equal(previewGroupMenuVisible({ ...selected, selectedIds: ['bag#A', 'bag#B'] }, 'group'), false);
  assert.equal(previewGroupMenuVisible({ ...selected, scopeNodeKind: 'bag' }, 'group'), false);
  assert.equal(previewGroupMenuVisible({ ...selected, selectionKind: 'group',
    selectedNodeKind: 'group', selectedIds: ['g'] }, 'ungroup'), true);
  assert.equal(previewGroupMenuVisible({ ...selected, selectionKind: 'group',
    selectedNodeKind: 'bag', selectedIds: ['bag'] }, 'ungroup'), false);
  assert.equal(previewGroupMenuVisible(selected, 'ungroup'), false);
  assert.match(host, /akari\.preview\.groupUnavailable/u);
});

test('L1 command discards widget return values and editing shortcut checks a footer sentinel', () => {
  const command = l1.slice(l1.indexOf('async function command('), l1.indexOf('const timeline ='));
  assert.match(command, /await c\.get\(key\)\.executeCommand\(/u);
  assert.match(command, /return true;/u);
  assert.doesNotMatch(command, /return c\.get\(key\)\.executeCommand/u);
  const editingStep = l1.slice(l1.indexOf("await sample(8, 'editing text"));
  assert.match(editingStep, /await setFooterSentinel\(sentinel\);[\s\S]*await press\('g',mod\);[\s\S]*footer===sentinel/u);
  assert.match(editingStep, /readFile\(editPath,'utf8'\)===before/u);
});
