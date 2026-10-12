import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runNewCommand } from '../src/new-command.mjs';

test('akari new --lang writes the generated intake and rejects invalid tags', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-new-language-'));
  try {
    const output = { log: () => {}, logError: () => {}, cwd: root };
    const help = [];
    assert.equal((await runNewCommand(['--help'], { ...output, log: (line) => help.push(line) })).exitCode, 0);
    assert.match(help.join('\n'), /--lang <code>/);
    for (const tag of ['en_US', 'english', '--bad']) {
      assert.equal((await runNewCommand(['--lang', tag, 'bad'], output)).exitCode, 1);
    }
    assert.equal((await runNewCommand(['--lang', 'en', 'project'], output)).exitCode, 0);
    const intake = JSON.parse(await readFile(join(root, 'project', '.akari', 'intake.json'), 'utf8'));
    assert.equal(intake.language, 'en');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
