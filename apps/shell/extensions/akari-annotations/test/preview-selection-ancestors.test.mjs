import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { selectionAncestorIds } from '../../../../../packages/overlay-runtime/src/selection-scope.mjs';

const rows = [{ id: 'outer' }, { id: 'g1', parentId: 'outer' },
  { id: 'first', parentId: 'g1' }, { id: 'other' }];
test('only ancestors, in outer-to-inner order, are expanded; input remains unchanged', () => {
  const before = structuredClone(rows);
  assert.deepEqual(selectionAncestorIds(rows, 'first'), ['outer', 'g1']);
  assert.deepEqual(selectionAncestorIds(rows, 'g1'), ['outer']);
  assert.deepEqual(selectionAncestorIds(rows, 'outer'), []);
  assert.deepEqual(selectionAncestorIds(rows, 'missing'), []);
  assert.deepEqual(rows, before);
});
test('scoped rows cannot expand parents outside focus; malformed cycles terminate', () => {
  assert.deepEqual(selectionAncestorIds(rows.slice(1, 3), 'first'), ['g1']);
  assert.deepEqual(selectionAncestorIds([{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }], 'a'), ['b']);
});
test('widget helper equals the tested pure function and uses the header persistence/refresh path', () => {
  const widget = readFileSync(new URL('../src/browser/akari-annotations-widget.ts', import.meta.url), 'utf8');
  const pure = readFileSync(new URL('../../../../../packages/overlay-runtime/src/selection-scope.mjs', import.meta.url), 'utf8');
  const body = widget.match(/protected previewSelectionAncestorIds[^\n]*\{([\s\S]*?)\n    \}/u)?.[1];
  const canonical = pure.match(/function selectionAncestorIds[^\n]*\{([\s\S]*?)\n\}/u)?.[1];
  assert.ok(body && canonical);
  assert.equal(body.replace(/\s+/gu, ''), canonical.replace(/\s+/gu, ''));
  const handler = widget.slice(widget.indexOf('    handleOverlaySelection('), widget.indexOf('    handleLayerSelection('));
  assert.match(handler, /rowsInFocusScope\(this\.expandedTimelineTreeRows, this\.focusScope\)/u);
  assert.match(handler, /this\.timelineCollapsedState\?\.set\(id, true\);\s*this\.timelineCollapsedIds\.delete\(id\)/u);
  assert.match(handler, /this\.refreshTimelineTreeRows\(\);[\s\S]*this\.applySelection\([\s\S]*this\.revealPreviewSelection\(\)/u);
  assert.doesNotMatch(handler, /else if \(this\.expandedTimelineTreeRows\.some/u);
  assert.match(handler, /else if \(this\.overlays\.some\(overlay => overlay\.id === overlayId\)\) \{\s*this\.applySelection\(\{ kind: 'overlay', id: overlayId \}, false\)/u);
  assert.doesNotMatch(handler, /this\.focusScope\s*=|this\.applyFocusScope\(/u);
});
