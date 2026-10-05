import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readHandlerSource } from './helpers/handler-source.mjs';

const style = readFileSync(new URL('../src/browser/preview-selection-handles-style.ts', import.meta.url), 'utf8');

test('preview injects text selection rules with editing exceptions', () => {
  assert.match(readHandlerSource(), /\$\{previewSelectionHandlesStyle\}/u);
  assert.match(style, /#preview-stage, #preview-stage \*\s*\{[^}]*user-select:\s*none\s*!important;[^}]*-webkit-user-select:\s*none\s*!important;/u);
  for (const selector of [
    '[data-akari-interaction-editing="true"]',
    '[contenteditable]:not([contenteditable="false"])',
    ':is(input, textarea, select)',
  ]) {
    assert.ok(style.includes(`#preview-stage ${selector}`), selector);
  }
  assert.match(style, /#preview-stage :is\(input, textarea, select\)\s*\{[^}]*user-select:\s*text\s*!important;[^}]*-webkit-user-select:\s*text\s*!important;/u);
});

test('editing caret and text selection remain visible without a second outline', () => {
  assert.match(style, /\[data-akari-interaction-editing="true"\] \*\s*\{\s*caret-color:\s*#[0-9a-f]{6}\s*!important;/iu);
  assert.match(style, /\[data-akari-interaction-editing="true"\] \*::selection\s*\{[^}]*background:\s*#[0-9a-f]{6}/iu);
  assert.match(style, /html \[data-akari-interaction-editing="true"\]\s*\{\s*outline:\s*none\s*!important;/u);
  assert.match(style, /\.akari-interaction-selection-frame\[data-akari-interaction\]\s*\{\s*border:\s*1px solid/u);
});
