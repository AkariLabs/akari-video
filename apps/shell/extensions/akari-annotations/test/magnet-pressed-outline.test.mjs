import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/browser/style/annotations-widget-style.ts', import.meta.url), 'utf8');

test('timeline tool ON and keyboard focus show distinct single rings', () => {
  assert.match(css, /\.theia-button\.secondary\.akari-annotations-icon-button\[aria-pressed="true"\]\s*\{\s*box-shadow:\s*inset 0 0 0 2px var\(--akari-accent-light\);\s*\}/u);
  assert.match(css, /\.theia-button\.akari-annotations-icon-button:focus-visible,\s*\.akari-annotations-widget \.theia-button\.akari-annotations-text-button:focus-visible\s*\{\s*outline:\s*1px solid var\(--akari-accent-light\) !important;\s*outline-offset:\s*-3px !important;\s*\}/u);
  assert.match(css, /\.theia-button\.main\.akari-annotations-text-button:focus-visible\s*\{\s*outline-color:\s*var\(--akari-bg\) !important;\s*\}/u);
  assert.match(css, /\.theia-button\.secondary\.akari-annotations-icon-button\[aria-pressed="true"\]:focus-visible\s*\{\s*outline:\s*none !important;\s*box-shadow:\s*inset 0 0 0 3px var\(--akari-accent-light\);\s*\}/u);
  assert.match(css, /\.theia-button\.akari-annotations-icon-button:focus:not\(:focus-visible\),\s*\.akari-annotations-widget \.theia-button\.akari-annotations-text-button:focus:not\(:focus-visible\)\s*\{\s*outline:\s*none !important;\s*\}/u);
  assert.doesNotMatch(css, /\.akari-annotations-text-button\[aria-pressed="true"\](?::focus-visible)?\s*\{[^}]*box-shadow:/u);
  assert.doesNotMatch(css, /\.theia-button\.akari-annotations-text-button:focus-visible\s*\{[^}]*box-shadow:/u);
});
