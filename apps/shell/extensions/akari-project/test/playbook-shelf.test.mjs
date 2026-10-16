import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { playbookShelfAction, playbookDragPayload, channelFromProjectPath } = require('../lib/common/playbook-shelf.js');
test('template and depth 2 placeholders drag; depth 1 opens', () => {
  assert.equal(playbookShelfAction({ depth: 1 }), 'open');
  assert.equal(playbookShelfAction({ depth: 2, placeholders: [{ id: 'a' }] }), 'drag');
  assert.equal(playbookShelfAction({ depth: 3 }), 'drag');
  assert.equal(playbookDragPayload({ id: 'x', name: 'X', depth: 3 }, '/tmp/x').kind, 'playbook');
  assert.equal(channelFromProjectPath('/tmp/root/channels/main/videos/project'), 'main');
});
