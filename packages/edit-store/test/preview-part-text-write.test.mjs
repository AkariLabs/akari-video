import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolvePreviewItemWrite } from '../lib/edit-v2-item-write.js';

const fixture = readFileSync(new URL('../../render-cut/test/fixtures/object-tree-html-bag/edit.json', import.meta.url), 'utf8');
const write = (id, patch, input = fixture) => resolvePreviewItemWrite(input, { kind: 'overlay', itemId: id, patch });
const item = (doc, id) => {
  const visit = items => {
    for (const entry of items ?? []) {
      if (entry.id === id) return entry;
      const found = visit(entry.items);
      if (found) return found;
    }
  };
  return visit(doc.tracks.flatMap(track => track.items ?? []));
};

for (const id of ['s01.C', 's01.B', 's01#A']) {
  for (const text of ['編集した文字 <b>&</b>', '']) {
    test(`${id}: text ${JSON.stringify(text)} changes only source.text (and materializes scanned A)`, () => {
      const expected = JSON.parse(fixture);
      if (id === 's01#A') {
        const bag = item(expected, 's01');
        bag.items.push({ id: 's01.A', at: 0, duration: bag.duration,
          source: { kind: 'html', path: bag.source.path, part: 'A', text } });
      } else item(expected, id).source.text = text;
      const result = write(id, { text });
      assert.equal(result.htmlPath, undefined, 'never return a shared HTML write destination');
      assert.deepEqual(JSON.parse(result.candidateText), expected);
      assert.equal(result.candidateText, `${JSON.stringify(expected, undefined, 2)}\n`);
      if (id === 's01#A') {
        const updated = JSON.parse(write('s01#A', { text: 'again' }, result.candidateText).candidateText);
        assert.equal(item(updated, 's01').items.length, 2, 'alias reuses the materialized child');
        assert.equal(item(updated, 's01.A').source.text, 'again');
      }
    });
  }
  for (const patch of [{ html: '<div data-akari-part-mask="A">damaged</div>' }, { html: '', text: 'safe?' }]) {
    test(`${id}: refuses html even alongside text`, () => {
      assert.throws(() => write(id, patch), /部品の文字は source.text に保存します/u);
    });
  }
  for (const text of [null, 123, {}, [], undefined]) {
    test(`${id}: rejects non-string text ${JSON.stringify(text)}`, () => {
      assert.throws(() => write(id, { text }), /text は文字列/u);
    });
  }
}

test('plain HTML retains its exact file-write resolution', () => {
  assert.deepEqual(write('plain', { html: '<b>new plain</b>' }), { htmlPath: 'overlays/plain.html' });
});
for (const id of ['plain', 's01', 'g1', 'g1.first']) {
  test(`${id}: a non-part item refuses text, including empty text`, () => {
    for (const text of ['new', '']) assert.throws(() => write(id, { text }), /部品でないアイテム/u);
  });
}
test('shape also refuses a text patch', () => {
  const doc = JSON.parse(fixture);
  item(doc, 'plain').source = { kind: 'shape', shape: 'rect' };
  assert.throws(() => write('plain', { text: 'new' }, JSON.stringify(doc)), /部品でないアイテム/u);
});
