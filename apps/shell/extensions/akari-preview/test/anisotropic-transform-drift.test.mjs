import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { composeTransforms as store, effectiveScale } from '../../../../../packages/edit-store/lib/index.js';
import { composeTransforms as parts, effectiveScale as runtimeScale } from '../../../../../packages/overlay-runtime/src/parts.mjs';

test('three transform implementations agree on rotated parent and anisotropic leaves', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'akari-transform-'));
  try {
    const outfile = join(dir, 'transform.mjs');
    await build({ entryPoints: [new URL('../src/common/preview-transform.ts', import.meta.url).pathname], outfile,
      bundle: true, platform: 'node', format: 'esm' });
    const { composePreviewTransforms: shell } = await import(pathToFileURL(outfile));
    const parent = { x: 23, y: -17, scale: 1.8, rotate: 37 };
    for (const child of [{ x: 4, y: 8, scaleX: 2, rotate: 30 }, { scale: 3, scaleY: 0.5 }, { scaleX: 2, scaleY: 2 }, { scale: 2 }]) {
      const reference = { x: 0, y: 0, rotate: 0, ...store(parent, child) };
      for (const compose of [parts, shell]) assert.deepEqual(compose(parent, child), reference);
      assert.deepEqual(runtimeScale(child), effectiveScale(child));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
