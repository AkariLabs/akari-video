import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseRoute } from '../lib/common/task-route.js';

test('配達先と件数から経路を選ぶ', () => {
  assert.deepEqual(chooseRoute({ target: 'cli', count: 1 }), { route: 'pty', pasteHint: false });
  assert.deepEqual(chooseRoute({ target: 'cli', count: 3 }), { route: 'pty', pasteHint: false });
  assert.deepEqual(chooseRoute({ target: 'extension', count: 1 }), { route: 'clipboard', pasteHint: true });
  assert.deepEqual(chooseRoute({ target: 'none', count: 2 }), { route: 'none', pasteHint: false });
  assert.deepEqual(chooseRoute({ target: 'cli', count: 0 }), { route: 'none', pasteHint: false });
});
