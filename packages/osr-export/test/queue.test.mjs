import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { BoundedAsyncQueue, writeWithDrain } from "../src/encode.mjs";

test("bounded queue は深さ上限で producer を待たせる", async () => {
  const queue = new BoundedAsyncQueue(2);
  await queue.push(1);
  await queue.push(2);
  let completed = false;
  const third = queue.push(3).then(() => { completed = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, false);
  assert.equal((await queue.next()).value, 1);
  await third;
  assert.equal(queue.maximumSize, 2);
  queue.close();
});

test("write false は drain まで必ず待つ", async () => {
  const stream = new EventEmitter();
  stream.write = () => false;
  const stats = { awaitCount: 0, totalWaitMs: 0, maxWaitMs: 0 };
  let completed = false;
  const write = writeWithDrain(stream, Buffer.alloc(1), stats).then(() => { completed = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, false);
  stream.emit("drain");
  await write;
  assert.equal(stats.awaitCount, 1);
  assert.equal(stream.listenerCount("error"), 0);
  assert.equal(stream.listenerCount("drain"), 0);
});

test("多数回の drain 待機でも error listener を増やさない", async () => {
  const stream = new EventEmitter();
  stream.write = () => false;
  const stats = { awaitCount: 0, totalWaitMs: 0, maxWaitMs: 0 };
  for (let index = 0; index < 32; index += 1) {
    const pending = writeWithDrain(stream, Buffer.alloc(1), stats);
    stream.emit("drain");
    await pending;
  }
  assert.equal(stream.listenerCount("error"), 0);
  assert.equal(stream.listenerCount("drain"), 0);
});
