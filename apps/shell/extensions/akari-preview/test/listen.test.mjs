import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { listen } = require('../lib/browser/akari-preview-listen.js');

test('listen receives an event and removes the handler on dispose', () => {
  const target = new EventTarget();
  let calls = 0;
  const disposable = listen(target, 'sample', () => { calls++; });
  target.dispatchEvent(new Event('sample'));
  assert.equal(calls, 1);
  disposable.dispose();
  target.dispatchEvent(new Event('sample'));
  assert.equal(calls, 1);
});

test('listen uses the same capture option when adding and removing', () => {
  const records = [];
  class RecordingTarget extends EventTarget {
    addEventListener(type, listener, options) {
      records.push({ op: 'add', type, listener, options });
      super.addEventListener(type, listener, options);
    }
    removeEventListener(type, listener, options) {
      records.push({ op: 'remove', type, listener, options });
      super.removeEventListener(type, listener, options);
    }
  }
  const hasMatchingCapture = entries => entries.length === 2
    && entries[0].op === 'add' && entries[1].op === 'remove'
    && entries[0].type === entries[1].type
    && entries[0].listener === entries[1].listener
    && entries[0].options === true && entries[1].options === true;
  const target = new RecordingTarget();
  const handler = () => {};
  listen(target, 'keydown', handler, true).dispose();
  assert.equal(hasMatchingCapture(records), true);
  records.length = 0;
  // The same check rejects an implementation that drops capture on removal.
  function brokenListen(eventTarget, type, listener, options) {
    eventTarget.addEventListener(type, listener, options);
    return { dispose: () => eventTarget.removeEventListener(type, listener) };
  }
  brokenListen(target, 'keydown', handler, true).dispose();
  assert.equal(hasMatchingCapture(records), false);
});

test('one handler can be disposed separately for two event types', () => {
  const target = new EventTarget();
  const seen = [];
  const handler = event => { seen.push(event.type); };
  const first = listen(target, 'first', handler);
  const second = listen(target, 'second', handler);
  first.dispose();
  target.dispatchEvent(new Event('first'));
  target.dispatchEvent(new Event('second'));
  assert.deepEqual(seen, ['second']);
  second.dispose();
  target.dispatchEvent(new Event('second'));
  assert.deepEqual(seen, ['second']);
});

test('disposing a listener twice does not throw', () => {
  const target = new EventTarget();
  const disposable = listen(target, 'sample', () => {});
  disposable.dispose();
  assert.doesNotThrow(() => disposable.dispose());
});
