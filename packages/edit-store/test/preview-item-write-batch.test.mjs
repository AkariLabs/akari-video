import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePreviewItemWrite, resolvePreviewItemWriteBatch } from '../lib/edit-v2-item-write.js';
const leaf = id => ({ id, at: 0, duration: 90, source: { kind: 'html', path: 'overlays/title.html' } });
const fixture = () => JSON.stringify({ version: 2, output: { width: 640, height: 360, fps: 30 }, sources: [],
  tracks: [{ id: 'v', lane: 'visual', items: [leaf('flat'), { id: 'g', at: 0, duration: 90,
    source: { kind: 'group' }, transform: { x: 20, y: 30, scale: 2, rotate: 90 }, items: [leaf('nested')] }, leaf('bag')] }] });
const command = (itemId, transform) => ({ kind: 'overlay', itemId, patch: { transform } });
test('batch matches ordered single resolutions, including repeated target patches', () => {
  const text = fixture(), commands = [command('flat', { x: 12 }), command('flat', { y: 15 }), command('flat', { x: 40 })];
  const expected = commands.reduce((text, command) => resolvePreviewItemWrite(text, command).candidateText, text);
  assert.equal(resolvePreviewItemWriteBatch(text, commands).candidateText, expected);
});
test('batch mixes nested world-to-local writes, flat items and materialized bag children', () => {
  const result = JSON.parse(resolvePreviewItemWriteBatch(fixture(), [command('flat', { x: 5, y: 9 }),
    command('nested', { x: 10, y: 50 }), command('bag#title', { x: 8, y: 4 })]).candidateText);
  const [flat, group, bag] = result.tracks[0].items;
  assert.deepEqual(flat.transform, { x: 5, y: 9 });
  assert.ok(Math.abs(group.items[0].transform.x - 10) < 1e-8);
  assert.ok(Math.abs(group.items[0].transform.y - 5) < 1e-8);
  assert.equal(bag.items[0].source.part, 'title');
  assert.deepEqual(bag.items[0].transform, { x: 8, y: 4 });
});
test('mid-batch failure exposes no partial document and leaves input and commands unchanged', () => {
  const text = fixture(), commands = [command('bag#title', { x: 4 }), command('missing', { x: 2 })];
  const before = JSON.stringify(commands);
  assert.throws(() => resolvePreviewItemWriteBatch(text, commands), /missing/);
  assert.equal(text, fixture()); assert.equal(JSON.stringify(commands), before);
});
test('empty batch and external HTML writes are refused', () => {
  assert.throws(() => resolvePreviewItemWriteBatch(fixture(), []), /空/);
  assert.throws(() => resolvePreviewItemWriteBatch(fixture(), [command('flat', { x: 2 }),
    { kind: 'overlay', itemId: 'flat', patch: { html: '<b>text</b>' } }]), /HTML/);
});
test('legacy overlay batches also resolve sequentially', () => {
  const text = JSON.stringify({ overlays: [{ id: 'a' }, { id: 'b' }] });
  const result = JSON.parse(resolvePreviewItemWriteBatch(text, [command('a', { x: 5 }), command('b', { y: 3 })]).candidateText);
  assert.deepEqual(result.overlays.map(o => o.transform), [{ x: 5 }, { y: 3 }]);
});
