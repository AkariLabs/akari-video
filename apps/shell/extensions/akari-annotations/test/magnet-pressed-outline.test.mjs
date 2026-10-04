import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/browser/style/annotations-widget-style.ts', import.meta.url), 'utf8');

test('only the pressed timeline magnet keeps an orange outline without focus', () => {
  assert.match(css, /\.theia-button\.secondary\.akari-annotations-icon-button\[aria-label="マグネット"\]\[aria-pressed="true"\]\s*\{\s*box-shadow:\s*inset 0 0 0 2px var\(--akari-accent-light\);\s*\}/);
  assert.doesNotMatch(css, /\.theia-button\.secondary\.akari-annotations-icon-button\[aria-pressed="true"\]\s*\{\s*box-shadow:/);
});
