// darwin ネイティブ clone 高速路（copyIntoProject 内の /bin/cp -Rc 経路）の単体テスト。
// 実行環境分岐: darwin 以外では該当経路が存在しないためスキップする。

import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { resolve as resolveAsset } from '../src/resolve.mjs';
import { setupFixtureEnv } from './helpers.mjs';

// resolve.mjs は `import { spawnSync } from 'node:child_process'`（named import）で束縛して
// いるため、t.mock.method で childProcess オブジェクトのプロパティを差し替えただけでは
// 既存の live binding に伝播しない。syncBuiltinESMExports() で明示的に同期させる。

const isDarwin = process.platform === 'darwin';
const originalSpawnSync = childProcess.spawnSync;

test(
  'resolve --project (darwin): cp -Rc が成功したらそれで完了する（fs.cp を経由しない）',
  { skip: isDarwin ? false : 'darwin 専用経路' },
  async (t) => {
    const { env, root } = setupFixtureEnv();
    const projectDir = path.join(root, 'project');
    mkdirSync(projectDir, { recursive: true });

    // ライブラリ側へ先に取得しておく（validate-asset の spawnSync 呼び出しを、
    // 後段でモックする /bin/cp 呼び出し検出と混線させないため）
    await resolveAsset('mini-still', { env });

    const calls = [];
    t.mock.method(childProcess, 'spawnSync', (cmd, args, opts) => {
      calls.push([cmd, args]);
      return originalSpawnSync(cmd, args, opts);
    });
    syncBuiltinESMExports();

    const result = await resolveAsset('mini-still', { env, project: projectDir });

    const cloneCalls = calls.filter(([cmd, args]) => cmd === '/bin/cp' && args?.[0] === '-Rc');
    assert.equal(cloneCalls.length, 1, '/bin/cp -Rc が 1 回呼ばれること');

    assert.equal(result.projectDir, path.join(projectDir, 'assets', 'still', 'mini-still'));
    assert.ok(existsSync(path.join(result.projectDir, 'meta.json')));
    assert.ok(existsSync(path.join(result.projectDir, 'fragment.html')));

    const meta = JSON.parse(readFileSync(path.join(result.projectDir, 'meta.json'), 'utf8'));
    assert.equal(meta.id, 'mini-still');
  },
);

test(
  'resolve --project (darwin): cp -Rc が失敗したら fs.cp フォールバックで実体化される',
  { skip: isDarwin ? false : 'darwin 専用経路' },
  async (t) => {
    const { env, root } = setupFixtureEnv();
    const projectDir = path.join(root, 'project');
    mkdirSync(projectDir, { recursive: true });

    await resolveAsset('mini-still', { env });
    const libraryMetaPath = path.join(env.AKARI_HOME, 'assets', 'still', 'mini-still', 'meta.json');
    const expectedMeta = readFileSync(libraryMetaPath, 'utf8');

    t.mock.method(childProcess, 'spawnSync', (cmd, args, opts) => {
      if (cmd === '/bin/cp' && args?.[0] === '-Rc') {
        // クロスボリューム等で -c が失敗するケースを模擬（クローン不可 → 非 0 終了）
        return { status: 1, signal: null, error: null, stdout: '', stderr: 'forced failure for test' };
      }
      return originalSpawnSync(cmd, args, opts);
    });
    syncBuiltinESMExports();

    const result = await resolveAsset('mini-still', { env, project: projectDir });

    assert.equal(result.projectDir, path.join(projectDir, 'assets', 'still', 'mini-still'));
    assert.ok(existsSync(path.join(result.projectDir, 'meta.json')));
    assert.ok(existsSync(path.join(result.projectDir, 'fragment.html')));

    // フォールバックでもバイト同一（fs.cp COPYFILE_FICLONE 経路が正しく完了している）
    const actualMeta = readFileSync(path.join(result.projectDir, 'meta.json'), 'utf8');
    assert.equal(actualMeta, expectedMeta);
  },
);
