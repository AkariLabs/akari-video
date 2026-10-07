import assert from 'node:assert/strict';
import test from 'node:test';
import { readEditV2 } from '../lib/edit-v2.js';
import { readInternalEdit } from '../lib/internal-model.js';
import { serializeEdit } from '../lib/canonical.js';
import { resolvePreviewItemWrite } from '../lib/edit-v2-item-write.js';
import { detachItem, groupItems, materializeProjectedPart, ungroupItem } from '../lib/tree-ops.js';

const make = elements => ({ version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
  tracks: [{ id: 'v', lane: 'visual', items: [{ id: 'leaf', at: 0, duration: 60,
    source: { kind: 'html', path: 'a.html', text: 'x', elements, exclude: [] } }] }] });

test('reader, internal model and canonical serializer retain element overrides without moving source keys', () => {
  const elements = { '.bar[2]': { style: { height: '260px' } } };
  const doc = make(elements);
  assert.deepEqual(readEditV2(doc).tracks[0].items[0].source.elements, elements);
  assert.deepEqual(readInternalEdit(doc).tracks[0].items[0].source.elements, elements);
  const encoded = serializeEdit(doc);
  assert.ok(encoded.indexOf('"text"') < encoded.indexOf('"elements"'));
  assert.ok(encoded.indexOf('"elements"') < encoded.indexOf('"exclude"'));
  assert.deepEqual(JSON.parse(encoded).tracks[0].items[0].source.elements, elements);
  assert.equal(serializeEdit(JSON.parse(encoded)), encoded);
  assert.equal(JSON.parse(serializeEdit(make({ '.bar[0]': { style: {} } }))).tracks[0].items[0].source.elements, undefined);
});

test('legacy HTML source order stays byte-identical and element position is stable', () => {
  const source = { kind: 'html', path: 'a.html', params: { p: 1 }, vars: { v: 1 },
    exclude: ['x'], text: 't', style: { color: 'red' }, part: 'A', derivedFrom: 'z' };
  const item = { id: 'a', at: 0, duration: 10, source };
  const doc = { version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
    tracks: [{ id: 'v', lane: 'visual', items: [item] }] };
  const exact = '{ "id": "a", "at": 0, "duration": 10, "source": { "kind": "html", "path": "a.html", "params": { "p": 1 }, "vars": { "v": 1 }, "exclude": ["x"], "text": "t", "style": { "color": "red" }, "part": "A", "derivedFrom": "z" } }';
  const itemLine = value => serializeEdit(value).split('\n').find(line => line.includes('"id": "a"'))?.trim();
  assert.equal(itemLine(doc), exact);
  const withElements = structuredClone(doc);
  withElements.tracks[0].items[0].source = { kind: 'html', path: 'a.html', params: { p: 1 },
    elements: { '.bar[0]': { style: { width: '80px' } } }, vars: { v: 1 }, exclude: ['x'] };
  const encoded = serializeEdit(withElements);
  assert.ok(encoded.indexOf('"params"') < encoded.indexOf('"elements"'));
  assert.ok(encoded.indexOf('"elements"') < encoded.indexOf('"vars"'));
  assert.equal(serializeEdit(JSON.parse(encoded)), encoded);
});

test('canonical source removes empty element maps and only empty addresses', () => {
  const sourceOf = elements => JSON.parse(serializeEdit(make(elements))).tracks[0].items[0].source;
  assert.equal(sourceOf({}).elements, undefined);
  assert.equal(sourceOf({ '.a[0]': { style: {} }, '.b[0]': { style: {} } }).elements, undefined);
  assert.deepEqual(sourceOf({ '.a[0]': { style: {} }, '.b[0]': { style: { width: '20px' } } }).elements,
    { '.b[0]': { style: { width: '20px' } } });
});

test('reader rejects malformed addresses and unknown per-address fields', () => {
  for (const address of ['div', '.a b[0]', '.bar', '.bar[-1]', '.bar[01]']) {
    assert.throws(() => readEditV2(make({ [address]: { style: {} } })), /elements/u, address);
  }
  assert.throws(() => readEditV2(make({ '.bar[0]': { style: {}, text: 'no' } })), /text/u);
});

test('existing transform write and materialized projected part preserve elements', () => {
  const doc = make({ '.bar[0]': { style: { width: '90px' } } });
  const result = resolvePreviewItemWrite(JSON.stringify(doc), { kind: 'overlay', itemId: 'leaf', patch: { transform: { x: 5 } } });
  assert.deepEqual(JSON.parse(result.candidateText).tracks[0].items[0].source.elements, doc.tracks[0].items[0].source.elements);
  materializeProjectedPart(doc, 'leaf#A');
  assert.deepEqual(doc.tracks[0].items[0].items[0].source.elements, doc.tracks[0].items[0].source.elements);
});

test('existing vars, params and text patches preserve elements', () => {
  const elements = { '.bar[0]': { style: { width: '90px' } } };
  const doc = make(elements);
  doc.tracks[0].items[0].source.part = 'A';
  let text = JSON.stringify(doc);
  for (const patch of [{ vars: { '--tone': 'blue' } }, { params: { title: 'A' } }, { text: 'New' }]) {
    text = resolvePreviewItemWrite(text, { kind: 'overlay', itemId: 'leaf', patch }).candidateText;
    assert.deepEqual(JSON.parse(text).tracks[0].items[0].source.elements, elements);
  }
});

test('detach and group/ungroup retain element maps', () => {
  const elements = { '.free[0]': { style: { width: '180px' } } };
  const bag = make(elements);
  materializeProjectedPart(bag, 'leaf#A');
  const detached = detachItem(bag, 'leaf#A', { track: 'above' });
  assert.deepEqual(detached.source.elements, elements);
  const doc = make(elements);
  doc.tracks[0].items[0].duration = 30;
  doc.tracks[0].items.push({ id: 'second', at: 30, duration: 30,
    source: { kind: 'html', path: 'a.html', elements } });
  const { group } = groupItems(doc, ['leaf', 'second']);
  assert.ok(group.items.every(item => JSON.stringify(item.source.elements) === JSON.stringify(elements)));
  assert.ok(ungroupItem(doc, group.id).every(item => JSON.stringify(item.source.elements) === JSON.stringify(elements)));
});
