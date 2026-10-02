import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readHandlerSource, methodBody, sliceBetween } from './helpers/handler-source.mjs';

test('handler source is byte-for-byte the original source', () => {
  const original = readFileSync(new URL('../src/browser/akari-preview-open-handler.ts', import.meta.url), 'utf8');
  assert.equal(readHandlerSource(), original);
});

test('methodBody extracts a real method and rejects a missing method', () => {
  const source = readHandlerSource();
  const body = methodBody('hostAdapterScript');
  assert.match(body, /^    protected hostAdapterScript\(\): string/u);
  assert.ok(source.includes(body));
  assert.throws(() => methodBody('missingHandlerMethod'), /missingHandlerMethod/u);
});

test('sliceBetween matches the original range and rejects missing or reversed anchors', () => {
  const source = readHandlerSource();
  const start = 'const onAdjustBypass =';
  const end = 'window.addEventListener(TIMELINE_ADJUST_BYPASS_EVENT';
  assert.equal(sliceBetween(start, end), source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))));
  assert.throws(() => sliceBetween('missingStartAnchor', end), /missingStartAnchor/u);
  assert.throws(() => sliceBetween(start, 'missingEndAnchor'), /missingEndAnchor/u);
  assert.throws(() => sliceBetween(end, start), /const onAdjustBypass =/u);
});

test('source options work on synthetic text', () => {
  const source = '    private example() {\n      return 1;\n    }\nA first B second';
  assert.equal(methodBody('example', { source }), '    private example() {\n      return 1;\n    }');
  assert.equal(sliceBetween('A', 'B', { source }), 'A first ');
  assert.equal(sliceBetween('A', 'B', { source: 'A skip A first B', from: 2 }), 'A first ');
  assert.throws(() => methodBody('example', { source: `${source}\n${source}` }), /example/u);
});
