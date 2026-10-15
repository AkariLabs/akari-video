import assert from 'node:assert/strict';
import test from 'node:test';
import { readScript, validateScript } from '../validate-script.mjs';

const sample = { version: 0, kind: 'akari-script', lines: [
  { id: 'p-hook', kind: 'plan', at: 0, duration: 3, text: 'Hook', placeholder: 'talking-head', beat: 'hook' },
  { id: 'm-01', kind: 'memo', at: 12.5, text: 'Add diagram' }
] };

test('valid script passes', () => assert.equal(validateScript(sample).ok, true));
test('missing required field fails', () => {
  const value = structuredClone(sample); delete value.lines[0].text;
  assert.equal(validateScript(value).ok, false);
});
test('kind outside vocabulary fails', () => {
  const value = structuredClone(sample); value.lines[0].kind = 'caption';
  assert.equal(validateScript(value).ok, false);
});
test('tolerant reader skips broken lines and keeps unknown fields', () => {
  const value = { ...sample, extension: { future: true }, lines: [
    { id: 'bad', kind: 'memo', at: -1, text: 'bad' },
    { ...sample.lines[1], extra: 42 }, sample.lines[0],
    { ...sample.lines[1], text: 'duplicate' }
  ] };
  const read = readScript(value);
  assert.deepEqual(read.lines.map(line => line.id), ['p-hook', 'm-01']);
  assert.equal(read.lines[1].extra, 42);
  assert.deepEqual(read.extension, { future: true });
});
