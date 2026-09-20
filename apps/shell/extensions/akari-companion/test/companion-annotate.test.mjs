import assert from 'node:assert/strict';
import test from 'node:test';
import uriModule from '@theia/core/lib/common/uri.js';
import { applyCompanionAnnotation } from '../lib/browser/companion-annotate.js';

const URI = uriModule.default ?? uriModule;

function fixture(overrides = {}) {
  const calls = [];
  const deps = {
    currentProjectSessionId: () => 'session-1',
    currentLocation: () => ({
      reviewUri: new URI('file:///project/review.json'),
      root: new URI('file:///project')
    }),
    createAnnotation: async request => {
      calls.push(request);
      return { annotation: { id: 'a-0001' }, committed: false };
    },
    ...overrides
  };
  return { calls, deps };
}

const base = { projectSessionId: 'session-1', text: 'note', sourceT: 1 };

test('現在の review/root と external 印で注釈を作る', async () => {
  const { calls, deps } = fixture();
  const result = await applyCompanionAnnotation(base, deps);
  assert.deepEqual(result, { ok: true, value: { annotationId: 'a-0001' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].reviewUri, 'file:///project/review.json');
  assert.equal(calls[0].projectRootUri, 'file:///project');
  assert.equal(calls[0].intent, 'external');
  assert.equal(calls[0].target, null);
});

test('session 不一致では作らない', async () => {
  const { calls, deps } = fixture({ currentProjectSessionId: () => 'other' });
  assert.equal((await applyCompanionAnnotation(base, deps)).error, 'stale-session');
  assert.equal(calls.length, 0);
});

test('空文字と 2001 字を拒む', async () => {
  const { deps } = fixture();
  assert.equal((await applyCompanionAnnotation({ ...base, text: '' }, deps)).error, 'invalid-args');
  assert.equal((await applyCompanionAnnotation({ ...base, text: 'x'.repeat(2001) }, deps)).error, 'invalid-args');
});

test('sourceT null は文書・画像ターゲットだけに許す', async () => {
  const { calls, deps } = fixture();
  assert.equal((await applyCompanionAnnotation({ ...base, sourceT: null, target: 'cut:c-1' }, deps)).error, 'invalid-args');
  assert.equal((await applyCompanionAnnotation({ ...base, sourceT: null, target: 'doc:README.md#intro' }, deps)).ok, true);
  assert.equal(calls.length, 1);
});

test('範囲・文字列境界・例外を検査する', async () => {
  const { deps } = fixture();
  assert.equal((await applyCompanionAnnotation({ ...base, sourceRange: [2, 1] }, deps)).error, 'invalid-args');
  assert.equal((await applyCompanionAnnotation({ ...base, src: 'x'.repeat(513) }, deps)).error, 'invalid-args');
  const rejected = await applyCompanionAnnotation(base, {
    ...deps, createAnnotation: async () => { throw new Error('denied'); }
  });
  assert.deepEqual(rejected, { ok: false, error: 'rejected', value: { reasons: ['denied'] } });
});
