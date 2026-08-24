import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { findHermesExecutable } from '../src/path-lookup.mjs';

async function withScratchDir(callback) {
  const dir = await mkdtemp(join(tmpdir(), 'path-lookup-hermes-test-'));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('findHermesExecutable: PATH に hermes がある場合はそのパスを返す', async () => {
  await withScratchDir(async (dir) => {
    const binDir = join(dir, 'bin');
    await mkdir(binDir, { recursive: true });
    const hermesPath = join(binDir, 'hermes');
    await writeFile(hermesPath, '#!/bin/sh\n');
    await chmod(hermesPath, 0o755);

    assert.equal(findHermesExecutable(binDir, 'linux'), hermesPath);
  });
});

test('findHermesExecutable: PATH に hermes がない場合は null を返す', async () => {
  await withScratchDir(async (dir) => {
    const binDir = join(dir, 'bin');
    await mkdir(binDir, { recursive: true });

    assert.equal(findHermesExecutable(binDir, 'linux'), null);
  });
});

test('findHermesExecutable: win32 では PATHEXT の拡張子候補を探索する', async () => {
  await withScratchDir(async (dir) => {
    const first = join(dir, 'bin1');
    const second = join(dir, 'bin2');
    await mkdir(first, { recursive: true });
    await mkdir(second, { recursive: true });
    const hermesPath = join(second, 'hermes.exe');
    await writeFile(hermesPath, '');
    await chmod(hermesPath, 0o755);

    assert.equal(findHermesExecutable(`${first};${second}`, 'win32', '.exe;.cmd'), hermesPath);
  });
});
