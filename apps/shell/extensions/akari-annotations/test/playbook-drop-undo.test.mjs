import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { executePlaybookDrop } = require('../lib/browser/playbook-drop.js');
test('one history entry restores edit and imported files', async () => {
  let history; const calls = [];
  await executePlaybookDrop({ projectUri: 'file:///tmp/project', playbookDir: '/tmp/book', at: 0, name: 'Book',
    service: { placePlaybook: async () => { calls.push('place'); return { edit: { version: 2 }, rollback: { createdPaths: ['a'] } }; },
      undoPlacePlaybook: async () => { calls.push('undo-files'); } },
    commit: async (mutate, options) => { assert.equal(options.history, false); await mutate({ version: 2 }); return { before: '{}', after: '{"version":2}' }; },
    record: entry => { history = entry; }, restore: async source => { calls.push(source); }, reload: async () => {} });
  await history.undo();
  assert.deepEqual(calls, ['place', '{}', 'undo-files']);
});
