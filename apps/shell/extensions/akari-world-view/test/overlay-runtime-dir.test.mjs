import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { findOverlayRuntimeDirectory } = require('../lib/node/overlay-runtime-dir.js');

test('resolves the development ancestor candidate', () => {
  const root = mkdtempSync(join(tmpdir(), 'akari-world-runtime-'));
  const runtime = join(root, 'packages/overlay-runtime/src'); mkdirSync(join(runtime, 'vendor'), { recursive: true });
  writeFileSync(join(runtime, 'world-runtime.js'), ''); writeFileSync(join(runtime, 'vendor/world-camera.js'), '');
  assert.equal(findOverlayRuntimeDirectory(join(root, 'apps/shell/lib/backend')), runtime);
});
test('reports every attempted candidate when absent', () => {
  const root = mkdtempSync(join(tmpdir(), 'akari-world-runtime-missing-'));
  assert.throws(() => findOverlayRuntimeDirectory(join(root, 'a/b'), join(root, 'cwd')), /tried:/);
});
