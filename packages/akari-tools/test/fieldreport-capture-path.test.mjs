import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { normalizeCaptureArgs } from '../bin/capture.mjs';
import { parseCaptureArguments } from '../src/capture/arguments.mjs';

test('capture --edit selects the nearest project ancestor', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fieldreport-capture-'));
  try {
    await mkdir(join(root, '.akari'));
    await mkdir(join(root, 'review'));
    const nested = normalizeCaptureArgs(['--edit', 'review/edit.json', '-t', '1'], root);
    assert.deepEqual(nested, [
      '-p', root, '--edit', join(root, 'review', 'edit.json'), '-t', '1',
    ]);
    assert.equal(parseCaptureArguments(nested, { cwd: root }).projectRoot, root);
    const outside = join(root, 'elsewhere');
    await mkdir(outside);
    assert.deepEqual(normalizeCaptureArgs(['--edit', 'elsewhere/edit.json', '-t', '1'], root).slice(0, 4), [
      '-p', root, '--edit', join(outside, 'edit.json'),
    ]);
    // An edit outside any project falls back to the edit file's directory.
    const detached = await mkdtemp(join(tmpdir(), 'fieldreport-detached-'));
    try {
      assert.deepEqual(normalizeCaptureArgs(['--edit', 'edit.json', '-t', '1'], detached).slice(0, 4), [
        '-p', detached, '--edit', join(detached, 'edit.json'),
      ]);
    } finally { await rm(detached, { recursive: true, force: true }); }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
