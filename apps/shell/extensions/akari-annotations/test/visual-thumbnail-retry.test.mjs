import assert from 'node:assert/strict';
import test from 'node:test';
import { visualThumbnailRetryPlan } from '../lib/common/visual-thumbnail-retry.js';

test('transient capture and IPC failures have exactly three delayed retries', () => {
  for (const failure of ['Visual thumbnail capture is busy', 'Visual thumbnail capture timed out',
    'Visual thumbnail has no visible pixels', 'IPC channel disconnected', new Error('ECONNRESET')]) {
    assert.deepEqual([1, 2, 3, 4, 5].map(attempt => visualThumbnailRetryPlan(failure, attempt, 100).nextAttemptAt),
      [5100, 15100, 45100, undefined, undefined]);
  }
});

test('explicit renderer failures override timeout wording, while stale results are discarded', () => {
  for (const failure of ['Invalid visual thumbnail page', 'Visual renderer failed',
    'Visual renderer readiness timed out', 'Visual thumbnail edit snapshot mismatch', 'SyntaxError: bad HTML',
    'Thumbnail input is outside the project', 'This item has no renderable overlay']) {
    assert.deepEqual(visualThumbnailRetryPlan(new Error(failure), 1, 100), { kind: 'permanent' });
  }
  assert.deepEqual(visualThumbnailRetryPlan(new Error('Stale visual thumbnail input'), 1, 100), { kind: 'stale' });
  for (const attempt of [0, -1, 1.5, NaN, Infinity]) assert.equal(visualThumbnailRetryPlan('busy', attempt, 100).nextAttemptAt, undefined);
});
