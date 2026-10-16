import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const { readInternalEdit, timelineDurationSeconds } = createRequire(import.meta.url)('../lib/index.js');

test('planned groups alone retain their 45-second output duration', () => {
  const edit = { version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [],
    tracks: [{ id: 'visual', lane: 'visual', items: [
      { id: 'hook', at: 0, duration: 90, source: { kind: 'group', canvas: { origin: 'plan', durationMode: 'fixed' } }, items: [] },
      { id: 'body', at: 90, duration: 990, source: { kind: 'group', canvas: { origin: 'plan', durationMode: 'fixed' } }, items: [] },
      { id: 'reaction', at: 1080, duration: 270, source: { kind: 'group', canvas: { origin: 'plan', durationMode: 'fixed' } }, items: [] }
    ] }] };
  assert.equal(timelineDurationSeconds(readInternalEdit(edit)).seconds, 45);
});
