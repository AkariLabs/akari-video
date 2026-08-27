import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = join(packageRoot, '../..');
const read = path => readFile(path, 'utf8');

test('shell と Web UI は edit-store の同一 ducking kernel だけを使う', async () => {
  const [kernel, webConsumer, shellConsumer, bundle] = await Promise.all([
    read(join(repositoryRoot, 'packages/edit-store/src/ducking.ts')),
    read(join(packageRoot, 'public/app.js')),
    read(join(repositoryRoot, 'apps/shell/extensions/akari-preview/src/browser/akari-preview-open-handler.ts')),
    read(join(packageRoot, 'public/edit-kernel.bundle.js')),
  ]);

  for (const definition of [
    /export const STATIC_DUCK_GAIN_DB\s*=/gu,
    /export function computeBgmDuckGainDb\(/gu,
    /export function computeDuckIntervals\(/gu,
    /export function isWithinDuckInterval\(/gu,
  ]) {
    assert.equal((kernel.match(definition) ?? []).length, 1);
  }

  const duckingLiteral = /(^|[^\d.])-12(?![\d.])/mu;
  assert.doesNotMatch(webConsumer, duckingLiteral);
  assert.doesNotMatch(shellConsumer, duckingLiteral);
  assert.doesNotMatch(webConsumer, /narrationNodes\.some\s*\(\s*n\s*=>[\s\S]{0,180}?n\._buffer\.duration/u);
  assert.doesNotMatch(shellConsumer, /decoded\.narration\.some\s*\([\s\S]{0,180}?item\.durationSec/u);

  assert.match(webConsumer,
    /import\s*\{[^}]*\bcomputeBgmDuckGainDb\b[^}]*\bcomputeDuckIntervals\b[^}]*\}\s*from '\/edit-kernel\.bundle\.js';/u);
  assert.match(shellConsumer,
    /import\s*\{[^}]*\bcomputeDuckIntervals\b[^}]*\bisWithinDuckInterval\b[^}]*\bSTATIC_DUCK_GAIN_DB\b[^}]*\}\s*from '@akari-video\/edit-store';/u);
  assert.match(shellConsumer, /computeDuckIntervals\.toString\(\)/u);
  assert.match(shellConsumer, /isWithinDuckInterval\.toString\(\)/u);
  assert.match(shellConsumer, /JSON\.stringify\(STATIC_DUCK_GAIN_DB\)/u);
  assert.match(bundle, /\.\.\/edit-store\/src\/ducking\.ts/u);
});
