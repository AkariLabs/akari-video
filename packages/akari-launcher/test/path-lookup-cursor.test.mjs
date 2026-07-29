import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { findCursorAgentExecutable } from '../src/path-lookup.mjs';

test('findCursorAgentExecutable: cursor-agent のみを探し、一般名 agent は無視する', () => {
  const dir = mkdtempSync(join(tmpdir(), 'akari-cursor-lookup-'));
  writeFileSync(join(dir, 'agent'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(dir, 'agent'), 0o755);

  assert.equal(findCursorAgentExecutable(dir, 'linux'), null);

  writeFileSync(join(dir, 'cursor-agent'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(dir, 'cursor-agent'), 0o755);

  assert.equal(findCursorAgentExecutable(dir, 'linux'), join(dir, 'cursor-agent'));
});
