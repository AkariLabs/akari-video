import assert from 'node:assert/strict';
import test from 'node:test';
import { gateCompanionApplyEdit } from '../lib/node/companion-apply-edit-gate.js';

const location = {
  projectSessionId: 'session-1',
  rootFsPath: '/project',
  editFsPath: '/project/timeline.edit.json',
  captionsFsPath: '/project/captions.json'
};

const instruction = {
  id: 'i-1',
  kind: 'applyEdit',
  applyEdit: {
    projectSessionId: 'session-1', label: 'apply',
    edit: { baseSha256: 'a', nextText: '{}' },
    captions: { baseSha256: 'b', nextText: '[]' }
  }
};

test('applyEdit 以外は検査せず通す', async () => {
  let calls = 0;
  const result = await gateCompanionApplyEdit({ id: 'i', kind: 'getState' }, {
    currentLocation: () => undefined,
    lintCandidates: async () => { calls += 1; return { pass: false, errors: [] }; }
  });
  assert.equal(result, undefined);
  assert.equal(calls, 0);
});

test('場所なしと session 不一致を stale-session にする', async () => {
  for (const currentLocation of [() => undefined, () => ({ ...location, projectSessionId: 'other' })]) {
    let calls = 0;
    const result = await gateCompanionApplyEdit(instruction, {
      currentLocation,
      lintCandidates: async () => { calls += 1; return { pass: true, errors: [] }; }
    });
    assert.equal(result.error, 'stale-session');
    assert.equal(calls, 0);
  }
});

test('検査の失敗理由をそのまま返す', async () => {
  const result = await gateCompanionApplyEdit(instruction, {
    currentLocation: () => location,
    lintCandidates: async () => ({ pass: false, errors: ['first', 'second'] })
  });
  assert.deepEqual(result, {
    id: 'i-1', ok: false, error: 'rejected', value: { reasons: ['first', 'second'] }
  });
});

test('検査通過と中身の無い applyEdit は通す', async () => {
  assert.equal(await gateCompanionApplyEdit(instruction, {
    currentLocation: () => location,
    lintCandidates: async () => ({ pass: true, errors: [] })
  }), undefined);
  let calls = 0;
  assert.equal(await gateCompanionApplyEdit({
    id: 'empty', kind: 'applyEdit', applyEdit: { projectSessionId: 'session-1', label: 'empty' }
  }, {
    currentLocation: () => location,
    lintCandidates: async () => { calls += 1; return { pass: true, errors: [] }; }
  }), undefined);
  assert.equal(calls, 0);
});

test('候補名には basename だけを使う', async () => {
  let received;
  await gateCompanionApplyEdit(instruction, {
    currentLocation: () => location,
    lintCandidates: async (root, candidates) => {
      received = { root, candidates };
      return { pass: true, errors: [] };
    }
  });
  assert.deepEqual(received, {
    root: '/project', candidates: { 'timeline.edit.json': '{}', 'captions.json': '[]' }
  });
});
