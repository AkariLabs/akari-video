import assert from 'node:assert/strict';
import test from 'node:test';

import { buildHarnessArgv, parseHarnessArgs } from '../src/harnesses.mjs';

test('parseHarnessArgs: explicit harness flags are stripped and last wins', () => {
  assert.deepEqual(parseHarnessArgs(['--cursor', '--continue']), {
    harness: 'cursor',
    filteredArgs: ['--continue'],
    autoConfirm: false,
  });
  assert.deepEqual(parseHarnessArgs(['--codex', '-y', 'fix lint']), {
    harness: 'codex',
    filteredArgs: ['fix lint'],
    autoConfirm: true,
  });
});

test('buildHarnessArgv: auto-confirm maps to harness-specific flags', () => {
  assert.deepEqual(buildHarnessArgv('claude', true, ['--continue']), ['--permission-mode', 'acceptEdits', '--continue']);
  assert.deepEqual(buildHarnessArgv('opencode', true, []), ['--auto']);
  assert.deepEqual(buildHarnessArgv('cursor', true, ['--continue']), ['--force', '--continue']);
  assert.deepEqual(buildHarnessArgv('codex', true, []), ['--full-auto']);
});
