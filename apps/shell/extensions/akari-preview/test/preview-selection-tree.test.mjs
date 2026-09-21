import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';
import { expandBagOverlays, projectBagChildren, scanHtmlParts } from '../../../../../packages/overlay-runtime/src/parts.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { readInternalEdit } = require('../../../../../packages/edit-store/lib/index.js');
const handler = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
const start = handler.indexOf('// BEGIN preview selection tree');
const end = handler.indexOf('// END preview selection tree', start);
assert.ok(start > 0 && end > start);
// Execute the actual typed summary construction, rather than reimplementing it.
const code = ts.transpileModule(`function build(internal, overlayHtml, rawVersion) {
  ${handler.slice(start, end)}
  return { tree, projected: projectedOverlays };
}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const build = vm.runInNewContext(`${code};build`, { expandBagOverlays, projectBagChildren, scanHtmlParts });
const fixture = new URL('../../../../../packages/render-cut/test/fixtures/object-tree-html-bag/', import.meta.url);
const rawFixture = () => JSON.parse(readFileSync(new URL('edit.json', fixture), 'utf8'));
function summary(raw, rawVersion = 2) {
  const internal = readInternalEdit(JSON.stringify(raw));
  const html = new Map(['overlays/card.html', 'overlays/plain.html'].map(ref => [ref, readFileSync(new URL(ref, fixture), 'utf8')]));
  return JSON.parse(JSON.stringify(build(internal, html, rawVersion)));
}

test('summary tree retains group ancestors and scanned/explicit bag identities only for overlay leaves', () => {
  const raw = rawFixture(), g = raw.tracks[1].items[0];
  raw.tracks[1].items[0] = { id: 'outer', at: 0, duration: 120, source: { kind: 'group' }, items: [g] };
  raw.sources.push({ id: 'video', path: 'assets/video.mp4' });
  raw.tracks.push({ id: 'native', lane: 'visual', items: [{ id: 'native-group', at: 0, duration: 120, source: { kind: 'group' },
    items: [{ id: 'native-leaf', at: 0, duration: 120, source: { kind: 'media', src: 'video', in: 0, out: 4 } }] }] });
  const { tree } = summary(raw);
  assert.deepEqual(tree.filter(n => ['outer', 'g1', 'g1.first'].includes(n.id)).map(n => [n.id, n.parentId, n.kind]),
    [['outer', null, 'group'], ['g1', 'outer', 'group'], ['g1.first', 'g1', 'leaf']]);
  assert.equal(tree.find(n => n.id === 's01').kind, 'bag');
  assert.equal(tree.find(n => n.id === 's01#A').parentId, 's01');
  assert.equal(tree.find(n => n.id === 's01.B').parentId, 's01');
  assert.equal(tree.find(n => n.id === 's01.C').parentId, null);
  assert.ok(!tree.some(n => n.id.startsWith('native')));
});
test('summary preserves shared bag override geometry and copies it to selection nodes', () => {
  const raw = rawFixture(), bag = raw.tracks[0].items[0];
  bag.transform = { x: 60, y: 40, scale: 2, rotate: 90 };
  const { tree, projected } = summary(raw);
  const oracle = expandBagOverlays(readInternalEdit(JSON.stringify(raw)), ref =>
    readFileSync(new URL(ref, fixture), 'utf8'));
  assert.deepEqual(projected, oracle, 'tree construction never mutates renderer records');
  const b = projected.find(n => n.id === 's01.B');
  assert.deepEqual(b.transform, { x: 60, y: -40, scale: 2, rotate: 90 });
  assert.deepEqual(tree.find(n => n.id === 's01.B').transform, b.transform);
  assert.deepEqual(projected.find(n => n.id === 's01#A').transform, bag.transform);
});
test('legacy summaries and v2 without groups/bags have an empty selection tree', () => {
  assert.deepEqual(summary(rawFixture(), 1).tree, []);
  const raw = rawFixture(); raw.tracks = [raw.tracks[2]];
  assert.deepEqual(summary(raw).tree, []);
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

test('all-scanned bags expand into addressable preview parts without explicit children in edit.json', () => {
  const raw = rawFixture(), bag = raw.tracks[0].items[0];
  delete bag.items; delete bag.source.exclude;
  const { tree, projected } = summary(raw);
  assert.equal(tree.find(n => n.id === 's01').kind, 'bag');
  assert.deepEqual(tree.filter(n => n.parentId === 's01').map(n => n.id), ['s01#A', 's01#B', 's01#C']);
  assert.ok(projected.some(n => n.id === 's01#A' && n.part === 'A'));
  assert.equal(bag.items, undefined);
});
