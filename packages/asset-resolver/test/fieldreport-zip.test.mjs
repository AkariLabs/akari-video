import assert from 'node:assert/strict';
import test from 'node:test';
import { extractZipWithTools } from '../src/paid-zip.mjs';

test('zip extraction uses Windows tar when unzip is absent from PATH', () => {
  const called = [];
  extractZipWithTools('input.zip', 'out', {
    platform: 'win32',
    spawn(command, args) {
      called.push([command, args]);
      return command === 'tar.exe' ? { status: 0 } : { error: { code: 'ENOENT' } };
    },
  });
  assert.deepEqual(called, [['tar.exe', ['-xf', 'input.zip', '-C', 'out']]]);
});

test('zip extraction falls back in order and gives actionable missing-tools error', () => {
  const called = [];
  const missing = { status: null, error: { code: 'ENOENT' } };
  assert.throws(() => extractZipWithTools('input.zip', 'out', {
    platform: 'win32', spawn(command) { called.push(command); return missing; },
  }), /zip を展開できる道具が見つからない/);
  assert.deepEqual(called, ['tar.exe', 'unzip', 'powershell.exe']);
});
