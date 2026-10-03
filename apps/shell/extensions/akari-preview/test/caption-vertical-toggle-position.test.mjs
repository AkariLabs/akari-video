import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCaptionContextField } from '../../akari-annotations/lib/common/caption-context-edit.js';

const stage = { left: 0, top: 0, width: 1920, height: 1080 };

test('vertical toggle writes its compensated position and vertical flag together', async () => {
  let source = JSON.stringify({ captions: [{ id: 'a', text_style: {
    text_anchor: 'tl', position: { x: 0.4351, y: 0.5556 }, scale: 3, size_px: 45 } }] });
  const original = source;
  const writes = [];
  const history = [];
  const box = { left: 535, top: 450, width: 900, height: 150 };
  const deps = { readSource: async () => source, writeSource: async next => { writes.push(next); source = next; },
    recordHistory: entry => history.push(entry), reload: async () => undefined };
  assert.deepEqual(await applyCaptionContextField('a', 'vertical',
    { enabled: true, box, stage }, [], deps), { ok: true });
  assert.equal(writes.length, 1);
  const style = JSON.parse(source).captions[0].text_style;
  assert.equal(style.vertical, true);
  assert.deepEqual(style.position, { x: 0.492, y: 0.3614 });
  assert.equal(history.length, 1);
  await history[0].undo();
  assert.equal(source, original);
  await history[0].redo();
  assert.equal(source, writes[0]);
});

test('vertical toggle clamps a scaled box to the frame', async () => {
  let source = JSON.stringify({ captions: [{ id: 'a', text_style: { text_anchor: 'tl',
    position: { x: 0.9, y: 0.9 }, scale: 3 } }] });
  await applyCaptionContextField('a', 'vertical', { enabled: true,
    box: { left: 1760, top: 900, width: 600, height: 120 }, stage }, [], {
    readSource: async () => source, writeSource: async next => { source = next; },
    recordHistory: () => undefined, reload: async () => undefined });
  const position = JSON.parse(source).captions[0].text_style.position;
  assert.ok(position.x >= 0 && position.x <= 1);
  assert.ok(position.y >= 0 && position.y <= 1);
});

test('a newly placed caption gains an explicit in-frame position in the same vertical write', async () => {
  let source = JSON.stringify({ captions: [{ id: 'a', text_style: { text_anchor: 'tl',
    size_px: 45, scale: 3 } }] });
  let writes = 0;
  await applyCaptionContextField('a', 'vertical', { enabled: true,
    box: { left: 700, top: 520, width: 600, height: 150 }, stage }, [], {
    readSource: async () => source, writeSource: async next => { source = next; writes++; },
    recordHistory: () => undefined, reload: async () => undefined });
  const style = JSON.parse(source).captions[0].text_style;
  assert.equal(writes, 1);
  assert.equal(style.vertical, true);
  assert.deepEqual(style.position, { x: 0.4998, y: 0.4725 });
});
