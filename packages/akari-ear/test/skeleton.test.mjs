import assert from 'node:assert/strict';
import test from 'node:test';
import { EAR_ENGINE_IDS, EAR_PURPOSES } from '../src/index.mjs';

test('聞き取りエンジンの ID は契約どおりで変更できない', () => {
  assert.deepEqual(EAR_ENGINE_IDS, ['speechanalyzer-live', 'record-then-transcribe']);
  assert.ok(Object.isFrozen(EAR_ENGINE_IDS));
});

test('耳の用途は契約どおりで変更できない', () => {
  assert.deepEqual(EAR_PURPOSES, ['trial', 'note', 'jev']);
  assert.ok(Object.isFrozen(EAR_PURPOSES));
});
