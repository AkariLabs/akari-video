import assert from 'node:assert/strict';
import test from 'node:test';

import { opencodeMissingGuidance } from '../src/messages.mjs';

test('opencodeMissingGuidance: インストール案内を返す', () => {
  const result = opencodeMissingGuidance();
  assert.ok(result.includes('opencode コマンドが見つかりませんでした'));
  assert.ok(result.includes('npm install -g opencode'));
  assert.ok(result.includes('akari --opencode'));
});