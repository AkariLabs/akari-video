import assert from 'node:assert/strict';
import test from 'node:test';
import { shapeMarkup } from '../lib/shape-markup.js';

const root = markup => markup.match(/^<svg\b[^>]*>/u)?.[0];
const visible = markup => assert.match(root(markup), /\boverflow="visible"/u);

test('thick v0 outlines and arrow strokes can paint outside the unchanged box', () => {
  for (const shape of ['rect', 'ellipse', 'line', 'arrow']) {
    const markup = shapeMarkup({ kind: 'shape', shape, params: {
      width: 100, height: 80, stroke: '#123abc', strokeWidth: 40
    } });
    assert.match(root(markup), /width="100" height="80" viewBox="0 0 100 80"/u);
    visible(markup);
  }
});

test('thick v1 path and triangle/chevron arrowheads can paint outside the unchanged box', () => {
  const sources = [
    { shape: 'path', params: { path: { d: 'M0 80 L50 0 L100 80 Z' } } },
    ...['triangle', 'chevron'].map(endCap => ({ shape: 'arrow', params: { endCap } }))
  ];
  for (const source of sources) {
    const markup = shapeMarkup({ kind: 'shape', shape: source.shape, params: {
      width: 100, height: 80, stroke: '#123abc', strokeWidth: 40, ...source.params
    } });
    assert.match(root(markup), /width="100" height="80" viewBox="0 0 100 80"/u);
    visible(markup);
  }
});
