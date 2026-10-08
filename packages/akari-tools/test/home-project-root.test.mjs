import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

import { findProjectRoot } from '../src/media/common.mjs';
import { parseCaptureArguments } from '../src/capture/arguments.mjs';
import { normalizeCaptureArgs } from '../bin/capture.mjs';

test('media and capture ignore the application home but keep a nested project', async (t) => {
  const root = await mkdtemp(join(process.env.TMPDIR, 'akari-tools-home-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const work = join(home, 'work');
  await mkdir(join(home, '.akari'), { recursive: true });
  await mkdir(work);
  const previous = process.env.AKARI_HOME;
  process.env.AKARI_HOME = join(home, '.akari');
  try {
    assert.equal(findProjectRoot(work), null);
    assert.throws(() => parseCaptureArguments(['-t', '1'], { cwd: work }), /project not found/u);
    assert.deepEqual(normalizeCaptureArgs(['--edit', 'edit.json', '-t', '1'], work), [
      '-p', work, '--edit', join(work, 'edit.json'), '-t', '1',
    ]);
    await mkdir(join(work, '.akari'));
    const nested = join(work, 'nested');
    await mkdir(nested);
    assert.equal(findProjectRoot(nested), work);
    assert.equal(parseCaptureArguments(['-t', '1'], { cwd: nested }).projectRoot, work);
    assert.deepEqual(normalizeCaptureArgs(['--edit', 'edit.json', '-t', '1'], nested), [
      '-p', work, '--edit', join(work, 'edit.json'), '-t', '1',
    ]);
  } finally {
    if (previous === undefined) delete process.env.AKARI_HOME;
    else process.env.AKARI_HOME = previous;
  }
});
