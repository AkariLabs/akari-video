import assert from 'node:assert/strict';
import test from 'node:test';
import { ScrubController } from '../dist/index.js';

test('a scrub requested while a frame renders marks that frame stale and renders the latest next', async () => {
  const calls = [];
  let release;
  const firstDone = new Promise(resolve => { release = resolve; });
  const controller = new ScrubController(0, async (frame, generation) => {
    calls.push({ frame, generation });
    if (calls.length === 1) await firstDone;
  });
  controller.requestScrub(10);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(calls.length, 1);
  const first = calls[0];
  assert.equal(controller.isStale(first.generation), false);
  controller.requestScrub(20);
  controller.requestScrub(30);
  // 描画中の 10 はもう最新ではない（提示前に打ち切れる）。
  assert.equal(controller.isStale(first.generation), true);
  release();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(calls.map(call => call.frame), [10, 30]);
  assert.equal(controller.isStale(calls[1].generation), false);
  controller.dispose();
});
