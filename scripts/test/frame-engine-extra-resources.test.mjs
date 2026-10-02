import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { packagedRoots, resolvePackagedSpecifier } from '../../apps/shell/test/helpers/packaged-imports.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const shellRoot = path.join(repoRoot, 'apps', 'shell');
const bundlePath = 'generated/frame-engine.iife.js';

test('extraResources includes the generated frame-engine bundle from an existing source file', async () => {
  const shellPackage = JSON.parse(await readFile(path.join(shellRoot, 'package.json'), 'utf8'));
  const resources = shellPackage.build.extraResources;
  const frameEngine = resources.find((entry) =>
    entry.from === '../../packages/frame-engine' && entry.to === 'packages/frame-engine');

  assert.ok(frameEngine, 'packages/frame-engine extraResources entry is missing');
  assert.ok(frameEngine.filter?.includes('generated/**/*'), 'generated/**/* filter is missing');

  const source = path.resolve(shellRoot, frameEngine.from, bundlePath);
  assert.ok((await stat(source)).isFile(), `bundle source is missing: ${source}`);

  const roots = packagedRoots(resources);
  for (const owner of ['gpu-export', 'osr-export']) {
    const result = resolvePackagedSpecifier('../../frame-engine/generated/frame-engine.iife.js', {
      fromPackagedPath: `resources/packages/${owner}/src/page-builder.mjs`,
      roots,
      shellRoot,
    });
    assert.ok(result.ok, `${owner}: ${result.reason}`);
    assert.equal(result.sourcePath, source);
  }
});
