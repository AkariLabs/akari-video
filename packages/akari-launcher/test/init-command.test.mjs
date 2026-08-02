import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { runInitCommand } from '../src/init-command.mjs';
import { resolveRepoAssets } from '../src/repo-assets.mjs';
import { createCreatorRoot, defaultRootPath, DEFAULT_CHANNEL_NAME } from '../../creator-root/src/index.mjs';

/**
 * `akari init [path] [--channel <name>]`（タスク契約 tasks/2026-08-02-launcher-init）の
 * 検証。作業場の作成・確認だけを行う入口であり、プロジェクト作成も claude 起動も一切
 * 行わない。`creator-root-first-run.test.mjs` と同じ流儀（実 creator-root モジュールを
 * 使い、実 ~/.akari/ には触れない隔離 env）で分岐を検証する。
 */

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(packageRoot, '..', '..');
const assets = resolveRepoAssets(repoRoot);

test('このテストはモノレポ checkout 内で実行する前提', () => {
  assert.ok(assets.creatorRootModulePath, 'creator-root モジュールが見つからない（checkout 崩れの可能性）');
});

async function withScratchRoot(callback) {
  const root = await mkdtemp(join(tmpdir(), 'akari-init-command-test-'));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

// 実 ~/.akari/ や実 ~ に一切触れないよう、HOME・AKARI_HOME を隔離した env を作る。
// AKARI_CREATOR_ROOT は明示的に無効化し、開発機の実運用状態を拾わないようにする。
function isolatedEnv(root) {
  return {
    ...process.env,
    HOME: join(root, 'home'),
    AKARI_HOME: join(root, 'akari-home'),
    AKARI_CREATOR_ROOT: undefined
  };
}

function collectLogs() {
  const lines = [];
  const errors = [];
  return { log: (line) => lines.push(line), logError: (line) => errors.push(line), lines, errors };
}

test('引数なし × 既存あり: resolveCreatorRoot が見つけた作業場をそのまま出力し、何も作らない（ensure）', async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const rootDir = join(scratch, 'AkariVideo');
    await createCreatorRoot(rootDir);

    const { log, logError, lines } = collectLogs();
    const result = await runInitCommand([], {
      cwd: rootDir,
      env,
      assets,
      log,
      logError,
      createCreatorRoot: () => {
        throw new Error('既存の作業場があるので createCreatorRoot は呼ばれてはいけない');
      }
    });

    assert.equal(result.exitCode, 0);
    assert.equal(lines[0], rootDir, 'stdout 1 行目は作業場の絶対パス');
    assert.ok(lines.some((line) => line.includes('既存の作業場を確認しました')), '実出力: ' + JSON.stringify(lines));

    const pointer = JSON.parse(await readFile(join(env.AKARI_HOME, 'creator-root.json'), 'utf8'));
    assert.equal(pointer.lastRoot, rootDir, 'ensure でも updateMachinePointer が呼ばれること');
  });
});

test('引数なし × 既存なし: defaultRootPath に新規作成する', async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const cwd = join(scratch, 'somewhere');
    await mkdir(cwd, { recursive: true });

    const { log, logError, lines } = collectLogs();
    const result = await runInitCommand([], { cwd, env, assets, log, logError });

    const expectedRoot = defaultRootPath(env, { platform: process.platform });
    assert.equal(result.exitCode, 0);
    assert.equal(lines[0], expectedRoot, 'stdout 1 行目は作業場の絶対パス');
    assert.ok(lines.some((line) => line.includes('作業場を作成しました')), '実出力: ' + JSON.stringify(lines));

    const manifest = JSON.parse(await readFile(join(expectedRoot, '.akari', 'root.json'), 'utf8'));
    assert.equal(manifest.schema, 'creator-root/v1');
    assert.deepEqual(manifest.channels, [DEFAULT_CHANNEL_NAME]);

    const pointer = JSON.parse(await readFile(join(env.AKARI_HOME, 'creator-root.json'), 'utf8'));
    assert.equal(pointer.lastRoot, expectedRoot);
  });
});

test('パス指定作成: 指定パスに作業場を作成する', async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const cwd = join(scratch, 'somewhere');
    await mkdir(cwd, { recursive: true });
    const explicitTarget = join(scratch, 'my-workspace');

    const { log, logError, lines } = collectLogs();
    const result = await runInitCommand([explicitTarget], { cwd, env, assets, log, logError });

    assert.equal(result.exitCode, 0);
    assert.equal(lines[0], explicitTarget);
    assert.ok(lines.some((line) => line.includes('作業場を作成しました')), '実出力: ' + JSON.stringify(lines));

    const manifest = JSON.parse(await readFile(join(explicitTarget, '.akari', 'root.json'), 'utf8'));
    assert.equal(manifest.schema, 'creator-root/v1');
  });
});

test('冪等: 既に有効な作業場があるパスを指定すると no-op で同パスを出力し exit 0', async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const cwd = join(scratch, 'somewhere');
    await mkdir(cwd, { recursive: true });
    const explicitTarget = join(scratch, 'my-workspace');

    const first = collectLogs();
    const result1 = await runInitCommand([explicitTarget], { cwd, env, assets, log: first.log, logError: first.logError });
    assert.equal(result1.exitCode, 0);
    const manifestAfterFirst = JSON.parse(await readFile(join(explicitTarget, '.akari', 'root.json'), 'utf8'));

    const second = collectLogs();
    const result2 = await runInitCommand([explicitTarget], { cwd, env, assets, log: second.log, logError: second.logError });
    assert.equal(result2.exitCode, 0);
    assert.equal(second.lines[0], explicitTarget);
    assert.ok(second.lines.some((line) => line.includes('既存の作業場を確認しました')), '実出力: ' + JSON.stringify(second.lines));

    const manifestAfterSecond = JSON.parse(await readFile(join(explicitTarget, '.akari', 'root.json'), 'utf8'));
    assert.deepEqual(manifestAfterSecond, manifestAfterFirst, '2 回目で root.json が書き換わっていないこと（既存ファイルを上書きしない）');
  });
});

test('--channel: 指定した初期チャンネル名で作業場を作成する', async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const cwd = join(scratch, 'somewhere');
    await mkdir(cwd, { recursive: true });
    const explicitTarget = join(scratch, 'my-workspace');

    const { log, logError } = collectLogs();
    const result = await runInitCommand([explicitTarget, '--channel', 'my-crew'], { cwd, env, assets, log, logError });

    assert.equal(result.exitCode, 0);
    const manifest = JSON.parse(await readFile(join(explicitTarget, '.akari', 'root.json'), 'utf8'));
    assert.deepEqual(manifest.channels, ['my-crew']);
  });
});

test('--channel: 引数なし呼び出しでも channels の並びの先頭に反映される（既定パス作成）', async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const cwd = join(scratch, 'somewhere');
    await mkdir(cwd, { recursive: true });

    const { log, logError } = collectLogs();
    const result = await runInitCommand(['--channel', 'crew-b'], { cwd, env, assets, log, logError });

    assert.equal(result.exitCode, 0);
    const expectedRoot = defaultRootPath(env, { platform: process.platform });
    const manifest = JSON.parse(await readFile(join(expectedRoot, '.akari', 'root.json'), 'utf8'));
    assert.deepEqual(manifest.channels, ['crew-b']);
  });
});

test('破損 root.json（パス指定）: 既知でない schema の root.json があるパスを指定すると上書きせず exit 1', async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const cwd = join(scratch, 'somewhere');
    await mkdir(cwd, { recursive: true });
    const brokenTarget = join(scratch, 'broken-workspace');
    await mkdir(join(brokenTarget, '.akari'), { recursive: true });
    await writeFile(join(brokenTarget, '.akari', 'root.json'), 'not valid json{{{', 'utf8');

    const { log, logError, errors } = collectLogs();
    const result = await runInitCommand([brokenTarget], { cwd, env, assets, log, logError });

    assert.equal(result.exitCode, 1);
    assert.equal(errors.length, 1, 'stderr にエラー 1 行');
    assert.ok(errors[0].length > 0);

    const rawAfter = await readFile(join(brokenTarget, '.akari', 'root.json'), 'utf8');
    assert.equal(rawAfter, 'not valid json{{{', '既存ファイルを一切上書きしないこと');
  });
});

test('破損 root.json（祖先探索・引数なし）: cwd の祖先に壊れた作業場があると新規作成せず exit 1', async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const rootDir = join(scratch, 'AkariVideo');
    await mkdir(join(rootDir, '.akari'), { recursive: true });
    // schema フィールド自体が無い（未知 schema）壊れた root.json。
    await writeFile(join(rootDir, '.akari', 'root.json'), JSON.stringify({ notASchema: true }), 'utf8');

    const { log, logError, errors } = collectLogs();
    const result = await runInitCommand([], { cwd: rootDir, env, assets, log, logError });

    assert.equal(result.exitCode, 1);
    assert.equal(errors.length, 1, 'stderr にエラー 1 行');

    const rawAfter = await readFile(join(rootDir, '.akari', 'root.json'), 'utf8');
    assert.equal(rawAfter, JSON.stringify({ notASchema: true }), '既存ファイルを一切上書きしないこと');
  });
});

test('モジュール欠如: assets.creatorRootModulePath が無いと exit 1（init は静かにフォールバックしない）', async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const cwd = join(scratch, 'somewhere');
    await mkdir(cwd, { recursive: true });

    const { log, logError, errors } = collectLogs();
    const result = await runInitCommand([], {
      cwd,
      env,
      assets: { ...assets, creatorRootModulePath: null },
      log,
      logError
    });

    assert.equal(result.exitCode, 1);
    assert.equal(errors.length, 1, 'stderr にエラー 1 行');
    assert.ok(errors[0].includes('見つかりませんでした'), '実出力: ' + JSON.stringify(errors));
  });
});

test('--yes は受け取っても無視し、引数なしと同じ既定パス作成の挙動になる', async () => {
  await withScratchRoot(async (scratch) => {
    const env = isolatedEnv(scratch);
    const cwd = join(scratch, 'somewhere');
    await mkdir(cwd, { recursive: true });

    const { log, logError, lines } = collectLogs();
    const result = await runInitCommand(['--yes'], { cwd, env, assets, log, logError });

    const expectedRoot = defaultRootPath(env, { platform: process.platform });
    assert.equal(result.exitCode, 0);
    assert.equal(lines[0], expectedRoot);
  });
});
