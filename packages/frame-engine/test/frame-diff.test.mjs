import assert from 'node:assert/strict';
import test from 'node:test';
import { compareRgba } from '../dist/index.js';

test('golden comparator rejects an injected one-pixel mutation', () => {
  const preview = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255]);
  const mutatedExport = preview.slice();
  mutatedExport[0] += 1;
  const result = compareRgba(preview, mutatedExport);
  assert.equal(result.differingPixels, 1);
  assert.equal(result.differingBytes, 1);
  assert.equal(result.maxDelta, 1);
  assert.notEqual(result.meanAbsoluteDelta, 0);
});
