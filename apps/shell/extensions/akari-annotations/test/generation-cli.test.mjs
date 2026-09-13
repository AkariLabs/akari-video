import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { GenerationCliManager, generationDraftPath } from '../lib/node/generation-cli.js';

test('GenerationCliManager は偽 CLI を非 detached で起動し stdout を保持する', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'akari-generation-cli-'));
  try {
    await mkdir(path.dirname(generationDraftPath(root, 'clip-a')), { recursive: true });
    await writeFile(generationDraftPath(root, 'clip-a'), JSON.stringify({ modelId: 'fal:h3-i2v', inputs: {}, output: {} }));
    let invocation;
    const spawnImpl = (command, args, options) => {
      invocation = { command, args, options };
      const child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = () => true; child.exitCode = null; child.killed = false;
      queueMicrotask(() => { child.stdout.emit('data', Buffer.from('{"ok":true}\n')); child.emit('close', 0); });
      return child;
    };
    const manager = new GenerationCliManager({ spawnImpl, env: { AKARI_GENERATE_CLI: '/tmp/fake-generate.mjs' } });
    const result = await manager.start(root, 'clip-a');
    assert.equal(result.ok, true);
    assert.equal(result.stdout, '{"ok":true}\n');
    assert.equal(invocation.options.detached, false);
    assert.deepEqual(invocation.args.slice(1, 4), ['generate', 'video', root]);
    assert.ok(invocation.args.includes('--yes'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('generationDraftPath は itemId のパストラバーサルを拒否する', () => {
  assert.throws(() => generationDraftPath('/tmp/project', '../outside'), /itemId/);
});
