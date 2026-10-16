import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { playbookShelfAction, playbookDragPayload, channelFromProjectPath } = require('../lib/common/playbook-shelf.js');
test('only templates (depth 3) drag; depth 1 and 2 open the playbook', () => {
  assert.equal(playbookShelfAction({ depth: 1 }), 'open');
  assert.equal(playbookShelfAction({ depth: 2, placeholders: [{ id: 'a' }] }), 'open');
  assert.equal(playbookShelfAction({ depth: 3 }), 'drag');
  assert.equal(playbookDragPayload({ id: 'x', name: 'X', depth: 3 }, '/tmp/x').kind, 'playbook');
  assert.equal(channelFromProjectPath('/tmp/root/channels/main/videos/project'), 'main');
});
