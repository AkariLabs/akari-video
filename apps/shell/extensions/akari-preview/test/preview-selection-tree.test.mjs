import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const handler = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const start = handler.indexOf('// BEGIN preview selection tree');
const end = handler.indexOf('// END preview selection tree', start);
assert.ok(start > 0 && end > start);
// Structural assertions only. Runtime behavior is covered by browser and L1
// tests; never execute a substring extracted from the TypeScript source.
const treeSource = handler.slice(start, end);

test('summary tree retains group ancestors and bag identities only for overlay leaves', () => {
  assert.match(treeSource, /kind === 'group'[\s\S]*visit\(child, item\.id, world\)/u);
  assert.match(treeSource, /if \(kind !== 'html'\) return \[\]/u);
  assert.match(treeSource, /projectBagChildren\(item, parts\)/u);
  assert.match(treeSource, /visit\(child as TreeItem, item\.id, parentTransform\)/u);
});
test('summary preserves shared bag override geometry and copies it to selection nodes', () => {
  assert.match(treeSource, /const projectedOverlays = expandBagOverlays\(internal,/u);
  assert.match(treeSource, /transform: \{ \.\.\.overlay\.transform \}/u);
  assert.doesNotMatch(treeSource, /overlay\.transform\s*=/u);
});
test('legacy summaries and v2 without groups/bags have an empty selection tree', () => {
  assert.match(treeSource, /const tree: PreviewSelectionNode\[\] = \[\];\s*if \(rawVersion === 2\)/u);
  assert.match(treeSource, /if \(!tree\.some\(node => node\.kind !== 'leaf'\)\) tree\.length = 0/u);
});
test('selection-floor and optional scopeId use the existing one-way notification paths', () => {
  assert.match(handler, /scopeId\?: string \| null/u);
  assert.match(handler, /message\.scopeId === undefined \|\| message\.scopeId === null \|\| typeof message\.scopeId === 'string'/u);
  assert.match(handler, /'akari\.timeline\.selectionFloor'[\s\S]*?type: 'akari-preview-selection-floor', scopeId: detail\.scopeId/u);
  assert.match(handler, /message\.type === 'akari-preview-selection-floor'[\s\S]*?setSelectionFloor\(message\.scopeId\)/u);
  assert.match(handler, /data-akari-ui="preview-scope-breadcrumb"/u);
  const widget = readFileSync(new URL('../../akari-annotations/src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
  assert.match(widget, /this\.focusScope = scope;\s*this\.dispatchPreviewEvent\('akari\.timeline\.selectionFloor', \{ scopeId: scope\.rootId \}\)/u);
});

test('all-scanned bags keep one renderer record and expose lazy bag/part nodes', () => {
  assert.match(treeSource, /item\.children\.length === 0\s*&& !item\.source\.exclude\?\.length && parts\.length > 0/u);
  assert.match(treeSource, /if \(lazy && rendered\.has\(item\.id\)\)/u);
  assert.match(treeSource, /kind: 'bag', lazy: true/u);
  assert.match(treeSource, /parentId: item\.id, kind: 'leaf' as const, lazy: true/u);
  assert.doesNotMatch(treeSource, /selectionProjectionItem/u);
});
