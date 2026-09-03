import assert from 'node:assert/strict';
import test from 'node:test';

import { shapeMarkup } from '../lib/shape-markup.js';

const full = shape => ({
  kind: 'shape',
  shape,
  params: {
    width: 100,
    height: 80,
    fill: '#123abc',
    stroke: 'navy',
    strokeWidth: 4,
    cornerRadius: 12,
  },
});

const expected = {
  rect: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80"><rect x="0" y="0" width="100" height="80" fill="#123abc" stroke="navy" stroke-width="4"/></svg>',
  'rounded-rect': '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80"><rect x="0" y="0" width="100" height="80" rx="12" ry="12" fill="#123abc" stroke="navy" stroke-width="4"/></svg>',
  ellipse: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80"><ellipse cx="50" cy="40" rx="50" ry="40" fill="#123abc" stroke="navy" stroke-width="4"/></svg>',
  line: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80"><line x1="0" y1="40" x2="100" y2="40" fill="none" stroke="navy" stroke-width="4" stroke-linecap="round"/></svg>',
  arrow: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80"><path d="M 0 40 H 60 M 60 0 L 100 40 L 60 80" fill="none" stroke="navy" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  'speech-bubble': '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="80" viewBox="0 0 100 80"><path d="M 0 0 H 100 V 60 H 82 L 72 80 L 60 60 H 0 Z" fill="#123abc" stroke="navy" stroke-width="4"/></svg>',
};

for (const [shape, markup] of Object.entries(expected)) {
  test(`shapeMarkup renders deterministic ${shape} markup`, () => {
    assert.equal(shapeMarkup(full(shape)), markup);
  });
}

test('shapeMarkup applies the vocabulary defaults, including the shorter line bounding box', () => {
  assert.equal(
    shapeMarkup({ kind: 'shape', shape: 'rect' }),
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340" viewBox="0 0 600 340"><rect x="0" y="0" width="600" height="340" fill="#f97316" stroke="none" stroke-width="0"/></svg>',
  );
  assert.equal(
    shapeMarkup({ kind: 'shape', shape: 'line' }),
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="80" viewBox="0 0 600 80"><line x1="0" y1="40" x2="600" y2="40" fill="none" stroke="#f97316" stroke-width="8" stroke-linecap="round"/></svg>',
  );
});

test('shapeMarkup falls back from unsafe colors without emitting injectable markup', () => {
  const markup = shapeMarkup({
    kind: 'shape',
    shape: 'rect',
    params: { fill: 'red" onload="alert(1)', stroke: '<script>', strokeWidth: 3 },
  });
  assert.match(markup, /fill="#f97316" stroke="none"/);
  assert.doesNotMatch(markup, /onload|script/u);

  const line = shapeMarkup({
    kind: 'shape', shape: 'line', params: { fill: '#123abc', stroke: '<script>' },
  });
  assert.match(line, /stroke="#123abc" stroke-width="8"/);
  assert.doesNotMatch(line, /script/u);
});

test('shapeMarkup accepts only finite in-range numbers and normalizes color whitespace to one line', () => {
  const markup = shapeMarkup({
    kind: 'shape',
    shape: 'rounded-rect',
    params: {
      width: Number.POSITIVE_INFINITY,
      height: -1,
      fill: 'rgb(1,\n 2, 3)',
      strokeWidth: Number.NaN,
      cornerRadius: -5,
    },
  });
  assert.equal(
    markup,
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="340" viewBox="0 0 600 340"><rect x="0" y="0" width="600" height="340" rx="24" ry="24" fill="rgb(1, 2, 3)" stroke="none" stroke-width="0"/></svg>',
  );
  assert.doesNotMatch(markup, /[\r\n]/u);
});

test('shapeMarkup returns byte-identical output for the same input', () => {
  const source = full('speech-bubble');
  assert.equal(shapeMarkup(source), shapeMarkup(source));
});
