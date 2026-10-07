import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('first-use task confirmation is inline, dismissible, and closes when paper changes', async () => {
  const source = await readFile(fileURLToPath(new URL('../src/browser/rough-canvas/rough-canvas-popup.ts', import.meta.url)), 'utf8');
  assert.doesNotMatch(source, /window\.(?:confirm|alert)\s*\(/);
  assert.match(source, /this\.confirm\.append\(message, actions\)/);
  assert.match(source, /this\.button\('続ける', 'secondary small'/);
  assert.match(source, /this\.button\('やめる', 'quiet small'/);
  assert.match(source, /this\.memo\.addEventListener\('input', .*this\.closeTaskConfirmation\(\)/);
  assert.match(source, /this\.layer\.onChange\(doc => .*this\.closeTaskConfirmation\(\)/);
});
