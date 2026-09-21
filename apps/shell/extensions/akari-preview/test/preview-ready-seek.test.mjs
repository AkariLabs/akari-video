import assert from 'node:assert/strict';
import test from 'node:test';
import { createReadySeekResponder, requestReadyPreviewSeek } from '../lib/common/preview-ready-seek.js';

test('renderer waits for latest model, acknowledges once ready, and does not repeat a seek', async () => {
 let done, model = new Promise(resolve => { done = resolve; }), ready = false;
 const seeks = [], replies = [];
 const respond = createReadySeekResponder({ pageId: 'page', ready: () => ready, pendingModel: () => model,
  seek: time => seeks.push(time), reply: message => replies.push(message) });
 const request = { type: 'akari-preview-ready-seek', pageId: 'page', requestId: 1, time: 1.333 };
 await respond(request); assert.deepEqual(seeks, []);
 ready = true;
 const pending = respond(request);
 await respond(request); // A retry must not schedule a second seek while the model loads.
 model = Promise.resolve(); done(); await pending;
 assert.deepEqual(seeks, []); // Superseded model cannot be acknowledged.
 await respond(request); await respond(request);
 assert.deepEqual(seeks, [1.333]); assert.equal(replies.length, 2);
 await respond({ ...request, pageId: 'old', requestId: 2 }); assert.deepEqual(seeks, [1.333]);
});

test('host timeout and closed preview both remove their message subscription', async () => {
 for (const disposed of [false, true]) {
  let removed = false;
  await assert.rejects(requestReadyPreviewSeek({ pageId: () => 'page', disposed: () => disposed,
   send() {}, onMessage() { return { dispose() { removed = true; } }; }
  }, 0.4, 20), disposed ? /閉じられ/ : /再生準備/);
  assert.equal(removed, true);
 }
});
