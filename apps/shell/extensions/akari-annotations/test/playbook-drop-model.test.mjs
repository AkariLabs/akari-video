import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseLibraryDragPayload } = require('../lib/browser/library-drop-model.js');
test('playbook payload is accepted only for drag enabled depths', () => {
  assert.equal(parseLibraryDragPayload({ kind: 'playbook', id: 'intro', name: 'Intro', depth: 3, dir: '/tmp/intro' }).kind, 'playbook');
  assert.equal(parseLibraryDragPayload({ kind: 'playbook', id: 'intro', name: 'Intro', depth: 1, dir: '/tmp/intro' }), undefined);
});
