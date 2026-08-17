// Exercises the pure open-focus-mode helper (apps/shell/extensions/akari-preview/src/browser/
// open-focus-mode.ts) against its compiled output, independent of the Electron/Theia runtime.
// Run: `npm run build` (or `tsc -b`) in this extension first, then `node --test test/*.test.mjs`
// from apps/shell/extensions/akari-preview/ — see package.json's "test" script for the combined
// command. createRequire is used (not a static ESM import) so this doesn't depend on Node's
// cjs-module-lexer correctly inferring named exports from the tsc-emitted CommonJS output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveOutputOpenFocusMode } = require('../lib/browser/open-focus-mode.js');

test('resolveOutputOpenFocusMode: no explicit mode, newly-created widget -> activate', () => {
    assert.equal(resolveOutputOpenFocusMode(undefined, false), 'activate');
});

test('resolveOutputOpenFocusMode: no explicit mode, already-open widget -> reveal (does not steal focus)', () => {
    assert.equal(resolveOutputOpenFocusMode(undefined, true), 'reveal');
});

test('resolveOutputOpenFocusMode: explicit mode always wins, regardless of wasAlreadyOpen', () => {
    assert.equal(resolveOutputOpenFocusMode('activate', true), 'activate');
    assert.equal(resolveOutputOpenFocusMode('reveal', false), 'reveal');
    assert.equal(resolveOutputOpenFocusMode('open', false), 'open');
    assert.equal(resolveOutputOpenFocusMode('open', true), 'open');
});
