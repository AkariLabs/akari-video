import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { ALLOWED_MISSING, scanVendorImports } from './helpers/vendor-import-scan.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const prepack = path.join(repo, 'packages/akari-launcher/scripts/prepack.mjs');
const originalValidator = path.join(repo, 'packages/schemas/bin/validate-asset.mjs');
const fixture = path.join(repo, 'packages/schemas/test/fixtures/asset/valid-scene3d-texts-only/scene3d/hero-texts-only');

function runNode(script, fixturePath) {
  const result = spawnSync(process.execPath, [script, fixturePath], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout.replaceAll(fixturePath, '<fixture>').trim(), stderr: result.stderr.replaceAll(fixturePath, '<fixture>').trim() };
}

test('vendored JavaScript has a complete relative import closure and a working asset validator', async () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'issue-81-vendor-'));
  const vendor = path.join(scratch, 'vendor');
  try {
    const packed = spawnSync(process.execPath, [prepack, '--vendor-root', vendor], { cwd: repo, encoding: 'utf8' });
    assert.equal(packed.status, 0, packed.stderr);
    const imports = scanVendorImports(vendor);
    assert.deepEqual(imports.allowed, [...ALLOWED_MISSING.keys()].sort(), 'stale test-only import exception');
    assert.deepEqual(imports.unexpected, [], `missing relative imports/requires in vendor\nall unresolved: ${imports.unresolved.join('\n')}`);

    // runtimes.mjs loads these by path at runtime, outside the import graph.
    const runtimeRoot = path.join(vendor, 'packages/overlay-runtime');
    const { runtimes, registryPath } = await import(pathToFileURL(path.join(runtimeRoot, 'runtimes.mjs')).href);
    assert.ok(existsSync(registryPath), 'runtime registry is vendored');
    assert.ok(existsSync(path.join(runtimeRoot, 'test-harness/fonts/ZenKakuGothicNew-Black.ttf')));
    for (const runtime of runtimes) {
      for (const script of runtime.scripts) {
        assert.ok(existsSync(path.join(runtimeRoot, script.path)), `${runtime.id}: ${script.path}`);
      }
    }

    const vendoredValidator = path.join(vendor, 'packages/schemas/bin/validate-asset.mjs');
    const original = runNode(originalValidator, fixture);
    const vendored = runNode(vendoredValidator, fixture);
    assert.equal(original.status, 0, original.stderr);
    assert.equal(vendored.status, 0, vendored.stderr);
    assert.match(vendored.stdout, /^OK:/u);
    assert.deepEqual(vendored, original);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
