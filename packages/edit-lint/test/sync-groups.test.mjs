import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEditV2 } from '../src/lint/edit-v2.mjs';

test('sync group lint checks missing sources and duplicate membership', () => {
  const edit = { version: 2, output: { width: 320, height: 180, fps: 30 },
    sources: [{ id: 'cam', path: 'cam.mp4' }, { id: 'mic', path: 'mic.wav' }],
    tracks: [{ id: 'v', lane: 'visual', items: [] }],
    sync_groups: [{ id: 'take', members: [
      { source: 'cam', offset_sec: 0 }, { source: 'mic', offset_sec: 0.2 },
    ] }] };
  const lint = value => { const findings = []; validateEditV2(value, findings); return findings; };
  assert.equal(lint(edit).filter(item => item.check === 'v2.sync-groups').length, 0);
  const missing = structuredClone(edit);
  missing.sync_groups[0].members[1].source = 'missing';
  assert.equal(lint(missing).filter(item => item.check === 'v2.sync-groups').length, 1);
  const duplicate = structuredClone(edit);
  duplicate.sync_groups.push(structuredClone(duplicate.sync_groups[0]));
  assert.ok(lint(duplicate).filter(item => item.check === 'v2.sync-groups').length >= 2);
});
