import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasOperationReason } from '../lib/common/canvas-operation-reason.js';

test('内部の型名と英語を表示理由へ通さない', () => {
  assert.equal(canvasOperationReason(new Error('group は重複しない 2 個以上の id を必要とします。')),
    '2 つ以上選んでください。');
  assert.equal(canvasOperationReason(new Error('v2.group-bake-blocked: keyframes')),
    '操作できません。選択と時刻を確認してください。');
});
