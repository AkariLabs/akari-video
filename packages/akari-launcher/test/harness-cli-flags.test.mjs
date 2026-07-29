import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { findClaudeExecutable, findOpencodeExecutable } from '../src/path-lookup.mjs';

function helpText(bin) {
  const r = spawnSync(bin, ['--help'], { encoding: 'utf8', timeout: 10000 });
  if (r.error || r.status !== 0) return null;
  return `${r.stdout}\n${r.stderr}`;
}

test('CLI smoke: claude --help に permission-mode がある', { skip: findClaudeExecutable() ? false : 'claude not installed' }, () => {
  const help = helpText('claude');
  assert.ok(help, 'claude --help failed');
  assert.match(help, /permission-mode/);
});

test('CLI smoke: opencode --help に --auto がある', { skip: findOpencodeExecutable() ? false : 'opencode not installed' }, () => {
  const help = helpText('opencode');
  assert.ok(help, 'opencode --help failed');
  assert.match(help, /--auto/);
});
