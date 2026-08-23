import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'src', 'browser', 'akari-annotations-widget.ts'), 'utf8');

test('トランジション選択 UI は schema の 5 種を持つ', () => {
  const optionBlock = source.slice(
    source.indexOf('const TRANSITION_TYPE_OPTIONS'),
    source.indexOf('const BEAT_PROJECTION_EPSILON')
  );
  for (const type of ['dissolve', 'fade-black', 'fade-white', 'reveal-down', 'reveal-up']) {
    assert.match(optionBlock, new RegExp(`type: '${type}'`), type);
  }
  assert.equal((optionBlock.match(/\{ type: '/g) || []).length, 5);
});
