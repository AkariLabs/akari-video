import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ADJUST_PREVIEW_SECTIONS } from '../lib/browser/inspector/adjust-preview.js';
import { ACTIVE_ADJUST_SECTIONS, COMING_SOON_ADJUST_SECTIONS } from '../lib/browser/inspector/tab-model.js';

test('adjust has six active sections and no coming-soon previews', () => {
  assert.equal(ACTIVE_ADJUST_SECTIONS.length, 6);
  assert.deepEqual(ADJUST_PREVIEW_SECTIONS, []);
  assert.deepEqual(COMING_SOON_ADJUST_SECTIONS, []);
});

test('effects no longer has a dummy preview builder', () => {
  const source = readFileSync(new URL('../src/browser/inspector/adjust-preview.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('buildEffects'), false);
  assert.equal(source.includes('createValueRow'), false);
});

test('empty preview iteration renders no placeholder and needs no DOM', () => {
  const rendered = [];
  ADJUST_PREVIEW_SECTIONS.forEach(section => rendered.push(section.build()));
  assert.deepEqual(rendered, []);
});
