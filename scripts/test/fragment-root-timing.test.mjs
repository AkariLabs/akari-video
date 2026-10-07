import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { withoutFragmentRootTiming as resolverTiming } from '../../packages/asset-resolver/src/resolve.mjs';
import { withoutFragmentRootTiming as vibeTiming } from '../../packages/akari-vibe/live/companion/library-insert.mjs';
import { withoutFragmentRootTiming as runtimeTiming } from '../../packages/overlay-runtime/src/fragment-source-write.mjs';
import { VENDOR_SOURCES } from '../../packages/akari-launcher/src/vendor-sources.mjs';

const fixturePaths = [
  '../../packages/asset-resolver/test/fixtures/fragment-root-timing.json',
  '../../packages/akari-vibe/test/fixtures/fragment-root-timing.json',
  '../../packages/overlay-runtime/test-harness/fixtures/fragment-root-timing.json',
];
const implementations = [resolverTiming, vibeTiming, runtimeTiming];

test('3 パッケージの時刻変換表は同一で、3 実装は両モードで一致する', () => {
  const fixtures = fixturePaths.map(relative => readFileSync(new URL(relative, import.meta.url), 'utf8'));
  for (const fixture of fixtures.slice(1)) assert.equal(fixture, fixtures[0]);
  const table = JSON.parse(fixtures[0]);
  assert.equal(table.version, 1);
  assert.ok(table.cases.length > 1);
  for (const { name, source, plain, preserved } of table.cases) {
    for (const [options, expected] of [[undefined, plain], [{ preserveNaturalDuration: true }, preserved]]) {
      const outputs = implementations.map(transform => transform(source, options));
      assert.deepEqual(outputs, [expected, expected, expected], name);
    }
  }
});

test('共通照合テストは launcher の vendor 同梱対象外', () => {
  const file = 'scripts/test/fragment-root-timing.test.mjs';
  assert.equal(VENDOR_SOURCES.some(source => file === source || file.startsWith(`${source}/`)), false);
});
