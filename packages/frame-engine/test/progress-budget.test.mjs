import assert from 'node:assert/strict';
import test from 'node:test';

import { TimeoutError, withProgressBudget } from '../dist/decode/guard.js';

test('progressing work may continue beyond its initial budget', async () => {
  let progress = 0;
  const progressTimer = setInterval(() => { progress += 1; }, 8);
  try {
    const value = await withProgressBudget(
      new Promise(resolve => setTimeout(() => resolve('ready'), 100)),
      { budgetMs: 20, stallMs: 1000, pollMs: 5, progress: () => progress, label: 'progressing' },
    );
    assert.equal(value, 'ready');
  } finally {
    clearInterval(progressTimer);
  }
});

test('stalled work times out only after both budget and stall thresholds', async () => {
  const started = performance.now();
  await assert.rejects(
    withProgressBudget(new Promise(() => undefined), {
      budgetMs: 25, stallMs: 45, pollMs: 5, progress: () => 0, label: 'stalled',
    }),
    TimeoutError,
  );
  assert.ok(performance.now() - started >= 40);
});

test('resolved work returns its value and clears the guard timer', async () => {
  const value = await withProgressBudget(Promise.resolve(42), {
    budgetMs: 10, stallMs: 10, pollMs: 2, progress: () => 0, label: 'resolved',
  });
  assert.equal(value, 42);
});
