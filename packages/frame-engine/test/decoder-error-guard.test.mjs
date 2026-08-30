import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDecoderErrorGuard,
  readDeclaredAcceleration,
} from '../dist/decode/guard.js';

function installWindow(t) {
  const previous = globalThis.window;
  const listeners = new Map();
  const stub = {
    addEventListener(type, listener) {
      const registered = listeners.get(type) ?? new Set();
      registered.add(listener);
      listeners.set(type, registered);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type, fields) {
      let prevented = false;
      const event = {
        ...fields,
        preventDefault() { prevented = true; },
      };
      for (const listener of listeners.get(type) ?? []) listener(event);
      return prevented;
    },
  };
  globalThis.window = stub;
  t.after(() => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });
  return stub;
}

const hardwareError = 'VideoDecoder error: Unsupported configuration config: {"hardwareAcceleration":"prefer-hardware"}';
const softwareError = 'VideoDecoder error: Unsupported configuration config: {"hardwareAcceleration":"prefer-software"}';

test('readDeclaredAcceleration reads supported config values', () => {
  assert.equal(readDeclaredAcceleration(hardwareError), 'prefer-hardware');
  assert.equal(readDeclaredAcceleration(softwareError), 'prefer-software');
  assert.equal(readDeclaredAcceleration('VideoDecoder error: Unsupported configuration'), null);
});

test('guard ignores an error declaring a different acceleration', async t => {
  const window = installWindow(t);
  const guard = createDecoderErrorGuard({ acceleration: 'prefer-software', graceMs: 5 });
  assert.equal(window.dispatch('error', { message: hardwareError }), false);
  assert.equal(guard.observed(), null);
  assert.equal(await Promise.race([
    guard.failure.then(() => 'rejected', () => 'rejected'),
    new Promise(resolve => setTimeout(() => resolve('pending'), 15)),
  ]), 'pending');
  guard.stop();
});

test('operation success within grace wins over an observed decoder error', async t => {
  const window = installWindow(t);
  const guard = createDecoderErrorGuard({ graceMs: 30 });
  window.dispatch('error', { message: hardwareError });
  const result = await Promise.race([Promise.resolve('decoded'), guard.failure]);
  assert.equal(result, 'decoded');
  assert.equal(guard.observed(), hardwareError);
  guard.stop();
});

test('failure rejects after grace and preserves the first message', async t => {
  const window = installWindow(t);
  const guard = createDecoderErrorGuard({ graceMs: 5 });
  window.dispatch('error', { message: hardwareError });
  window.dispatch('error', { message: softwareError });
  await assert.rejects(guard.failure, new RegExp(hardwareError.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
  assert.equal(guard.observed(), hardwareError);
  guard.stop();
});

test('stop prevents later detection and rejection', async t => {
  const window = installWindow(t);
  const guard = createDecoderErrorGuard({ graceMs: 5 });
  guard.stop();
  assert.equal(window.dispatch('error', { message: hardwareError }), false);
  assert.equal(guard.observed(), null);
  assert.equal(await Promise.race([
    guard.failure.then(() => 'rejected', () => 'rejected'),
    new Promise(resolve => setTimeout(() => resolve('pending'), 15)),
  ]), 'pending');
});

test('createError controls the rejection type', async t => {
  class CustomDecoderError extends Error {}
  const window = installWindow(t);
  const guard = createDecoderErrorGuard({
    graceMs: 5,
    createError: message => new CustomDecoderError(message),
  });
  window.dispatch('unhandledrejection', { reason: new Error(hardwareError) });
  await assert.rejects(guard.failure, CustomDecoderError);
  guard.stop();
});
