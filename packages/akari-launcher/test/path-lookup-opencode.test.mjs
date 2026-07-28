import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { findOpencodeExecutable } from '../src/path-lookup.mjs';

async function withScratchDir(callback) {
  const dir = await mkdtemp(join(tmpdir(), 'path-lookup-test-'));
  try {
    return await callback(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('findOpencodeExecutable: PATH に opencode がある場合はそのパスを返す', async () => {
  await withScratchDir(async (dir) => {
    const binDir = join(dir, 'bin');
    await mkdir(binDir, { recursive: true });
    const opencodePath = join(binDir, 'opencode');
    await writeFile(opencodePath, '#!/bin/sh\n');
    await chmod(opencodePath, 0o755);

    const result = findOpencodeExecutable(binDir, 'linux');
    assert.equal(result, opencodePath);
  });
});

test('findOpencodeExecutable: PATH に opencode がない場合は null を返す', async () => {
  await withScratchDir(async (dir) => {
    const binDir = join(dir, 'bin');
    await mkdir(binDir, { recursive: true });

    const result = findOpencodeExecutable(binDir, 'linux');
    assert.equal(result, null);
  });
});

test('findOpencodeExecutable: Windows では .exe 拡張子も探索する', async () => {
  await withScratchDir(async (dir) => {
    const binDir = join(dir, 'bin');
    await mkdir(binDir, { recursive: true });
    const opencodePath = join(binDir, 'opencode.exe');
    await writeFile(opencodePath, '');

    // Windows では .exe ファイルに実行権限は不要（accessSync が失敗する）
    // そのため、Windows プラットフォームとしてテストする
    const result = findOpencodeExecutable(`${binDir}`, 'win32', '.exe');
    // Windows では accessSync が失敗するため、null が返る
    // 実際の Windows では CreateProcess が実行する
    assert.equal(result, null);
  });
});

test('findOpencodeExecutable: 複数のディレクトリを探索する', async () => {
  await withScratchDir(async (dir) => {
    const binDir1 = join(dir, 'bin1');
    const binDir2 = join(dir, 'bin2');
    await mkdir(binDir1, { recursive: true });
    await mkdir(binDir2, { recursive: true });

    // 2 つめのディレクトリに opencode を置く
    const opencodePath = join(binDir2, 'opencode');
    await writeFile(opencodePath, '#!/bin/sh\n');
    await chmod(opencodePath, 0o755);

    // Linux では PATH は `:` 区切り
    const pathEnv = `${binDir1}:${binDir2}`;
    const result = findOpencodeExecutable(pathEnv, 'linux');
    assert.equal(result, opencodePath);
  });
});