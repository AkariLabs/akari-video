import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePreviewItemWrite } from '../lib/edit-v2-item-write.js';
import { composeTransforms } from '../lib/tree-ops.js';
import { readInternalEdit } from '../lib/internal-model.js';
import { expandBagOverlays } from '../../overlay-runtime/src/parts.mjs';

const leaf = (id, transform = {}) => ({ id, at: 0, duration: 90, transform, source: { kind: 'html', path: 'overlays/title.html' } });
const group = (id, transform, items) => ({ id, at: 0, duration: 90, transform, source: { kind: 'group' }, items });
const doc = items => ({ version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [], tracks: [{ id: 'v', lane: 'visual', items }] });
const write = (value, itemId, patch) => resolvePreviewItemWrite(JSON.stringify(value), { kind: 'overlay', itemId, patch });
const close = (actual, expected) => {
  for (const key of ['x', 'y', 'scale', 'rotate']) assert.ok(Math.abs((actual[key] ?? (key === 'scale' ? 1 : 0))
    - (expected[key] ?? (key === 'scale' ? 1 : 0))) < 1e-8, `${key}: ${actual[key]} != ${expected[key]}`);
};

// Use the shared preview/export projector as the oracle, through the same
// internal-model reader as the production host. No copied bag algebra here.
const projected = value => expandBagOverlays(readInternalEdit(JSON.stringify(value)), () =>
  '<div data-akari-part="A">A</div><div data-akari-part="B">B</div>');
const rendered = (value, id) => {
  const record = projected(value).find(record => record.id === id);
  assert.ok(record, `projected overlay ${id}`);
  return record.transform ?? {};
};

test('nested leaf world patch is stored locally; rotated/scaled ancestors compose back exactly', () => {
  const a = { x: 130, y: -40, scale: 2, rotate: 90 };
  const b = { x: 20, y: 30, scale: .5, rotate: -25 };
  const value = doc([group('outer', a, [group('g', b, [leaf('a', { x: 10, y: 5, scale: 1.2, rotate: 7 })])])]);
  const original = structuredClone(value);
  const world = { x: 304, y: -90.8, scale: 1.6, rotate: 42 };
  const saved = JSON.parse(write(value, 'a', { transform: world }).candidateText);
  const local = saved.tracks[0].items[0].items[0].items[0].transform;
  close(composeTransforms(composeTransforms(a, b), local), world);
  close(rendered(saved, 'a'), world);
  assert.deepEqual(saved.tracks[0].items[0].transform, a);
  assert.deepEqual(saved.tracks[0].items[0].items[0].transform, b);
  assert.deepEqual(value, original, 'caller object is untouched');
});
test('a partial world x patch under rotation changes both local coordinates and preserves scale/rotate', () => {
  const parent = { x: 20, y: 30, scale: 2, rotate: 90 }, child = { x: 5, y: 10, scale: .5, rotate: 3 };
  const value = doc([group('g', parent, [leaf('a', child)])]);
  const saved = JSON.parse(write(value, 'a', { transform: { x: 100 } }).candidateText).tracks[0].items[0].items[0];
  close(composeTransforms(parent, saved.transform), { ...composeTransforms(parent, child), x: 100 });
  assert.equal(saved.transform.scale, child.scale); assert.equal(saved.transform.rotate, child.rotate);
});
test('nested group translation changes only its local x/y, never its children', () => {
  const value = doc([group('outer', { x: 10, y: 20, scale: 2, rotate: 90 }, [group('g', { x: 5, y: 6, scale: .7, rotate: 5 }, [leaf('a')])])]);
  const saved = JSON.parse(write(value, 'g', { transform: { x: 30, y: 50 } }).candidateText);
  const next = saved.tracks[0].items[0].items[0], old = value.tracks[0].items[0].items[0];
  close(composeTransforms(value.tracks[0].items[0].transform, next.transform), { x: 30, y: 50, scale: 1.4, rotate: 95 });
  assert.deepEqual(next.items, old.items);
  assert.equal(next.transform.scale, old.transform.scale); assert.equal(next.transform.rotate, old.transform.rotate);
  next.transform = old.transform;
  assert.deepEqual(saved, value);
});
for (const patch of [{ html: '<b>x</b>' }, { vars: { '--x': 2 } }, { params: { title: 'x' } }]) {
  test(`groups reject non-transform ${Object.keys(patch)[0]} patches`, () => {
    assert.throws(() => write(doc([group('g', {}, [leaf('a')])]), 'g', patch), /グループ.*書き戻せません/u);
  });
}
test('scanned bag part becomes an explicit child with a unique id and local transform, without exclude', () => {
  const bag = { ...leaf('bag', { x: 50, y: 20, scale: 2, rotate: 90 }), items: [leaf('bag.A')] };
  const parent = group('outer', { x: 100, y: 50, scale: .5, rotate: 30 }, [bag]);
  const world = { x: 304, y: 90, scale: 1.1, rotate: 37 };
  const saved = JSON.parse(write(doc([parent]), 'bag#A', { transform: world }).candidateText);
  const nextBag = saved.tracks[0].items[0].items[0], part = nextBag.items.at(-1);
  assert.equal(part.id, 'bag.A-2'); assert.equal(part.at, 0); assert.equal(part.duration, bag.duration);
  assert.deepEqual(part.source, { kind: 'html', path: bag.source.path, part: 'A' });
  assert.equal(nextBag.source.exclude, undefined);
  close(rendered(saved, part.id), world);
  assert.deepEqual(nextBag.items[0], bag.items[0]);
});
test('explicit bag part id and stale scanned alias both resolve to the same existing child', () => {
  const part = { ...leaf('bag.B', { x: 3, y: -40 }), source: { kind: 'html', path: 'overlays/title.html', part: 'B' } };
  const bag = { ...leaf('bag', { x: 30, y: 60, scale: 2, rotate: 90 }), items: [part] };
  const value = doc([bag]);
  const patch = { transform: { x: 180, y: 120 } };
  const direct = write(value, 'bag.B', patch), alias = write(value, 'bag#B', patch);
  assert.equal(alias.candidateText, direct.candidateText);
  const saved = JSON.parse(direct.candidateText).tracks[0].items[0];
  assert.equal(saved.items.length, 1);
  const world = rendered(value, 'bag.B');
  close(rendered(JSON.parse(direct.candidateText), 'bag.B'), { ...world, ...patch.transform });
});
test('excluded/unknown targets are rejected and nested text resolves to the referenced HTML', () => {
  const bag = { ...leaf('bag'), source: { kind: 'html', path: 'overlays/title.html', exclude: ['C'] } };
  assert.throws(() => write(doc([bag]), 'bag#C', { transform: { x: 2 } }), /見つかりません/u);
  assert.throws(() => write(doc([bag]), 'missing', { transform: { x: 2 } }), /見つかりません/u);
  assert.deepEqual(write(doc([group('g', {}, [leaf('a')])]), 'a', { html: '<b>new</b>' }), { htmlPath: 'overlays/title.html' });
});
test('top-level item output bytes remain the pre-drill-in stringifyEdit result', () => {
  for (const patch of [{ transform: { x: 20 } }, { transform: { scale: 2, rotate: 13 } },
    { vars: { '--font-size': 24 }, params: { text: 'value' } }]) {
    const value = doc([leaf('plain', { x: 7, y: 3 })]);
    const expected = structuredClone(value), item = expected.tracks[0].items[0];
    if (patch.transform) item.transform = { ...item.transform, ...patch.transform };
    if (patch.params) item.source.params = { ...patch.params };
    if (patch.vars) item.source.vars = { ...patch.vars };
    assert.equal(write(value, 'plain', patch).candidateText, `${JSON.stringify(expected, undefined, 2)}\n`);
  }
});
test('legacy overlay output bytes are unchanged', () => {
  const value = { version: 1, overlays: [{ id: 'plain', html: 'x.html', transform: { x: 3 } }] };
  const result = write(value, 'plain', { transform: { y: 4 } });
  value.overlays[0].transform.y = 4;
  assert.equal(result.candidateText, `${JSON.stringify(value, undefined, 2)}\n`);
});

for (const nested of [false, true]) {
  for (const targetId of ['s01.B', 's01#A']) {
    for (const patch of [{ x: 215, y: -18, scale: 1.25, rotate: 35 }, { x: 215 }, { y: 17, scale: .75 }]) {
      test(`parts oracle: ${nested ? 'nested group > ' : ''}nonidentity bag ${targetId}, patch ${Object.keys(patch)}`, () => {
        const b = { ...leaf('s01.B', { y: -40 }), source: { kind: 'html', path: 'overlays/title.html', part: 'B' } };
        const bag = { ...leaf('s01', { x: 100, y: 20, scale: 2 }), items: [b] };
        const value = doc([nested ? group('outer', { x: 23, y: -17, scale: 1.5, rotate: 55 },
          [group('g', { x: 8, y: 12, scale: .7, rotate: -10 }, [bag])]) : bag]);
        const before = rendered(value, targetId);
        const saved = JSON.parse(write(value, targetId, { transform: patch }).candidateText);
        const savedBag = nested ? saved.tracks[0].items[0].items[0].items[0] : saved.tracks[0].items[0];
        const savedId = targetId === 's01#A' ? savedBag.items.find(item => item.source.part === 'A').id : targetId;
        close(rendered(saved, savedId), { ...before, ...patch });
        assert.deepEqual(savedBag.transform, bag.transform, 'bag defaults are unchanged');
        if (targetId === 's01#A') assert.deepEqual(savedBag.items[0], b, 'existing explicit sibling is unchanged');
        assert.equal(savedBag.source.exclude, undefined);
      });
    }
  }
}
