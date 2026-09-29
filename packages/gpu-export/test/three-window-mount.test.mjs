import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('GPU mounts every 3D scene before waiting for its sprite canvas', () => {
  const source = readFileSync(new URL('../src/page-runtime.js', import.meta.url), 'utf8');
  const start = source.indexOf('for (const value of config.spriteManifest.three)');
  const end = source.indexOf('for (const value of config.spriteManifest.vgpu', start);
  assert.ok(start >= 0 && end > start);
  const loop = source.slice(start, end);
  const mount = loop.indexOf('if (threeRuntime.inspect(container)?.status === "disposed") threeRuntime.render(container, 0);');
  const wait = loop.indexOf('await waitForThreeReady(threeRuntime, container, value.id);');
  assert.ok(mount >= 0 && wait > mount);
});
